/**
 * DM Bank NET RUN: the AR overlay every client sees while a Netrun is active.
 * Pure DOM (not an Application) so it can sit over the board with click-through gaps.
 */
import { ncSetting } from "../util.js";
import { ABILITIES, ABILITY_ORDER, BOOSTERS, FLOOR_TYPES, ICE, ICE_ORDER } from "./data.js";
import { HoloDie } from "../dice/holo-dice.js";
import { countUp as holoCount, fillMeter, meterHtml, modsHtml, reactorHtml, sumParts, titleHtml } from "../dice/holo-ui.js";
import { T, TK } from "./i18n.js";
import { canControl, deckPrograms, engagedIce, findIce, getState, request, runnerActor, runnerInterface } from "./engine.js";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
/** Text that glitches now and then (chromatic split) and decodes when it changes. */
const gl = (text, key, extra = "") => `<span class="nn-gl ${extra}" data-text="${esc(text)}" data-scr="${esc(key)}" style="--gl-t:${(3.6 + Math.random() * 3).toFixed(2)}s;--gl-t2:${(2.8 + Math.random() * 3).toFixed(2)}s">${esc(text)}</span>`;

const ui$ = {
  root: null,
  sid: null,
  seenRolls: new Set(),
  sel: { type: "ability", key: "pathfinder" },
  target: null,
  leftTab: "actions",
  rightTab: null,
  minimized: false,
  lastPhase: null,
  lastPos: null,
  diceQueue: [],
  diceBusy: false,
  rain: null,
  ended: null,
};

const visibleTo = (S) => !!S && (S.opts?.showAll !== false || game.user.isGM || canControl(S));

/* ------------------------------------------------------------------ */
/* Root / lifecycle                                                    */
/* ------------------------------------------------------------------ */

export function refreshOverlay() {
  const S = getState();
  if (!S || S.cleared || (!S.active && !S.ended)) {
    teardown();
    return;
  }
  if (!visibleTo(S)) {
    teardown();
    return;
  }
  // Session finished: play the disconnect screen once, then remove.
  if (!S.active) {
    if (ui$.root && ui$.sid === S.sid && ui$.ended !== S.ended?.t) {
      ui$.ended = S.ended?.t;
      render(S);
      playDisconnect(S);
    } else if (!ui$.root) {
      /* nothing to show */
    }
    return;
  }
  const fresh = !ui$.root || ui$.sid !== S.sid;
  if (fresh) build(S);
  // Auto expand / collapse with the turn flow.
  if (S.prompt) ui$.minimized = false;
  if (ui$.lastPhase !== S.phase) {
    if (S.phase === "wait") ui$.minimized = true;
    else if (S.phase === "runner" || S.phase === "ice") ui$.minimized = false;
    ui$.lastPhase = S.phase;
  }
  render(S);
  if (fresh) {
    for (const r of S.rolls ?? []) ui$.seenRolls.add(r.id);
    playBoot(S);
  } else queueRolls(S);
  if (ui$.lastPos !== null && ui$.lastPos !== S.pos) dive(S.pos > ui$.lastPos ? "down" : "up");
  ui$.lastPos = S.pos;
}

function teardown() {
  stopRain();
  destroyRollView();
  ui$.root?.remove();
  ui$.root = null;
  ui$.sid = null;
  ui$.lastPos = null;
  ui$.lastPhase = null;
  ui$.diceQueue = [];
  ui$.diceBusy = false;
}

function build(S) {
  clearTimeout(ui$.offTimer);
  teardown();
  const root = document.createElement("div");
  root.id = "nc-net";
  root.className = "nn-root";
  root.innerHTML = `
    <canvas class="nn-rain"></canvas>
    <div class="nn-vignette"></div>
    <div class="nn-scan"></div>
    <div class="nn-ui"></div>
    <div class="nn-dice-layer"></div>
    <div class="nn-boot"></div>`;
  document.body.append(root);
  ui$.root = root;
  ui$.sid = S.sid;
  ui$.ended = null;
  ui$.seenRolls = new Set();
  ui$.rightTab = game.user.isGM ? "ctrl" : "data";
  ui$.minimized = S.phase === "wait";
  ui$.target = null;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  if (ncSetting("netRain") !== false) startRain(root.querySelector(".nn-rain"));
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render(S) {
  const root = ui$.root;
  if (!root) return;
  const ctrl = canControl(S);
  const gm = game.user.isGM;
  root.classList.toggle("nn-gm", gm);
  root.classList.toggle("nn-ctrl", ctrl);
  root.classList.toggle("nn-view", !ctrl);
  root.classList.toggle("nn-min", ui$.minimized);
  root.classList.toggle("nn-phase-ice", S.phase === "ice");
  root.classList.toggle("nn-phase-wait", S.phase === "wait");
  const actor = runnerActor(S);
  // Keep the selected target valid.
  const engaged = engagedIce(S);
  const here = S.arch.floors[S.pos];
  const hereIce = (here?.ice ?? []).filter((i) => !i.derezzed);
  if (!ui$.target || !findIce(S, ui$.target).ice || findIce(S, ui$.target).ice.derezzed) ui$.target = engaged[0]?.uid ?? hereIce[0]?.uid ?? null;

  const uiEl = root.querySelector(".nn-ui");
  const logScroll = uiEl.querySelector(".nn-log")?.scrollTop;
  const logAtBottom = (() => {
    const l = uiEl.querySelector(".nn-log");
    return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 30;
  })();
  uiEl.innerHTML = `
    ${topBar(S, actor)}
    <div class="nn-main">
      ${leftPanel(S, actor, ctrl)}
      ${centerPanel(S, ctrl)}
      ${rightPanel(S, gm)}
    </div>
    ${execBar(S, actor, ctrl)}
    ${pendingBanner(S, gm)}
    ${chip(S, actor)}`;
  const log = uiEl.querySelector(".nn-log");
  if (log) log.scrollTop = logAtBottom ? log.scrollHeight : (logScroll ?? 0);
  scrambleAll(false);
  syncPrompt(S);
}

/* ------------------------------------------------------------------ */
/* Text decode: changed labels scramble through glyphs before settling  */
/* ------------------------------------------------------------------ */

const GLYPHS = "!<>-_\\/[]{}=+*^?#01アカサタナハマヤラワ";
const scrCache = new Map();
function scrambleEl(el) {
  // Only touch plain text nodes so icons inside the element survive.
  const nodes = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) nodes.push(walk.currentNode);
  if (!nodes.length) return;
  const finals = nodes.map((n) => n.nodeValue);
  const total = Math.max(...finals.map((f) => f.length));
  const frames = 14;
  let f = 0;
  el.classList.add("nn-scr-on");
  const step = () => {
    if (!el.isConnected) return;
    f += 1;
    const reveal = Math.floor((f / frames) * total);
    nodes.forEach((n, i) => {
      const txt = finals[i];
      let out = "";
      for (let c = 0; c < txt.length; c++) out += c < reveal || txt[c] === " " ? txt[c] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      n.nodeValue = out;
    });
    if (f < frames) setTimeout(step, 32);
    else {
      nodes.forEach((n, i) => (n.nodeValue = finals[i]));
      el.classList.remove("nn-scr-on");
    }
  };
  step();
}
function scrambleAll(force) {
  const root = ui$.root;
  if (!root || ui$.minimized) return;
  for (const el of root.querySelectorAll("[data-scr]")) {
    const key = el.dataset.scr;
    const text = el.textContent;
    if (force || (scrCache.has(key) && scrCache.get(key) !== text)) scrambleEl(el);
    scrCache.set(key, text);
  }
}

function segBar(value, max, segs, cls) {
  const n = Math.max(1, segs);
  const filled = max > 0 ? Math.round((Math.max(0, value) / max) * n) : 0;
  let h = "";
  for (let i = 0; i < n; i++) h += `<i class="${i < filled ? "on" : ""}"></i>`;
  return `<div class="nn-seg ${cls}">${h}</div>`;
}

