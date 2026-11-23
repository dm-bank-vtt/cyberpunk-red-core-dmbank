/**
 * DM Bank: HOSTILES DETECTED — cinematic combat start for Cyberpunk RED.
 * Same flow as DM Bank's Grim Encounter (launcher → intro → everyone rolls their own die →
 * order cards → combat starts), rebuilt in a cyberpunk HUD style with hologram d10s.
 *
 * GM client is authoritative: it creates the Combat, rolls (CPR initiative = REF + 1d10,
 * criticals per the system setting) and broadcasts what every screen should show.
 */
import NetWindow from "../net/app-base.js";
import { HoloDie } from "../dice/holo-dice.js";
import { T } from "../net/i18n.js";

const NS = "ncenc";
const sock = () => `system.${game.system.id}`;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const isActiveGM = () => (globalThis.CPR_NET_LOCAL ? game.user.isGM : game.users.activeGM ? game.users.activeGM.isSelf : game.user.isGM);
const gl = (text, extra = "") => `<span class="nn-gl ${extra}" data-text="${esc(text)}">${esc(text)}</span>`;

/* ------------------------------------------------------------------ */
/* GM state                                                            */
/* ------------------------------------------------------------------ */
const GM = { pcs: new Map(), results: new Map(), part: new Set(), combatId: null, finishing: false };

const ownersOf = (actor) => game.users.filter((u) => !u.isGM && actor?.testUserPermission(u, "OWNER"));
const isPlayerToken = (t) => !!t.actor?.hasPlayerOwner;

function broadcast(msg) {
  game.socket.emit(sock(), { ns: NS, ...msg });
  onMessage({ ns: NS, ...msg });
}

function send(msg) {
  if (isActiveGM()) onMessage({ ns: NS, ...msg, userId: game.user.id });
  else game.socket.emit(sock(), { ns: NS, ...msg, userId: game.user.id });
}

export async function launchEncounter({ sceneId, actorIds = [], foeIds = [], preview = false }) {
  if (!game.user.isGM) return;
  const scene = game.scenes.get(sceneId) ?? game.scenes.viewed;
  if (!scene) return;
  Object.assign(GM, { pcs: new Map(), results: new Map(), part: new Set(), combatId: null, finishing: false });
  const threat = foeIds.length;
  if (preview) {
    playIntro({ threat, preview: true });
    return;
  }
  broadcast({ action: "intro", threat });
  await sleep(900);
  if (game.scenes.viewed?.id !== scene.id || !scene.active) {
    const ready = new Promise((r) => {
      Hooks.once("canvasReady", r);
      setTimeout(r, 6000);
    });
    if (!scene.active) await scene.activate();
    else await scene.view();
    await ready;
  }
  try {
    let combat = game.combats.find((c) => c.scene?.id === scene.id);
    if (!combat) combat = await getDocumentClass("Combat").create({ scene: scene.id, active: true });
    if (!combat.active) await combat.activate?.();
    GM.combatId = combat.id;
    const wanted = new Set(actorIds);
    const foes = new Set(foeIds);
    const picked = new Set();
    const data = [];
    for (const t of scene.tokens) {
      const pc = t.actorId && wanted.has(t.actorId) && isPlayerToken(t);
      const foe = foes.has(t.id) && !isPlayerToken(t);
      if (!pc && !foe) continue;
      picked.add(t.id);
      if (combat.combatants.some((c) => c.tokenId === t.id)) continue;
      data.push({ tokenId: t.id, sceneId: scene.id, actorId: t.actorId, hidden: t.hidden });
    }
    if (data.length) await combat.createEmbeddedDocuments("Combatant", data);
    const reinforce = !!combat.started;
    const updates = [];
    for (const c of combat.combatants) {
      if (!picked.has(c.tokenId)) continue;
      const owners = ownersOf(c.actor);
      const isPC = owners.length && !c.hidden;
      if (!isPC && reinforce && c.initiative != null) continue;
      GM.part.add(c.id);
      if (isPC) {
        GM.pcs.set(c.id, {
          id: c.id,
          name: c.name,
          img: c.actor?.img ?? c.img,
          player: owners.map((u) => u.name).join(", "),
          owners: owners.map((u) => u.id),
          ref: Number(c.actor?.system?.stats?.ref?.value ?? 0),
        });
      } else {
        const r = await rollInit(c);
        updates.push({ _id: c.id, initiative: r.total });
      }
    }
    if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
  } catch (err) {
    console.error("DM Bank | encounter", err);
    ui.notifications.error(`HOSTILES DETECTED: ${err.message}`);
    broadcast({ action: "close" });
    return;
  }
  await sleep(1700);
  if (!GM.pcs.size) {
    GM.finishing = true;
    finishOrder();
    return;
  }
  broadcast({ action: "dice", dice: [...GM.pcs.values()] });
}

