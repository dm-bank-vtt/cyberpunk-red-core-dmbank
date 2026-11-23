/**
 * DM Bank: top-centre turn order HUD for the active combat (cyberpunk style).
 * Players only see what they are allowed to: hidden combatants are left out and HP bars only
 * show for actors the player can observe.
 */
import { ncSetting, NC_SCOPE } from "../util.js";
import { T } from "../net/i18n.js";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
let el = null;
let lastKey = "";
let timer = null;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(render, 40);
}

function hpOf(actor) {
  const hp = actor?.system?.derivedStats?.hp;
  if (!hp || !Number(hp.max)) return null;
  return { value: Number(hp.value) || 0, max: Number(hp.max) || 1 };
}

/** The running fight: prefer an active, started combat on the viewed scene. */
export function currentCombat() {
  const sceneId = canvas?.scene?.id;
  const list = game.combats?.contents ?? [];
  return (
    list.find((c) => c.active && c.started && (!c.scene || c.scene.id === sceneId)) ??
    list.find((c) => c.started && c.scene?.id === sceneId) ??
    game.combat
  );
}

function render() {
  const combat = currentCombat();
  const on = ncSetting("turnHud") !== false;
  if (!on || !combat?.started || !combat.turns?.length) {
    el?.remove();
    el = null;
    lastKey = "";
    return;
  }
  const gm = game.user.isGM;
  const turns = combat.turns.filter((c) => gm || !c.hidden);
  const current = combat.combatant;
  if (!el || !el.isConnected) {
    el = document.createElement("div");
    el.id = "dmb-turns";
    document.body.append(el);
    el.addEventListener("click", onClick);
  }
  const cards = turns
    .map((c, i) => {
      const actor = c.actor;
      const disp = c.token?.disposition ?? 0;
      const side = actor?.hasPlayerOwner ? "pc" : disp < 0 ? "hostile" : disp > 0 ? "ally" : "neutral";
      const canSee = gm || actor?.testUserPermission(game.user, "OBSERVER");
      const hp = canSee ? hpOf(actor) : null;
      const pct = hp ? Math.max(0, Math.min(100, Math.round((hp.value / hp.max) * 100))) : 0;
      const isCur = current?.id === c.id;
      const img = c.img && !/mystery-man/.test(c.img) ? c.img : actor?.img ?? "icons/svg/mystery-man.svg";
      return `<a class="tt-card tt-${side} ${isCur ? "cur" : ""} ${c.isDefeated ? "dead" : ""} ${c.hidden ? "hid" : ""}" data-id="${c.id}" data-tooltip="${esc(c.name)}${c.initiative != null ? ` · ${c.initiative}` : ""}">
          <span class="tt-idx">${String(i + 1).padStart(2, "0")}</span>
          <div class="tt-img"><img src="${esc(img)}" alt="">${c.isDefeated ? '<i class="fas fa-skull tt-skull"></i>' : ""}</div>
          ${hp ? `<div class="tt-hp ${pct <= 25 ? "low" : pct <= 50 ? "mid" : ""}"><i style="width:${pct}%"></i></div>` : '<div class="tt-hp none"></div>'}
          ${isCur ? `<b class="tt-name">${esc(c.name)}</b>` : ""}
          ${c.initiative != null ? `<em class="tt-init">${Math.round(c.initiative)}</em>` : ""}
        </a>`;
    })
    .join("");
  const key = `${combat.id}:${combat.round}:${combat.turn}`;
  const changed = key !== lastKey;
  lastKey = key;
  // End-turn: the GM always; a player only on their own combatant's turn.
  const canEnd = !!current && (gm || current.isOwner);
  el.innerHTML = `
    <div class="tt-head"><span class="tt-round">${esc(T("ROUND"))} <b>${String(combat.round).padStart(2, "0")}</b></span>${current ? `<span class="tt-now"><i class="fas fa-caret-right"></i> ${esc(current.hidden && !gm ? "???" : current.name)}</span>` : ""}</div>
    <div class="tt-body"><div class="tt-row">${cards}</div>${
      canEnd ? `<a class="tt-end" data-act="endTurn" data-tooltip="${esc(T("End turn"))}"><i class="fas fa-forward-step"></i><span>${esc(T("END TURN"))}</span></a>` : ""
    }</div>`;
  place();
  setTimeout(place, 350);
  if (changed) {
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
}

/** Keep the bar between the scene clock (top left) and the sidebar; scroll long orders to the current turn. */
function place() {
  if (!el) return;
  const clock = document.getElementById("dmb-clock")?.getBoundingClientRect();
  const ctrls = document.getElementById("scene-controls")?.getBoundingClientRect();
  const right = (document.getElementById("ui-right") ?? document.getElementById("sidebar"))?.getBoundingClientRect();
  const hi = right && right.width ? right.left - 12 : window.innerWidth - 12;
  let lo = clock && clock.width ? clock.right + 16 : (ctrls?.right ?? 60) + 16;
  let top = 6;
  if (hi - lo < 420 && clock && clock.width) {
    // not enough room beside the clock: drop the bar under it
    lo = clock.left;
    top = clock.bottom + 8;
  }
  const avail = Math.max(200, hi - lo);
  el.style.left = `${lo + avail / 2}px`;
  el.style.top = `${top}px`;
  el.style.maxWidth = `${avail}px`;
  const row = el.querySelector(".tt-row");
  if (!row) return;
  const over = row.scrollWidth > row.clientWidth + 2;
  row.classList.toggle("over", over);
  if (over) {
    const cur = row.querySelector(".tt-card.cur");
    if (cur) row.scrollLeft = Math.max(0, cur.offsetLeft - row.clientWidth / 2 + cur.offsetWidth / 2);
  }
}

async function endTurn(btn) {
  const combat = currentCombat();
  const cur = combat?.combatant;
  if (!combat || !cur || !(game.user.isGM || cur.isOwner)) return;
  btn.classList.add("busy");
  try {
    await combat.nextTurn(); // core lets the owner of the current combatant advance the turn
  } catch (err) {
    console.error("DM Bank | end turn", err);
    ui.notifications.warn(T("Could not end the turn."));
    btn.classList.remove("busy");
  }
}

function onClick(ev) {
  const endBtn = ev.target.closest("[data-act='endTurn']");
  if (endBtn) {
    ev.preventDefault();
    if (!endBtn.classList.contains("busy")) endTurn(endBtn);
    return;
  }
  const card = ev.target.closest(".tt-card");
  if (!card) return;
  const c = currentCombat()?.combatants.get(card.dataset.id);
  const token = c?.token?.object;
  if (!token) return;
  canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 400 });
  if (game.user.isGM || token.isOwner) token.control({ releaseOthers: true });
}

export function registerTurnHud() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, "nc.turnHud", {
      name: "DM Bank: Turn order bar (top of the screen)",
      hint: "Shows the combat turn order as a row of portraits at the top centre of the screen.",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => schedule(),
    });
  });
  Hooks.once("ready", () => {
    schedule();
    window.addEventListener("resize", place);
  });
  Hooks.on("dmbClockPlaced", () => place());
  Hooks.on("collapseSidebar", () => setTimeout(place, 350));
  for (const h of ["updateCombat", "createCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "combatStart", "canvasReady"]) Hooks.on(h, schedule);
  Hooks.on("updateActor", (actor) => {
    if (currentCombat()?.combatants.some((c) => c.actorId === actor.id)) schedule();
  });
  Hooks.on("updateToken", (doc, changes) => {
    if ("hidden" in changes || "disposition" in changes) schedule();
  });
}