function topBar(S, actor) {
  const hp = actor?.system.derivedStats?.hp ?? { value: 0, max: 0 };
  const iface = runnerInterface(S);
  const chips = [];
  if (S.status.burning) chips.push('<span class="nn-tag nn-tag-bad"><i class="fas fa-fire"></i> BURNING</span>');
  if (S.status.stuck > 0) chips.push('<span class="nn-tag nn-tag-bad"><i class="fas fa-lock"></i> LOCKED</span>');
  if (S.status.slowNext) chips.push('<span class="nn-tag nn-tag-warn"><i class="fas fa-hourglass-half"></i> SLOWED</span>');
  if (S.status.cloak) chips.push(`<span class="nn-tag"><i class="fas fa-user-secret"></i> CLOAK ${S.status.cloak}</span>`);
  if (S.virus) chips.push('<span class="nn-tag nn-tag-ok"><i class="fas fa-virus"></i> VIRUS</span>');
  const phase = T({ runner: S.mode === "combat" ? "YOUR TURN" : "ONLINE", ice: "BLACK ICE ACTING", wait: "WAITING FOR TURN", out: "OFFLINE" }[S.phase] ?? S.phase);
  return `<div class="nn-top">
      <div class="nn-who">
        <img src="${esc(actor?.img ?? "icons/svg/mystery-man.svg")}" alt="">
        <div><b>${gl(actor?.name ?? "NETRUNNER", "who")}</b><span>INTERFACE ${iface} // ${S.mode === "combat" ? `COMBAT TURN ${S.turn}` : `FREE RUN CYCLE ${S.turn}`}</span></div>
      </div>
      <div class="nn-bars">
        <div class="nn-bar nn-bar-ram"><label>NET ACTIONS: <b>${S.actions.left}/${S.actions.max}</b></label>${segBar(S.actions.left, S.actions.max, S.actions.max, "nn-seg-ram")}</div>
        <div class="nn-bar nn-bar-hp">${segBar(hp.value, hp.max, 40, "nn-seg-hp")}<label>BRAIN ${hp.value}/${hp.max}</label></div>
      </div>
      <div class="nn-state">
        <div class="nn-state-col">
          <span class="nn-phase nn-phase-${esc(S.phase)}">${gl(phase, "phase")}</span>
          <div class="nn-tags">${chips.join("")}</div>
        </div>
        <div class="nn-winbtns">
          <a data-nn="min" data-tooltip="Minimize"><i class="fas fa-window-minimize"></i></a>
          ${game.user.isGM ? '<a data-nn="architect" data-tooltip="NET Architect"><i class="fas fa-sitemap"></i></a>' : ""}
        </div>
      </div>
    </div>`;
}

function abilityState(S, key) {
  const ab = ABILITIES[key];
  const floor = S.arch.floors[S.pos];
  if (ab.needs && floor.type !== ab.needs) return { ok: false, why: `${T("NEEDS")} ${FLOOR_TYPES[ab.needs].label}` };
  if (ab.needs && floor.cleared) return { ok: false, why: T("DONE") };
  if (ab.needsBottom && S.pos !== S.arch.floors.length - 1) return { ok: false, why: T("BOTTOM ONLY") };
  if (ab.needsIce && !(floor.ice ?? []).some((i) => !i.derezzed) && !engagedIce(S).length) return { ok: false, why: T("NO ICE") };
  return { ok: true };
}

function leftPanel(S, actor, ctrl) {
  const progs = deckPrograms(actor);
  const tab = ui$.leftTab;
  let list = "";
  if (tab === "actions") {
    list = ABILITY_ORDER.map((key, i) => {
      const ab = ABILITIES[key];
      const arc = arcOffset(i, ABILITY_ORDER.length);
      const st = abilityState(S, key);
      const sel = ui$.sel.type === "ability" && ui$.sel.key === key;
      return `<a class="nn-row ${sel ? "sel" : ""} ${st.ok ? "" : "blocked"}" style="--arc:${arc}px" data-nn="sel" data-type="ability" data-key="${key}">
          <span class="nn-num">${i + 1}</span>
          <span class="nn-row-name"><span data-scr="ab-${key}"><i class="fas ${ab.icon}"></i> ${ab.name.toUpperCase()}</span><small>${st.ok ? T("READY") : esc(st.why)}</small></span>
          <span class="nn-cost">1<i class="fas fa-memory"></i></span>
        </a>`;
    }).join("");
  } else {
    list = progs.length
      ? progs
          .map((p, i) => {
            const sel = ui$.sel.type === "program" && ui$.sel.key === p.id;
            const cls = p.system.class;
            const state = T(p.system.isRezzed ? "REZZED" : cls.includes("attacker") ? "ATTACKER" : "STANDBY");
            return `<a class="nn-row nn-prog ${sel ? "sel" : ""} ${p.system.isRezzed ? "rezzed" : ""}" style="--arc:${arcOffset(i, progs.length)}px" data-nn="sel" data-type="program" data-key="${p.id}">
              <span class="nn-num">${i + 1}</span>
              <img src="${esc(p.img)}" alt="">
              <span class="nn-row-name">${esc(p.name.toUpperCase())}<small>${state}${p.system.isRezzed && p.system.rez?.max ? ` · REZ ${p.system.rez.value}/${p.system.rez.max}` : ""}</small></span>
              <span class="nn-cost">1<i class="fas fa-memory"></i></span>
            </a>`;
          })
          .join("")
      : `<div class="nn-empty">${T("NO PROGRAMS ON DECK")}<br><small>${T("Open NET DECK to install cards")}</small></div>`;
  }
  return `<div class="nn-left nn-panel">
      <div class="nn-panel-head">${gl(T(tab === "actions" ? "AVAILABLE NET ACTIONS:" : "LOADED PROGRAMS:"), "lhead")}</div>
      <div class="nn-panel-sub">${esc(deckName(actor))}</div>
      <div class="nn-tabs">
        <a class="${tab === "actions" ? "on" : ""}" data-nn="ltab" data-tab="actions">NET ACTIONS</a>
        <a class="${tab === "programs" ? "on" : ""}" data-nn="ltab" data-tab="programs">${T("PROGRAMS")} <b>${progs.length}</b></a>
        ${actor?.isOwner ? '<a data-nn="deck" data-tooltip="Open NET DECK"><i class="fas fa-layer-group"></i></a>' : ""}
      </div>
      <div class="nn-list">${list}</div>
      ${detailBox(S, actor)}
    </div>`;
}

/** Rows bow outwards in the middle so the list follows the visor's curve. */
function arcOffset(i, n) {
  if (n < 2) return 0;
  const t = (i - (n - 1) / 2) / ((n - 1) / 2);
  return Math.round(26 * (1 - t * t));
}

function deckName(actor) {
  const deck = actor?.itemTypes?.cyberdeck?.find((d) => d.system.equipped === "equipped") ?? actor?.itemTypes?.cyberdeck?.[0];
  return deck ? deck.name.toUpperCase() : "NO DECK";
}

function previewParts(S, actor) {
  const iface = runnerInterface(S);
  const parts = [`INTERFACE ${iface}`];
  if (ui$.sel.type === "ability") {
    const key = ui$.sel.key;
    for (const p of deckPrograms(actor).filter((x) => x.system.isRezzed)) {
      const b = BOOSTERS[p.name.toLowerCase()];
      if (b?.ability === key) parts.push(`${p.name.toUpperCase()} +${b.value}`);
    }
    if (key === "slide") {
      const sk = engagedIce(S).filter((i) => i.key === "skunk").length;
      if (sk) parts.push(`SKUNK -${sk * 2}`);
    }
    parts.push("d10");
    const ab = ABILITIES[key];
    const floor = S.arch.floors[S.pos];
    const dvKnown = game.user.isGM || !S.opts.dvHidden;
    let vs = "";
    if (ab.dvFrom === "floor") vs = `DV ${dvKnown ? floor.dv ?? S.arch.dv : "??"}`;
    else if (ab.dvFrom === "arch") vs = `DV ${dvKnown ? S.arch.dv : "??"}`;
    else if (ab.dvFrom === "opposed") {
      const t = findIce(S, ui$.target).ice;
      vs = t ? `${t.name.toUpperCase()} ${key === "slide" ? `PER ${t.per}` : `DEF ${t.def}`} + d10` : "TARGET ?";
    }
    return { parts, vs };
  }
  const p = actor?.items.get(ui$.sel.key);
  if (!p) return { parts: [], vs: "" };
  if (p.system.class === "antiprogramattacker" || p.system.class === "antipersonnelattacker") {
    parts.push(`ATK ${p.system.atk ?? 0}`, "d10");
    const t = findIce(S, ui$.target).ice;
    return { parts, vs: t ? `${t.name.toUpperCase()} DEF ${t.def} + d10` : "TARGET ?" };
  }
  return { parts: [p.system.isRezzed ? "DEREZ PROGRAM" : "REZ PROGRAM"], vs: "" };
}