async function rollInit(c) {
  const { default: CPRCombat } = await import("../../combat/cpr-combat.js");
  const roll = await c.getInitiativeRoll(CPRCombat._getInitiativeFormula(c));
  await roll.roll();
  const face = Number(roll.initialRoll) || 0;
  const crit = roll.criticalRoll ? (roll.wasCriticalFailure?.() || face === 1 ? -roll.criticalRoll : roll.criticalRoll) : 0;
  return { face, crit, total: Number(roll.resultTotal ?? face), stat: roll.statValue ?? 0, mods: roll.totalMods?.() ?? 0 };
}

async function gmRoll(id, userId) {
  const combat = game.combats.get(GM.combatId);
  const c = combat?.combatants.get(id);
  const user = game.users.get(userId);
  if (!c || !user || !GM.pcs.has(id) || GM.finishing || GM.results.has(id)) return;
  if (!user.isGM && !c.actor?.testUserPermission(user, "OWNER")) return;
  GM.results.set(id, null);
  try {
    const r = await rollInit(c);
    await c.update({ initiative: r.total });
    GM.results.set(id, r);
    broadcast({ action: "rolled", id, result: r });
    if ([...GM.pcs.keys()].every((k) => GM.results.get(k))) {
      GM.finishing = true;
      await sleep(2600);
      finishOrder();
    }
  } catch (err) {
    GM.results.delete(id);
    console.error("DM Bank | initiative", err);
  }
}

async function finishOrder() {
  const combat = game.combats.get(GM.combatId);
  if (!combat) return broadcast({ action: "close" });
  const order = combat.combatants.contents
    .filter((c) => GM.part.has(c.id) && !c.hidden)
    .sort((a, b) => (b.initiative ?? -999) - (a.initiative ?? -999))
    .map((c) => ({
      name: c.name,
      img: c.actor?.img && !/mystery-man/.test(c.actor.img) ? c.actor.img : c.img,
      total: Math.round((c.initiative ?? 0) * 100) / 100,
      pc: GM.pcs.has(c.id),
      hostile: (c.token?.disposition ?? 0) < 0,
    }));
  broadcast({ action: "order", order });
  await sleep(2200 + order.length * 140 + 2600);
  try {
    if (!combat.started) await combat.startCombat();
  } catch (err) {
    console.warn("DM Bank | start combat", err);
  }
  broadcast({ action: "close" });
}

/* ------------------------------------------------------------------ */
/* Client side: stage                                                  */
/* ------------------------------------------------------------------ */
let stage = null;
const dice = new Map();

function root() {
  if (!stage || !stage.isConnected) {
    stage = document.createElement("div");
    stage.id = "dmb-enc";
    document.body.append(stage);
    stage.addEventListener("click", onStageClick);
  }
  return stage;
}

function closeStage() {
  for (const d of dice.values()) d.die.destroy();
  dice.clear();
  if (!stage) return;
  const el = stage;
  el.classList.add("out");
  setTimeout(() => el.remove(), 600);
  stage = null;
}

function onMessage(msg) {
  if (msg?.ns !== NS) return;
  switch (msg.action) {
    case "intro":
      return playIntro(msg);
    case "dice":
      return showDice(msg);
    case "rolled":
      return playRolled(msg);
    case "order":
      return playOrder(msg);
    case "close":
      return closeStage();
    case "rollRequest":
      if (isActiveGM()) gmRoll(msg.id, msg.userId);
      return;
    case "rollAll":
      if (isActiveGM() && game.users.get(msg.userId)?.isGM) for (const id of GM.pcs.keys()) if (!GM.results.has(id)) gmRoll(id, msg.userId);
      return;
    default:
  }
}

