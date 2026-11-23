/**
 * DM Bank: VIRTUALITY — an AR view of the local network for characters wearing Virtuality
 * (installed cyberware) or Virtuality Goggles (equipped gear).
 *
 * GM authoring (Walls controls):
 *  - "AR Cable" preset: walls with no restrictions, flagged ar=cable (red). Drawn like any wall.
 *  - "AR Barrier" preset: walls with no restrictions, flagged ar=barrier (green). They block the
 *    AR scan only; players never see them.
 *  - "Jack-In Point" tool: click to place, drag to move, right-click to remove (scene flag).
 *
 * Player view: toggle from the Token controls. A scan ring sweeps out from the token, the world
 * goes dark green, and inside the scan radius (default 20 m, blocked by barriers) the cables show
 * with running glow pulses and the jack-in points light up. Purely client side.
 */
import { NC_SCOPE } from "../util.js";
import { T } from "../net/i18n.js";
import { metresPerUnit } from "../combat/ranges.js";

const SYS = "cyberpunk-red-core-dmbank";
const FLAG_POINTS = "arPoints";
const RANGE_KEY = "nc.arRange";
const COL = { cable: 0xff3b4e, cableHot: 0xffc2c9, barrier: 0x39ff8a, jack: 0x43f1ff, veil: 0x010805, tint: 0x06301b, scan: 0x5dffa8 };

const AR = {
  on: false,
  tokenId: null,
  started: 0,
  root: null, // PIXI container (view)
  gfx: null,
  dom: null,
  ticker: null,
  poly: null, // [x,y,...] full visibility polygon
  polyKey: "",
  clock: null,
  // editor
  edit: null, // PIXI container for GM jack-point editing
  drag: null,
};

/** Line with round caps (works for PIXI and SmoothGraphics). */
function line(g, width, color, alpha, a, b) {
  try {
    g.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
  } catch (err) {
    g.lineStyle(width, color, alpha);
  }
  g.moveTo(a.x, a.y).lineTo(b.x, b.y);
}

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const arType = (wall) => wall?.flags?.[SYS]?.ar ?? wall?.document?.flags?.[SYS]?.ar ?? null;

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */
export function virtualitySource(actor) {
  if (!actor) return null;
  const quick = new Set((actor.getFlag?.(NC_SCOPE, "loadout")?.quick ?? []).filter(Boolean));
  let fallback = null;
  for (const i of actor.items) {
    const name = `${i.name} ${i._source?.name ?? ""} ${i.flags?.babele?.originalName ?? ""}`;
    if (!/virtuality|vr\s*goggles/i.test(name)) continue;
    // Virtuality cyberware (cybereye option) must be installed.
    if (i.type === "cyberware") {
      if (i.system.isInstalled) return i;
      continue;
    }
    // Virtuality Goggles (gear): equipped, on a quick-use slot, or simply carried on the character.
    // Only "owned" (stashed at home) does not count.
    const eq = i.system?.equipped;
    if (eq === "equipped" || quick.has(i.id)) return i;
    if (eq === "carried" || eq === undefined) fallback ??= i;
  }
  return fallback;
}

function viewToken() {
  const ctl = canvas.tokens?.controlled ?? [];
  const pick = ctl.find((t) => t.isOwner && (game.user.isGM || virtualitySource(t.actor))) ?? ctl.find((t) => t.isOwner);
  if (pick) return pick;
  const own = game.user.character?.getActiveTokens?.()[0];
  return own ?? null;
}