function detailBox(S, actor) {
  if (ui$.sel.type === "ability") {
    const ab = ABILITIES[ui$.sel.key];
    const pv = previewParts(S, actor);
    return `<div class="nn-detail">
        <div class="nn-detail-title"><i class="fas ${ab.icon}"></i> ${ab.name.toUpperCase()}${ab.booster ? `<small>BOOST: ${esc(ab.booster)}</small>` : ""}</div>
        <p>${esc(TK(`desc.${ui$.sel.key}`, ab.desc))}</p>
        <div class="nn-formula">${pv.parts.map((x) => `<span>${esc(x)}</span>`).join("<em>+</em>")}${pv.vs ? `<em>VS</em><span class="vs">${esc(pv.vs)}</span>` : ""}</div>
      </div>`;
  }
  const p = actor?.items.get(ui$.sel.key);
  if (!p) return "";
  const s = p.system;
  const cls = game.i18n.localize(`CPR.global.programClass.${s.class === "antipersonnelattacker" ? "antiPersonnelAttacker" : s.class === "antiprogramattacker" ? "antiProgramAttacker" : s.class}`);
  const desc = String(s.description?.value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const pv = previewParts(S, actor);
  return `<div class="nn-detail nn-card">
      <div class="nn-card-top"><img src="${esc(p.img)}" alt=""><div><b>${esc(p.name.toUpperCase())}</b><small>${esc(cls)}</small></div></div>
      <div class="nn-card-stats">
        <span>ATK <b>${s.atk ?? 0}</b></span><span>DEF <b>${s.def ?? 0}</b></span><span>REZ <b>${s.rez?.value ?? 0}/${s.rez?.max ?? 0}</b></span>
        ${s.class.includes("attacker") ? `<span>DMG <b>${esc(s.damage?.blackIce || s.damage?.standard || "-")}</b></span>` : ""}
      </div>
      <p>${esc(desc || "—")}</p>
      <div class="nn-formula">${pv.parts.map((x) => `<span>${esc(x)}</span>`).join("<em>+</em>")}${pv.vs ? `<em>VS</em><span class="vs">${esc(pv.vs)}</span>` : ""}</div>
    </div>`;
}

function floorLabel(S, f, idx, gm) {
  const known = gm || f.revealed || f.visited;
  const t = FLOOR_TYPES[f.type] ?? FLOOR_TYPES.empty;
  if (!known) return { icon: "fa-question", label: T("UNKNOWN"), known };
  let label = t.label;
  if (f.type === "ice") label = (f.ice ?? []).map((i) => i.name.toUpperCase()).join(" · ") || t.label;
  return { icon: t.icon, label, known };
}

function centerPanel(S, ctrl) {
  const gm = game.user.isGM;
  const floors = S.arch.floors;
  const frames = [];
  const depth = Math.min(5, floors.length - S.pos);
  for (let k = depth - 1; k >= 0; k--) {
    const idx = S.pos + k;
    const f = floors[idx];
    const fl = floorLabel(S, f, idx, gm);
    const dvShown = f.dv && (gm || !S.opts.dvHidden) && fl.known && f.type !== "ice";
    const sc = Math.pow(0.66, k).toFixed(3);
    frames.push(`<div class="nn-ring nn-k${k} ${k === 0 ? "nn-here" : ""} nn-t-${fl.known ? f.type : "unknown"} ${f.cleared ? "nn-cleared" : ""}" style="--k:${k};--sc:${sc}">
        <div class="nn-disc"><span class="nn-arc"></span><span class="nn-arc thin"></span></div>
        <div class="nn-ring-tag"><b>${T("FLOOR")} ${String(idx + 1).padStart(2, "0")}</b><span data-scr="ring-${k}"><i class="fas ${fl.icon}"></i> ${esc(fl.label)}</span>${dvShown ? `<em>DV ${f.dv}</em>` : ""}${f.cleared ? `<em class="ok">${f.type === "password" ? "CRACKED" : f.type === "control" ? "CONTROLLED" : "DONE"}</em>` : ""}</div>
      </div>`);
  }
  const here = floors[S.pos];
  const ice = (here.ice ?? []).map((i) => {
    const engaged = S.engaged.includes(i.uid);
    const pct = Math.round((i.rez / Math.max(1, i.rezMax)) * 100);
    return `<a class="nn-ice ${i.derezzed ? "dead" : ""} ${engaged ? "engaged" : ""} ${ui$.target === i.uid ? "targeted" : ""} nn-ice-${esc(i.cls)}" data-nn="target" data-uid="${i.uid}">
        <div class="nn-ice-holo"><i class="fas fa-skull"></i></div>
        <b>${esc(i.name.toUpperCase())}</b>
        <div class="nn-ice-rez"><i style="width:${pct}%"></i></div>
        <small>${i.derezzed ? T("DEREZZED") : `REZ ${i.rez}/${i.rezMax}${engaged ? ` ${T("ENGAGED")}` : ""}`}</small>
      </a>`;
  });
  // Ice following from other floors.
  const followers = engagedIce(S).filter((i) => !(here.ice ?? []).includes(i));
  for (const i of followers) {
    ice.push(`<a class="nn-ice engaged follower ${ui$.target === i.uid ? "targeted" : ""}" data-nn="target" data-uid="${i.uid}">
        <div class="nn-ice-holo"><i class="fas fa-skull"></i></div><b>${esc(i.name.toUpperCase())}</b>
        <div class="nn-ice-rez"><i style="width:${Math.round((i.rez / Math.max(1, i.rezMax)) * 100)}%"></i></div><small>${T("FOLLOWING")}</small></a>`);
  }
  const gauge = floors
    .map((f, idx) => {
      const fl = floorLabel(S, f, idx, gm);
      const cls = [idx === S.pos ? "here" : "", fl.known ? `t-${f.type}` : "unk", f.cleared ? "clr" : "", (f.ice ?? []).some((x) => !x.derezzed) && fl.known ? "hot" : ""].join(" ");
      return `<a class="nn-g ${cls}" ${gm ? `data-nn="goto" data-idx="${idx}"` : ""} data-tooltip="FLOOR ${idx + 1} · ${esc(fl.label)}"><span>${String(idx + 1).padStart(2, "0")}</span><i class="fas ${fl.icon}"></i></a>`;
    })
    .join("");
  return `<div class="nn-center">
      <div class="nn-arch-name">${gl(S.arch.name.toUpperCase(), "arch")}<small>DEPTH ${S.pos + 1}/${floors.length}${gm || !S.opts.dvHidden ? ` · ARCH DV ${S.arch.dv}` : ""}</small></div>
      <div class="nn-tunnel"><div class="nn-vortex">${frames.join("")}</div>
        <div class="nn-ice-row">${ice.join("")}</div>
        ${here.infoShown && here.info ? `<div class="nn-file"><b><i class="fas fa-file-code"></i> ${esc(here.name || "FILE")}</b><p>${esc(here.info)}</p></div>` : ""}
      </div>
      <div class="nn-nav">
        <a class="nn-navbtn" data-nn="move" data-dir="-1" ${S.pos <= 0 ? "disabled" : ""}><i class="fas fa-chevron-up"></i><span>${T("ASCEND")}</span></a>
        <div class="nn-gauge">${gauge}</div>
        <a class="nn-navbtn" data-nn="move" data-dir="1" ${S.pos >= floors.length - 1 ? "disabled" : ""}><i class="fas fa-chevron-down"></i><span>${T("DIVE")}</span></a>
      </div>
    </div>`;
}

function dataPanel(S, gm) {
  const f = S.arch.floors[S.pos];
  const fl = floorLabel(S, f, S.pos, gm);
  const dv = f.dv && (gm || !S.opts.dvHidden) ? f.dv : f.dv ? "??" : "—";
  const ice = (f.ice ?? [])
    .map(
      (i) => `<div class="nn-scan-ice ${i.derezzed ? "dead" : ""}">
        <b><i class="fas fa-skull"></i> ${esc(i.name.toUpperCase())}</b><small>${T(i.cls === "antiprogram" ? "ANTI-PROGRAM" : "ANTI-PERSONNEL")}</small>
        <div class="nn-scan-stats"><span>PER ${i.per}</span><span>SPD ${i.spd}</span><span>ATK ${i.atk}</span><span>DEF ${i.def}</span><span>REZ ${i.rez}/${i.rezMax}</span></div>
        <p>${esc(i.effect === ICE[i.key]?.effect ? TK(`ice.${i.key}`, i.effect) : i.effect)}</p></div>`
    )
    .join("");
  return `<div class="nn-data">
      <div class="nn-data-title">${gl(`${T("SCAN RESULTS :: FLOOR")} ${String(S.pos + 1).padStart(2, "0")}`, "scan")}</div>
      <div class="nn-kv"><span>${T("TYPE")}</span><b><i class="fas ${fl.icon}"></i> ${esc(FLOOR_TYPES[f.type]?.label ?? f.type)}</b></div>
      ${f.name ? `<div class="nn-kv"><span>${T("NAME")}</span><b>${esc(f.name)}</b></div>` : ""}
      <div class="nn-kv"><span>DV</span><b>${dv}</b></div>
      <div class="nn-kv"><span>${T("STATUS")}</span><b class="${f.cleared ? "ok" : ""}">${T(f.cleared ? "BREACHED" : f.type === "password" ? "LOCKED" : f.type === "ice" ? ((f.ice ?? []).every((i) => i.derezzed) ? "CLEAR" : "HOSTILE") : "INTACT")}</b></div>
      ${gm && f.desc ? `<div class="nn-gmnote"><i class="fas fa-eye-slash"></i> ${esc(f.desc)}</div>` : ""}
      ${f.infoShown && f.info ? `<div class="nn-kv nn-kv-wide"><span>CONTENT</span><p>${esc(f.info)}</p></div>` : gm && f.info ? `<div class="nn-gmnote"><i class="fas fa-file"></i> ${esc(f.info)}</div>` : ""}
      ${ice}
      <div class="nn-hint"><i class="fas fa-circle-info"></i> ${esc(TK(`hint.${f.type}`, FLOOR_TYPES[f.type]?.hint ?? ""))}</div>
    </div>`;
}

function logPanel(S) {
  const gm = game.user.isGM;
  const lines = (S.log ?? [])
    .filter((l) => gm || l.c !== "gmx")
    .map((l) => `<div class="nn-l nn-l-${esc(l.c)}"><span>${new Date(l.t).toLocaleTimeString([], { hour12: false })}</span>${esc(l.m)}</div>`)
    .join("");
  return `<div class="nn-log">${lines}<div class="nn-l nn-cursor">_</div></div>`;
}

function gmControl(S) {
  const opts = S.opts;
  const tg = (key, label) => `<a class="nn-tog ${opts[key] ? "on" : ""}" data-nn="opt" data-key="${key}">${label}</a>`;
  const engaged = engagedIce(S);
  const icePhase =
    S.phase === "ice" || (S.ambush ?? []).length
      ? `<div class="nn-gm-box nn-gm-hot">
          <div class="nn-gm-title"><i class="fas fa-skull-crossbones"></i> BLACK ICE ${S.phase === "ice" ? "PHASE" : "AMBUSH"}</div>
          ${(S.phase === "ice" ? engaged : (S.ambush ?? []).map((u) => findIce(S, u).ice).filter(Boolean))
            .map(
              (i) => `<div class="nn-gm-ice"><b>${esc(i.name)}</b><span>ATK ${i.atk} · REZ ${i.rez}</span>
                <a class="nn-btn nn-btn-red" data-nn="ice" data-act="attack" data-uid="${i.uid}">ATTACK</a></div>`
            )
            .join("") || '<div class="nn-dim">no hostile ICE</div>'}
          ${S.phase === "ice" ? '<a class="nn-btn nn-btn-wide" data-nn="gm" data-req="gm.iceDone">END ICE PHASE <i class="fas fa-forward"></i></a>' : ""}
        </div>`
      : "";
  return `<div class="nn-gm">
      ${icePhase}
      <div class="nn-gm-box">
        <div class="nn-gm-title"><i class="fas fa-sliders"></i> RUN CONTROL</div>
        <div class="nn-gm-grid">
          <label>NET ACTIONS</label><div class="nn-step"><a data-nn="na" data-d="-1">−</a><b>${S.actions.left}/${S.actions.max}</b><a data-nn="na" data-d="1">+</a></div>
          <label>INTERFACE</label><div class="nn-step"><a data-nn="iface" data-d="-1">−</a><b>${runnerInterface(S)}</b><a data-nn="iface" data-d="1">+</a></div>
          <label>MODE</label><div class="nn-seg2"><a class="${S.mode === "free" ? "on" : ""}" data-nn="mode" data-v="free">FREE</a><a class="${S.mode === "combat" ? "on" : ""}" data-nn="mode" data-v="combat">COMBAT</a></div>
          <label>PHASE</label><div class="nn-seg2"><a class="${S.phase === "runner" ? "on" : ""}" data-nn="gm" data-req="gm.newTurn">NEW TURN</a><a data-nn="phase" data-v="wait" class="${S.phase === "wait" ? "on" : ""}">WAIT</a></div>
          <label>BRAIN DMG</label><div class="nn-step"><input type="number" class="nn-brain" value="2" min="0"><a data-nn="brain">APPLY</a></div>
        </div>
        <div class="nn-tgls">${tg("dvHidden", "HIDE DV")}${tg("gmConfirm", "GM CONFIRMS RESULTS")}${tg("autoIce", "AUTO BLACK ICE")}${tg("showAll", "EVERYONE SEES")}</div>
        <div class="nn-tgls">
          ${S.status.burning ? '<a class="nn-tog on" data-nn="status" data-key="burning">BURNING ✕</a>' : ""}
          ${S.status.stuck ? '<a class="nn-tog on" data-nn="status" data-key="stuck">LOCKED ✕</a>' : ""}
          ${S.status.slowNext ? '<a class="nn-tog on" data-nn="status" data-key="slowNext">SLOWED ✕</a>' : ""}
        </div>
      </div>
      <div class="nn-gm-box">
        <div class="nn-gm-title"><i class="fas fa-user-lock"></i> ACCESS</div>
        <div class="nn-users">${game.users
          .filter((u) => !u.isGM)
          .map((u) => `<a class="nn-tog ${(S.controllers ?? []).includes(u.id) ? "on" : ""}" data-nn="ctrlUser" data-id="${u.id}"><i class="fas fa-gamepad"></i> ${esc(u.name)}</a>`)
          .join("") || '<span class="nn-dim">no players</span>'}</div>
      </div>
      <div class="nn-gm-box">
        <div class="nn-gm-title"><i class="fas fa-plug-circle-xmark"></i> CONNECTION</div>
        <div class="nn-btns">
          <a class="nn-btn" data-nn="gm" data-req="gm.kick">KICK (SAFE)</a>
          <a class="nn-btn nn-btn-red" data-nn="kickUnsafe">KICK (UNSAFE)</a>
          <a class="nn-btn" data-nn="closeRun">END SESSION</a>
        </div>
      </div>
    </div>`;
}

function gmIce(S) {
  const rows = [];
  S.arch.floors.forEach((f, idx) => {
    for (const i of f.ice ?? []) {
      const engaged = S.engaged.includes(i.uid);
      const num = (field) => `<input type="number" data-nn-ice-edit="${field}" data-uid="${i.uid}" value="${i[field]}">`;
      rows.push(`<div class="nn-gm-icecard ${i.derezzed ? "dead" : ""} ${engaged ? "engaged" : ""}">
          <div class="nn-gm-icehead"><b><i class="fas fa-skull"></i> ${esc(i.name)}</b><span>FLOOR ${idx + 1}${engaged ? " · ENGAGED" : ""}${i.derezzed ? " · DEREZZED" : ""}</span></div>
          <div class="nn-gm-icestats"><label>PER</label>${num("per")}<label>SPD</label>${num("spd")}<label>ATK</label>${num("atk")}<label>DEF</label>${num("def")}<label>REZ</label>${num("rez")}</div>
          <div class="nn-btns">
            <a class="nn-btn nn-btn-red" data-nn="ice" data-act="attack" data-uid="${i.uid}">ATTACK</a>
            <a class="nn-btn" data-nn="ice" data-act="effect" data-uid="${i.uid}" data-tooltip="Apply its effect without a roll">EFFECT</a>
            ${engaged ? `<a class="nn-btn" data-nn="ice" data-act="disengage" data-uid="${i.uid}">DISENGAGE</a>` : `<a class="nn-btn" data-nn="ice" data-act="engage" data-uid="${i.uid}">ENGAGE</a>`}
            ${i.derezzed ? `<a class="nn-btn" data-nn="ice" data-act="restore" data-uid="${i.uid}">RESTORE</a>` : `<a class="nn-btn" data-nn="ice" data-act="derez" data-uid="${i.uid}">DEREZ</a>`}
            <a class="nn-btn nn-btn-ghost" data-nn="ice" data-act="remove" data-uid="${i.uid}"><i class="fas fa-trash"></i></a>
          </div>
        </div>`);
    }
  });
  const opts = ICE_ORDER.map((k) => `<option value="${k}">${ICE[k].name}</option>`).join("");
  return `<div class="nn-gm">
      <div class="nn-gm-box"><div class="nn-gm-title"><i class="fas fa-plus"></i> SPAWN ICE ON THIS FLOOR</div>
        <div class="nn-step"><select class="nn-spawn">${opts}</select><a data-nn="spawn">SPAWN</a></div></div>
      ${rows.join("") || '<div class="nn-dim">No Black ICE in this architecture.</div>'}
    </div>`;
}

function gmMap(S) {
  const rows = S.arch.floors
    .map((f, idx) => {
      const t = FLOOR_TYPES[f.type] ?? FLOOR_TYPES.empty;
      return `<div class="nn-gm-floor ${idx === S.pos ? "here" : ""}">
          <a class="nn-gm-fnum" data-nn="goto" data-idx="${idx}" data-tooltip="Move the runner here">${String(idx + 1).padStart(2, "0")}</a>
          <span class="nn-gm-ftype"><i class="fas ${t.icon}"></i> ${t.label}${f.name ? ` · ${esc(f.name)}` : ""}${f.dv ? ` · DV ${f.dv}` : ""}</span>
          <a class="nn-tog ${f.revealed ? "on" : ""}" data-nn="floor" data-idx="${idx}" data-key="revealed" data-tooltip="Visible on the players' map"><i class="fas fa-eye"></i></a>
          ${["password", "control", "file"].includes(f.type) ? `<a class="nn-tog ${f.cleared ? "on" : ""}" data-nn="floor" data-idx="${idx}" data-key="cleared" data-tooltip="Breached"><i class="fas fa-unlock"></i></a>` : ""}
          ${f.type === "file" && f.info ? `<a class="nn-tog ${f.infoShown ? "on" : ""}" data-nn="floor" data-idx="${idx}" data-key="infoShown" data-tooltip="Show file content to players"><i class="fas fa-file-lines"></i></a>` : ""}
        </div>`;
    })
    .join("");
  return `<div class="nn-gm">
      <div class="nn-btns"><a class="nn-btn" data-nn="revealAll" data-v="1">REVEAL ALL</a><a class="nn-btn" data-nn="revealAll" data-v="0">HIDE ALL</a><a class="nn-btn" data-nn="architect">EDIT ARCHITECTURE</a></div>
      ${rows}
    </div>`;
}

function rightPanel(S, gm) {
  const tabs = gm ? [["ctrl", "CONTROL"], ["ice", "ICE"], ["map", "MAP"], ["data", T("DATA")], ["log", T("LOG")]] : [["data", T("DATA")], ["log", T("LOG")]];
  let tab = ui$.rightTab;
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  let body = "";
  if (tab === "ctrl") body = gmControl(S);
  else if (tab === "ice") body = gmIce(S);
  else if (tab === "map") body = gmMap(S);
  else if (tab === "data") body = gm ? dataPanel(S, gm) : `${dataPanel(S, gm)}`;
  else body = logPanel(S);
  // Players always get a short log under DATA.
  const tail = !gm && tab === "data" ? `<div class="nn-subhead">${T("TRACE LOG")}</div>${logPanel(S)}` : "";
  return `<div class="nn-right nn-panel">
      <div class="nn-tabs">${tabs.map(([k, l]) => `<a class="${tab === k ? "on" : ""}" data-nn="rtab" data-tab="${k}">${l}${k === "ctrl" && S.pending ? " <i class='fas fa-circle-exclamation nn-blink'></i>" : ""}</a>`).join("")}</div>
      <div class="nn-right-body">${body}${tail}</div>
    </div>`;
}

function execBar(S, actor, ctrl) {
  const pv = previewParts(S, actor);
  let label = T("EXECUTE");
  if (ui$.sel.type === "program") {
    const p = actor?.items.get(ui$.sel.key);
    if (p) label = T(p.system.class.includes("attacker") ? "ATTACK" : p.system.isRezzed ? "DEREZ" : "REZ");
  }
  const blocked = S.phase !== "runner" || S.actions.left <= 0;
  const status =
    S.phase === "ice" ? T("BLACK ICE IS ACTING...") : S.phase === "wait" ? T("WAITING FOR YOUR TURN") : S.actions.left <= 0 ? T("NO NET ACTIONS LEFT — END TURN") : `${T("NET ACTIONS LEFT")}: ${S.actions.left}`;
  const target = findIce(S, ui$.target).ice;
  return `<div class="nn-exec">
      <div class="nn-prompts nn-prompts-l nn-meat">
        ${ctrl && S.status.burning ? `<a data-nn="extinguish"><i class="fas fa-fire-extinguisher"></i> ${T("PUT OUT FIRE (meat action)")}</a>` : ""}
        ${ctrl ? `<a data-nn="unsafe" class="bad"><i class="fas fa-bolt-lightning"></i> ${T("UNSAFE JACK OUT")}</a>` : ""}
      </div>
      <div class="nn-exec-mid">
        <div class="nn-exec-line">${pv.parts.map((x) => `<span>${esc(x)}</span>`).join("<em>+</em>")}${pv.vs ? `<em>VS</em><span class="vs">${esc(pv.vs)}</span>` : ""}</div>
        <a class="nn-execute ${blocked ? "dim" : ""}" data-nn="execute" ${ctrl ? "" : "disabled"}><span class="nn-key">F</span> ${label}${target && (ui$.sel.type === "program" || ABILITIES[ui$.sel.key]?.needsIce) ? ` <small>${esc(target.name.toUpperCase())}</small>` : ""}</a>
        <div class="nn-exec-status">${esc(status)}${ctrl ? "" : ` ${T("(view only)")}`}</div>
      </div>
      <div class="nn-prompts">
        ${ctrl ? `<a class="nn-side nn-endturn ${S.actions.left <= 0 && S.phase === "runner" ? "hot" : ""}" data-nn="endturn"><i class="fas fa-forward-step"></i> ${T("END TURN")}</a>` : ""}
        ${ctrl ? `<a class="nn-side" data-nn="jackout"><i class="fas fa-plug-circle-minus"></i> ${T("JACK OUT")}</a>` : ""}
      </div>
    </div>`;
}

function pendingBanner(S, gm) {
  const p = S.pending;
  if (!p) return "";
  if (!gm) return `<div class="nn-pending"><i class="fas fa-hourglass-half nn-spin"></i> ${T("WAITING FOR GM")} :: ${esc(p.text)}</div>`;
  if (p.kind === "rule") {
    const who = game.users.get(p.userId)?.name ?? "player";
    return `<div class="nn-pending gm"><div><b>RULE CHECK</b><span>${esc(who)}: ${esc(p.text)}</span></div>
        <a class="nn-btn nn-btn-cyan" data-nn="gm" data-req="gm.approve">ALLOW</a><a class="nn-btn nn-btn-red" data-nn="gm" data-req="gm.deny">DENY</a></div>`;
  }
  return `<div class="nn-pending gm"><div><b>CONFIRM RESULT</b><span>${esc(p.text)}</span></div>
      <a class="nn-btn nn-btn-cyan" data-nn="result" data-v="">ACCEPT</a><a class="nn-btn" data-nn="result" data-v="1">FORCE PASS</a><a class="nn-btn nn-btn-red" data-nn="result" data-v="0">FORCE FAIL</a></div>`;
}

function chip(S, actor) {
  return `<a class="nn-chip" data-nn="min">
      <i class="fas fa-network-wired"></i><b>NET LINK</b><span>${esc(actor?.name ?? "")}</span><span>FLOOR ${S.pos + 1}/${S.arch.floors.length}</span><span>NA ${S.actions.left}/${S.actions.max}</span>
      <span class="nn-phase nn-phase-${esc(S.phase)}">${S.phase === "wait" ? "WAITING" : S.phase === "ice" ? "ICE" : "ACTIVE"}</span><i class="fas fa-up-right-and-down-left-from-center"></i></a>`;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

async function onClick(event) {
  const el = event.target.closest("[data-nn]");
  if (!el || el.hasAttribute("disabled")) return;
  event.preventDefault();
  event.stopPropagation();
  const S = getState();
  if (!S) return;
  const act = el.dataset.nn;
  const d = el.dataset;
  switch (act) {
    case "min":
      ui$.minimized = !ui$.minimized;
      render(S);
      return;
    case "ltab":
      ui$.leftTab = d.tab;
      if (d.tab === "programs") {
        const first = deckPrograms(runnerActor(S))[0];
        if (first && ui$.sel.type !== "program") ui$.sel = { type: "program", key: first.id };
      } else if (ui$.sel.type !== "ability") ui$.sel = { type: "ability", key: "pathfinder" };
      render(S);
      return;
    case "rtab":
      ui$.rightTab = d.tab;
      render(S);
      return;
    case "sel":
      ui$.sel = { type: d.type, key: d.key };
      render(S);
      return;
    case "target":
      ui$.target = d.uid;
      render(S);
      return;
    case "deck": {
      const { openNetDeck } = await import("./deck.js");
      openNetDeck(runnerActor(S));
      return;
    }
    case "architect": {
      const { openArchitect } = await import("./architect.js");
      openArchitect();
      return;
    }
    default:
  }
  if (!canControl(S)) return;
  switch (act) {
    case "roll":
      clickRoll(S);
      return;
    case "execute":
      return execute(S);
    case "move":
      request("move", { dir: Number(d.dir) });
      return;
    case "endturn":
      request("endturn");
      return;
    case "jackout":
      request("jackout");
      return;
    case "extinguish":
      request("extinguish");
      return;
    case "unsafe": {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "UNSAFE JACK OUT" },
        content: `<p>${T("Yank the plug? Every rezzed Black ICE you met gets its effect on you.")}</p>`,
      });
      if (ok) request("unsafe");
      return;
    }
    default:
  }
  if (!game.user.isGM) return;
  switch (act) {
    case "gm":
      request(d.req);
      return;
    case "result":
      request("gm.result", { success: d.v === "" ? undefined : d.v === "1" });
      return;
    case "opt":
      request("gm.set", { path: `opts.${d.key}`, value: !S.opts[d.key] });
      return;
    case "status":
      request("gm.set", { path: `status.${d.key}`, value: d.key === "burning" ? false : 0 });
      return;
    case "na":
      request("gm.set", { path: "actions.left", value: Math.max(0, S.actions.left + Number(d.d)) });
      return;
    case "iface":
      request("gm.set", { path: "interface", value: Math.max(0, runnerInterface(S) + Number(d.d)) });
      return;
    case "mode":
      request("gm.set", { path: "mode", value: d.v });
      return;
    case "phase":
      request("gm.set", { path: "phase", value: d.v });
      return;
    case "brain": {
      const v = Number(ui$.root.querySelector(".nn-brain")?.value ?? 0);
      if (v) request("gm.brain", { amount: v });
      return;
    }
    case "ctrlUser": {
      const set = new Set(S.controllers ?? []);
      if (set.has(d.id)) set.delete(d.id);
      else set.add(d.id);
      request("gm.set", { path: "controllers", value: [...set] });
      return;
    }
    case "kickUnsafe":
      request("gm.kick", { unsafe: true });
      return;
    case "closeRun": {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "END NET SESSION" }, content: "<p>Close the Netrun for everyone?</p>" });
      if (ok) request("gm.end", {});
      return;
    }
    case "ice":
      request("gm.ice", { iceUid: d.uid, act: d.act });
      return;
    case "spawn": {
      const key = ui$.root.querySelector(".nn-spawn")?.value;
      if (key) request("gm.addIce", { index: S.pos, key });
      return;
    }
    case "goto":
      request("gm.set", { path: "pos", value: Number(d.idx) });
      return;
    case "floor": {
      const f = S.arch.floors[Number(d.idx)];
      request("gm.floor", { index: Number(d.idx), data: { [d.key]: !f[d.key] } });
      return;
    }
    case "revealAll":
      request("gm.revealAll", { value: d.v === "1" });
      return;
    default:
  }
}

