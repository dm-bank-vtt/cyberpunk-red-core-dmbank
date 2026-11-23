/**
 * DM Bank edition: Humanity automation.
 *  - EMP always follows Humanity: every 10 points of Humanity lost costs 1 EMP (EMP = floor(Humanity / 10)).
 *  - When a character's EMP drops to 0 or lower they become a Cyberpsycho: the GM takes control
 *    (players are reduced to Observer), everyone gets a full-screen alert and a chat card.
 *  - If Humanity is restored (therapy, removing chrome) control is handed back automatically.
 */
import { NC_SCOPE, ncSetting } from "./util.js";

const FLAG = "ncCyberpsycho";
const PSYCHO_TYPES = ["character"];

function empFromHumanity(value) {
  return Math.max(0, Math.floor((Number(value) || 0) / 10));
}

function onPreUpdateActor(actor, changes) {
  if (!ncSetting("autoEmp")) return;
  if (!["character", "mook"].includes(actor.type)) return;
  const newHumanity = foundry.utils.getProperty(changes, "system.derivedStats.humanity.value");
  if (newHumanity === undefined || newHumanity === null) return;
  foundry.utils.setProperty(changes, "system.stats.emp.value", empFromHumanity(newHumanity));
}

function isPrimaryGM() {
  const gm = game.users.activeGM;
  return gm ? gm.isSelf : game.user.isGM;
}

async function seize(actor) {
  const previous = foundry.utils.deepClone(actor.ownership);
  const ownership = {};
  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  for (const [userId, level] of Object.entries(actor.ownership)) {
    if (userId === "default") continue;
    const user = game.users.get(userId);
    if (user && !user.isGM && level >= OWNER) ownership[userId] = OBSERVER;
  }
  await actor.update({
    ownership,
    [`flags.${NC_SCOPE}.${FLAG}`]: { since: Date.now(), ownership: previous },
  });
  await ChatMessage.create({
    speaker: { alias: "NIGHT CITY // MAXTAC" },
    content: `<div class="nc-psycho-card"><div class="nc-psycho-card-title">CYBERPSYCHOSIS</div>
      <p><b>${foundry.utils.escapeHTML(actor.name)}</b> has lost their humanity. EMP 0 — the Gamemaster now controls this character.</p></div>`,
    flags: { [NC_SCOPE]: { ncPsychoAlert: { name: actor.name, state: "lost", at: Date.now() } } },
  });
}

async function release(actor) {
  const data = actor.getFlag(NC_SCOPE, FLAG);
  const ownership = data?.ownership ?? {};
  const restore = {};
  for (const [userId, level] of Object.entries(ownership)) {
    if (userId === "default") continue;
    if (game.users.get(userId) && !game.users.get(userId).isGM) restore[userId] = level;
  }
  await actor.update({ ownership: restore });
  await actor.unsetFlag(NC_SCOPE, FLAG);
  await ChatMessage.create({
    speaker: { alias: "NIGHT CITY // TRAUMA TEAM" },
    content: `<p><b>${foundry.utils.escapeHTML(actor.name)}</b> is stable again (EMP above 0). Control returned to the player.</p>`,
  });
}

async function onUpdateActor(actor, changes) {
  if (!ncSetting("cyberpsycho")) return;
  if (!PSYCHO_TYPES.includes(actor.type) || !isPrimaryGM()) return;
  const touched =
    foundry.utils.hasProperty(changes, "system.stats.emp") ||
    foundry.utils.hasProperty(changes, "system.derivedStats.humanity");
  if (!touched) return;
  const emp = Number(actor.system.stats?.emp?.value ?? 1);
  const flagged = !!actor.getFlag(NC_SCOPE, FLAG);
  if (emp <= 0 && !flagged) await seize(actor);
  else if (emp > 0 && flagged) await release(actor);
}

function showAlert(name) {
  document.getElementById("nc-psycho-alert")?.remove();
  const el = document.createElement("div");
  el.id = "nc-psycho-alert";
  el.innerHTML = `<div class="nc-psycho-box"><div class="nc-psycho-title">CYBERPSYCHOSIS</div><div class="nc-psycho-name">${foundry.utils.escapeHTML(name)}</div></div>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 4300);
}

export default function registerHumanity() {
  Hooks.on("preUpdateActor", onPreUpdateActor);
  Hooks.on("updateActor", (actor, changes) => {
    onUpdateActor(actor, changes).catch((err) => console.error("CPR DM Bank | humanity", err));
  });
  Hooks.on("createChatMessage", (message) => {
    const alert = message.getFlag(NC_SCOPE, "ncPsychoAlert");
    if (alert && Date.now() - (alert.at ?? 0) < 15000) showAlert(alert.name);
  });
}