function rangePx() {
  let m = 20;
  try {
    m = Number(game.settings.get(NC_SCOPE, RANGE_KEY)) || 20;
  } catch (err) {
    /* not registered yet */
  }
  const pxPerMetre = canvas.grid.size / ((canvas.scene.grid.distance || 1) * metresPerUnit());
  return m * pxPerMetre;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
function arWalls(kind) {
  return (canvas.scene?.walls ?? []).filter((w) => arType(w) === kind).map((w) => ({ id: w.id, a: { x: w.c[0], y: w.c[1] }, b: { x: w.c[2], y: w.c[3] } }));
}

function jackPoints(scene = canvas.scene) {
  return foundry.utils.deepClone(scene?.getFlag(SYS, FLAG_POINTS) ?? []);
}

function raySeg(o, dx, dy, s) {
  const ex = s.b.x - s.a.x;
  const ey = s.b.y - s.a.y;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const ax = s.a.x - o.x;
  const ay = s.a.y - o.y;
  const t = (ax * ey - ay * ex) / den;
  const u = (ax * dy - ay * dx) / den;
  if (t < 0 || u < 0 || u > 1) return Infinity;
  return t;
}

/** Visibility polygon around `o` with radius `R`, blocked by barrier segments. */
function visibility(o, R, segs) {
  const near = segs.filter((s) => {
    const minX = Math.min(s.a.x, s.b.x) - R;
    const maxX = Math.max(s.a.x, s.b.x) + R;
    const minY = Math.min(s.a.y, s.b.y) - R;
    const maxY = Math.max(s.a.y, s.b.y) + R;
    return o.x >= minX && o.x <= maxX && o.y >= minY && o.y <= maxY;
  });
  const angles = [];
  for (let i = 0; i < 72; i++) angles.push((i / 72) * Math.PI * 2 - Math.PI);
  for (const s of near) {
    for (const p of [s.a, s.b]) {
      if (Math.hypot(p.x - o.x, p.y - o.y) > R + 2) continue;
      const a = Math.atan2(p.y - o.y, p.x - o.x);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
  }
  angles.sort((x, y) => x - y);
  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = R;
    for (const s of near) t = Math.min(t, raySeg(o, dx, dy, s));
    pts.push(o.x + dx * t, o.y + dy * t);
  }
  return pts;
}

function segHits(p, q, segs) {
  for (const s of segs) {
    const d1x = q.x - p.x;
    const d1y = q.y - p.y;
    const d2x = s.b.x - s.a.x;
    const d2y = s.b.y - s.a.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((s.a.x - p.x) * d2y - (s.a.y - p.y) * d2x) / den;
    const u = ((s.a.x - p.x) * d1y - (s.a.y - p.y) * d1x) / den;
    if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */
function arcSvg() {
  const ticks = [];
  for (let d = 0; d < 360; d += 3) {
    const a = (d * Math.PI) / 180;
    const long = d % 30 === 0;
    const r1 = 452;
    const r2 = long ? 434 : 444;
    ticks.push(`<line x1="${(500 + Math.cos(a) * r1).toFixed(1)}" y1="${(500 + Math.sin(a) * r1).toFixed(1)}" x2="${(500 + Math.cos(a) * r2).toFixed(1)}" y2="${(500 + Math.sin(a) * r2).toFixed(1)}"${long ? ' class="l"' : ""}/>`);
  }
  const arc = (r, a0, a1) => {
    const p = (deg) => [500 + Math.cos((deg * Math.PI) / 180) * r, 500 + Math.sin((deg * Math.PI) / 180) * r].map((v) => v.toFixed(1)).join(" ");
    return `M${p(a0)} A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${p(a1)}`;
  };
  return `<svg class="ar-arcs" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs><path id="ar-top" d="${arc(476, 200, 340)}"/></defs>
      <g class="spin-a"><circle cx="500" cy="500" r="470" class="thin dash"/></g>
      <g class="spin-b">${ticks.join("")}</g>
      <path class="thick" d="${arc(462, 150, 210)}"/><path class="thick" d="${arc(462, -30, 30)}"/>
      <path class="mid" d="${arc(420, 235, 305)}"/><path class="mid" d="${arc(420, 55, 125)}"/>
      <circle cx="500" cy="500" r="380" class="hair"/>
      <path class="tri" d="M64 500 l18 -9 v18z M936 500 l-18 -9 v18z"/>
      <text class="arc-txt"><textPath href="#ar-top" startOffset="50%" text-anchor="middle">VIRTUALITY  ·  LOCAL NETWORK  ·  AR LINK</textPath></text>
    </svg>`;
}

function codeColumn(rows = 22) {
  const r = () => Math.random();
  const out = [];
  for (let i = 0; i < rows; i++) out.push(`${r().toFixed(5)}  ${Math.floor(r() * 9)} . ${Math.floor(r() * 9)}  ${Math.floor(r() * 9)}  ${Math.floor(r() * 9)}`);
  return out.join("<br>");
}

function placeDom() {
  if (!AR.dom) return;
  const right = document.getElementById("ui-right") ?? document.getElementById("sidebar");
  const r = right?.getBoundingClientRect();
  AR.dom.style.setProperty("--ar-right", `${r && r.width ? window.innerWidth - r.left + 24 : 24}px`);
}

function buildDom(token) {
  AR.dom?.remove();
  const el = document.createElement("div");
  el.id = "dmb-ar";
  el.innerHTML = `
    <div class="ar-tint"></div><div class="ar-scan"></div><div class="ar-noise"></div>
    ${arcSvg()}
    <div class="ar-chev l">${"<i></i>".repeat(9)}</div><div class="ar-chev r">${"<i></i>".repeat(9)}</div>
    <div class="ar-code">${codeColumn()}</div>
    <div class="ar-data">
      <div class="ar-data-head"><span class="ar-rec"></span><b>${esc(T("Scan results"))}</b><span class="ar-time">--:--:--</span></div>
      <div class="ar-data-name">${esc(token?.name ?? "")}</div>
      <div class="ar-row"><small>${esc(T("jack-in points in range"))}</small><b class="ar-nodes">0</b></div>
      <div class="ar-row"><small>${esc(T("cables in range"))}</small><b class="ar-lines">0</b></div>
      <div class="ar-row"><small>${esc(T("Scan radius"))}</small><b class="ar-range">20 m</b></div>
      <div class="ar-feed"><i></i><i></i><i></i><i></i><i></i></div>
    </div>`;
  document.body.append(el);
  AR.dom = el;
  placeDom();
  const tick = () => {
    const t = el.querySelector(".ar-time");
    if (t) t.textContent = new Date().toTimeString().slice(0, 8);
    const c = el.querySelector(".ar-code");
    if (c && Math.random() < 0.5) c.innerHTML = codeColumn();
  };
  tick();
  clearInterval(AR.clock);
  AR.clock = setInterval(tick, 1000);
  requestAnimationFrame(() => el.classList.add("on"));
}

function buildPixi() {
  destroyPixi();
  const root = new PIXI.Container();
  root.eventMode = "none";
  const veil = new PIXI.Graphics();
  const tint = new PIXI.Graphics();
  const Smooth = PIXI.smooth?.SmoothGraphics ?? PIXI.Graphics;
  const cablesGlow = new Smooth();
  const cables = new Smooth();
  const mask = new PIXI.Graphics();
  const marks = new Smooth();
  const ring = new Smooth();
  const labels = new PIXI.Container();
  try {
    const res = canvas.app?.renderer?.resolution ?? window.devicePixelRatio ?? 1;
    cablesGlow.filters = [new PIXI.BlurFilter(12, 6, res)];
  } catch (err) {
    /* no filters */
  }
  const masked = new PIXI.Container();
  masked.addChild(cablesGlow, cables, marks, labels);
  masked.mask = mask;
  root.addChild(veil, tint, mask, masked, ring);
  (canvas.interface ?? canvas.stage).addChild(root);
  AR.root = root;
  AR.gfx = { veil, tint, cablesGlow, cables, mask, marks, ring, labels };
  AR.labelPool = [];
}

function destroyPixi() {
  if (AR.root) AR.root.destroy({ children: true });
  AR.root = null;
  AR.gfx = null;
  AR.labelPool = [];
}

function labelAt(i, text, x, y, alpha) {
  let t = AR.labelPool[i];
  if (!t) {
    t = new PIXI.Text("", new PIXI.TextStyle({ fontFamily: "Tektur, Jost, sans-serif", fontSize: Math.max(12, canvas.grid.size * 0.2), fill: COL.jack, stroke: 0x000000, strokeThickness: 4, letterSpacing: 2 }));
    t.anchor.set(0.5, 0);
    AR.labelPool[i] = t;
    AR.gfx.labels.addChild(t);
  }
  t.text = text;
  t.position.set(x, y);
  t.alpha = alpha;
  t.visible = true;
}

function frame() {
  if (!AR.gfx) return;
  if (AR.closing) {
    const k = 1 - (performance.now() - AR.closing) / 650;
    if (k <= 0) return finishStop();
    AR.root.alpha = k * k;
  } else if (!AR.on) return;
  const token = canvas.tokens.get(AR.tokenId);
  if (!token) return stopView();
  const g = AR.gfx;
  const now = performance.now();
  const age = (now - AR.started) / 1000;
  const R = rangePx();
  const o = token.center;
  const barriers = arWalls("barrier");
  const reveal = Math.min(1, age / 1.2);
  const rr = R * (1 - Math.pow(1 - reveal, 3));
  const key = `${Math.round(o.x)}:${Math.round(o.y)}:${Math.round(rr)}:${AR.wallsRev ?? 0}`;
  if (key !== AR.polyKey) {
    AR.poly = visibility(o, Math.max(4, rr), barriers);
    AR.polyKey = key;
    const d = canvas.dimensions;
    g.veil.clear().beginFill(COL.veil, 0.93).drawRect(d.sceneX - d.size * 4, d.sceneY - d.size * 4, d.sceneWidth + d.size * 8, d.sceneHeight + d.size * 8);
    g.veil.beginHole().drawPolygon(AR.poly).endHole().endFill();
    g.tint.clear().beginFill(COL.tint, 0.62).drawPolygon(AR.poly).endFill();
    g.tint.lineStyle(2, COL.scan, 0.35).drawPolygon(AR.poly);
    g.mask.clear().beginFill(0xffffff).drawPolygon(AR.poly).endFill();
  }

  // cables + running pulses
  const cables = arWalls("cable");
  g.cables.clear();
  g.cablesGlow.clear();
  let lines = 0;
  for (const s of cables) {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (len < 1) continue;
    const midIn = Math.hypot((s.a.x + s.b.x) / 2 - o.x, (s.a.y + s.b.y) / 2 - o.y) < R + len / 2;
    if (midIn) lines++;
    const w = Math.max(2.5, canvas.grid.size * 0.05);
    line(g.cablesGlow, w * 4, COL.cable, 0.7, s.a, s.b);
    line(g.cables, w * 2.4, COL.cable, 0.28, s.a, s.b);
    line(g.cables, w, COL.cable, 1, s.a, s.b);
    const ux = (s.b.x - s.a.x) / len;
    const uy = (s.b.y - s.a.y) / len;
    const spacing = Math.max(90, canvas.grid.size * 1.8);
    const pl = Math.max(22, canvas.grid.size * 0.6);
    const phase = ((now / 1000) * canvas.grid.size * 2.2) % spacing;
    const at = (d) => ({ x: s.a.x + ux * d, y: s.a.y + uy * d });
    for (let d0 = phase - spacing; d0 < len + pl; d0 += spacing) {
      // a comet: bright head, fading tail
      for (let k = 0; k < 4; k++) {
        const a = Math.max(0, d0 + (pl * k) / 4);
        const b = Math.min(len, d0 + (pl * (k + 1)) / 4);
        if (b <= a) continue;
        const al = 0.25 + k * 0.25;
        line(g.cables, w * (1 + k * 0.15), COL.cableHot, al, at(a), at(b));
        line(g.cablesGlow, w * 6, 0xff6b78, al, at(a), at(b));
      }
    }
    // little node caps at both ends
    g.cables.lineStyle(0).beginFill(COL.cable, 1).drawCircle(s.a.x, s.a.y, w * 1.4).drawCircle(s.b.x, s.b.y, w * 1.4).endFill();
  }

  // jack-in points, token brackets
  g.marks.clear();
  AR.labelPool.forEach((t) => (t.visible = false));
  const pts = jackPoints();
  let nodes = 0;
  const pulse = (Math.sin(now / 300) + 1) / 2;
  const sz = canvas.grid.size;
  pts.forEach((p, i) => {
    const inRange = Math.hypot(p.x - o.x, p.y - o.y) <= R && !segHits(o, p, barriers);
    if (inRange) nodes++;
    const r = sz * 0.28;
    g.marks.lineStyle(2, COL.jack, 0.9).beginFill(COL.jack, 0.18);
    g.marks.drawPolygon([p.x, p.y - r, p.x + r, p.y, p.x, p.y + r, p.x - r, p.y]).endFill();
    g.marks.lineStyle(1.5, COL.jack, 0.25 + 0.6 * (1 - pulse)).drawCircle(p.x, p.y, r * (1.3 + pulse * 1.2));
    g.marks.lineStyle(0).beginFill(0xffffff, 0.9).drawCircle(p.x, p.y, 2.5).endFill();
    labelAt(i, p.label || "JACK-IN", p.x, p.y + r * 1.4, 0.95);
  });
  for (const t of canvas.tokens.placeables) {
    if (t === token || !t.visible) continue;
    const c = t.center;
    if (Math.hypot(c.x - o.x, c.y - o.y) > R || segHits(o, c, barriers)) continue;
    const disp = t.document.disposition;
    const col = disp < 0 ? COL.cable : COL.scan;
    const b = t.bounds;
    const k = Math.min(b.width, b.height) * 0.25;
    g.marks.lineStyle(2, col, 0.9);
    for (const [x, y, sx, sy] of [[b.left, b.top, 1, 1], [b.right, b.top, -1, 1], [b.left, b.bottom, 1, -1], [b.right, b.bottom, -1, -1]]) {
      g.marks.moveTo(x, y + sy * k).lineTo(x, y).lineTo(x + sx * k, y);
    }
  }

  // scan ring: the opening sweep, then a faint sweep every few seconds; reticle on the token
  g.ring.clear();
  const sweep = age < 1.4 ? age / 1.2 : ((age - 1.4) % 5) / 1.6;
  if (sweep <= 1) {
    const a = age < 1.4 ? 0.9 : 0.35;
    g.ring.lineStyle(age < 1.4 ? 5 : 2, COL.scan, a * (1 - sweep * 0.6)).drawCircle(o.x, o.y, Math.max(2, R * Math.min(1, sweep)));
    g.ring.lineStyle(18, COL.scan, 0.08 * (1 - sweep)).drawCircle(o.x, o.y, Math.max(2, R * Math.min(1, sweep)));
  }
  const rr2 = token.w * 0.75;
  const rot = now / 900;
  g.ring.lineStyle(1.5, COL.scan, 0.8).drawCircle(o.x, o.y, rr2);
  for (let i = 0; i < 4; i++) {
    const a0 = rot + (i * Math.PI) / 2;
    g.ring.moveTo(o.x + Math.cos(a0) * rr2, o.y + Math.sin(a0) * rr2).lineTo(o.x + Math.cos(a0) * (rr2 + 10), o.y + Math.sin(a0) * (rr2 + 10));
  }
  g.ring.lineStyle(1, COL.scan, 0.25).drawCircle(o.x, o.y, R);

  if (AR.dom) {
    const n = AR.dom.querySelector(".ar-nodes");
    if (n && n.textContent !== String(nodes)) n.textContent = String(nodes);
    const l = AR.dom.querySelector(".ar-lines");
    if (l && l.textContent !== String(lines)) l.textContent = String(lines);
  }
}

function startView(token) {
  AR.on = true;
  AR.closing = 0;
  AR.tokenId = token.id;
  AR.started = performance.now();
  AR.polyKey = "";
  buildPixi();
  buildDom(token);
  let m = 20;
  try {
    m = Number(game.settings.get(NC_SCOPE, RANGE_KEY)) || 20;
  } catch (err) {
    /* default */
  }
  const r = AR.dom?.querySelector(".ar-range");
  if (r) r.textContent = `${m} m`;
  if (!AR.ticker) {
    AR.ticker = () => frame();
    canvas.app.ticker.add(AR.ticker);
  }
  document.body.classList.add("dmb-ar-on");
}

function stopView() {
  if (!AR.on && !AR.closing) return;
  AR.on = false;
  clearInterval(AR.clock);
  if (AR.dom) {
    const el = AR.dom;
    AR.dom = null;
    el.classList.remove("on");
    el.classList.add("off");
    setTimeout(() => el.remove(), 700);
  }
  document.body.classList.remove("dmb-ar-on");
  refreshTool();
  if (AR.gfx && AR.ticker && !AR.closing) AR.closing = performance.now();
  else finishStop();
}

function finishStop() {
  AR.closing = 0;
  if (AR.ticker) canvas.app?.ticker?.remove(AR.ticker);
  AR.ticker = null;
  destroyPixi();
}

/** Toggle the AR view. Returns whether it is on afterwards. */
export function toggleVirtuality(force) {
  const want = force ?? !AR.on;
  if (!want) {
    stopView();
    return false;
  }
  const token = viewToken();
  if (!token) {
    ui.notifications.warn(T("Select your token first."));
    refreshTool();
    return false;
  }
  if (!game.user.isGM && !virtualitySource(token.actor)) {
    ui.notifications.warn(T("You need Virtuality installed, or Virtuality Goggles equipped, to see the AR overlay."));
    refreshTool();
    return false;
  }
  if (AR.on || AR.closing) {
    stopView();
    finishStop();
  }
  startView(token);
  refreshTool();
  return true;
}

function refreshTool() {
  const tool = ui.controls?.controls?.tokens?.tools?.dmbVirtuality;
  if (tool) tool.active = AR.on;
  try {
    ui.controls?.render({ parts: ["tools"] });
  } catch (err) {
    /* older render signature */
  }
}

/* ------------------------------------------------------------------ */
/* GM editor: jack-in points + coloured AR walls                       */
/* ------------------------------------------------------------------ */
const editing = () => game.user.isGM && ui.controls?.control?.name === "walls";
const jackTool = () => editing() && ui.controls?.tool?.name === "dmbArJack";

function drawEditor() {
  if (!editing() || !canvas.ready) {
    AR.edit?.destroy({ children: true });
    AR.edit = null;
    return;
  }
  if (!AR.edit || AR.edit.destroyed) {
    AR.edit = new PIXI.Container();
    AR.edit.eventMode = "none";
    (canvas.interface ?? canvas.stage).addChild(AR.edit);
  }
  AR.edit.removeChildren().forEach((c) => c.destroy());
  const g = new PIXI.Graphics();
  AR.edit.addChild(g);
  const sz = canvas.grid.size;
  const pts = AR.drag ? AR.drag.points : jackPoints();
  for (const p of pts) {
    const r = sz * 0.28;
    g.lineStyle(2, COL.jack, 1).beginFill(COL.jack, 0.25).drawPolygon([p.x, p.y - r, p.x + r, p.y, p.x, p.y + r, p.x - r, p.y]).endFill();
    g.lineStyle(1, COL.jack, 0.5).drawCircle(p.x, p.y, r * 1.6);
    const t = new PIXI.Text(p.label || "JACK-IN", new PIXI.TextStyle({ fontFamily: "Tektur, Jost, sans-serif", fontSize: Math.max(12, sz * 0.18), fill: COL.jack, stroke: 0x000000, strokeThickness: 4 }));
    t.anchor.set(0.5, 0);
    t.position.set(p.x, p.y + r * 1.7);
    AR.edit.addChild(t);
  }
}

function worldFrom(ev) {
  try {
    return canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  } catch (err) {
    const t = canvas.stage.worldTransform;
    return { x: (ev.clientX - t.tx) / t.a, y: (ev.clientY - t.ty) / t.d };
  }
}

function hitPoint(pts, p) {
  const r = canvas.grid.size * 0.4;
  return pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= r);
}

async function savePoints(pts) {
  await canvas.scene.setFlag(SYS, FLAG_POINTS, pts);
}

function onPointerDown(ev) {
  if (!jackTool() || ev.target?.id !== "board") return;
  if (ev.button !== 0 && ev.button !== 2) return;
  ev.preventDefault();
  ev.stopPropagation();
  const p = worldFrom(ev);
  const pts = jackPoints();
  const i = hitPoint(pts, p);
  if (ev.button === 2) {
    if (i >= 0) {
      pts.splice(i, 1);
      savePoints(pts);
    }
    return;
  }
  if (i >= 0) {
    AR.drag = { points: pts, index: i, moved: false, start: p };
    return;
  }
  const snap = !ev.shiftKey && canvas.grid.getSnappedPoint ? canvas.grid.getSnappedPoint(p, { mode: CONST.GRID_SNAPPING_MODES.CENTER | CONST.GRID_SNAPPING_MODES.VERTEX | CONST.GRID_SNAPPING_MODES.SIDE_MIDPOINT }) : p;
  pts.push({ id: foundry.utils.randomID(8), x: Math.round(snap.x), y: Math.round(snap.y), label: "JACK-IN" });
  savePoints(pts);
}

function onPointerMove(ev) {
  if (!AR.drag) return;
  ev.stopPropagation();
  const p = worldFrom(ev);
  const q = AR.drag.points[AR.drag.index];
  q.x = Math.round(p.x);
  q.y = Math.round(p.y);
  AR.drag.moved = true;
  drawEditor();
}

function onPointerUp(ev) {
  if (!AR.drag) return;
  ev.stopPropagation();
  const d = AR.drag;
  AR.drag = null;
  if (d.moved) savePoints(d.points);
  else renamePoint(d.points, d.index);
}

async function renamePoint(pts, i) {
  const cur = pts[i]?.label ?? "JACK-IN";
  let label = null;
  try {
    label = await foundry.applications.api.DialogV2.prompt({
      window: { title: T("Jack-In Point") },
      content: `<label>${esc(T("Label"))} <input type="text" name="label" value="${esc(cur)}" autofocus></label>`,
      ok: { label: T("Save"), callback: (event, button) => button.form.elements.label.value },
      rejectClose: false,
    });
  } catch (err) {
    label = null;
  }
  if (label == null) return;
  pts[i].label = String(label).trim() || "JACK-IN";
  savePoints(pts);
}

function patchWallColor() {
  const W = foundry.canvas?.placeables?.Wall ?? CONFIG.Wall.objectClass;
  if (!W || W.prototype._dmbArColor) return;
  const orig = W.prototype._getWallColor;
  W.prototype._getWallColor = function () {
    const t = arType(this.document);
    if (t === "cable") return COL.cable;
    if (t === "barrier") return COL.barrier;
    return orig.call(this);
  };
  W.prototype._dmbArColor = true;
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */
export function registerVirtuality() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, RANGE_KEY, {
      name: "DM Bank: Virtuality scan radius (m)",
      hint: "How far the Virtuality AR view reaches around the token.",
      scope: "world",
      config: true,
      type: Number,
      default: 20,
      range: { min: 5, max: 100, step: 5 },
    });
  });
  Hooks.once("ready", () => {
    patchWallColor();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("resize", placeDom);
    game.cprAR = { toggle: toggleVirtuality, isOn: () => AR.on, source: virtualitySource };
  });
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.token;
    if (tokens?.tools) {
      tokens.tools.dmbVirtuality = {
        name: "dmbVirtuality",
        title: "Virtuality AR view",
        icon: "fas fa-vr-cardboard",
        order: 92,
        toggle: true,
        active: AR.on,
        visible: true,
        onChange: (event, active) => toggleVirtuality(!!active),
      };
    }
    const walls = controls.walls;
    if (walls?.tools && game.user.isGM) {
      const preset = (kind) => async () => {
        const pc = canvas.walls?.constructor?.paletteClass;
        const data = { light: 0, move: 0, sight: 0, sound: 0, door: 0, flags: { [SYS]: { ar: kind } } };
        if (pc?.SETTING_KEY) await game.settings.set("core", pc.SETTING_KEY, data);
        ui.placeablesPalette?.render?.({ preset: data, preservePlacement: true });
        ui.notifications.info(kind === "cable" ? T("Drawing AR cables: use the wall tool to draw red lines.") : T("Drawing AR barriers: green lines that block the Virtuality scan."));
        try {
          ui.controls.activate({ control: "walls", tool: "wall" });
        } catch (err) {
          /* fine */
        }
      };
      walls.tools.dmbArCable = { name: "dmbArCable", order: 40, title: "AR Cable (Virtuality)", icon: "fas fa-bolt", button: true, onChange: preset("cable") };
      walls.tools.dmbArBarrier = { name: "dmbArBarrier", order: 41, title: "AR Barrier (blocks Virtuality scan)", icon: "fas fa-shield-halved", button: true, onChange: preset("barrier") };
      walls.tools.dmbArJack = { name: "dmbArJack", order: 42, title: "Jack-In Point: click to place, drag to move, click to rename, right-click to remove", icon: "fas fa-ethernet" };
    }
  });
  Hooks.on("renderSceneControls", () => setTimeout(drawEditor, 0));
  Hooks.on("collapseSidebar", () => setTimeout(placeDom, 350));
  Hooks.on("canvasReady", () => {
    if (AR.on || AR.closing) {
      stopView();
      finishStop();
    }
    drawEditor();
  });
  Hooks.on("canvasTearDown", () => {
    if (AR.on || AR.closing) {
      stopView();
      finishStop();
    }
    AR.edit = null;
  });
  Hooks.on("preCreateWall", (doc, data) => {
    const t = arType(data) ?? arType(doc);
    if (t) doc.updateSource({ light: 0, move: 0, sight: 0, sound: 0, door: 0 });
  });
  const bump = () => {
    AR.wallsRev = (AR.wallsRev ?? 0) + 1;
  };
  for (const h of ["createWall", "updateWall", "deleteWall"]) Hooks.on(h, bump);
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(changes, `flags.${SYS}.${FLAG_POINTS}`)) drawEditor();
    if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(changes, `flags.${SYS}.-=${FLAG_POINTS}`)) drawEditor();
  });
  Hooks.on("updateItem", (item) => {
    if (!AR.on || game.user.isGM) return;
    const tok = canvas.tokens.get(AR.tokenId);
    if (tok?.actor && item.parent === tok.actor && !virtualitySource(tok.actor)) {
      ui.notifications.info(T("Virtuality disconnected."));
      stopView();
    }
  });
}