function onChange(event) {
  const input = event.target.closest("[data-nn-ice-edit]");
  if (!input || !game.user.isGM) return;
  request("gm.ice", { iceUid: input.dataset.uid, act: "edit", field: input.dataset.nnIceEdit, value: input.value });
}

async function execute(S) {
  const actor = runnerActor(S);
  if (ui$.sel.type === "ability") {
    const args = { key: ui$.sel.key, iceUid: ui$.target };
    if (ui$.sel.key === "virus") {
      const text = await foundry.applications.api.DialogV2.prompt({
        window: { title: "VIRUS PAYLOAD" },
        content: '<p>What should the virus do? (the GM decides how it plays out)</p><input type="text" name="payload" style="width:100%" placeholder="e.g. loop the cameras for 1 hour">',
        ok: { callback: (ev, button) => button.form.elements.payload.value },
      }).catch(() => null);
      if (text === null) return;
      args.text = text;
    }
    request("ability", args);
    return;
  }
  const p = actor?.items.get(ui$.sel.key);
  if (!p) return;
  if (p.system.class.includes("attacker")) request("attack", { programId: p.id, iceUid: ui$.target });
  else request(p.system.isRezzed ? "derez" : "rez", { programId: p.id });
}

/** Keyboard: F = execute (number keys stay with the macro hotbar). Ignored while typing. */
export function registerKeys() {
  document.addEventListener("keydown", (event) => {
    if (!ui$.root || ui$.minimized || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest("input, textarea, select, [contenteditable]")) return;
    const S = getState();
    if (!S?.active || !canControl(S)) return;
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      if (S.prompt) clickRoll(S);
      else execute(S);
    }
  });
}

