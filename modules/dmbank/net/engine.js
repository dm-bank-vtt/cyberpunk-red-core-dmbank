/**
 * DM Bank NET RUN engine.
 * The run lives in a hidden world setting so every client renders the same thing. Players send
 * requests over the system socket; the active GM's client checks the rules, rolls and writes the
 * new state. Anything outside the rules is parked as `pending` for the GM to allow or refuse.
 */
import { NC_SCOPE } from "../util.js";
import { ABILITIES, BOOSTERS, ICE, makeIce, netActionsForRank } from "./data.js";

export const STATE_KEY = "nc.netrun";
const MAX_LOG = 90;
const MAX_ROLLS = 8;

export const socketName = () => `system.${game.system.id}`;
export const getState = () => {
  try {
    return game.settings.get(NC_SCOPE, STATE_KEY) || null;
  } catch (err) {
    return null;
  }
};
export const isActiveGM = () => (globalThis.CPR_NET_LOCAL ? game.user.isGM : game.users.activeGM ? game.users.activeGM.isSelf : game.user.isGM);
export const canControl = (S, user = game.user) => !!S && (user.isGM || (S.controllers ?? []).includes(user.id));

/* ------------------------------------------------------------------ */
/* Request routing                                                     */
/* ------------------------------------------------------------------ */

export function request(type, args = {}) {
  if (isActiveGM()) return enqueue(game.user.id, type, args);
  if (!game.users.activeGM) {
    ui.notifications.warn("NET RUN: no GM is connected to process this action.");
    return null;
  }
  game.socket.emit(socketName(), { ns: "ncnet", userId: game.user.id, type, args });
  return null;
}

let queue = Promise.resolve();
export function enqueue(userId, type, args) {
  queue = queue
    .then(() => processRequest(userId, type, args))
    .catch((err) => {
      console.error("NET RUN |", type, err);
      ui.notifications?.error(`NET RUN (${type}): ${err?.message ?? err}`);
    });
  return queue;
}

export function registerSocket() {
  game.socket.on(socketName(), (msg) => {
    if (msg?.ns !== "ncnet" || !isActiveGM()) return;
    enqueue(msg.userId, msg.type, msg.args ?? {});
  });
}

