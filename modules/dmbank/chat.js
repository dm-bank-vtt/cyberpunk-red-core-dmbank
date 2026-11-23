/**
 * DM Bank edition: Night City chat + simplified player sidebar.
 *  - players only see the Chat and Settings tabs
 *  - an identity card (character name + role) sits above the chat input
 *  - plain messages are drawn as "INCOMING TRANSMISSION" calls, roll cards as holograms
 */
import { isNightCity, ncSetting } from "./util.js";

/* ------------------------------------------------------------------ */
/*  Identity card                                                       */
/* ------------------------------------------------------------------ */

/** Work out who the user is currently speaking as. */
function getSpeakerIdentity() {
  const token = canvas?.ready ? canvas.tokens?.controlled?.[0] : null;
  const actor = token?.actor ?? game.user.character ?? null;
  let role = "";
  if (actor) {
    role = actor.system?.roleInfo?.activeRole || actor.itemTypes?.role?.[0]?.name || "";
    if (!role) {
      role = { character: "Edgerunner", mook: "NPC", blackIce: "Black ICE", demon: "Demon", container: "Container" }[actor.type] ?? "";
    }
  } else {
    role = game.user.isGM ? "Gamemaster" : "Unlinked";
  }
  return {
    name: token?.name ?? actor?.name ?? game.user.name,
    role,
    img: actor?.img ?? game.user.avatar,
    user: game.user.name,
    color: game.user.color?.css ?? "#3ef2ff",
  };
}

function buildIdentityCard() {
  const card = document.createElement("div");
  card.id = "nc-identity";
  card.innerHTML = `
    <div class="nc-id-rail"></div>
    <div class="nc-id-body">
      <div class="nc-id-name"><span class="nc-id-name-text"></span></div>
      <div class="nc-id-role"></div>
      <div class="nc-id-meta"><span class="nc-id-dot"></span><span class="nc-id-user"></span><span class="nc-id-link">LINK ESTABLISHED</span></div>
    </div>`;
  return card;
}

function refreshIdentity() {
  const card = document.getElementById("nc-identity");
  if (!card) return;
  const id = getSpeakerIdentity();
  card.querySelector(".nc-id-name-text").textContent = id.name;
  card.querySelector(".nc-id-role").textContent = id.role;
  card.querySelector(".nc-id-user").textContent = id.user;
  card.style.setProperty("--nc-user-color", id.color);
}

/** Place the identity card right above the chat input, wherever core put the input. */
function placeIdentity() {
  const input = document.getElementById("chat-message");
  if (!input) return;
  let card = document.getElementById("nc-identity");
  if (!card) card = buildIdentityCard();
  const parent = input.parentElement;
  // Only show the card when the input lives in the expanded chat log (or its popout).
  const embedded = parent?.classList.contains("chat-form");
  card.hidden = !embedded;
  if (card.parentElement !== parent || card.nextElementSibling !== input) {
    parent.insertBefore(card, input);
  }
  refreshIdentity();
}

/* ------------------------------------------------------------------ */
/*  Messages                                                            */
/* ------------------------------------------------------------------ */

function isRollCard(message, element) {
  return (
    !!element.querySelector(".rollcard, .dice-roll, .cpr-block, .item-card, .damage-application") ||
    message.rolls?.length > 0 ||
    message.isRoll
  );
}

function decorateMessage(message, element) {
  if (!element || element.dataset.ncDecorated) return;
  element.dataset.ncDecorated = "1";
  if (isRollCard(message, element)) {
    element.classList.add("nc-holo");
    // Hologram dice: tag the dice images so CSS can recolor and animate them.
    element.querySelectorAll("img.d10, img.d6, .d10-dice-div img, .d6-dice-div img").forEach((img) => {
      img.classList.add("nc-holo-die");
    });
    return;
  }
  element.classList.add("nc-transmission");
  const isOwn = message.author?.id === game.user.id;
  const whisper = message.whisper?.length > 0;
  let label = "Incoming Transmission";
  if (whisper) label = "Encrypted // Private Channel";
  else if (isOwn) label = "Outgoing Transmission";
  const header = element.querySelector(".message-header");
  if (header && !element.querySelector(".nc-tx-label")) {
    const tag = document.createElement("div");
    tag.className = "nc-tx-label";
    tag.innerHTML = `<span>${label}</span><span class="nc-tx-sig"><i></i><i></i><i></i><i></i></span>`;
    header.before(tag);
  }
  const sender = element.querySelector(".message-sender");
  if (sender && !sender.querySelector(".nc-tx-icon")) {
    const icon = document.createElement("i");
    icon.className = `nc-tx-icon fa-solid ${whisper ? "fa-lock" : "fa-phone-volume"}`;
    sender.prepend(icon);
  }
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                             */
/* ------------------------------------------------------------------ */

function applyBodyClasses() {
  document.body.classList.toggle("nc-player", !game.user.isGM);
  document.body.classList.toggle("nc-hide-sidebar", !game.user.isGM && !!ncSetting("simplePlayerSidebar"));
  document.body.classList.toggle("nc-chat", !!ncSetting("chatPanel"));
  // The chat logs are rendered with the light theme by core; force dark glass.
  document.querySelectorAll(".chat-log.theme-light").forEach((el) => {
    el.classList.replace("theme-light", "theme-dark");
  });
}

/** Players with the simplified sidebar should never land on a hidden tab. */
function enforcePlayerTab() {
  if (!document.body.classList.contains("nc-hide-sidebar")) return;
  const active = ui.sidebar?.tabGroups?.primary;
  if (active && !["chat", "settings"].includes(active)) ui.sidebar.changeTab("chat", "primary");
}

/** Apply everything once the UI exists (also usable after a hot reload). */
export function initChat() {
  if (!isNightCity() && !ncSetting("chatPanel")) return;
  applyBodyClasses();
  enforcePlayerTab();
  placeIdentity();
}

export default function registerChat() {
  Hooks.once("ready", initChat);
  Hooks.on("changeSidebarTab", () => {
    enforcePlayerTab();
    placeIdentity();
  });
  Hooks.on("collapseSidebar", () => setTimeout(placeIdentity, 50));
  Hooks.on("renderChatInput", () => {
    applyBodyClasses();
    setTimeout(placeIdentity, 0);
  });
  Hooks.on("renderChatLog", () => {
    applyBodyClasses();
    setTimeout(placeIdentity, 0);
  });
  Hooks.on("controlToken", () => refreshIdentity());
  Hooks.on("updateUser", (user) => {
    if (user.id === game.user.id) refreshIdentity();
  });
  Hooks.on("renderChatMessageHTML", (message, element) => {
    if (!ncSetting("chatPanel")) return;
    try {
      decorateMessage(message, element);
    } catch (err) {
      console.error("CPR DM Bank | chat", err);
    }
  });
}