/* ------------------------------------------------------------------ */
/* FX: boot, dive, disconnect, rain                                    */
/* ------------------------------------------------------------------ */

function playBoot(S) {
  const boot = ui$.root?.querySelector(".nn-boot");
  if (!boot) return;
  const actor = runnerActor(S);
  const panels = [];
  for (let i = 0; i < 9; i++) {
    const x = 4 + Math.random() * 70;
    const y = 4 + Math.random() * 64;
    const w = 14 + Math.random() * 18;
    const h = 12 + Math.random() * 20;
    const lines = Array.from({ length: 6 }, () => `<i style="width:${30 + Math.random() * 65}%"></i>`).join("");
    panels.push(`<div class="nn-bp" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;animation-delay:${i * 70}ms"><div class="nn-bp-cross"></div>${lines}</div>`);
  }
  // Screen tearing: bands of the image slip sideways in RGB-split bursts.
  const tears = Array.from({ length: 9 }, (_, i) => {
    const top = Math.random() * 96;
    const h = 0.6 + Math.random() * 5;
    const dur = (0.35 + Math.random() * 0.5).toFixed(2);
    return `<i class="nn-tear" style="top:${top}%;height:${h}%;animation-duration:${dur}s;animation-delay:${(i * 0.07).toFixed(2)}s"></i>`;
  }).join("");
  const codes = Array.from({ length: 6 }, () => `<span style="left:${Math.random() * 80}%;top:${Math.random() * 90}%;animation-delay:${(Math.random() * 1.2).toFixed(2)}s">${["0xDEADBEEF", "ICE_BREAK", "SEGFAULT", "//BREACH", "NULL_PTR", "ACCESS::ROOT", "0x7F3A9C", "SYN_FLOOD"][Math.floor(Math.random() * 8)]}</span>`).join("");
  boot.innerHTML = `${panels.join("")}
    <div class="nn-tears">${tears}</div>
    <div class="nn-boot-codes">${codes}</div>
    <div class="nn-breach"><b class="nn-gl" data-text="${esc(T("SYSTEM BREACH"))}">${esc(T("SYSTEM BREACH"))}</b></div>
    <div class="nn-boot-center">
      <div class="nn-boot-face"><img src="${esc(actor?.img ?? "")}" alt=""><div class="nn-boot-cross"></div></div>
      <div class="nn-boot-bar"><i></i></div>
      <div class="nn-boot-text">${T("NOW CONNECTING")} <b>0</b> %</div>
      <div class="nn-boot-sub">${esc(S.arch.name.toUpperCase())} // ${T("NEURAL LINK")}</div>
    </div>`;
  boot.classList.add("on");
  const num = boot.querySelector(".nn-boot-text b");
  const bar = boot.querySelector(".nn-boot-bar i");
  const start = performance.now();
  const dur = 1700;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (num) num.textContent = "100";
    if (bar) bar.style.width = "100%";
    boot.classList.add("out");
    setTimeout(() => {
      boot.classList.remove("on", "out");
      boot.innerHTML = "";
      // The visor unfolds once, right after the connect screen.
      ui$.root?.classList.add("nn-booting");
      scrambleAll(true);
      setTimeout(() => ui$.root?.classList.remove("nn-booting"), 1300);
      queueRolls(getState());
    }, 450);
  };
  const tick = (t) => {
    if (done) return;
    const p = Math.min(1, (t - start) / dur);
    const v = Math.floor(p * 100);
    if (num) num.textContent = v;
    if (bar) bar.style.width = `${v}%`;
    if (p < 1) requestAnimationFrame(tick);
    else finish();
  };
  requestAnimationFrame(tick);
  // Background tabs pause animation frames: make sure the boot screen always ends.
  setTimeout(finish, dur + 400);
}

