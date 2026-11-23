/**
 * DM Bank edition: holographic token HUD.
 *  - Turn marker: counter-rotating red HUD rings with a cyan inner dial (replaces the core sprite)
 *  - Your own target: animated targeting reticle (only you see it)
 *  - Other users' targets: small square pips in each user's colour (core style, squares instead of dots)
 */
import { ncSetting } from "./util.js";

const RED = 0xff2a3d;
const RED_DEEP = 0x8a0618;
const CYAN = 0x3ef2ff;
const WHITE = 0xf2f2f2;
const TAU = Math.PI * 2;

/** Draw an arc segment as a stroked path. */
function arc(g, r, start, end, width, color, alpha = 1) {
  g.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.BUTT });
  g.moveTo(Math.cos(start) * r, Math.sin(start) * r);
  g.arc(0, 0, r, start, end);
}

/* ------------------------------------------------------------------ */
/*  Turn marker                                                         */
/* ------------------------------------------------------------------ */

function buildTurnMarker(radius) {
  const root = new PIXI.Container();
  root.ncRadius = radius;

  // soft glow disc
  const glow = new PIXI.Graphics();
  glow.beginFill(RED, 0.12).drawCircle(0, 0, radius * 1.02).endFill();
  glow.beginFill(RED, 0.08).drawCircle(0, 0, radius * 0.86).endFill();
  root.addChild(glow);

  // outer thin ring with ticks
  const outer = new PIXI.Graphics();
  arc(outer, radius, 0, TAU, Math.max(1.5, radius * 0.018), RED, 0.9);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    const long = i % 4 === 0;
    const r1 = radius * (long ? 1.05 : 1.025);
    outer.lineStyle({ width: long ? 2 : 1, color: long ? RED : RED_DEEP, alpha: 0.9 });
    outer.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
    outer.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
  }
  root.addChild(outer);

  // thick segmented ring (like the reference HUD ring)
  const segments = new PIXI.Graphics();
  const segCount = 6;
  for (let i = 0; i < segCount; i++) {
    const a0 = (i / segCount) * TAU + 0.08;
    const a1 = ((i + 1) / segCount) * TAU - 0.08;
    arc(segments, radius * 0.9, a0, a1, Math.max(3, radius * 0.07), RED, 0.85);
  }
  root.addChild(segments);

  // dashed inner ring
  const dashed = new PIXI.Graphics();
  const dashCount = 28;
  for (let i = 0; i < dashCount; i++) {
    const a0 = (i / dashCount) * TAU;
    arc(dashed, radius * 0.76, a0, a0 + (TAU / dashCount) * 0.55, Math.max(1.5, radius * 0.025), RED, 0.75);
  }
  root.addChild(dashed);

  // cyan dial with 4 notches
  const dial = new PIXI.Graphics();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    arc(dial, radius * 0.66, a - 0.32, a + 0.32, Math.max(1.5, radius * 0.02), CYAN, 0.9);
    dial.beginFill(CYAN, 0.95);
    dial.drawCircle(Math.cos(a) * radius * 0.66, Math.sin(a) * radius * 0.66, Math.max(1.5, radius * 0.022));
    dial.endFill();
  }
  root.addChild(dial);

  // bloom copy of the segmented ring
  const bloom = new PIXI.Graphics();
  for (let i = 0; i < segCount; i++) {
    const a0 = (i / segCount) * TAU + 0.08;
    const a1 = ((i + 1) / segCount) * TAU - 0.08;
    arc(bloom, radius * 0.9, a0, a1, Math.max(6, radius * 0.16), RED, 0.55);
  }
  root.addChildAt(bloom, 1);
  if (PIXI.filters?.BlurFilter) {
    glow.filters = [new PIXI.filters.BlurFilter(Math.max(2, radius * 0.04))];
    bloom.filters = [new PIXI.filters.BlurFilter(Math.max(4, radius * 0.08))];
  }
  root.ncParts = { glow, bloom, outer, segments, dashed, dial };
  return root;
}

