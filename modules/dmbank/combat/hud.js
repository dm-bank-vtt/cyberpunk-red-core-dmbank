/**
 * DM Bank: COMBAT HUD — replaces Foundry's macro hotbar with a compact, game-style HUD
 * anchored to the bottom-right of the board (clear of the players list and the sidebar):
 *  - a row of angled slots with key labels (weapons, quick use, Evasion, Luck)
 *  - a weapon readout: red line-art silhouette, big ammo counter + reserve, fire modes
 *    (single / aimed / autofire / suppressive) and a body figure showing armor & HP
 * Aiming draws DV range rings; pick a token or an empty spot, then a shared hologram roll.
 */
import { NC_SCOPE } from "../util.js";
import { T } from "../net/i18n.js";
import { resolveLoadout } from "../loadout.js";
import { RANGE_TABLE, autofireDv, clearRings, distanceMetres, drawRings, dvAt, tableKeyFor } from "./ranges.js";
import { controllersOf, openDuel } from "./duel.js";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pad = (n, len) => String(Math.max(0, Math.round(n))).padStart(len, "0");
const KEY = "nc.combatHud";
const RINGS = "nc.rangeRings";
const ringsOn = () => {
  try {
    return game.settings.get(NC_SCOPE, RINGS) !== false;
  } catch (err) {
    return true;
  }
};

/* ------------------------------------------------------------------ */
/* Line-art silhouettes: item art keyed off its background, redrawn as  */
/* a red outline with a faint fill (cached per image).                  */
/* ------------------------------------------------------------------ */
const SIL = new Map();
function silhouette(src, size) {
  const key = `${size}|${src}`;
  if (SIL.has(key)) return SIL.get(key);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const n = size;
        const c = document.createElement("canvas");
        c.width = n;
        c.height = n;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0, n, n);
        const d = x.getImageData(0, 0, n, n).data;
        const bg = [d[0], d[1], d[2], d[3]];
        const mask = new Uint8Array(n * n);
        let minX = n, minY = n, maxX = -1, maxY = -1;
        for (let i = 0; i < n * n; i++) {
          const o = i * 4;
          const a = d[o + 3];
          const dist = Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]);
          const on = a > 40 && (bg[3] < 40 || dist > 60);
          if (!on) continue;
          mask[i] = 1;
          const px = i % n;
          const py = (i / n) | 0;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        if (maxX < 0) return resolve(src);
        const out = x.createImageData(n, n);
        const o2 = out.data;
        const at = (px, py) => (px < 0 || py < 0 || px >= n || py >= n ? 0 : mask[py * n + px]);
        for (let py = 0; py < n; py++) {
          for (let px = 0; px < n; px++) {
            if (!at(px, py)) continue;
            const edge = !at(px - 1, py) || !at(px + 1, py) || !at(px, py - 1) || !at(px, py + 1);
            const o = (py * n + px) * 4;
            o2[o] = 255;
            o2[o + 1] = edge ? 70 : 40;
            o2[o + 2] = edge ? 84 : 60;
            o2[o + 3] = edge ? 255 : 52;
          }
        }
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const crop = document.createElement("canvas");
        crop.width = w;
        crop.height = h;
        x.putImageData(out, 0, 0);
        crop.getContext("2d").drawImage(c, minX, minY, w, h, 0, 0, w, h);
        resolve(crop.toDataURL());
      } catch (err) {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
  SIL.set(key, job);
  job.then((url) => SIL.set(key, url));
  return job;
}
/** <img> markup that swaps to the silhouette when it is ready. */
function silImg(src, size, cls = "") {
  const hit = SIL.get(`${size}|${src}`);
  if (typeof hit === "string") return `<img class="sil ${cls}" src="${esc(hit)}" alt="">`;
  silhouette(src, size).then(() => schedule());
  return `<img class="sil pending ${cls}" src="${esc(src)}" alt="">`;
}
const AIM_SPOTS = ["head", "hand", "leg"];

const S = {
  el: null,
  actorId: null,
  weaponId: null,
  rangeOverride: {},
  mode: {}, // weaponId -> single | aimed | autofire | suppressive
  aimSpot: "head",
  hpSeen: {}, // actorId -> last HP value (for the damage trail)
  trail: null, // { actorId, from, to, at }
  luck: 0,
  aiming: false,
  tip: null,
  timer: null,
};