function playDisconnect(S) {
  const boot = ui$.root?.querySelector(".nn-boot");
  if (!boot) return;
  const unsafe = /UNSAFE|SEVERED|KICK/i.test(S.ended?.reason ?? "");
  // Programs fold shut: side panels swing closed, the vortex collapses like a CRT, then a short sign-off.
  ui$.minimized = false;
  ui$.root.classList.remove("nn-min", "nn-booting");
  ui$.root.classList.add("nn-closing");
  ui$.diceQueue = [];
  boot.classList.remove("on");
  boot.innerHTML = `<div class="nn-off ${unsafe ? "bad" : ""}"><b data-scr="off">${T(unsafe ? "CONNECTION LOST" : "LINK CLOSED")}</b><span>${esc(S.ended?.reason ?? "")}</span></div>`;
  boot.style.display = "block";
  setTimeout(() => scrambleAll(true), 900);
  const sid = S.sid;
  clearTimeout(ui$.offTimer);
  ui$.offTimer = setTimeout(() => {
    // Only close the overlay if no new run started meanwhile.
    if (ui$.sid === sid && !getState()?.active) teardown();
  }, 2700);
}

function dive(dir) {
  const t = ui$.root?.querySelector(".nn-tunnel");
  if (!t) return;
  t.classList.remove("nn-dive-down", "nn-dive-up");
  void t.offsetWidth;
  t.classList.add(dir === "down" ? "nn-dive-down" : "nn-dive-up");
}