function patchTurnMarker() {
  const TTM = foundry.canvas.placeables.tokens.TokenTurnMarker;
  if (!TTM || TTM.prototype._ncPatched) return;
  TTM.prototype._ncPatched = true;
  const originalDraw = TTM.prototype.draw;
  const originalAnimate = TTM.prototype.animate;

  TTM.prototype.draw = async function ncDraw() {
    await originalDraw.call(this);
    if (!ncSetting("tokenHud")) return;
    if (this.mesh) this.mesh.alpha = 0; // keep the core mesh for sizing, hide it
    this.ncHud?.destroy({ children: true });
    const token = this.token;
    const radius = Math.max(token.w, token.h) * 0.92;
    this.ncHud = this.addChild(buildTurnMarker(radius));
  };

  TTM.prototype.animate = function ncAnimate(deltaTime) {
    if (!this.ncHud) return originalAnimate.call(this, deltaTime);
    if (!this.visible) return;
    const t = canvas.app.ticker.lastTime / 1000;
    this.rotation = 0;
    this.scale.set(1);
    const p = this.ncHud.ncParts;
    p.outer.rotation = t * 0.25;
    p.segments.rotation = -t * 0.6;
    p.bloom.rotation = -t * 0.6;
    p.bloom.alpha = 0.6 + 0.4 * Math.sin(t * 2.2);
    p.dashed.rotation = t * 1.1;
    p.dial.rotation = -t * 0.4;
    p.glow.alpha = 0.65 + 0.35 * Math.sin(t * 3);
    const radius = Math.max(this.token.w, this.token.h) * 0.92;
    if (Math.abs(radius - this.ncHud.ncRadius) > 1) {
      this.ncHud.destroy({ children: true });
      this.ncHud = this.addChild(buildTurnMarker(radius));
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Targets                                                             */
/* ------------------------------------------------------------------ */

const animated = new Set();

function buildReticle(size) {
  const root = new PIXI.Container();
  const r = size * 0.62;

  const arcs = new PIXI.Graphics();
  for (let i = 0; i < 4; i++) {
    const mid = (i / 4) * TAU;
    arc(arcs, r, mid + 0.35, mid + TAU / 4 - 0.35, 2, WHITE, 0.9);
    // tick marks on the arcs
    for (const off of [0.6, TAU / 4 - 0.6]) {
      const a = mid + off;
      arcs.lineStyle({ width: 2, color: WHITE, alpha: 0.9 });
      arcs.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      arcs.lineTo(Math.cos(a) * (r - 7), Math.sin(a) * (r - 7));
    }
  }
  root.addChild(arcs);

  const dots = new PIXI.Graphics();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    dots.beginFill(WHITE, 1).drawRect(Math.cos(a) * (r + 1) - 2.5, Math.sin(a) * (r + 1) - 2.5, 5, 5).endFill();
  }
  root.addChild(dots);

  const center = new PIXI.Graphics();
  const b = size * 0.11;
  const g = size * 0.035;
  center.lineStyle({ width: 3, color: WHITE, alpha: 1 });
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    center.moveTo(sx * g, sy * (g + b * 0.6));
    center.lineTo(sx * g, sy * g);
    center.lineTo(sx * (g + b * 0.6), sy * g);
  }
  center.lineStyle({ width: 1, color: WHITE, alpha: 0.7 });
  center.moveTo(-b * 1.6, 0).lineTo(-g * 0.6, 0);
  center.moveTo(b * 1.6, 0).lineTo(g * 0.6, 0);
  center.moveTo(0, -b * 1.6).lineTo(0, -g * 0.6);
  center.moveTo(0, b * 1.6).lineTo(0, g * 0.6);
  root.addChild(center);

  const lock = new PIXI.Graphics();
  arc(lock, r * 0.82, 0, TAU, 1, RED, 0.6);
  root.addChild(lock);

  root.ncParts = { arcs, dots, center, lock };
  root.ncBorn = performance.now();
  return root;
}

function patchTargets() {
  const TokenClass = foundry.canvas.placeables.Token;
  if (TokenClass.prototype._ncTargetPatched) return;
  TokenClass.prototype._ncTargetPatched = true;
  const originalArrows = TokenClass.prototype._drawTargetArrows;
  const originalPips = TokenClass.prototype._drawTargetPips;

  TokenClass.prototype._drawTargetArrows = function ncArrows(options = {}) {
    if (!ncSetting("tokenHud")) return originalArrows.call(this, options);
    this.targetArrows.clear();
    this.targetArrows.ncReticle?.destroy({ children: true });
    this.targetArrows.ncReticle = null;
    animated.delete(this);
    if (!this.targeted.size || !this.targeted.has(game.user)) return;
    const size = Math.max(this.w, this.h);
    const reticle = buildReticle(size);
    reticle.position.set(this.w / 2, this.h / 2);
    this.targetArrows.ncReticle = this.targetArrows.addChild(reticle);
    animated.add(this);
  };

  // Other users' targets: like core (one pip per user, in that user's colour, top-left corner),
  // but drawn as small squares instead of circles.
  TokenClass.prototype._drawTargetPips = function ncPips() {
    if (!ncSetting("tokenHud")) return originalPips.call(this);
    this.targetPips.clear();
    this.targetPips.ncRam?.destroy({ children: true });
    this.targetPips.ncRam = null;
    if (!this.targeted.size) return;
    const others = Array.from(this.targeted).filter((u) => u !== game.user);
    if (!others.length) return;
    const size = Math.max(10, Math.round(canvas.dimensions.uiScale ? 12 * canvas.dimensions.uiScale : 12));
    const gap = Math.round(size * 0.35);
    others.forEach((user, i) => {
      const c = Number(user.color?.valueOf?.() ?? user.color);
      const color = Number.isFinite(c) ? c : CYAN;
      const x = i * (size + gap);
      this.targetPips
        .beginFill(color, 1)
        .lineStyle({ width: 2, color: 0x000000, alpha: 0.85 })
        .drawRect(x, 0, size, size)
        .endFill();
    });
  };
}

function tick() {
  if (!animated.size) return;
  const now = performance.now();
  const t = now / 1000;
  for (const token of animated) {
    if (token.destroyed) {
      animated.delete(token);
      continue;
    }
    const reticle = token.targetArrows?.ncReticle;
    if (reticle && !reticle.destroyed) {
      const p = reticle.ncParts;
      const age = (now - reticle.ncBorn) / 1000;
      // lock-on: shrink in from 1.6x during the first 0.35s
      const lockIn = Math.min(1, age / 0.35);
      reticle.scale.set(1 + (1 - lockIn) * 0.6);
      reticle.alpha = 0.4 + lockIn * 0.6;
      p.arcs.rotation = t * 0.8;
      p.dots.rotation = -t * 0.3;
      p.lock.rotation = -t * 1.4;
      p.center.alpha = 0.75 + 0.25 * Math.sin(t * 6);
    }
    if (!reticle) animated.delete(token);
  }
}

export default function registerTokenHud() {
  Hooks.once("init", () => {
    // Patching happens at init so tokens drawn on the first canvas already use it.
    patchTurnMarker();
    patchTargets();
  });
  Hooks.on("canvasReady", () => {
    canvas.app.ticker.remove(tick);
    canvas.app.ticker.add(tick);
  });
}

/** For hot reload during development. */
export function applyTokenHudNow() {
  patchTurnMarker();
  patchTargets();
  canvas.app.ticker.remove(tick);
  canvas.app.ticker.add(tick);
  for (const token of canvas.tokens.placeables) {
    token.renderFlags.set({ refreshTarget: true, refreshTurnMarker: true });
    token.turnMarker?.draw();
  }
}
