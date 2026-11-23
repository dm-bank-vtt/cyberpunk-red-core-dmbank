/**
 * DM Bank: shared markup for the hologram roll screens (combat duels and NET RUN prompts):
 * the rotating "reactor" ring system around each die, inline modifiers, and the DV meter.
 * Styles live in styles/dmbank-combat.css under the .dd-* classes.
 */
import { T } from "../net/i18n.js";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const sumParts = (parts) => (parts ?? []).reduce((s, p) => s + (Number(p[1]) || 0), 0);

let RINGS = null;
/** Rotating ring system drawn around a hologram die (SVG, 200×200 view box). */
export function reactorSvg() {
  if (!RINGS) {
    let ticks = "";
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const long = i % 6 === 0;
      const r2 = long ? 70 : 74;
      ticks += `<line x1="${(100 + Math.cos(a) * 78).toFixed(1)}" y1="${(100 + Math.sin(a) * 78).toFixed(1)}" x2="${(100 + Math.cos(a) * r2).toFixed(1)}" y2="${(100 + Math.sin(a) * r2).toFixed(1)}"${long ? ' class="l"' : ""}/>`;
    }
    RINGS = `<svg class="dd-rings" viewBox="0 0 200 200" aria-hidden="true">
      <g class="rg r-out"><circle cx="100" cy="100" r="95"/><path d="M100 2 l5 7 h-10z M100 198 l5 -7 h-10z"/></g>
      <g class="rg r-ticks">${ticks}</g>
      <g class="rg r-arc"><path d="M100 36 A64 64 0 1 1 36 100"/><path class="thin" d="M100 30 A70 70 0 0 0 51 50"/></g>
      <g class="rg r-hex"><polygon points="100,46 147,73 147,127 100,154 53,127 53,73"/></g>
    </svg>`;
  }
  return RINGS;
}

/** The reactor block; `rollAttr` makes the die itself clickable (e.g. 'data-act="roll"'). */
export function reactorHtml(rollAttr = "") {
  return `<div class="dd-reactor" ${rollAttr}>
      <div class="dd-cone"></div>
      ${reactorSvg()}
      <div class="dd-die"></div>
      <div class="dd-base"></div>
      <div class="dd-shock"></div>
    </div>`;
}

const fmtMod = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
export function modsHtml(parts) {
  return (parts ?? []).map((p) => `<span><em>${esc(p[0])}</em>${fmtMod(Number(p[1]) || 0)}</span>`).join("") + `<span class="d"><em>d10</em></span>`;
}

/** A meter under the die: a yellow mark at the DV, filled to the total once the die lands. */
export function meterHtml({ dv, hidden = false, base = 0, rangeM = null }) {
  const scale = Math.max(30, (Number(dv) || 0) + 10, base + 14);
  return `<div class="dd-meter" data-scale="${scale}" data-dv="${hidden ? "" : dv}" style="--mark:${((Number(dv) || 0) / scale) * 100}%">
      <div class="dd-track">${hidden ? "" : '<b class="dd-mark"></b>'}<i class="dd-fill"></i></div>
      <div class="dd-dvlabel"><small>${esc(T("Target number"))}</small><strong>DV ${hidden ? "??" : esc(dv)}</strong>${rangeM != null ? `<em>${Math.round(rangeM)} m</em>` : ""}</div>
    </div>`;
}

/** Fill a meter to `total`; colour it pass/fail unless the result is hidden from this viewer. */
export function fillMeter(meter, total, { pass = null } = {}) {
  if (!meter) return;
  const scale = Number(meter.dataset.scale) || 30;
  const pct = Math.max(2, Math.min(100, (total / scale) * 100));
  requestAnimationFrame(() => meter.style.setProperty("--fill", `${pct}%`));
  if (pass !== null) meter.classList.add(pass ? "pass" : "fail");
}

/** Count a number up on screen. */
export function countUp(el, to, ms = 520) {
  if (!el) return;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => (el.textContent = String(to)), ms + 80);
}

/** Title row with chevrons pointing in. */
export function titleHtml(text, sub = "", inner = null) {
  return `<div class="dd-title"><i class="dd-chev l"></i>${inner ?? `<span class="nn-gl" data-text="${esc(text)}">${esc(text)}</span>`}<i class="dd-chev r"></i>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
}