async function save(S) {
  await game.settings.set(NC_SCOPE, STATE_KEY, S);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const uid = () => foundry.utils.randomID(10);

function log(S, cls, msg) {
  S.seq = (S.seq ?? 0) + 1;
  S.log.push({ i: S.seq, c: cls, m: msg, t: Date.now() });
  if (S.log.length > MAX_LOG) S.log.splice(0, S.log.length - MAX_LOG);
}

function pushRoll(S, roll) {
  roll.id = uid();
  roll.t = Date.now();
  if (S.curPrompt && roll.kind === "check" && !S.curPromptUsed) {
    roll.promptId = S.curPrompt;
    S.curPromptUsed = true;
  }
  S.rolls.push(roll);
  if (S.rolls.length > MAX_ROLLS) S.rolls.splice(0, S.rolls.length - MAX_ROLLS);
  return roll;
}

async function d10() {
  const face = (await new Roll("1d10").evaluate()).total;
  let extra = 0;
  if (face === 10) extra = (await new Roll("1d10").evaluate()).total;
  else if (face === 1) extra = -(await new Roll("1d10").evaluate()).total;
  return { face, extra, value: face + extra };
}

async function rollFormula(formula) {
  try {
    const r = await new Roll(String(formula || "0")).evaluate();
    return { total: r.total, dice: r.dice.flatMap((d) => d.results.map((x) => x.result)) };
  } catch (err) {
    return { total: 0, dice: [] };
  }
}

export function runnerActor(S) {
  return game.actors.get(S?.actorId) ?? null;
}

export function interfaceRank(actor) {
  const role = actor?.itemTypes?.role?.find((r) => String(r.system.mainRoleAbility).toLowerCase() === "interface");
  return Number(role?.system.rank ?? 0) || 0;
}

export function runnerInterface(S) {
  if (Number.isFinite(S?.interface)) return S.interface;
  return interfaceRank(runnerActor(S));
}

export function equippedDeck(actor) {
  if (!actor) return null;
  const decks = actor.itemTypes?.cyberdeck ?? actor.items.filter((i) => i.type === "cyberdeck");
  return decks.find((d) => d.system.equipped === "equipped") ?? decks[0] ?? null;
}

export function deckPrograms(actor) {
  const deck = equippedDeck(actor);
  if (!deck) return [];
  const ids = deck.system.installedItems?.list ?? [];
  return ids.map((id) => actor.items.get(id)).filter((i) => i?.type === "program");
}

function rezzedPrograms(actor) {
  return deckPrograms(actor).filter((p) => p.system.isRezzed);
}

function boosterBonus(actor, ability) {
  let bonus = 0;
  const names = [];
  for (const p of rezzedPrograms(actor)) {
    const b = BOOSTERS[p.name.toLowerCase()];
    if (b && b.ability === ability) {
      bonus += b.value;
      names.push(p.name);
    }
  }
  return { bonus, names };
}

export function findIce(S, iceUid) {
  for (let f = 0; f < S.arch.floors.length; f++) {
    const ice = S.arch.floors[f].ice?.find((i) => i.uid === iceUid);
    if (ice) return { ice, floor: f };
  }
  return { ice: null, floor: -1 };
}

export function engagedIce(S) {
  return (S.engaged ?? []).map((u) => findIce(S, u).ice).filter((i) => i && !i.derezzed);
}

function floorDv(S, floor) {
  return Number(floor?.dv) || Number(S.arch.dv) || 6;
}

function maxActions(S) {
  return netActionsForRank(runnerInterface(S));
}

/* ------------------------------------------------------------------ */
/* Actor side effects (GM client)                                      */
/* ------------------------------------------------------------------ */

async function brainDamage(S, amount, source, { meat = false } = {}) {
  const actor = runnerActor(S);
  let dmg = Math.max(0, Number(amount) || 0);
  const armor = meat ? null : rezzedPrograms(actor).find((p) => p.name.toLowerCase() === "armor");
  if (armor && dmg > 0) {
    dmg = Math.max(0, dmg - 4);
    log(S, "def", `armor.def :: brain damage reduced by 4 (${amount} -> ${dmg})`);
  }
  if (!actor) return dmg;
  const hp = actor.system.derivedStats?.hp;
  const next = Math.max(0, Number(hp?.value ?? 0) - dmg);
  await actor.update({ "system.derivedStats.hp.value": next });
  log(S, "dmg", `!! ${meat ? "DAMAGE" : "BRAIN DAMAGE"} ${dmg} from ${source} :: HP ${hp?.value} -> ${next}`);
  if (next <= 0) log(S, "bad", `!! FLATLINE WARNING :: ${actor.name} is down`);
  return dmg;
}

async function debuffEffect(S, label, keys, amount, icon) {
  const actor = runnerActor(S);
  if (!actor) return;
  try {
    const { default: CPRActiveEffect } = await import("../../cpr-active-effect.js");
    const changes = keys.map((key) => CPRActiveEffect.buildChange({ key, value: String(-amount), mode: 2 }));
    const data = { name: `${label} (NET, 1 hr)`, img: icon, duration: { seconds: 3600 }, origin: actor.uuid };
    if (game.release.generation >= 14) data.system = { changes };
    else data.changes = changes;
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    log(S, "dmg", `!! ${label} :: ${keys.map((k) => k.split(".")[2].toUpperCase()).join("/")} -${amount} for 1 hour (applied as an effect)`);
  } catch (err) {
    console.warn("NET RUN | effect", err);
    log(S, "dmg", `!! ${label} :: lower ${keys.map((k) => k.split(".")[2].toUpperCase()).join("/")} by ${amount} for 1 hour (GM: apply manually)`);
  }
}

async function destroyProgram(S, program, why) {
  const actor = runnerActor(S);
  const deck = equippedDeck(actor);
  try {
    if (deck?.system.installedItems?.list?.includes(program.id)) await deck.uninstallItems([program]);
  } catch (err) {
    console.warn("NET RUN | uninstall", err);
  }
  await program.delete();
  log(S, "bad", `!! PROGRAM DESTROYED :: ${program.name} (${why})`);
}

/* ------------------------------------------------------------------ */
/* Black ICE                                                           */
/* ------------------------------------------------------------------ */

async function applyIceEffect(S, ice, { noDamage = false } = {}) {
  const actor = runnerActor(S);
  const name = ice.name.toUpperCase();
  const dmgRoll = async (formula) => {
    const r = await rollFormula(formula);
    pushRoll(S, { kind: "damage", label: `${ice.name} :: damage`, formula, total: r.total, faces: r.dice, who: ice.name, ice: true });
    return r.total;
  };
  switch (ice.key) {
    case "hellhound":
      if (!noDamage) await brainDamage(S, await dmgRoll(ice.dmg || "2d6"), ice.name);
      if (!S.status.burning) log(S, "dmg", `!! ${name} :: your deck is ON FIRE (2 HP every turn until you spend a Meat Action)`);
      S.status.burning = true;
      break;
    case "kraken":
      if (!noDamage) await brainDamage(S, await dmgRoll(ice.dmg || "3d6"), ice.name);
      S.status.stuck = 1;
      log(S, "dmg", `!! ${name} :: locked — no going deeper or safe Jack Out until the end of your next turn`);
      break;
    case "giant":
      if (!noDamage) await brainDamage(S, await dmgRoll(ice.dmg || "3d6"), ice.name);
      log(S, "bad", `!! ${name} :: forced UNSAFE JACK OUT`);
      if (!noDamage) await unsafeJackOut(S, ice.uid);
      break;
    case "liche": {
      const n = (await rollFormula("1d6")).total;
      await debuffEffect(S, "Liche", ["system.stats.int.value", "system.stats.ref.value", "system.stats.dex.value"], n, "icons/svg/skull.svg");
      break;
    }
    case "scorpion": {
      const n = (await rollFormula("1d6")).total;
      await debuffEffect(S, "Scorpion", ["system.stats.move.value"], n, "icons/svg/net.svg");
      break;
    }
    case "raven": {
      const defenders = rezzedPrograms(actor).filter((p) => p.system.class === "defender");
      if (defenders.length) {
        const pick = defenders[Math.floor(Math.random() * defenders.length)];
        await pick.update({ "system.isRezzed": false });
        log(S, "dmg", `!! ${name} :: derezzed your defender ${pick.name}`);
      }
      if (!noDamage) await brainDamage(S, await dmgRoll(ice.dmg || "1d6"), ice.name);
      break;
    }
    case "wisp":
      if (!noDamage) await brainDamage(S, await dmgRoll(ice.dmg || "1d6"), ice.name);
      S.status.slowNext = 1;
      log(S, "dmg", `!! ${name} :: -1 NET Action next turn (min 2)`);
      break;
    case "skunk":
      log(S, "dmg", `!! ${name} :: Slide checks -2 while it stays rezzed`);
      break;
    case "asp": {
      const progs = deckPrograms(actor).filter((p) => p.system.class !== "blackice");
      if (!progs.length) {
        log(S, "ice", `${name} :: found nothing to eat`);
        break;
      }
      await destroyProgram(S, progs[Math.floor(Math.random() * progs.length)], ice.name);
      break;
    }
    case "dragon":
    case "killer":
    case "sabertooth": {
      const targets = rezzedPrograms(actor);
      if (!targets.length) {
        log(S, "ice", `${name} :: no rezzed program to hit`);
        break;
      }
      const target = targets[Math.floor(Math.random() * targets.length)];
      const dmg = await dmgRoll(ice.dmg || "4d6");
      const rez = Number(target.system.rez?.value ?? 0) - dmg;
      if (rez <= 0) await destroyProgram(S, target, `${ice.name} ${dmg} REZ`);
      else {
        await target.update({ "system.rez.value": rez });
        log(S, "dmg", `!! ${name} :: ${target.name} takes ${dmg} REZ (${rez} left)`);
      }
      break;
    }
    case "brainwipe":
      if (!noDamage) await brainDamage(S, await dmgRoll(ice.dmg || "1d6"), ice.name);
      S.status.cloak = null;
      log(S, "dmg", `!! ${name} :: your Cloak is wiped`);
      break;
    default:
      if (ice.dmg && !noDamage) await brainDamage(S, await dmgRoll(ice.dmg), ice.name);
      else log(S, "dmg", `!! ${name} :: ${ice.effect}`);
  }
}

/* ------------------------------------------------------------------ */
/* Click-to-roll prompts                                               */
/* ------------------------------------------------------------------ */

/** Open a roll prompt (or queue it behind the current one). Everyone sees it; the runner clicks to roll. */
function openPrompt(S, spec, { front = false } = {}) {
  const prompt = { ...spec, id: uid(), t: Date.now() };
  S.queue ??= [];
  if (S.prompt) {
    if (front) S.queue.unshift(prompt);
    else S.queue.push(prompt);
  } else S.prompt = prompt;
  return prompt;
}

/** Called after a prompt resolved: open the next one, or run what waits for the queue to empty. */
async function advancePrompts(S) {
  if (!S.active) {
    S.prompt = null;
    S.queue = [];
    S.afterQueue = null;
    return null;
  }
  if (S.prompt) return null;
  S.queue ??= [];
  if (S.queue.length) {
    S.prompt = { ...S.queue.shift(), t: Date.now() };
    return null;
  }
  const after = S.afterQueue;
  S.afterQueue = null;
  if (after === "finishIce") return finishIcePhase(S);
  if (after === "wait") S.phase = "wait";
  return null;
}

function iceSide(ice, stat) {
  return { who: ice.name, tone: "red", parts: [[stat.toUpperCase(), ice[stat]]] };
}
function runnerSide(S, parts) {
  return { who: runnerActor(S)?.name ?? "Netrunner", tone: "cyan", parts };
}

function queueIceAttack(S, ice, label = "ATTACK", opts = {}) {
  if (!S.active || ice.derezzed) return;
  openPrompt(
    S,
    {
      type: "iceAttack",
      args: { uid: ice.uid, label },
      title: `${ice.name.toUpperCase()} :: ${label}`,
      hint: "defend",
      a: runnerSide(S, [["Interface", runnerInterface(S)]]),
      b: iceSide(ice, "atk"),
    },
    opts
  );
}

async function iceAttack(S, ice, label = "ATTACK") {
  if (!S.active || ice.derezzed) return;
  const atk = await d10();
  const def = await d10();
  const iface = runnerInterface(S);
  const total = ice.atk + atk.value;
  const vsTotal = iface + def.value;
  const success = total > vsTotal;
  pushRoll(S, {
    kind: "check",
    ice: true,
    who: ice.name,
    label: `${ice.name} :: ${label}`,
    parts: [["ATK", ice.atk]],
    face: atk.face,
    extra: atk.extra,
    total,
    vs: { label: "Your defense", parts: [["Interface", iface]], face: def.face, extra: def.extra, total: vsTotal },
    success,
    good: !success,
  });
  log(S, "ice", `${ice.name.toLowerCase()}.ice >> ${label.toLowerCase()} :: ${total} vs ${vsTotal} :: ${success ? "HIT" : "BLOCKED"}`);
  if (success) await applyIceEffect(S, ice);
}

async function encounter(S, floorIdx) {
  const floor = S.arch.floors[floorIdx];
  const actor = runnerActor(S);
  const ref = Number(actor?.system.stats?.ref?.value ?? 0);
  const speedy = boosterBonus(actor, "speed").bonus;
  for (const ice of floor.ice ?? []) {
    if (ice.derezzed || S.engaged.includes(ice.uid)) continue;
    S.engaged.push(ice.uid);
    if (!S.met.includes(ice.uid)) S.met.push(ice.uid);
    log(S, "ice", `!! CONTACT :: ${ice.name.toUpperCase()} rezzes on floor ${floorIdx + 1}`);
    openPrompt(S, {
      type: "init",
      args: { uid: ice.uid },
      title: `${ice.name.toUpperCase()} :: INITIATIVE`,
      hint: "init",
      a: runnerSide(S, [["REF", ref], ...(speedy ? [["Speedy", speedy]] : [])]),
      b: iceSide(ice, "spd"),
    });
  }
}

async function rollInitiative(S, ice) {
  const actor = runnerActor(S);
  const ref = Number(actor?.system.stats?.ref?.value ?? 0);
  const speedy = boosterBonus(actor, "speed").bonus;
  {
    const a = await d10();
    const b = await d10();
    const iceInit = ice.spd + a.value;
    const runInit = ref + speedy + b.value;
    const iceFirst = iceInit > runInit;
    pushRoll(S, {
      kind: "check",
      ice: true,
      who: ice.name,
      label: `${ice.name} :: initiative`,
      parts: [["SPD", ice.spd]],
      face: a.face,
      extra: a.extra,
      total: iceInit,
      vs: { label: "Your speed", parts: [["REF", ref], ...(speedy ? [["Speedy", speedy]] : [])], face: b.face, extra: b.extra, total: runInit },
      success: iceFirst,
      good: !iceFirst,
    });
    if (iceFirst) {
      log(S, "ice", `${ice.name.toLowerCase()}.ice is faster (${iceInit} vs ${runInit}) :: AMBUSH`);
      if (S.opts.autoIce) queueIceAttack(S, ice, "AMBUSH", { front: true });
      else S.ambush = [...(S.ambush ?? []), ice.uid];
    } else log(S, "ok", `you are faster (${runInit} vs ${iceInit})`);
  }
}

async function unsafeJackOut(S, skipUid = null) {
  log(S, "bad", ">> UNSAFE JACK OUT :: every rezzed Black ICE you met bites on the way out");
  for (const iceUid of S.met) {
    if (iceUid === skipUid) continue;
    const { ice } = findIce(S, iceUid);
    if (ice && !ice.derezzed && ice.key !== "giant") await applyIceEffect(S, ice);
  }
  await endRun(S, "UNSAFE JACK OUT");
}

/* ------------------------------------------------------------------ */
/* Turn flow                                                           */
/* ------------------------------------------------------------------ */

async function startRunnerTurn(S) {
  S.turn = (S.turn ?? 0) + 1;
  S.phase = "runner";
  let max = maxActions(S);
  if (S.status.slowNext) {
    max = Math.max(2, max - 1);
    S.status.slowNext = 0;
    log(S, "dmg", "slowed :: -1 NET Action this turn");
  }
  S.actions = { max, left: max };
  log(S, "sys", `== TURN ${S.turn} :: ${max} NET ACTIONS ==`);
  if (S.status.burning) {
    log(S, "dmg", "!! deck still burning");
    await brainDamage(S, 2, "Fire", { meat: true });
  }
}

async function finishIcePhase(S) {
  S.ambush = [];
  if (!S.active) return;
  if (S.mode === "combat") {
    S.phase = "wait";
    const combat = game.combat;
    if (combat?.started && combat.combatant?.actorId === S.actorId) {
      // Saving first so the next turn hook sees the waiting phase.
      await save(S);
      await combat.nextTurn();
      return "saved";
    }
  } else await startRunnerTurn(S);
  return null;
}

async function startIcePhase(S) {
  const engaged = engagedIce(S);
  if (S.status.stuck > 0) S.status.stuck -= 1;
  if (!engaged.length) return finishIcePhase(S);
  S.phase = "ice";
  log(S, "ice", `== BLACK ICE PHASE :: ${engaged.length} hostile ==`);
  if (S.opts.autoIce) {
    for (const ice of engaged) queueIceAttack(S, ice);
    S.afterQueue = "finishIce";
    return null;
  }
  return null;
}

async function endRun(S, reason) {
  const actor = runnerActor(S);
  for (const p of rezzedPrograms(actor)) await p.update({ "system.isRezzed": false });
  S.active = false;
  S.phase = "out";
  S.prompt = null;
  S.queue = [];
  S.afterQueue = null;
  S.ended = { reason, t: Date.now() };
  log(S, "sys", `== CONNECTION CLOSED :: ${reason} ==`);
}

/* ------------------------------------------------------------------ */
/* Request processing                                                  */
/* ------------------------------------------------------------------ */

function spend(S) {
  S.actions.left = Math.max(0, S.actions.left - 1);
}

/** Returns true when the request must wait for the GM. */
function violates(ctx, text) {
  if (ctx.isGM || ctx.force) {
    if (!ctx.isGM) log(ctx.S, "gm", `GM override :: ${text}`);
    return false;
  }
  ctx.S.pending = { id: uid(), kind: "rule", text, type: ctx.type, args: ctx.args, userId: ctx.userId, t: Date.now() };
  log(ctx.S, "gm", `?? RULE CHECK :: ${text} — waiting for the GM`);
  return true;
}

function costCheck(ctx) {
  const { S } = ctx;
  if (S.phase !== "runner") return violates(ctx, S.mode === "combat" ? "It's not the Netrunner's turn" : "Black ICE is acting");
  if (S.actions.left <= 0) return violates(ctx, "No NET Actions left this turn");
  return false;
}

async function resolveCheck(ctx, roll, resolution) {
  const { S } = ctx;
  if (S.opts.gmConfirm && !ctx.isGM) roll.awaiting = true;
  pushRoll(S, roll);
  if (S.opts.gmConfirm && !ctx.isGM) {
    S.pending = { id: uid(), kind: "result", text: `${roll.label}: ${roll.total} vs ${roll.vs?.total ?? "—"} → ${roll.success ? "PASS" : "FAIL"}`, resolution, success: roll.success, rollId: roll.id, t: Date.now() };
    return;
  }
  await applyResolution(S, resolution, roll.success);
}

async function applyResolution(S, res, success) {
  const floor = S.arch.floors[res.floor];
  switch (res.kind) {
    case "clear":
      if (success) {
        floor.cleared = true;
        if (res.ability === "eyedee") floor.infoShown = true;
        const done = { backdoor: "PASSWORD CRACKED", control: "NODE UNDER YOUR CONTROL", eyedee: "FILE DECRYPTED" }[res.ability];
        log(S, "ok", `>> ${done} :: floor ${res.floor + 1}`);
      } else log(S, "bad", `>> ACCESS DENIED :: floor ${res.floor + 1}`);
      break;
    case "pathfinder": {
      let shown = 0;
      if (success || res.total) {
        for (let f = S.pos + 1; f < S.arch.floors.length; f++) {
          const fl = S.arch.floors[f];
          if (res.total > floorDv(S, fl) || (success && !fl.dv)) {
            if (!fl.revealed) shown += 1;
            fl.revealed = true;
          } else break;
        }
      }
      log(S, shown ? "ok" : "bad", shown ? `>> MAP UPDATED :: ${shown} floor(s) revealed` : ">> PATHFINDER found nothing new");
      break;
    }
    case "virus":
      if (success) {
        S.virus = res.text || "virus planted";
        log(S, "ok", `>> VIRUS UPLOADED :: ${S.virus}`);
      } else log(S, "bad", ">> VIRUS REJECTED");
      break;
    case "slide":
      if (success) {
        S.engaged = S.engaged.filter((u) => u !== res.uid);
        log(S, "ok", `>> SLID PAST ${res.name.toUpperCase()}`);
      } else log(S, "bad", `>> ${res.name.toUpperCase()} still on you`);
      break;
    case "damageIce": {
      const { ice } = findIce(S, res.uid);
      if (!ice) break;
      if (!success) {
        log(S, "bad", `>> ${res.source} missed ${ice.name}`);
        break;
      }
      const r = await rollFormula(res.formula);
      pushRoll(S, { kind: "damage", label: `${res.source} :: REZ damage`, formula: res.formula, total: r.total, faces: r.dice, who: "you" });
      ice.rez = Math.max(0, ice.rez - r.total);
      log(S, "ok", `>> ${res.source} hits ${ice.name} for ${r.total} REZ (${ice.rez}/${ice.rezMax})`);
      if (ice.rez <= 0) {
        ice.derezzed = true;
        S.engaged = S.engaged.filter((u) => u !== ice.uid);
        log(S, "ok", `>> ${ice.name.toUpperCase()} DEREZZED`);
      }
      break;
    }
    default:
  }
}

const HANDLERS = {
  async move(ctx, { dir }) {
    const { S } = ctx;
    const step = Number(dir) > 0 ? 1 : -1;
    const target = S.pos + step;
    if (target < 0 || target >= S.arch.floors.length) return;
    if (costCheck(ctx)) return;
    const here = S.arch.floors[S.pos];
    const hostile = engagedIce(S);
    if (step > 0 && S.status.stuck > 0 && violates(ctx, "Locked by Black ICE — can't go deeper this turn")) return;
    if (step > 0 && here.type === "password" && !here.cleared && violates(ctx, `Password on floor ${S.pos + 1} is not cracked (Backdoor first)`)) return;
    if (hostile.length && violates(ctx, `${hostile.map((i) => i.name).join(", ")} engaged — Slide or derez it first`)) return;
    spend(S);
    S.pos = target;
    const floor = S.arch.floors[target];
    floor.revealed = true;
    floor.visited = true;
    S.deepest = Math.max(S.deepest ?? 0, target);
    log(S, "sys", `> cd ${step > 0 ? "../floor_" : "floor_"}${String(target + 1).padStart(2, "0")} :: ${floor.type.toUpperCase()}${floor.name ? ` "${floor.name}"` : ""}`);
    if ((floor.ice ?? []).some((i) => !i.derezzed)) await encounter(S, target);
  },

  async ability(ctx, { key, iceUid, text }) {
    const { S } = ctx;
    const ab = ABILITIES[key];
    if (!ab) return;
    if (costCheck(ctx)) return;
    const floor = S.arch.floors[S.pos];
    if (ab.needs && floor.type !== ab.needs && violates(ctx, `${ab.name} needs a ${ab.needs} floor`)) return;
    if (ab.needs && floor.cleared && violates(ctx, `${ab.name} is already done on this floor`)) return;
    if (ab.needsBottom && S.pos !== S.arch.floors.length - 1 && violates(ctx, "Virus can only be planted on the lowest floor")) return;
    let target = null;
    if (ab.needsIce) {
      target = findIce(S, iceUid).ice ?? engagedIce(S)[0] ?? null;
      if (!target || target.derezzed) {
        log(S, "bad", `${ab.name} :: no target`);
        return;
      }
    }
    spend(S);
    log(S, "cmd", `> ${key}.exe${target ? ` --target ${target.name.toLowerCase()}` : ""}${ab.needs || ab.needsBottom ? ` --floor ${S.pos + 1}` : ""}`);
    const preview = abilityParts(S, key);
    let b = null;
    let dv = null;
    if (ab.dvFrom === "floor") dv = { value: floorDv(S, floor), hidden: S.opts.dvHidden };
    else if (ab.dvFrom === "arch") dv = { value: Number(S.arch.dv) || 6, hidden: S.opts.dvHidden };
    else if (ab.dvFrom === "opposed" && target) b = iceSide(target, key === "slide" ? "per" : "def");
    openPrompt(S, {
      type: "ability",
      args: { key, iceUid: target?.uid ?? null, text },
      title: ab.name.toUpperCase(),
      hint: "check",
      a: runnerSide(S, preview),
      b,
      dv,
    });
  },
};

function abilityParts(S, key) {
  const actor = runnerActor(S);
  const parts = [["Interface", runnerInterface(S)]];
  const boost = boosterBonus(actor, key);
  if (boost.bonus) parts.push([boost.names.join("+"), boost.bonus]);
  if (key === "slide") {
    const skunks = engagedIce(S).filter((i) => i.key === "skunk").length;
    if (skunks) parts.push([`Skunk x${skunks}`, -2 * skunks]);
  }
  return parts;
}

const ROLLERS = {
  async ability(ctx, { key, iceUid, text }) {
    const { S } = ctx;
    const ab = ABILITIES[key];
    const floor = S.arch.floors[S.pos];
    const target = iceUid ? findIce(S, iceUid).ice : null;
    if (ab.needsIce && (!target || target.derezzed)) {
      log(S, "bad", `${ab.name} :: target is gone`);
      return;
    }
    const actor = runnerActor(S);
    const iface = runnerInterface(S);
    const parts = [["Interface", iface]];
    const boost = boosterBonus(actor, key);
    if (boost.bonus) parts.push([boost.names.join("+"), boost.bonus]);
    if (key === "slide") {
      const skunks = engagedIce(S).filter((i) => i.key === "skunk").length;
      if (skunks) parts.push([`Skunk x${skunks}`, -2 * skunks]);
    }
    const die = await d10();
    const total = parts.reduce((s, p) => s + p[1], 0) + die.value;
    const base = { kind: "check", who: actor?.name ?? "Netrunner", label: ab.name.toUpperCase(), parts, face: die.face, extra: die.extra, total };

    switch (key) {
      case "backdoor":
      case "control":
      case "eyedee": {
        const dv = floorDv(S, floor);
        const success = total > dv;
        await resolveCheck(ctx, { ...base, vs: { label: "DV", total: dv, dv: true }, success, good: success, hidden: S.opts.dvHidden }, { kind: "clear", ability: key, floor: S.pos });
        break;
      }
      case "pathfinder": {
        const dv = Number(S.arch.dv) || 6;
        const success = total > dv;
        await resolveCheck(ctx, { ...base, vs: { label: "DV", total: dv, dv: true }, success, good: success, hidden: S.opts.dvHidden }, { kind: "pathfinder", total, floor: S.pos });
        break;
      }
      case "virus": {
        const dv = Number(S.arch.dv) || 6;
        const success = total > dv;
        await resolveCheck(ctx, { ...base, vs: { label: "DV", total: dv, dv: true }, success, good: success, hidden: S.opts.dvHidden }, { kind: "virus", text, floor: S.pos });
        break;
      }
      case "cloak":
        pushRoll(S, { ...base, success: true, good: true });
        S.status.cloak = total;
        log(S, "ok", `>> CLOAK ACTIVE :: trace DV ${total}`);
        break;
      case "scanner":
        pushRoll(S, { ...base, success: true, good: true });
        log(S, "ok", `>> SCAN RESULT ${total} :: GM, describe the Access Points in range`);
        break;
      case "slide": {
        const def = await d10();
        const vsTotal = target.per + def.value;
        const success = total > vsTotal;
        await resolveCheck(ctx, { ...base, vs: { label: `${target.name} PER`, parts: [["PER", target.per]], face: def.face, extra: def.extra, total: vsTotal }, success, good: success }, { kind: "slide", uid: target.uid, name: target.name });
        break;
      }
      case "zap": {
        const def = await d10();
        const vsTotal = target.def + def.value;
        const success = total > vsTotal;
        await resolveCheck(ctx, { ...base, vs: { label: `${target.name} DEF`, parts: [["DEF", target.def]], face: def.face, extra: def.extra, total: vsTotal }, success, good: success }, { kind: "damageIce", uid: target.uid, formula: "1d6", source: "Zap" });
        break;
      }
      default:
    }
  },

  async attack(ctx, { programId, iceUid }) {
    const { S } = ctx;
    const actor = runnerActor(S);
    const program = actor?.items.get(programId);
    const target = findIce(S, iceUid).ice;
    if (!program || !target || target.derezzed) {
      log(S, "bad", "attack :: target or program is gone");
      return;
    }
    const iface = runnerInterface(S);
    const atk = Number(program.system.atk ?? 0);
    const die = await d10();
    const def = await d10();
    const total = iface + atk + die.value;
    const vsTotal = target.def + def.value;
    const success = total > vsTotal;
    const formula = program.system.damage?.blackIce || program.system.damage?.standard || "1d6";
    await resolveCheck(
      ctx,
      {
        kind: "check",
        who: actor?.name,
        label: program.name.toUpperCase(),
        parts: [["Interface", iface], ["ATK", atk]],
        face: die.face,
        extra: die.extra,
        total,
        vs: { label: `${target.name} DEF`, parts: [["DEF", target.def]], face: def.face, extra: def.extra, total: vsTotal },
        success,
        good: success,
      },
      { kind: "damageIce", uid: target.uid, formula, source: program.name }
    );
  },

  async iceAttack(ctx, { uid: iceUid, label }) {
    const { ice } = findIce(ctx.S, iceUid);
    if (ice) await iceAttack(ctx.S, ice, label);
  },

  async init(ctx, { uid: iceUid }) {
    const { ice } = findIce(ctx.S, iceUid);
    if (ice) await rollInitiative(ctx.S, ice);
  },
};

Object.assign(HANDLERS, {
  async rez(ctx, { programId }) {
    const { S } = ctx;
    const actor = runnerActor(S);
    const program = deckPrograms(actor).find((p) => p.id === programId);
    if (!program) return;
    const cls = program.system.class;
    if (program.system.isRezzed) return;
    if (cls.includes("attacker")) {
      if (violates(ctx, `${program.name} is an Attacker — use it to attack, it doesn't stay rezzed`)) return;
    }
    if (costCheck(ctx)) return;
    if (cls === "defender") {
      if (rezzedPrograms(actor).some((p) => p.name === program.name) && violates(ctx, `Only 1 copy of ${program.name} may be rezzed`)) return;
      if ((S.usedOnce ?? []).includes(program.id) && violates(ctx, `${program.name} has 1 use per Netrun`)) return;
      S.usedOnce = [...(S.usedOnce ?? []), program.id];
    }
    spend(S);
    await program.update({ "system.isRezzed": true, "system.rez.value": Number(program.system.rez?.max ?? 0) });
    log(S, "ok", `> rez ${program.name.toLowerCase().replace(/\s+/g, "_")}.prg :: ONLINE`);
  },

  async derez(ctx, { programId }) {
    const { S } = ctx;
    const program = deckPrograms(runnerActor(S)).find((p) => p.id === programId);
    if (!program?.system.isRezzed) return;
    if (costCheck(ctx)) return;
    spend(S);
    await program.update({ "system.isRezzed": false });
    log(S, "sys", `> derez ${program.name.toLowerCase().replace(/\s+/g, "_")}.prg`);
  },

  async attack(ctx, { programId, iceUid }) {
    const { S } = ctx;
    const actor = runnerActor(S);
    const program = deckPrograms(actor).find((p) => p.id === programId);
    if (!program) return;
    const target = findIce(S, iceUid).ice ?? engagedIce(S)[0];
    if (!target || target.derezzed) {
      log(S, "bad", `${program.name} :: no target`);
      return;
    }
    if (program.system.class !== "antiprogramattacker" && violates(ctx, `${program.name} can't damage Black ICE (only Anti-Program attackers can)`)) return;
    if (costCheck(ctx)) return;
    spend(S);
    log(S, "cmd", `> run ${program.name.toLowerCase().replace(/\s+/g, "_")}.prg --target ${target.name.toLowerCase()}`);
    openPrompt(S, {
      type: "attack",
      args: { programId, iceUid: target.uid },
      title: `${program.name.toUpperCase()} >> ${target.name.toUpperCase()}`,
      hint: "check",
      a: runnerSide(S, [["Interface", runnerInterface(S)], ["ATK", Number(program.system.atk ?? 0)]]),
      b: iceSide(target, "def"),
    });
  },

  /** The runner (or GM) clicks the hologram die: roll the open prompt. */
  async roll(ctx, { promptId }) {
    const { S } = ctx;
    const p = S.prompt;
    if (!p || p.id !== promptId) return;
    S.prompt = null;
    S.curPrompt = p.id;
    S.curPromptUsed = false;
    try {
      await ROLLERS[p.type]?.(ctx, p.args ?? {});
    } finally {
      delete S.curPrompt;
      delete S.curPromptUsed;
    }
    return advancePrompts(S);
  },

  async extinguish(ctx) {
    ctx.S.status.burning = false;
    log(ctx.S, "ok", "> meat action :: fire put out");
  },

  async jackout(ctx) {
    const { S } = ctx;
    if (S.status.stuck > 0 && violates(ctx, "Locked by Black ICE — can't Jack Out safely")) return;
    if (costCheck(ctx)) return;
    spend(S);
    await endRun(S, "JACKED OUT");
  },

  async unsafe(ctx) {
    await unsafeJackOut(ctx.S);
  },

  async endturn(ctx) {
    const { S } = ctx;
    if (S.phase !== "runner" && !ctx.isGM) return;
    log(S, "sys", `> end_turn :: ${S.actions.left} action(s) unused`);
    return startIcePhase(S);
  },

  /* ---------------- GM only ---------------- */
  async "gm.launch"(ctx, { arch, actorId, controllers, opts }) {
    const actor = game.actors.get(actorId);
    const S = {
      v: 1,
      sid: uid(),
      active: true,
      actorId,
      controllers: controllers ?? [],
      arch,
      pos: 0,
      deepest: 0,
      mode: "free",
      phase: "runner",
      turn: 0,
      actions: { max: 2, left: 2 },
      interface: null,
      engaged: [],
      met: [],
      ambush: [],
      usedOnce: [],
      status: { burning: false, stuck: 0, slowNext: 0, cloak: null },
      opts: { dvHidden: true, gmConfirm: false, autoIce: false, ...(opts ?? {}) },
      pending: null,
      rolls: [],
      log: [],
      seq: 0,
      started: Date.now(),
    };
    for (const f of S.arch.floors) f.visited = false;
    S.arch.floors[0].revealed = true;
    S.arch.floors[0].visited = true;
    log(S, "sys", `== JACK IN :: ${actor?.name ?? "?"} >> ${arch.name} ==`);
    const combat = game.combat;
    if (combat?.started && combat.combatants.some((c) => c.actorId === actorId)) {
      S.mode = "combat";
      if (combat.combatant?.actorId === actorId) await startRunnerTurn(S);
      else {
        S.phase = "wait";
        S.actions = { max: maxActions(S), left: maxActions(S) };
        log(S, "sys", "combat :: waiting for the Netrunner's turn");
      }
    } else await startRunnerTurn(S);
    if ((S.arch.floors[0].ice ?? []).some((i) => !i.derezzed)) await encounter(S, 0);
    ctx.S = S;
  },
  async "gm.end"(ctx, { reason }) {
    await endRun(ctx.S, reason || "SESSION CLOSED BY GM");
  },
  async "gm.kick"(ctx, { unsafe }) {
    if (unsafe) await unsafeJackOut(ctx.S);
    else await endRun(ctx.S, "CONNECTION SEVERED BY GM");
  },
  async "gm.clear"(ctx) {
    ctx.S = { v: 1, active: false, cleared: true, sid: null };
  },
  async "gm.approve"(ctx) {
    const p = ctx.S.pending;
    ctx.S.pending = null;
    if (!p || p.kind !== "rule") return;
    log(ctx.S, "gm", `GM ALLOWED :: ${p.text}`);
    const sub = { ...ctx, type: p.type, args: p.args, force: true, userId: p.userId, isGM: false };
    await HANDLERS[p.type]?.(sub, p.args);
  },
  async "gm.deny"(ctx) {
    const p = ctx.S.pending;
    ctx.S.pending = null;
    if (!p) return;
    if (p.kind === "result") {
      const roll = ctx.S.rolls.find((r) => r.id === p.rollId);
      if (roll) {
        roll.awaiting = false;
        roll.success = false;
        roll.good = false;
        pushRoll(ctx.S, { kind: "verdict", label: roll.label, success: false, good: false, forced: p.success });
      }
      await applyResolution(ctx.S, p.resolution, false);
      return;
    }
    log(ctx.S, "gm", `GM DENIED :: ${p.text}`);
  },
  async "gm.result"(ctx, { success }) {
    const p = ctx.S.pending;
    if (!p || p.kind !== "result") return;
    ctx.S.pending = null;
    const final = success === undefined ? p.success : !!success;
    if (final !== p.success) log(ctx.S, "gm", `GM set the result to ${final ? "PASS" : "FAIL"}`);
    const roll = ctx.S.rolls.find((r) => r.id === p.rollId);
    if (roll) {
      roll.awaiting = false;
      if (final !== roll.success) {
        roll.success = final;
        roll.good = final;
        roll.forced = true;
      }
      pushRoll(ctx.S, { kind: "verdict", label: roll.label, success: final, good: final, forced: !!roll.forced });
    }
    await applyResolution(ctx.S, p.resolution, final);
  },
  async "gm.force"(ctx, { success }) {
    // Flip the last roll's outcome after the fact (only for rolls that changed a floor).
    const last = [...ctx.S.rolls].reverse().find((r) => r.kind === "check" && !r.ice);
    if (!last) return;
    last.success = !!success;
    last.good = !!success;
    last.forced = true;
    log(ctx.S, "gm", `GM set ${last.label} to ${success ? "PASS" : "FAIL"} (fix the floor by hand if needed)`);
  },
  async "gm.set"(ctx, { path, value }) {
    const allowed = /^(pos|interface|actions\.left|actions\.max|mode|phase|status\.(burning|stuck|slowNext|cloak)|opts\.(dvHidden|gmConfirm|autoIce|showAll)|controllers|arch\.(name|dv))$/;
    if (!allowed.test(path)) return;
    foundry.utils.setProperty(ctx.S, path, value);
    if (path === "pos") {
      const f = ctx.S.arch.floors[value];
      if (f) {
        f.revealed = true;
        f.visited = true;
      }
    }
    log(ctx.S, "gmx", `gm.set ${path} = ${JSON.stringify(value)}`);
  },
  async "gm.floor"(ctx, { index, data }) {
    const f = ctx.S.arch.floors[index];
    if (!f) return;
    for (const k of ["type", "name", "dv", "desc", "info", "revealed", "cleared", "infoShown"]) if (k in data) f[k] = data[k];
  },
  async "gm.arch"(ctx, { arch }) {
    ctx.S.arch = arch;
    ctx.S.pos = Math.min(ctx.S.pos, arch.floors.length - 1);
    log(ctx.S, "gmx", `architecture updated :: ${arch.name}`);
  },
  async "gm.revealAll"(ctx, { value }) {
    for (const f of ctx.S.arch.floors) f.revealed = value !== false;
    log(ctx.S, "gmx", value === false ? "map hidden" : "full map revealed");
  },
  async "gm.addIce"(ctx, { index, key }) {
    const f = ctx.S.arch.floors[index ?? ctx.S.pos];
    if (!f || !ICE[key]) return;
    const ice = makeIce(key);
    f.ice = [...(f.ice ?? []), ice];
    if (f.type === "empty") f.type = "ice";
    log(ctx.S, "gmx", `${ice.name} added to floor ${(index ?? ctx.S.pos) + 1}`);
    if ((index ?? ctx.S.pos) === ctx.S.pos) await encounter(ctx.S, ctx.S.pos);
  },
  async "gm.ice"(ctx, { iceUid, act, field, value }) {
    const { S } = ctx;
    const { ice } = findIce(S, iceUid);
    if (!ice) return;
    switch (act) {
      case "attack":
        queueIceAttack(S, ice, (S.ambush ?? []).includes(iceUid) ? "AMBUSH" : "ATTACK");
        S.ambush = (S.ambush ?? []).filter((u) => u !== iceUid);
        break;
      case "effect":
        log(S, "gmx", `${ice.name} effect applied directly`);
        await applyIceEffect(S, ice);
        break;
      case "derez":
        ice.derezzed = true;
        ice.rez = 0;
        S.engaged = S.engaged.filter((u) => u !== iceUid);
        log(S, "gm", `${ice.name} derezzed by GM`);
        break;
      case "restore":
        ice.derezzed = false;
        ice.rez = ice.rezMax;
        log(S, "gmx", `${ice.name} restored`);
        break;
      case "engage":
        if (!S.engaged.includes(iceUid)) S.engaged.push(iceUid);
        if (!S.met.includes(iceUid)) S.met.push(iceUid);
        break;
      case "disengage":
        S.engaged = S.engaged.filter((u) => u !== iceUid);
        break;
      case "edit":
        if (["per", "spd", "atk", "def", "rez", "rezMax"].includes(field)) ice[field] = Number(value) || 0;
        if (["name", "dmg", "effect"].includes(field)) ice[field] = String(value);
        break;
      case "remove": {
        for (const f of S.arch.floors) f.ice = (f.ice ?? []).filter((i) => i.uid !== iceUid);
        S.engaged = S.engaged.filter((u) => u !== iceUid);
        break;
      }
      default:
    }
  },
  async "gm.iceDone"(ctx) {
    if (ctx.S.phase !== "ice") return;
    if (ctx.S.prompt?.type === "iceAttack") ctx.S.prompt = null;
    ctx.S.queue = (ctx.S.queue ?? []).filter((q) => q.type !== "iceAttack");
    ctx.S.afterQueue = null;
    log(ctx.S, "ice", "== BLACK ICE PHASE OVER ==");
    return finishIcePhase(ctx.S);
  },
  async "gm.newTurn"(ctx) {
    await startRunnerTurn(ctx.S);
  },
  async "gm.brain"(ctx, { amount }) {
    await brainDamage(ctx.S, amount, "GM", { meat: true });
  },
  async "gm.say"(ctx, { text }) {
    log(ctx.S, "gm", text);
  },
  async "gm.skipPrompt"(ctx) {
    if (!ctx.S.prompt) return;
    log(ctx.S, "gmx", `prompt skipped :: ${ctx.S.prompt.title}`);
    ctx.S.prompt = null;
    return advancePrompts(ctx.S);
  },
});

async function processRequest(userId, type, args) {
  const user = game.users.get(userId);
  if (!user) return;
  const isGM = user.isGM;
  if (type === "shop.buy") {
    const { processPurchase } = await import("./deck.js");
    await processPurchase(userId, args);
    return;
  }
  if (type.startsWith("gm.") && !isGM) return;
  let S = getState();
  if (type !== "gm.launch" && type !== "gm.clear") {
    if (!S?.active && !type.startsWith("gm.")) return;
    if (!S) return;
    if (!isGM && !canControl(S, user)) return;
    S = foundry.utils.deepClone(S);
    // Only the GM may act while a request is waiting for approval.
    if (S.pending && !isGM) return;
    // While a roll prompt is open the runner can only roll it.
    if (S.prompt && !isGM && type !== "roll") return;
  }
  const ctx = { S, userId, user, isGM, type, args, force: false };
  const handler = HANDLERS[type];
  if (!handler) return;
  const result = await handler(ctx, args);
  if (result === "saved") return;
  await save(ctx.S);
}

/* ------------------------------------------------------------------ */
/* Combat integration (GM client)                                      */
/* ------------------------------------------------------------------ */

export function registerCombatHooks() {
  Hooks.on("updateCombat", (combat, changed) => {
    if (!isActiveGM() || !("turn" in changed || "round" in changed)) return;
    const S = getState();
    if (!S?.active || S.mode !== "combat" || combat !== game.combat) return;
    enqueue(game.user.id, "gm.combatTurn", {});
  });
  HANDLERS["gm.combatTurn"] = async (ctx) => {
    const { S } = ctx;
    const combatant = game.combat?.combatant;
    if (combatant?.actorId === S.actorId) {
      if (S.phase !== "runner") await startRunnerTurn(S);
    } else if (S.phase === "runner") {
      // Turn advanced from the tracker without END TURN: give the ICE its phase.
      log(S, "sys", "combat :: turn passed");
      const engaged = engagedIce(S);
      if (S.status.stuck > 0) S.status.stuck -= 1;
      if (engaged.length && S.opts.autoIce) {
        S.phase = "ice";
        for (const ice of engaged) queueIceAttack(S, ice);
        S.afterQueue = "wait";
      } else S.phase = engaged.length ? "ice" : "wait";
    }
  };
}