function startRain(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const chars = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF#$%&<>/\\=+*".split("");
  let cols = [];
  const size = 15;
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Array.from({ length: Math.ceil(canvas.width / size) }, () => Math.random() * -60);
  };
  resize();
  window.addEventListener("resize", resize);
  let last = 0;
  const loop = (t) => {
    if (!ui$.root || !canvas.isConnected) return;
    ui$.rain = requestAnimationFrame(loop);
    if (ui$.minimized || t - last < 55) return;
    last = t;
    ctx.fillStyle = "rgba(4, 2, 6, 0.16)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${size - 2}px monospace`;
    for (let i = 0; i < cols.length; i++) {
      const y = cols[i] * size;
      ctx.fillStyle = Math.random() < 0.06 ? "rgba(62, 242, 255, 0.85)" : "rgba(255, 42, 61, 0.55)";
      ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * size, y);
      cols[i] = y > canvas.height && Math.random() > 0.97 ? 0 : cols[i] + 1;
    }
  };
  ui$.rain = requestAnimationFrame(loop);
}

function stopRain() {
  if (ui$.rain) cancelAnimationFrame(ui$.rain);
  ui$.rain = null;
}

/* ------------------------------------------------------------------ */
/* Holographic D10                                                     */
/* ------------------------------------------------------------------ */


const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
function sideHtml(side, key, { solo = null, clickable = false } = {}) {
  if (!side) return "";
  return `<div class="dd-side ${esc(side.tone ?? "cyan")}" data-side="${key}">
      ${reactorHtml(clickable ? 'data-nn="roll"' : "")}
      <div class="dd-id"><b class="dd-who">${esc(side.who ?? "")}</b></div>
      <div class="dd-mods">${modsHtml(side.parts)}</div>
      ${solo ? meterHtml({ dv: solo.value, hidden: !game.user.isGM && solo.hidden, base: sumParts(side.parts) }) : ""}
      <div class="dd-total"></div>
    </div>`;
}

const HINTS = {
  defend: () => T("Black ICE strikes — roll your defense"),
  init: () => T("Who moves first? Roll initiative"),
  check: () => T("Roll the hologram"),
};

/** Build (or rebuild) the prompt view inside the dice layer and give it live hologram dice. */
function buildRollView({ id, title, hint, a, b, dv, interactive }) {
  const layer = ui$.root?.querySelector(".nn-dice-layer");
  if (!layer) return null;
  destroyRollView();
  const S = getState();
  const ctrl = canControl(S);
  const who = runnerActor(S)?.name ?? "the Netrunner";
  const duo = !!b;
  layer.innerHTML = `<div class="nn-roll nn-prompt dd-box ${duo ? "duo" : "solo"} ${b?.tone === "red" && hint === "defend" ? "ice" : ""}" data-pid="${esc(id)}">
      <div class="dd-band"></div>
      ${titleHtml("", "", gl(title, `pt-${id}`))}
      ${interactive ? `<div class="nn-roll-hint">${esc(HINTS[hint]?.() ?? "")}</div>` : ""}
      <div class="dd-row">${sideHtml(a, "a", { solo: !duo ? dv : null, clickable: interactive && ctrl })}${duo ? `<div class="dd-link"><span class="beam"></span><b>VS</b></div>${sideHtml(b, "b")}` : ""}</div>
      ${interactive ? `<div class="dd-action">${ctrl ? `<a class="dd-roll" data-nn="roll"><span>${T("ROLL")}</span><span class="nn-key">F</span></a>` : `<div class="dd-wait">${esc(T("Waiting for {who} to roll…").replace("{who}", who))}</div>`}</div>` : ""}
      <div class="nn-verdict dd-verdict"></div>
    </div>`;
  const view = { id, el: layer.firstElementChild, dice: {} };
  for (const key of ["a", "b"]) {
    const side = key === "a" ? a : b;
    const slot = view.el.querySelector(`[data-side="${key}"] .dd-die`);
    if (!side || !slot) continue;
    const die = new HoloDie("d10", side.tone ?? (key === "a" ? "cyan" : "red"));
    slot.append(die.el);
    view.dice[key] = die;
  }
  ui$.rollView = view;
  return view;
}

function destroyRollView() {
  const v = ui$.rollView;
  if (!v) return;
  for (const d of Object.values(v.dice)) d.destroy();
  v.el?.remove();
  ui$.rollView = null;
}

/** Keep the visible prompt in step with the state (called on every render). */
function syncPrompt(S) {
  if (!ui$.root || ui$.diceBusy) return;
  const view = ui$.rollView;
  const rolls = S.rolls ?? [];
  if (view && !view.playing) {
    const mine = rolls.find((r) => r.promptId === view.id);
    if (mine) {
      // A prompt that has just been rolled stays up until its animation has played...
      if (!ui$.seenRolls.has(mine.id) || ui$.diceQueue.includes(mine)) return;
      // ...but if that roll was skipped (late join, clock drift) don't leave the die spinning.
      destroyRollView();
    } else if (view.rolling && S.prompt?.id !== view.id) {
      // The prompt was resolved without a roll (target gone, error, GM skipped it).
      destroyRollView();
    }
  }
  const cur = ui$.rollView;
  if (S.prompt) {
    if (cur?.id !== S.prompt.id) buildRollView({ ...S.prompt, interactive: true });
  } else if (cur && !cur.rolling) destroyRollView();
}

/** Put a prompt back to "click to roll" (the request was lost or refused). */
function unstickPrompt(view) {
  if (!view || ui$.rollView !== view || view.playing) return;
  view.rolling = false;
  view.el.classList.remove("rolling");
  view.el.querySelectorAll(".dd-side").forEach((e) => e.classList.remove("rolling"));
  for (const d of Object.values(view.dice)) d.idle?.();
  const act = view.el.querySelector(".dd-action");
  if (act && !act.children.length) act.innerHTML = `<a class="dd-roll" data-nn="roll"><span>${T("ROLL")}</span><span class="nn-key">F</span></a>`;
}

