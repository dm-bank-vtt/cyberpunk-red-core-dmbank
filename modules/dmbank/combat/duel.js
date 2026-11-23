/**
 * DM Bank: shared hologram roll screen for attacks (VS rolls), dodges and quick checks,
 * plus the attack chat card with its DAMAGE button.
 *
 * The attacker's client coordinates a duel: it opens the screen for everyone, each side's
 * controller clicks their own die (their client rolls and broadcasts), then the attacker's
 * client decides hit/miss, posts the chat card and spends ammo / luck.
 */
import { HoloDie } from "../dice/holo-dice.js";
import { countUp, meterHtml as meterBase, modsHtml, reactorHtml, titleHtml } from "../dice/holo-ui.js";
import { T } from "../net/i18n.js";

const NS = "ncduel";
const sock = () => `system.${game.system.id}`;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const duels = new Map(); // id -> { spec, rolls:{a,b}, choice, view }
const callbacks = new Map(); // id -> onResolve (kept on the opener's client only)

function emit(msg) {
  game.socket.emit(sock(), { ns: NS, ...msg });
  onMessage({ ns: NS, ...msg });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
export function rollModeIsPrivate() {
  try {
    const mode = game.settings.settings.has("core.messageMode") ? game.settings.get("core", "messageMode") : game.settings.get("core", "rollMode");
    return !["public", "publicroll", "ic", "ooc", "roll"].includes(mode);
  } catch (err) {
    return false;
  }
}

function currentRollMode() {
  try {
    if (game.settings.settings.has("core.messageMode")) {
      const m = game.settings.get("core", "messageMode");
      return { public: "publicroll", ic: "publicroll", ooc: "publicroll", gm: "gmroll", blind: "blindroll", self: "selfroll" }[m] ?? m;
    }
    return game.settings.get("core", "rollMode");
  } catch (err) {
    return "publicroll";
  }
}

export function applyChatMode(data, rollMode = currentRollMode()) {
  if (["gmroll", "blindroll"].includes(rollMode)) data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  if (rollMode === "selfroll") data.whisper = [game.user.id];
  if (rollMode === "blindroll") data.blind = true;
  if (typeof ChatMessage.applyMode === "function") {
    const mm = { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" }[rollMode] ?? rollMode;
    try {
      ChatMessage.applyMode(data, mm);
    } catch (err) {
      /* older core */
    }
  }
  return data;
}

async function rollD10() {
  const r = await new Roll("1d10").evaluate();
  const face = r.total;
  let extra = 0;
  if (face === 10) extra = (await new Roll("1d10").evaluate()).total;
  else if (face === 1) extra = -(await new Roll("1d10").evaluate()).total;
  return { face, extra, value: face + extra };
}

const sum = (parts) => (parts ?? []).reduce((s, p) => s + (Number(p[1]) || 0), 0);

function canRollSide(spec, side) {
  const s = spec[side];
  if (!s) return false;
  if (game.user.isGM) return true;
  return (s.userIds ?? []).includes(game.user.id);
}

/** Who may answer for a token: its player owners, or the GMs when nobody owns it. */
export function controllersOf(actor) {
  const players = game.users.filter((u) => !u.isGM && u.active && actor?.testUserPermission(u, "OWNER")).map((u) => u.id);
  return players.length ? players : game.users.filter((u) => u.isGM).map((u) => u.id);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Open a duel on every screen.
 * spec: { title, kind: "attack"|"check", a:{name,img,parts,userIds,tokenId}, b?:{...}, dv?:number,
 *         choice?:{dv} (defender may dodge or take the DV), meta:{...for the chat card} }
 */
export function openDuel(spec) {
  const id = foundry.utils.randomID(10);
  const { onResolve, ...rest } = spec;
  if (onResolve) callbacks.set(id, onResolve);
  const full = { ...rest, id, owner: game.user.id, private: rollModeIsPrivate(), rollMode: currentRollMode() };
  emit({ action: "open", spec: full });
  return id;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */
function onMessage(msg) {
  if (msg?.ns !== NS) return;
  switch (msg.action) {
    case "open":
      return showDuel(msg.spec);
    case "choice":
      return applyChoice(msg);
    case "rolled":
      return applyRoll(msg);
    case "result":
      return showResult(msg);
    case "close":
      return closeDuel(msg.id);
    default:
  }
}

let rootEl = null;
function root() {
  if (!rootEl || !rootEl.isConnected) {
    rootEl = document.createElement("div");
    rootEl.id = "dmb-duel";
    document.body.append(rootEl);
    rootEl.addEventListener("click", onClick);
  }
  return rootEl;
}

function meterHtml(spec) {
  const hide = spec.private && !game.user.isGM && spec.owner !== game.user.id;
  return meterBase({ dv: spec.dv, hidden: hide, base: sum(spec.a.parts), rangeM: spec.rangeM });
}

function sideHtml(s, key, spec) {
  if (!s) return "";
  const mine = canRollSide(spec, key);
  const solo = key === "a" && !spec.b && !spec.choice && spec.dv != null;
  return `<div class="dd-side dd-${key} ${s.tone ?? (key === "a" ? "cyan" : "red")}" data-side="${key}">
      ${reactorHtml(mine ? 'data-act="roll"' : "")}
      <div class="dd-id"><img src="${esc(s.img ?? "icons/svg/mystery-man.svg")}" alt=""><b class="dd-who">${esc(s.name)}</b></div>
      <div class="dd-mods">${modsHtml(s.parts)}</div>
      ${solo ? meterHtml(spec) : ""}
      <div class="dd-total"></div>
      <div class="dd-action">${mine ? `<a class="dd-roll" data-act="roll"><span>${esc(T("ROLL"))}</span></a>` : `<span class="dd-wait">${esc(T("waiting…"))}</span>`}</div>
    </div>`;
}

function choiceHtml(spec) {
  const c = spec.choice;
  if (!c) return "";
  const mine = canRollSide(spec, "b");
  return `<div class="dd-side dd-choice red" data-side="choice">
      <div class="dd-warn"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56"/><circle class="in" cx="60" cy="60" r="44"/></svg><img src="${esc(spec.b.img)}" alt=""></div>
      <b class="dd-who">${esc(spec.b.name)}</b>
      <p>${esc(T("Incoming fire! Dodge with Evasion, or let the range DV stand?"))}</p>
      ${mine ? `<div class="dd-choice-btns"><a class="dd-roll" data-act="dodge"><span>${esc(T("DODGE"))}</span></a><a class="dd-ghost" data-act="take">${esc(T("TAKE DV"))} ${c.dv}</a></div>` : `<span class="dd-wait">${esc(T("Target is deciding…"))}</span>`}
    </div>`;
}

function render(d) {
  const { spec } = d;
  const el = root();
  const other = spec.choice ? choiceHtml(spec) : spec.b ? sideHtml(spec.b, "b", spec) : "";
  el.innerHTML = `<div class="dd-box ${spec.kind} ${other ? "duo" : "solo"}" data-id="${spec.id}">
      <div class="dd-band"></div>
      ${titleHtml(spec.title, spec.sub)}
      <div class="dd-row">${sideHtml(spec.a, "a", spec)}${other ? `<div class="dd-link"><span class="beam"></span><b>VS</b></div>${other}` : ""}</div>
      <div class="dd-verdict"></div>
      ${game.user.isGM || spec.owner === game.user.id ? `<a class="dd-cancel" data-act="cancel" data-tooltip="${esc(T("CANCEL"))}"><i class="fas fa-xmark"></i></a>` : ""}
    </div>`;
  d.view = { el: el.firstElementChild, dice: {} };
  for (const key of ["a", "b"]) {
    const slot = d.view.el.querySelector(`[data-side="${key}"] .dd-die`);
    if (!slot) continue;
    const die = new HoloDie("d10", key === "a" ? spec.a.tone ?? "cyan" : spec.b?.tone ?? "red");
    slot.append(die.el);
    d.view.dice[key] = die;
  }
}

function showDuel(spec) {
  // one duel on screen at a time; a new one replaces the old
  for (const id of duels.keys()) closeDuel(id, true);
  const d = { spec, rolls: {}, choice: null };
  duels.set(spec.id, d);
  render(d);
}

function closeDuel(id, quiet = false) {
  const d = duels.get(id);
  if (!d) return;
  duels.delete(id);
  for (const die of Object.values(d.view?.dice ?? {})) die.destroy();
  const el = d.view?.el;
  if (!el) return;
  if (quiet) el.remove();
  else {
    el.classList.add("leave");
    setTimeout(() => el.remove(), 320);
  }
}

function currentDuel() {
  return [...duels.values()].at(-1);
}

async function onClick(ev) {
  const t = ev.target.closest("[data-act]");
  if (!t) return;
  ev.preventDefault();
  const d = currentDuel();
  if (!d) return;
  const { spec } = d;
  const act = t.dataset.act;
  if (act === "cancel") {
    emit({ action: "close", id: spec.id });
    return;
  }
  if (act === "dodge" || act === "take") {
    if (!canRollSide(spec, "b")) return;
    emit({ action: "choice", id: spec.id, dodge: act === "dodge" });
    return;
  }
  if (act === "roll") {
    const side = t.closest("[data-side]")?.dataset.side;
    if (!side || !canRollSide(spec, side) || d.rolls[side] || d.rolling?.[side]) return;
    d.rolling = { ...(d.rolling ?? {}), [side]: true };
    d.view.dice[side]?.spin();
    t.closest(".dd-side")?.querySelector(".dd-action")?.replaceChildren();
    let r;
    try {
      r = await rollD10();
    } catch (err) {
      console.error("DM Bank | duel: roll failed", err);
      delete d.rolling[side];
      render(d);
      return;
    }
    if (!duels.has(spec.id)) return;
    const total = sum(spec[side].parts) + r.value;
    emit({ action: "rolled", id: spec.id, side, face: r.face, extra: r.extra, total });
  }
}

function applyChoice({ id, dodge }) {
  const d = duels.get(id);
  if (!d || d.choice !== null) return;
  d.choice = dodge;
  if (dodge) {
    d.spec = { ...d.spec, choice: null };
  } else {
    d.spec = { ...d.spec, b: null, dv: d.spec.choice.dv, choice: null };
  }
  const keepA = d.rolls.a;
  render(d);
  if (keepA) landSide(d, "a", keepA, true);
  maybeResolve(d);
}

async function landSide(d, side, r, instant = false) {
  const die = d.view?.dice[side];
  const box = d.view?.el.querySelector(`[data-side="${side}"]`);
  if (!die || !box) return;
  box.querySelector(".dd-action")?.replaceChildren();
  box.classList.add("rolling");
  if (!instant) {
    if (die.state !== "spin") die.spin();
    await sleep(300);
  }
  await Promise.race([die.roll(r.face, { quick: instant }), sleep(2400)]);
  box.classList.remove("rolling");
  const hide = d.spec.private && !game.user.isGM && d.spec.owner !== game.user.id && side === "b";
  const totalEl = box.querySelector(".dd-total");
  if (hide) totalEl.textContent = "??";
  else countUp(totalEl, r.total);
  box.classList.add("landed");
  const meter = box.querySelector(".dd-meter");
  if (meter && !hide) {
    const scale = Number(meter.dataset.scale) || 30;
    const pct = Math.max(2, Math.min(100, (r.total / scale) * 100));
    requestAnimationFrame(() => meter.style.setProperty("--fill", `${pct}%`));
    const priv = d.spec.private && !game.user.isGM && d.spec.owner !== game.user.id;
    if (!priv) meter.classList.add(r.total > d.spec.dv ? "pass" : "fail");
  }
  if (r.extra) box.insertAdjacentHTML("beforeend", `<div class="dd-crit ${r.extra > 0 ? "good" : "bad"}">${r.extra > 0 ? `${T("CRITICAL")} +${r.extra}` : `${T("FUMBLE")} ${r.extra}`}</div>`);
}

async function applyRoll({ id, side, face, extra, total }) {
  const d = duels.get(id);
  if (!d || d.rolls[side]) return;
  d.rolls[side] = { face, extra, total };
  await landSide(d, side, d.rolls[side]);
  maybeResolve(d);
}

/** Only the client that opened the duel decides it. */
async function maybeResolve(d) {
  const { spec } = d;
  if (spec.owner !== game.user.id || d.resolved) return;
  if (spec.choice) return; // waiting for the defender to choose
  if (!d.rolls.a) return;
  if (spec.b && !d.rolls.b) return;
  d.resolved = true;
  await sleep(500);
  const atk = d.rolls.a.total;
  const def = spec.b ? d.rolls.b.total : spec.dv;
  const hit = spec.kind === "check" && def == null ? null : atk > def;
  emit({ action: "result", id: spec.id, hit, atk, def, dodged: !!spec.b && spec.kind === "attack" });
  try {
    const patch = await callbacks.get(spec.id)?.({ hit, atk, def, rolls: d.rolls });
    if (patch?.meta) spec.meta = { ...(spec.meta ?? {}), ...patch.meta };
    callbacks.delete(spec.id);
  } catch (err) {
    console.error("DM Bank | duel resolve", err);
  }
  await postCard(spec, { hit, atk, def, rolls: d.rolls });
}

async function showResult({ id, hit, atk, def }) {
  const d = duels.get(id);
  if (!d?.view) return;
  const { spec } = d;
  const hide = spec.private && !game.user.isGM && spec.owner !== game.user.id;
  const v = d.view.el.querySelector(".dd-verdict");
  let text;
  if (hide) text = T("RESULT SENT TO GM");
  else if (hit === null) text = `${T("RESULT")} ${atk}`;
  else if (spec.kind === "attack") text = hit ? T("HIT") : T("MISS");
  else text = hit ? T("SUCCESS") : T("FAIL");
  d.view.el.classList.add("resolved", hide ? "hidden-result" : hit === false ? "bad" : "good");
  v.innerHTML = `<i class="dd-slash"></i><span class="nn-gl" data-text="${esc(text)}">${esc(text)}</span><i class="dd-slash"></i>`;
  await sleep(2600);
  closeDuel(id);
}

/* ------------------------------------------------------------------ */
/* Chat card + DAMAGE button                                           */
/* ------------------------------------------------------------------ */
async function postCard(spec, { hit, atk, def, rolls }) {
  const meta = spec.meta ?? {};
  const line = (s, r) => `${esc(s.name)}: ${(s.parts ?? []).map((p) => `${esc(p[0])} ${p[1]}`).join(" + ")} + d10(${r.face}${r.extra ? (r.extra > 0 ? ` +${r.extra}` : ` ${r.extra}`) : ""}) = <b>${r.total}</b>`;
  const verdict = hit === null ? "" : spec.kind === "attack" ? (hit ? T("HIT") : T("MISS")) : hit ? T("SUCCESS") : T("FAIL");
  const content = `<div class="dmb-card ${hit === false ? "miss" : "hit"}">
      <div class="dmb-card-head"><b>${esc(spec.title)}</b>${spec.sub ? `<small>${esc(spec.sub)}</small>` : ""}</div>
      <div class="dmb-card-line">${line(spec.a, rolls.a)}</div>
      ${spec.b && rolls.b ? `<div class="dmb-card-line vs">${line(spec.b, rolls.b)}</div>` : def != null ? `<div class="dmb-card-line vs">DV <b>${def}</b>${spec.rangeM != null ? ` (${Math.round(spec.rangeM)} m)` : ""}</div>` : ""}
      ${verdict ? `<div class="dmb-card-verdict">${esc(verdict)}</div>` : ""}
      ${meta.note ? `<div class="dmb-card-note">${esc(meta.note)}</div>` : ""}
      ${meta.damage && hit !== false ? `<a class="dmb-card-btn" data-dmb-dmg="1"><i class="fas fa-droplet"></i> ${esc(T("DAMAGE"))} <small>${esc(meta.damage)}${meta.mult > 1 ? ` ×${meta.mult}` : ""}</small></a>` : ""}
    </div>`;
  const data = applyChatMode(
    {
      content,
      speaker: ChatMessage.getSpeaker({ actor: game.actors.get(meta.actorId), token: meta.tokenId ? canvas.tokens.get(meta.tokenId)?.document : undefined }),
      flags: { "cyberpunk-red-core-dmbank": { dmbAttack: { ...meta, hit } } },
    },
    spec.rollMode
  );
  await ChatMessage.create(data);
}

async function onDamageClick(message, btn) {
  const meta = message.flags?.["cyberpunk-red-core-dmbank"]?.dmbAttack;
  if (!meta?.damage) return;
  if (!game.user.isGM && message.author?.id !== game.user.id) {
    ui.notifications.warn(T("Only the attacker or the GM can roll this damage."));
    return;
  }
  btn.classList.add("used");
  const roll = await new Roll(meta.damage).evaluate();
  const faces = roll.dice.flatMap((d) => d.results.map((r) => r.result));
  const crit = faces.filter((f) => f === 6).length >= 2;
  const mult = Math.max(1, Number(meta.mult) || 1);
  const total = roll.total * mult;
  const bonus = crit ? 5 : 0;
  const loc = meta.location === "head" ? "head" : "body";
  const content = `<div class="dmb-card dmg">
      <div class="dmb-card-head"><b>${esc(T("DAMAGE"))}</b><small>${esc(meta.weaponName ?? "")}${meta.target ? ` >> ${esc(meta.target)}` : ""}</small></div>
      <div class="dmb-dmg-faces">${faces.map((f) => `<span class="${f === 6 ? "six" : ""}">${f}</span>`).join("")}${mult > 1 ? `<em>×${mult}</em>` : ""}</div>
      <div class="dmb-dmg-total">${total}${bonus ? ` <small>+${bonus}</small>` : ""}</div>
      ${crit ? `<div class="dmb-card-verdict crit">${esc(T("CRITICAL INJURY! (two 6s) +5 damage"))}</div>` : ""}
      ${meta.location ? `<div class="dmb-card-note">${esc(T("Aimed at"))}: ${esc(T(meta.location.toUpperCase()))}</div>` : ""}
      ${meta.targetTokenId ? `<div class="dmb-apply" data-gm-only><a data-dmb-apply="${loc}"><i class="fas fa-shield-halved"></i> ${esc(T("APPLY"))} ${esc(T(loc.toUpperCase()))}</a><a data-dmb-apply="${loc === "head" ? "body" : "head"}">${esc(T(loc === "head" ? "BODY" : "HEAD"))}</a></div>` : ""}
    </div>`;
  const data = {
    content,
    rolls: [roll],
    speaker: message.speaker,
    flags: { "cyberpunk-red-core-dmbank": { dmbDamage: { total, bonus, targetTokenId: meta.targetTokenId ?? null, sceneId: meta.sceneId ?? canvas.scene?.id } } },
  };
  if (message.whisper?.length) data.whisper = message.whisper;
  if (message.blind) data.blind = true;
  await ChatMessage.create(data);
}

/** GM: push the rolled damage through the target's armor with the system's own damage code. */
async function onApplyClick(message, loc) {
  if (!game.user.isGM) return;
  const info = message.flags?.["cyberpunk-red-core-dmbank"]?.dmbDamage;
  if (!info?.targetTokenId) return;
  const scene = game.scenes.get(info.sceneId) ?? canvas.scene;
  const actor = scene?.tokens.get(info.targetTokenId)?.actor;
  if (!actor?._applyDamage) {
    ui.notifications.warn(T("Target token not found on this scene."));
    return;
  }
  const form = { damageReductionRole: true, damageReductionAE: true, useShield: true, brainDamageReduction: true };
  await actor._applyDamage(info.total, info.bonus ?? 0, loc, 1, "", 0, 0, true, form);
}

export function registerDuel() {
  Hooks.once("ready", () => game.socket.on(sock(), (msg) => onMessage(msg)));
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const btn = html.querySelector?.("[data-dmb-dmg]");
    btn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      onDamageClick(message, btn);
    });
    const apply = html.querySelector?.("[data-gm-only]");
    if (apply && !game.user.isGM) apply.remove();
    html.querySelectorAll?.("[data-dmb-apply]").forEach((a) =>
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (a.classList.contains("used")) return;
        a.classList.add("used");
        onApplyClick(message, a.dataset.dmbApply);
      })
    );
  });
}