const enabled = () => {
  try {
    return !!game.settings.get(NC_SCOPE, KEY);
  } catch (err) {
    return false;
  }
};

function hudActor() {
  const tok = canvas.tokens?.controlled?.find((t) => t.actor?.isOwner);
  return tok?.actor ?? game.user.character ?? null;
}

function hudToken(actor) {
  if (!actor) return null;
  const sel = canvas.tokens?.controlled?.find((t) => t.actor?.id === actor.id || t.actor === actor);
  return sel ?? actor.getActiveTokens?.()[0] ?? null;
}

function schedule() {
  clearTimeout(S.timer);
  S.timer = setTimeout(render, 50);
}

function canAutofire(w) {
  return num(w?.system?.fireModes?.autoFire) > 0 && ["smg", "heavySmg", "assaultRifle"].includes(w?.system?.weaponType);
}
function canSuppress(w) {
  return !!w?.system?.fireModes?.suppressiveFire || canAutofire(w);
}
function modeOf(w) {
  const m = S.mode[w?.id] ?? "single";
  if (m === "autofire" && !canAutofire(w)) return "single";
  if (m === "suppressive" && !canSuppress(w)) return "single";
  return m;
}

function reserveAmmo(actor, w) {
  const vars = w?.system?.ammoVariety ?? [];
  return actor.items.filter((i) => i.type === "ammo" && vars.includes(i.system.variety)).reduce((s, i) => s + num(i.system.amount), 0);
}

const SCALE = "nc.combatHudScale";
function hudScale() {
  try {
    const v = Number(game.settings.get(NC_SCOPE, SCALE));
    return Number.isFinite(v) && v > 0 ? Math.max(0.5, Math.min(2, v / 100)) : 1;
  } catch (err) {
    return 1;
  }
}