function playIntro({ threat = 0, preview = false }) {
  const el = root();
  const tri = Array.from({ length: 6 }, (_, i) => `<i style="left:${8 + i * 16}%;animation-delay:${(i * 0.08).toFixed(2)}s"></i>`).join("");
  el.className = "dmb-enc intro";
  el.innerHTML = `
    <div class="enc-flash"></div>
    <div class="enc-stripes top"></div><div class="enc-stripes bottom"></div>
    <div class="enc-scan"></div>
    <div class="enc-warn">${tri}</div>
    <div class="enc-title">
      <small>${esc(T("COMBAT PROTOCOL ENGAGED"))}</small>
      <b>${gl(T("HOSTILES DETECTED"))}</b>
      <span class="enc-threat">${esc(T("THREATS"))}: <em>${threat || "?"}</em> &nbsp;//&nbsp; ${esc(T("LEVEL"))} <em>${threat >= 5 ? "OMEGA" : threat >= 3 ? "DELTA" : "GAMMA"}</em></span>
    </div>`;
  if (preview) setTimeout(() => closeStage(), 3400);
}

function showDice({ dice: list = [] }) {
  const el = root();
  for (const d of dice.values()) d.die.destroy();
  dice.clear();
  el.className = "dmb-enc rolling-stage";
  const gm = game.user.isGM;
  el.innerHTML = `
    <div class="enc-scan"></div>
    <div class="enc-head"><small>${esc(T("COMBAT PROTOCOL"))}</small><b>${gl(T("ROLL INITIATIVE"))}</b><span>REF + d10</span></div>
    <div class="enc-cols">${list
      .map((p) => {
        const mine = gm || p.owners.includes(game.user.id);
        return `<div class="enc-col ${mine ? "mine" : ""}" data-id="${p.id}">
          <div class="enc-port"><img src="${esc(p.img)}" alt=""></div>
          <div class="enc-holo" ${mine ? 'data-act="roll"' : ""}><div class="enc-die"></div><div class="enc-base"></div></div>
          <b class="enc-name">${esc(p.name)}</b>
          <small class="enc-player">${esc(p.player)}</small>
          <div class="enc-mods"><span>REF +${p.ref}</span><span class="d">+ d10</span></div>
          <div class="enc-total"></div>
          ${mine ? `<a class="enc-btn" data-act="roll">${esc(T("ROLL"))}</a>` : `<span class="enc-wait">${esc(T("waiting…"))}</span>`}
        </div>`;
      })
      .join("")}</div>
    ${gm ? `<div class="enc-gm"><a class="enc-btn ghost" data-act="rollAll">${esc(T("ROLL ALL REMAINING"))}</a><a class="enc-btn ghost" data-act="abort">${esc(T("CANCEL"))}</a></div>` : ""}`;
  for (const p of list) {
    const slot = el.querySelector(`.enc-col[data-id="${p.id}"] .enc-die`);
    const die = new HoloDie("d10", "cyan");
    slot.append(die.el);
    dice.set(p.id, { die, info: p });
  }
}

function onStageClick(ev) {
  const t = ev.target.closest("[data-act]");
  if (!t) return;
  ev.preventDefault();
  const act = t.dataset.act;
  if (act === "roll") {
    const col = t.closest(".enc-col");
    const entry = dice.get(col?.dataset.id);
    if (!entry || col.classList.contains("rolled") || col.classList.contains("spinning")) return;
    col.classList.add("spinning");
    entry.die.spin();
    col.querySelector(".enc-btn")?.remove();
    send({ action: "rollRequest", id: col.dataset.id });
  } else if (act === "rollAll" && game.user.isGM) {
    for (const [id, entry] of dice) {
      const col = stage?.querySelector(`.enc-col[data-id="${id}"]`);
      if (!col || col.classList.contains("rolled")) continue;
      col.classList.add("spinning");
      entry.die.spin();
    }
    send({ action: "rollAll" });
  } else if (act === "abort" && game.user.isGM) {
    broadcast({ action: "close" });
  }
}