/** Click on the die / ROLL: spin right away for feedback, the GM client does the real roll. */
function clickRoll(S) {
  const view = ui$.rollView;
  if (!S?.prompt || !view || view.id !== S.prompt.id || view.rolling) return;
  view.rolling = true;
  view.el.classList.add("rolling");
  for (const d of Object.values(view.dice)) d.spin();
  view.el.querySelector(".dd-action")?.replaceChildren();
  view.el.querySelectorAll(".dd-side").forEach((e) => e.classList.add("rolling"));
  const pid = S.prompt.id;
  request("roll", { promptId: pid });
  // Watchdog: if nothing came back, let the player click again instead of spinning forever.
  setTimeout(() => {
    const now = getState();
    if (ui$.rollView !== view || view.playing) return;
    if ((now?.rolls ?? []).some((r) => r.promptId === pid)) return;
    if (now?.prompt?.id === pid) unstickPrompt(view);
    else if (!ui$.diceBusy) destroyRollView();
  }, 8000);
}

function queueRolls(S) {
  if (!S || !ui$.root) return;
  if (ui$.root.querySelector(".nn-boot.on")) return;
  // Staleness is judged against the newest roll (all stamped by the GM's clock), not this
  // computer's clock, so players whose clock is off still see their rolls.
  const newest = Math.max(0, ...(S.rolls ?? []).map((r) => r.t ?? 0));
  const viewId = ui$.rollView?.id;
  for (const r of S.rolls ?? []) {
    if (ui$.seenRolls.has(r.id)) continue;
    ui$.seenRolls.add(r.id);
    if (newest - (r.t ?? 0) > 20000 && r.promptId !== viewId) continue;
    ui$.diceQueue.push(r);
  }
  pumpDice();
}

function countUp(el, value, ms = 500) {
  if (!el) return;
  const start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / ms);
    el.textContent = String(Math.round(value * k));
    if (k < 1) setTimeout(step, 30);
    else el.textContent = String(value);
  };
  step();
}

function verdictText(r) {
  if (r.awaiting) return T("AWAITING GM…");
  if (!r.vs) return `${T("RESULT")} ${r.total}`;
  const init = /initiative/i.test(r.label);
  if (r.ice) return r.success ? (init ? T("ICE STRIKES FIRST") : T("HIT")) : init ? T("YOU ACT FIRST") : T("BLOCKED");
  return r.success ? T("ACCESS GRANTED") : T("ACCESS DENIED");
}

async function playCheck(r) {
  let view = ui$.rollView;
  if (!view || view.id !== r.promptId) {
    // Joined late or a roll without a prompt: build a view from the roll itself.
    const runner = r.ice ? { who: r.vs?.label ?? "", parts: r.vs?.parts, tone: "cyan" } : { who: r.who, parts: r.parts, tone: "cyan" };
    const other = r.ice ? { who: r.who, parts: r.parts, tone: "red" } : r.vs && !r.vs.dv ? { who: r.vs.label, parts: r.vs.parts, tone: "red" } : null;
    view = buildRollView({ id: r.promptId ?? r.id, title: r.label, a: runner, b: other, dv: r.vs?.dv ? { value: r.vs.total, hidden: r.hidden } : null, interactive: false });
    if (!view) return;
  }
  view.rolling = true;
  view.playing = true;
  view.el.classList.add("rolling");
  view.el.querySelector(".dd-action")?.replaceChildren();
  view.el.querySelectorAll(".dd-side").forEach((e) => e.classList.add("rolling"));
  // Map faces: side a is always the runner.
  const runnerRoll = r.ice ? { face: r.vs?.face, extra: r.vs?.extra, total: r.vs?.total } : { face: r.face, extra: r.extra, total: r.total };
  const otherRoll = r.ice ? { face: r.face, extra: r.extra, total: r.total } : r.vs && !r.vs.dv ? { face: r.vs.face, extra: r.vs.extra, total: r.vs.total } : null;
  for (const d of Object.values(view.dice)) if (d.state !== "spin") d.spin();
  await sleep(450);
  const lands = [];
  if (view.dice.a) lands.push(runnerRoll.face ? view.dice.a.roll(runnerRoll.face) : Promise.resolve(view.dice.a.idle?.()));
  if (view.dice.b) lands.push(otherRoll?.face ? view.dice.b.roll(otherRoll.face) : Promise.resolve(view.dice.b.idle?.()));
  await Promise.race([Promise.all(lands), sleep(2600)]);
  view.el.classList.remove("rolling");
  view.el.classList.add("landed");
  const showDv = game.user.isGM || !r.hidden;
  const put = (key, roll) => {
    const side = view.el.querySelector(`[data-side="${key}"]`);
    if (!side || !roll) return;
    side.classList.remove("rolling");
    side.classList.add("landed");
    holoCount(side.querySelector(".dd-total"), roll.total);
    const meter = side.querySelector(".dd-meter");
    if (meter) fillMeter(meter, roll.total, { pass: showDv && !r.awaiting ? !!r.success : null });
    if (roll.extra) side.insertAdjacentHTML("beforeend", `<div class="dd-crit ${roll.extra > 0 ? "good" : "bad"}">${roll.extra > 0 ? `${T("CRITICAL")} +${roll.extra}` : `${T("FUMBLE")} ${roll.extra}`}</div>`);
  };
  put("a", runnerRoll);
  put("b", otherRoll);
  const runnerWins = r.ice ? !r.success : r.success;
  view.el.classList.add("resolved", r.awaiting ? "awaiting" : runnerWins ? "good" : "bad");
  const v = view.el.querySelector(".nn-verdict");
  const text = verdictText(r);
  v.innerHTML = `<i class="dd-slash"></i><span class="nn-gl" data-text="${esc(text)}">${esc(text)}</span>${r.forced ? " <small>(GM)</small>" : ""}<i class="dd-slash"></i>`;
  scrambleEl(v.firstElementChild);
  await sleep(2100);
  view.el.classList.add("leave");
  await sleep(300);
  if (ui$.rollView === view) destroyRollView();
}

async function playDamage(r) {
  const layer = ui$.root?.querySelector(".nn-dice-layer");
  if (!layer) return;
  destroyRollView();
  const faces = (r.faces ?? []).slice(0, 8);
  layer.innerHTML = `<div class="nn-roll nn-roll-dmg dd-box ${r.ice ? "ice" : ""}">
      <div class="dd-band"></div>
      ${titleHtml(r.label, r.formula)}
      <div class="nn-dmg-dice"></div>
      <div class="nn-dmg-total"><b>0</b></div>
    </div>`;
  const box = layer.firstElementChild;
  const wrap = box.querySelector(".nn-dmg-dice");
  const dice = faces.map(() => {
    const d = new HoloDie("d6", r.ice ? "red" : "yellow");
    const cell = document.createElement("div");
    cell.className = "nn-dmg-die";
    cell.append(d.el);
    wrap.append(cell);
    d.spin();
    return d;
  });
  await sleep(350);
  await Promise.race([Promise.all(dice.map((d, i) => d.roll(faces[i]))), sleep(2400)]);
  countUp(box.querySelector(".nn-dmg-total b"), r.total, 400);
  box.classList.add("landed");
  await sleep(1400);
  box.classList.add("leave");
  await sleep(300);
  dice.forEach((d) => d.destroy());
  if (layer.firstElementChild === box) layer.innerHTML = "";
}

async function playVerdict(r) {
  const layer = ui$.root?.querySelector(".nn-dice-layer");
  if (!layer) return;
  destroyRollView();
  const vt = r.success ? T("ACCESS GRANTED") : T("ACCESS DENIED");
  layer.innerHTML = `<div class="nn-roll nn-roll-verdict dd-box resolved landed ${r.good ? "good" : "bad"}">
      <div class="dd-band"></div>
      ${titleHtml(`${r.label} :: GM`)}
      <div class="nn-verdict dd-verdict"><i class="dd-slash"></i><span class="nn-gl" data-text="${esc(vt)}">${esc(vt)}</span><i class="dd-slash"></i></div>
    </div>`;
  const box = layer.firstElementChild;
  scrambleEl(box.querySelector(".nn-gl"));
  await sleep(1800);
  box.classList.add("leave");
  await sleep(300);
  if (layer.firstElementChild === box) layer.innerHTML = "";
}

async function pumpDice() {
  if (ui$.diceBusy || !ui$.diceQueue.length || !ui$.root) return;
  ui$.diceBusy = true;
  const r = ui$.diceQueue.shift();
  try {
    if (r.kind === "verdict") await playVerdict(r);
    else if (r.kind === "damage") await playDamage(r);
    else await playCheck(r);
  } catch (err) {
    console.error("NET RUN | dice", err);
    if (ui$.rollView?.playing) destroyRollView();
  }
  ui$.diceBusy = false;
  if (ui$.diceQueue.length) pumpDice();
  else {
    const S = getState();
    if (S?.active) syncPrompt(S);
  }
}