/** Keep the HUD clear of the right sidebar. */
function placeHud() {
  if (!S.el) return;
  const players = document.getElementById("players");
  let left = 14;
  if (players?.offsetParent) left = Math.max(...[players, ...players.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right)) + 14;
  const right = document.getElementById("ui-right") ?? document.getElementById("sidebar");
  const r = right?.getBoundingClientRect();
  const edge = r && r.width ? r.left - 10 : window.innerWidth - 10;
  const scale = hudScale();
  // `zoom` scales the whole HUD (layout included); positions are in zoomed px, so divide.
  S.el.style.zoom = String(scale);
  S.el.style.left = `${left / scale}px`;
  S.el.style.maxWidth = `${Math.max(320, edge - left) / scale}px`;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */
function spState(actor, loc) {
  const ext = actor.system.externalData?.[`currentArmor${loc}`] ?? {};
  const max = num(ext.max);
  if (!max) return { pct: 0, cur: 0, max: 0, cls: "none" };
  const cur = num(ext.value);
  const pct = Math.round((cur / max) * 100);
  return { pct, cur, max, cls: pct <= 25 ? "crit" : pct <= 50 ? "warn" : "ok" };
}

/** Health indicator: armor box, HP bar with a hatched damage trail, big HP numbers. */
function healthBar(actor) {
  const hp = actor.system.derivedStats?.hp ?? { value: 0, max: 1 };
  const max = Math.max(1, num(hp.max));
  const val = num(hp.value);
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  const body = spState(actor, "Body");
  const head = spState(actor, "Head");
  const seen = S.hpSeen[actor.id];
  if (seen != null && val < seen) S.trail = { actorId: actor.id, from: (seen / max) * 100, to: pct, at: Date.now() };
  S.hpSeen[actor.id] = val;
  const tr = S.trail && S.trail.actorId === actor.id && Date.now() - S.trail.at < 2200 ? S.trail : null;
  if (tr) setTimeout(schedule, 2300 - (Date.now() - tr.at));
  const cls = pct <= 25 ? "crit" : pct <= 50 ? "warn" : "";
  const wound = actor.system.derivedStats?.currentWoundState;
  const woundTxt = wound && wound !== "notWounded" ? game.i18n.localize(`CPR.global.woundState.${wound}`) : "";
  return `<div class="ch-health ${cls}">
      <span class="ch-lvl" data-tooltip="${esc(T("BODY"))} SP ${body.cur}/${body.max} · ${esc(T("HEAD"))} SP ${head.cur}/${head.max}">
        <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="trk" cx="20" cy="20" r="16"/><circle class="val ${body.cls}" cx="20" cy="20" r="16" pathLength="100" style="stroke-dasharray:${body.max ? body.pct : 0} 100"/><circle class="out" cx="20" cy="20" r="19.2"/></svg>
        <b>${body.cur}</b><small>SP</small>
      </span>
      <div class="ch-bars">
        <div class="ch-spline"><i style="width:${body.max ? body.pct : 0}%"></i>${woundTxt ? `<em>${esc(woundTxt)}</em>` : ""}</div>
        <div class="ch-hpbar"><i class="fill" style="width:${pct}%"></i>${tr ? `<i class="lost" style="left:${tr.to}%;width:${Math.max(0, tr.from - tr.to)}%"></i>` : ""}<span class="seg"></span></div>
      </div>
      <b class="ch-hpnum">${val}</b><small class="ch-hpmax">${num(hp.max)}</small>
    </div>`;
}

function bodyFigure(actor) {
  const head = spState(actor, "Head");
  const body = spState(actor, "Body");
  const hp = actor.system.derivedStats?.hp ?? { value: 0, max: 1 };
  const hpPct = Math.round((num(hp.value) / Math.max(1, num(hp.max))) * 100);
  const hpCls = hpPct <= 25 ? "crit" : hpPct <= 50 ? "warn" : "ok";
  return `<div class="ch-fig" data-tooltip="${esc(T("HEAD"))} SP ${head.cur}/${head.max} · ${esc(T("BODY"))} SP ${body.cur}/${body.max}">
      <svg viewBox="0 0 40 92" aria-hidden="true">
        <circle class="sp-${head.cls}" cx="20" cy="8" r="6.5"/>
        <path class="sp-${body.cls}" d="M15 16 h10 l6 3 l3 22 l-3 1 l-4 -17 v22 h-14 v-22 l-4 17 l-3 -1 l3 -22 z"/>
        <path class="hp-${hpCls}" d="M13.5 48 h6 v40 h-5.5 z M20.5 48 h6 l-0.5 40 h-5.5 z"/>
      </svg>
    </div>`;
}

function slot(act, id, img, label, opts = {}) {
  const art = img ? silImg(img, 72) : opts.icon ? `<i class="fas ${opts.icon}"></i>` : "";
  return `<a class="ch-slot ${opts.sel ? "sel" : ""} ${opts.empty ? "empty" : ""} ${opts.cls ?? ""}" ${act ? `data-act="${act}"` : ""} ${id ? `data-id="${id}"` : ""} data-tooltip="${esc(opts.tip ?? label)}">
      <span class="ch-frame">${art}${opts.badge != null ? `<em>${esc(opts.badge)}</em>` : ""}</span>
      <span class="ch-key ${opts.round ? "round" : ""}">${esc(label)}</span>
    </a>`;
}

function render() {
  const on = enabled();
  document.body.classList.toggle("dmb-chud-on", on);
  if (!on) {
    S.el?.remove();
    S.el = null;
    stopAim();
    clearRings();
    return;
  }
  const actor = hudActor();
  if (!S.el || !S.el.isConnected) {
    S.el = document.createElement("div");
    S.el.id = "dmb-chud";
    document.body.append(S.el);
    S.el.addEventListener("click", onClick);
    S.el.addEventListener("contextmenu", onContext);
    S.el.addEventListener("change", onChange);
  }
  placeHud();
  if (!actor) {
    S.el.innerHTML = `<div class="ch-empty"><i class="fas fa-crosshairs"></i> ${esc(T("Select your token to load your combat HUD"))}</div>`;
    clearRings();
    return;
  }
  if (S.actorId !== actor.id) {
    S.actorId = actor.id;
    S.weaponId = null;
    S.luck = 0;
    clearRings();
  }
  const lo = resolveLoadout(actor);
  if (!S.weaponId || !actor.items.get(S.weaponId)) S.weaponId = (lo.primary ?? lo.secondary ?? lo.melee)?.id ?? null;
  const luck = actor.system.stats?.luck ?? { value: 0, max: 0 };
  S.luck = Math.min(S.luck, num(luck.value));
  const weapon = actor.items.get(S.weaponId);
  const mode = weapon ? modeOf(weapon) : "single";
  const rings = ringsOn();

  const wslot = (label, w) =>
    w
      ? slot("weapon", w.id, w.img, label, {
          sel: S.weaponId === w.id,
          badge: w.system.isRanged && num(w.system.magazine?.max) ? w.system.magazine.value : null,
          tip: w.name,
          cls: w.system.isRanged && num(w.system.magazine?.max) && !num(w.system.magazine?.value) ? "dry" : "",
        })
      : slot("", null, null, label, { empty: true, tip: T("EMPTY") });
  const quick = lo.quick
    .map((item, i) => (item ? slot("quick", item.id, item.img, `Q${i + 1}`, { badge: Number.isFinite(item.system.amount) ? item.system.amount : null, tip: item.name }) : slot("", null, null, `Q${i + 1}`, { empty: true, tip: T("EMPTY") })))
    .join("");

  let gun;
  if (weapon) {
    const s = weapon.system;
    const ranged = !!s.isRanged;
    const mag = num(s.magazine?.value);
    const max = num(s.magazine?.max);
    const aimLabel = mode === "aimed" ? `AIM·${T(S.aimSpot.toUpperCase())}` : "AIM";
    const modes = [
      ["single", ranged ? "S" : "STR", ranged ? T("Single shot") : T("Strike")],
      ["aimed", aimLabel, T("Aimed shot (-8). Click again to change the spot.")],
      ...(ranged && canAutofire(weapon) ? [["autofire", "F/A", T("Autofire (10 rounds)")]] : []),
      ...(ranged && canSuppress(weapon) ? [["suppressive", "SUP", T("Suppressive fire (10 rounds)")]] : []),
    ];
    const fireLabel = S.aiming ? T("PICK A TARGET…") : mode === "suppressive" ? T("SUPPRESS") : ranged ? T("FIRE") : T("STRIKE");
    const state = ranged && max && !mag ? "dry" : ranged && max && mag / max < 0.25 ? "low" : "";
    gun = `
      <div class="ch-gun ${state}">
        <svg class="ch-arc" viewBox="0 0 30 110" aria-hidden="true"><path class="h" d="M28 2 Q2 55 28 108"/><path class="k" d="M18 34 Q12 55 18 76"/></svg>
        <div class="ch-tools">
          ${ranged ? `<a class="ch-tool ${rings ? "on" : ""}" data-act="rings" data-tooltip="${esc(rings ? T("Range rings: on") : T("Range rings: off"))}"><i class="fas fa-bullseye"></i></a>` : ""}
          ${
            ranged
              ? `<label class="ch-tool" data-tooltip="${esc(T("Range table"))}: ${esc(RANGE_TABLE[tableKeyFor(weapon, S.rangeOverride[weapon.id])]?.label ?? "-")}"><i class="fas fa-ruler-horizontal"></i><select data-k="range"><option value="">${esc(T("Auto"))}: ${esc(RANGE_TABLE[tableKeyFor(weapon)]?.label ?? "-")}</option>${Object.entries(RANGE_TABLE)
                  .map(([k, t]) => `<option value="${k}" ${S.rangeOverride[weapon.id] === k ? "selected" : ""}>${esc(t.label)}</option>`)
                  .join("")}</select></label>`
              : ""
          }
          ${ranged ? `<a class="ch-tool" data-act="reload" data-tooltip="${esc(T("RELOAD"))}"><i class="fas fa-rotate-right"></i></a>` : ""}
        </div>
        <div class="ch-gun-body">
          <div class="ch-gun-top"><b>${esc(weapon.name)}</b><span class="ch-link">${esc(mode === "autofire" ? "Autofire" : s.weaponSkill || "")}</span></div>
          <div class="ch-gun-main">
            <a class="ch-sil" data-act="fire" data-tooltip="${esc(fireLabel)}">${silImg(weapon.img, 160)}</a>
            ${ranged ? `<div class="ch-ammo"><b>${pad(mag, 3)}</b><small>${pad(reserveAmmo(actor, weapon), 4)}</small></div>` : `<div class="ch-ammo melee"><b>${esc(s.damage)}</b></div>`}
          </div>
          <div class="ch-gun-foot">
            <div class="ch-modes">${modes.map(([k, l, tip]) => `<a class="${mode === k ? "on" : ""}" data-act="mode" data-mode="${k}" data-tooltip="${esc(tip)}">${esc(l)}</a>`).join("")}</div>
            <a class="ch-fire ${S.aiming ? "on" : ""}" data-act="fire"><i class="fas fa-crosshairs"></i> ${esc(fireLabel)}</a>
          </div>
        </div>
      </div>`;
  } else {
    gun = `<div class="ch-gun none"><span class="ch-hint">${esc(T("Pick a weapon to aim"))}</span></div>`;
  }

  S.el.innerHTML = `
    ${healthBar(actor)}
    <div class="ch-strip">
      ${gun}
      ${bodyFigure(actor)}
      <i class="ch-sep"></i>
      <div class="ch-slots">
        ${wslot("PRI", lo.primary)}${wslot("SEC", lo.secondary)}${wslot("MEL", lo.melee)}
        <i class="ch-gap"></i>
        ${quick}
        <i class="ch-gap"></i>
        ${slot("evasion", null, null, "EVA", { icon: "fa-person-running", tip: T("EVASION"), round: true })}
        ${slot("luck", null, null, "LUCK", { icon: "fa-clover", badge: S.luck ? `+${S.luck}` : num(luck.value), cls: S.luck ? "luck-on" : "", round: true, tip: `${T("LUCK")} ${num(luck.value)}/${num(luck.max)} — ${T("Click: spend 1 LUCK on the next roll. Right-click: take it back.")}` })}
      </div>
    </div>`;
  const key = weapon ? tableKeyFor(weapon, S.rangeOverride[weapon.id]) : null;
  if (rings && weapon?.system.isRanged && key && mode !== "suppressive") drawRings(hudToken(actor), key);
  else clearRings();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
async function onClick(ev) {
  const t = ev.target.closest("[data-act]");
  if (!t || !t.dataset.act) return;
  ev.preventDefault();
  const actor = hudActor();
  if (!actor) return;
  switch (t.dataset.act) {
    case "weapon":
      S.weaponId = t.dataset.id;
      stopAim();
      break;
    case "mode": {
      const w = actor.items.get(S.weaponId);
      if (!w) return;
      const m = t.dataset.mode;
      if (m === "aimed" && modeOf(w) === "aimed") S.aimSpot = AIM_SPOTS[(AIM_SPOTS.indexOf(S.aimSpot) + 1) % AIM_SPOTS.length];
      S.mode[w.id] = m;
      break;
    }
    case "fire": {
      const w = actor.items.get(S.weaponId);
      if (!w) return;
      if (modeOf(w) === "suppressive") {
        suppress(actor, w);
        return;
      }
      if (S.aiming) stopAim();
      else startAim();
      break;
    }
    case "rings":
      await game.settings.set(NC_SCOPE, RINGS, !ringsOn());
      break;
    case "reload": {
      const w = actor.items.get(S.weaponId);
      if (w?.reload) await w.reload();
      break;
    }
    case "quick": {
      const item = actor.items.get(t.dataset.id);
      if (!item) return;
      if (item.type === "drug" && item.snort) await item.snort();
      else if (item.type === "weapon") {
        S.weaponId = item.id;
        stopAim();
      } else item.sheet.render(true);
      break;
    }
    case "luck":
      S.luck = Math.min(num(actor.system.stats?.luck?.value), S.luck + 1);
      break;
    case "evasion":
      rollEvasion(actor);
      return;
    default:
  }
  render();
}

function onContext(ev) {
  const t = ev.target.closest('[data-act="luck"]');
  if (!t) return;
  ev.preventDefault();
  S.luck = Math.max(0, S.luck - 1);
  render();
}

function onChange(ev) {
  if (ev.target.dataset.k === "range" && S.weaponId) {
    S.rangeOverride[S.weaponId] = ev.target.value || null;
    render();
  }
}

/* ------------------------------------------------------------------ */
/* Aiming                                                              */
/* ------------------------------------------------------------------ */
function worldFromEvent(ev) {
  try {
    return canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  } catch (err) {
    const t = canvas.stage.worldTransform;
    return { x: (ev.clientX - t.tx) / t.a, y: (ev.clientY - t.ty) / t.d };
  }
}

function tokenAt(p) {
  return canvas.tokens.placeables.filter((t) => t.visible && t.bounds.contains(p.x, p.y)).sort((a, b) => b.document.sort - a.document.sort)[0] ?? null;
}

function dvFor(weapon, metres) {
  if (modeOf(weapon) === "autofire") return autofireDv(weapon, metres);
  return dvAt(tableKeyFor(weapon, S.rangeOverride[weapon.id]), metres);
}

function onMove(ev) {
  if (!S.aiming || ev.target?.id !== "board") {
    if (S.tip) S.tip.style.display = "none";
    return;
  }
  const actor = hudActor();
  const token = hudToken(actor);
  const weapon = actor?.items.get(S.weaponId);
  if (!token || !weapon) return;
  const p = worldFromEvent(ev);
  const target = tokenAt(p);
  const m = distanceMetres(token.center, target ? target.center : p);
  let text = `${Math.round(m)} m`;
  if (weapon.system.isRanged) {
    const dv = dvFor(weapon, m);
    text += dv == null ? ` · ${T("OUT OF RANGE")}` : ` · DV ${dv}`;
  }
  if (target) text = `${target.name} · ${text}`;
  if (!S.tip) {
    S.tip = document.createElement("div");
    S.tip.id = "dmb-aimtip";
    document.body.append(S.tip);
  }
  S.tip.style.display = "block";
  S.tip.style.left = `${ev.clientX + 18}px`;
  S.tip.style.top = `${ev.clientY + 14}px`;
  S.tip.textContent = text;
}

function onDown(ev) {
  if (!S.aiming || ev.button !== 0 || ev.target?.id !== "board") return;
  ev.preventDefault();
  ev.stopPropagation();
  const p = worldFromEvent(ev);
  const target = tokenAt(p);
  stopAim();
  render();
  attack(p, target);
}

function onKey(ev) {
  if (S.aiming && ev.key === "Escape") {
    stopAim();
    render();
  }
}

function startAim() {
  S.aiming = true;
  document.body.classList.add("dmb-aiming");
}

function stopAim() {
  S.aiming = false;
  document.body.classList.remove("dmb-aiming");
  if (S.tip) S.tip.style.display = "none";
}

/* ------------------------------------------------------------------ */
/* Rolls                                                               */
/* ------------------------------------------------------------------ */
function skillLevel(actor, name) {
  try {
    return num(actor.getSkillLevel?.(name));
  } catch (err) {
    return 0;
  }
}

/**
 * Build the roll parts with the system's own roll builders so the HUD matches a roll made from the sheet:
 * role abilities (Solo Precision Attack, …), active effects, wound/armor penalties, weapon & upgrade mods.
 * Returns null when the system roll can't be built (caller falls back to its simple parts).
 */
function systemParts(build, statLabel, skillLabel) {
  try {
    const roll = build();
    if (!roll) return null;
    const parts = [
      [statLabel, num(roll.statValue)],
      [skillLabel, num(roll.skillValue)],
    ];
    for (const m of roll.mods ?? []) {
      const v = num(m?.value);
      if (v) parts.push([String(m.source || T("Mod")), v]);
    }
    return parts;
  } catch (err) {
    console.warn("DM Bank | combat HUD: system roll mods unavailable", err);
    return null;
  }
}

function attackParts(actor, weapon, type, statLabel, skillLabel) {
  return systemParts(() => weapon._createAttackRoll?.(type, actor), statLabel, skillLabel);
}

function evasionParts(actor) {
  const skill = actor.items.find((i) => i.type === "skill" && i.name === "Evasion");
  return (
    (skill && systemParts(() => skill.createRoll("skill", actor), "DEX", T("Evasion"))) ?? [
      ["DEX", num(actor.system.stats?.dex?.value)],
      [T("Evasion"), skillLevel(actor, "Evasion")],
    ]
  );
}

function defenderSide(targetActor, token) {
  return {
    name: token?.name ?? targetActor.name,
    img: targetActor.img,
    tokenId: token?.id,
    parts: evasionParts(targetActor),
    userIds: controllersOf(targetActor),
    tone: "red",
  };
}

function takeLuck(parts) {
  const luck = S.luck;
  if (luck) parts.push([T("LUCK"), luck]);
  S.luck = 0;
  return luck;
}

async function attack(point, targetToken) {
  const actor = hudActor();
  const token = hudToken(actor);
  const weapon = actor?.items.get(S.weaponId);
  if (!actor || !token || !weapon) return;
  const ws = weapon.system;
  const ranged = !!ws.isRanged;
  const mode = modeOf(weapon);
  if (targetToken?.id === token.id) targetToken = null;
  const rounds = mode === "autofire" ? 10 : 1;
  if (ranged && num(ws.magazine?.max) > 0 && num(ws.magazine?.value) < rounds) {
    ui.notifications.warn(`${weapon.name}: ${rounds > 1 ? T("Autofire needs 10 rounds") : T("EMPTY // RELOAD")}`);
    return;
  }
  const stat = ranged && ws.weaponType !== "thrownWeapon" ? "ref" : "dex";
  const skillName = mode === "autofire" ? "Autofire" : ws.weaponSkill;
  const rollType = mode === "autofire" ? "autofire" : mode === "aimed" ? "aimed" : "attack";
  let parts = attackParts(actor, weapon, rollType, stat.toUpperCase(), skillName || T("Skill"));
  if (parts) {
    // the system labels the -8 generically; show where we aimed
    if (mode === "aimed") parts = parts.map((p) => (p[1] === -8 && /aim/i.test(p[0]) ? [`${T("Aimed")} ${T(S.aimSpot.toUpperCase())}`, -8] : p));
  } else {
    parts = [
      [stat.toUpperCase(), num(actor.system.stats?.[stat]?.value)],
      [skillName || T("Skill"), skillLevel(actor, skillName)],
    ];
    if (num(ws.attackmod)) parts.push([T("Weapon"), num(ws.attackmod)]);
    if (mode === "aimed") parts.push([`${T("Aimed")} ${T(S.aimSpot.toUpperCase())}`, -8]);
  }
  const luck = takeLuck(parts);
  const at = targetToken ? targetToken.center : point;
  const rangeM = distanceMetres(token.center, at);
  const a = { name: token.name, img: actor.img, tokenId: token.id, parts, userIds: [game.user.id], tone: "cyan" };
  const meta = {
    actorId: actor.id,
    tokenId: token.id,
    weaponId: weapon.id,
    weaponName: weapon.name,
    damage: mode === "autofire" ? "2d6" : ws.damage || "",
    target: targetToken?.name ?? null,
    targetTokenId: targetToken?.id ?? null,
    sceneId: canvas.scene?.id,
    location: mode === "aimed" ? S.aimSpot : null,
  };
  if (mode === "aimed") {
    meta.note = {
      head: T("Aimed at the head: damage that gets through armor is doubled."),
      hand: T("Aimed at a held item: the target drops it."),
      leg: T("Aimed at a leg: the target is knocked prone."),
    }[S.aimSpot];
  }
  const maxMult = ws.weaponType === "assaultRifle" ? 4 : 3;
  const onResolve = async ({ hit, atk, def }) => {
    const upd = [];
    if (ranged && num(ws.magazine?.max) > 0) upd.push(weapon.update({ "system.magazine.value": Math.max(0, num(ws.magazine.value) - rounds) }));
    if (luck) upd.push(actor.update({ "system.stats.luck.value": Math.max(0, num(actor.system.stats.luck.value) - luck) }));
    await Promise.all(upd);
    if (mode === "autofire" && hit) {
      const mult = Math.max(1, Math.min(maxMult, atk - def));
      return { meta: { mult, note: `${T("Autofire")}: ${T("beat the DV by")} ${atk - def} → ×${mult} (${T("max")} ×${maxMult})` } };
    }
    return null;
  };
  render();
  const tag = mode === "autofire" ? " [F/A]" : mode === "aimed" ? " [AIM]" : "";
  const title = `${weapon.name.toUpperCase()}${tag}${targetToken ? ` >> ${targetToken.name.toUpperCase()}` : ""}`;
  if (!ranged) {
    if (!targetToken?.actor) {
      ui.notifications.warn(T("Melee needs a target token."));
      return;
    }
    openDuel({ kind: "attack", title, sub: T("MELEE // opposed"), a, b: defenderSide(targetToken.actor, targetToken), rangeM, meta, onResolve });
    return;
  }
  const dv = dvFor(weapon, rangeM);
  if (dv == null) {
    ui.notifications.warn(`${weapon.name}: ${T("OUT OF RANGE")} (${Math.round(rangeM)} m)`);
    return;
  }
  const canDodge = targetToken?.actor && num(targetToken.actor.system.stats?.ref?.value) >= 8;
  if (canDodge) openDuel({ kind: "attack", title, sub: `${Math.round(rangeM)} m // DV ${dv}`, a, b: defenderSide(targetToken.actor, targetToken), choice: { dv }, rangeM, meta, onResolve });
  else openDuel({ kind: "attack", title, sub: `${Math.round(rangeM)} m`, a, dv, rangeM, meta, onResolve });
}

function suppress(actor, weapon) {
  const ws = weapon.system;
  const token = hudToken(actor);
  if (num(ws.magazine?.max) > 0 && num(ws.magazine?.value) < 10) {
    ui.notifications.warn(`${weapon.name}: ${T("Suppressive fire needs 10 rounds")}`);
    return;
  }
  const parts = attackParts(actor, weapon, "suppressive", "REF", "Autofire") ?? [
    ["REF", num(actor.system.stats?.ref?.value)],
    ["Autofire", skillLevel(actor, "Autofire")],
  ];
  const luck = takeLuck(parts);
  render();
  openDuel({
    kind: "check",
    title: `${weapon.name.toUpperCase()} [SUP]`,
    sub: T("SUPPRESSIVE FIRE"),
    a: { name: token?.name ?? actor.name, img: actor.img, parts, userIds: [game.user.id], tone: "cyan" },
    meta: { actorId: actor.id, tokenId: token?.id, weaponName: weapon.name },
    onResolve: async ({ atk }) => {
      const upd = [];
      if (num(ws.magazine?.max) > 0) upd.push(weapon.update({ "system.magazine.value": Math.max(0, num(ws.magazine.value) - 10) }));
      if (luck) upd.push(actor.update({ "system.stats.luck.value": Math.max(0, num(actor.system.stats.luck.value) - luck) }));
      await Promise.all(upd);
      return { meta: { note: T("Everyone in range without cover rolls WILL + Concentration + d10 against {n}, or must use their next move to get into cover.").replace("{n}", atk) } };
    },
  });
}

function rollEvasion(actor) {
  const token = hudToken(actor);
  const parts = evasionParts(actor);
  const luck = takeLuck(parts);
  render();
  openDuel({
    kind: "check",
    title: T("EVASION"),
    a: { name: token?.name ?? actor.name, img: actor.img, parts, userIds: [game.user.id], tone: "cyan" },
    meta: { actorId: actor.id, tokenId: token?.id },
    onResolve: async () => {
      if (luck) await actor.update({ "system.stats.luck.value": Math.max(0, num(actor.system.stats.luck.value) - luck) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */
export function registerCombatHud() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, KEY, { scope: "client", config: false, type: Boolean, default: false, onChange: () => schedule() });
    game.settings.register(NC_SCOPE, RINGS, {
      name: "DM Bank: Range rings while a ranged weapon is drawn",
      hint: "Shows DV range bands around your token in the Combat HUD. You can also toggle this from the HUD.",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => schedule(),
    });
    game.settings.register(NC_SCOPE, SCALE, {
      name: "DM Bank: Combat HUD size (%)",
      hint: "Scale the Combat HUD at the bottom of the screen. 100 = normal size.",
      scope: "client",
      config: true,
      type: Number,
      range: { min: 50, max: 160, step: 5 },
      default: 100,
      onChange: () => placeHud(),
    });
  });
  Hooks.once("ready", () => {
    schedule();
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", placeHud);
  });
  Hooks.on("collapseSidebar", () => {
    placeHud();
    setTimeout(placeHud, 400);
  });
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.dmbCombatHud = {
      name: "dmbCombatHud",
      title: "Combat HUD (replaces the macro bar)",
      icon: "fas fa-gun",
      order: 91,
      toggle: true,
      active: enabled(),
      visible: true,
      onChange: (event, active) => game.settings.set(NC_SCOPE, KEY, !!active),
    };
  });
  for (const h of ["controlToken", "updateActor", "createItem", "updateItem", "deleteItem", "canvasReady"]) Hooks.on(h, schedule);
  Hooks.on("updateToken", (doc, changes) => {
    if (("x" in changes || "y" in changes) && doc.actor?.id === S.actorId) setTimeout(schedule, 350);
  });
}