async function playRolled({ id, result }) {
  const entry = dice.get(id);
  const col = stage?.querySelector(`.enc-col[data-id="${id}"]`);
  if (!entry || !col) return;
  col.classList.add("spinning");
  col.querySelector(".enc-btn")?.remove();
  if (entry.die.state !== "spin") entry.die.spin();
  await sleep(350);
  await Promise.race([entry.die.roll(Math.max(1, Math.min(10, result.face || 1))), sleep(2400)]);
  col.classList.remove("spinning");
  col.classList.add("rolled", result.crit > 0 ? "crit" : result.crit < 0 ? "fumble" : "ok");
  const tot = col.querySelector(".enc-total");
  const start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / 500);
    tot.textContent = String(Math.round(result.total * k));
    if (k < 1) setTimeout(step, 30);
  };
  step();
  if (result.crit) col.insertAdjacentHTML("beforeend", `<div class="enc-crit">${result.crit > 0 ? `CRIT +${result.crit}` : `FUMBLE ${result.crit}`}</div>`);
}

function playOrder({ order = [] }) {
  const el = root();
  for (const d of dice.values()) d.die.destroy();
  dice.clear();
  el.className = "dmb-enc order-stage";
  el.innerHTML = `
    <div class="enc-scan"></div>
    <div class="enc-head"><small>${esc(T("TACTICAL ANALYSIS COMPLETE"))}</small><b>${gl(T("TURN ORDER"))}</b><span>${order.length} ${esc(T("UNITS"))}</span></div>
    <div class="enc-order">${order
      .map(
        (o, i) => `<div class="enc-card ${o.pc ? "pc" : ""} ${o.hostile ? "hostile" : "ally"}" style="animation-delay:${(i * 0.12).toFixed(2)}s">
          <span class="enc-idx">${String(i + 1).padStart(2, "0")}</span>
          <div class="enc-cimg"><img src="${esc(o.img)}" alt=""></div>
          <b>${esc(o.name)}</b>
          <small>${o.hostile ? esc(T("HOSTILE")) : o.pc ? esc(T("PLAYER")) : esc(T("NEUTRAL"))}</small>
          <em>${o.total}</em>
        </div>`
      )
      .join("")}</div>`;
}

/* ------------------------------------------------------------------ */
/* Launcher (GM)                                                       */
/* ------------------------------------------------------------------ */
class EncounterLauncher extends NetWindow {
  static DEFAULT_OPTIONS = {
    id: "dmb-enc-launcher",
    classes: ["nc-netwin", "dmb-enc-launcher"],
    window: { title: "HOSTILES DETECTED", icon: "fas fa-triangle-exclamation", resizable: true },
    position: { width: 560, height: 640 },
  };

  constructor(...args) {
    super(...args);
    this.sceneId = game.scenes.viewed?.id;
    this.pcs = null;
    this.foes = null;
  }

  sceneTokens() {
    const scene = game.scenes.get(this.sceneId);
    return scene ? [...scene.tokens] : [];
  }

  async buildHTML() {
    const tokens = this.sceneTokens();
    const pcTokens = tokens.filter((t) => isPlayerToken(t));
    const npc = tokens.filter((t) => !isPlayerToken(t) && t.actor);
    if (!this.pcs) this.pcs = new Set(pcTokens.map((t) => t.actorId));
    if (!this.foes) {
      const sel = canvas.tokens?.controlled?.filter((t) => t.document.parent?.id === this.sceneId && !isPlayerToken(t.document)).map((t) => t.id) ?? [];
      this.foes = new Set(sel.length ? sel : npc.filter((t) => t.disposition < 0 && !t.hidden).map((t) => t.id));
    }
    const disp = (t) => (t.disposition < 0 ? "hostile" : t.disposition > 0 ? "friendly" : "neutral");
    return `<div class="dmb-enl">
        <label class="dmb-enl-h">${esc(T("SCENE"))}</label>
        <select data-k="scene">${game.scenes.map((s) => `<option value="${s.id}" ${s.id === this.sceneId ? "selected" : ""}>${esc(s.name)}${s.active ? " ●" : ""}</option>`).join("")}</select>
        <label class="dmb-enl-h">${esc(T("PLAYERS"))} <small>${pcTokens.length}</small></label>
        <div class="dmb-enl-chips">${pcTokens.map((t) => `<a class="dmb-chip ally ${this.pcs.has(t.actorId) ? "on" : ""}" data-a="pc" data-id="${t.actorId}"><img src="${esc(t.texture?.src)}" alt="">${esc(t.name)}</a>`).join("") || `<span class="nca-dim">${esc(T("No player tokens on this scene."))}</span>`}</div>
        <label class="dmb-enl-h">${esc(T("ON THE BOARD"))} <small>${npc.length}</small>
          <span class="dmb-enl-tools"><a data-a="sel">${esc(T("Use selected"))}</a><a data-a="all">${esc(T("All"))}</a><a data-a="none">${esc(T("None"))}</a></span></label>
        <div class="dmb-enl-chips">${npc
          .sort((a, b) => a.disposition - b.disposition)
          .map((t) => `<a class="dmb-chip ${disp(t)} ${this.foes.has(t.id) ? "on" : ""} ${t.hidden ? "hidden-tok" : ""}" data-a="foe" data-id="${t.id}"><img src="${esc(t.texture?.src)}" alt="">${esc(t.name)}${t.hidden ? ' <i class="fas fa-eye-slash"></i>' : ""}</a>`)
          .join("") || `<span class="nca-dim">${esc(T("No other tokens."))}</span>`}</div>
        <div class="dmb-enl-foot">
          <a class="nca-btn" data-a="preview"><i class="fas fa-eye"></i> ${esc(T("Preview"))}</a>
          <a class="nca-btn nca-go" data-a="start"><i class="fas fa-triangle-exclamation"></i> ${esc(T("START COMBAT"))}</a>
        </div>
      </div>`;
  }

  onAction(a, el) {
    const tokens = this.sceneTokens();
    switch (a) {
      case "pc":
        if (this.pcs.has(el.dataset.id)) this.pcs.delete(el.dataset.id);
        else this.pcs.add(el.dataset.id);
        break;
      case "foe":
        if (this.foes.has(el.dataset.id)) this.foes.delete(el.dataset.id);
        else this.foes.add(el.dataset.id);
        break;
      case "sel":
        this.foes = new Set(canvas.tokens.controlled.filter((t) => !isPlayerToken(t.document)).map((t) => t.id));
        break;
      case "all":
        this.foes = new Set(tokens.filter((t) => !isPlayerToken(t) && !t.hidden).map((t) => t.id));
        break;
      case "none":
        this.foes = new Set();
        break;
      case "preview":
        launchEncounter({ sceneId: this.sceneId, actorIds: [...this.pcs], foeIds: [...this.foes], preview: true });
        return;
      case "start":
        launchEncounter({ sceneId: this.sceneId, actorIds: [...this.pcs], foeIds: [...this.foes] });
        this.close();
        return;
      default:
        return;
    }
    this.render();
  }

  onInput(t) {
    if (t.dataset.k === "scene") {
      this.sceneId = t.value;
      this.pcs = null;
      this.foes = null;
      this.render();
    }
  }
}

let launcher = null;
export function openEncounterLauncher() {
  if (!game.user.isGM) return;
  launcher ??= new EncounterLauncher();
  launcher.sceneId = game.scenes.viewed?.id;
  launcher.pcs = null;
  launcher.foes = null;
  launcher.render({ force: true });
}

export function registerEncounter() {
  Hooks.once("ready", () => {
    game.socket.on(sock(), (msg) => onMessage(msg));
  });
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.dmbHostiles = {
      name: "dmbHostiles",
      title: "HOSTILES DETECTED — start combat",
      icon: "fas fa-triangle-exclamation",
      order: 89,
      button: true,
      visible: true,
      onChange: () => openEncounterLauncher(),
    };
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && stage && game.user.isGM && !ev.target.closest("input, textarea")) broadcast({ action: "close" });
  });
}

/** Debug helper: play a stage message on this client only. */
export function encounterDebug(msg) {
  onMessage({ ns: NS, ...msg });
}
