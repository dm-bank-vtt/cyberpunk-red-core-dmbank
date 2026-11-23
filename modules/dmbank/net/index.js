/**
 * DM Bank NET RUN: registration (settings, socket, hooks, launch buttons).
 */
import { NC_SCOPE, isNightCity } from "../util.js";
import { STATE_KEY, getState, registerCombatHooks, registerSocket } from "./engine.js";
import { refreshOverlay, registerKeys } from "./overlay.js";
import { SHOP_KEY, openNetDeck, refreshDecks } from "./deck.js";
import { openArchitect } from "./architect.js";

let pending = null;
function scheduleRefresh() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    try {
      refreshOverlay();
    } catch (err) {
      console.error("NET RUN | overlay", err);
    }
  }, 16);
}

export default function registerNet() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, STATE_KEY, { scope: "world", config: false, type: Object, default: {}, onChange: () => scheduleRefresh() });
    game.settings.register(NC_SCOPE, "nc.netPresets", { scope: "world", config: false, type: Array, default: [] });
    game.settings.register(NC_SCOPE, SHOP_KEY, { scope: "world", config: false, type: Object, default: { open: false, discount: 0, hidden: [] }, onChange: () => refreshDecks() });
    game.settings.register(NC_SCOPE, "nc.netLang", {
      name: "DM Bank: NET RUN language / ภาษาหน้าจอ Netrun",
      hint: "Language of the Netrun screen on this computer. Game terms (Backdoor, Black ICE, DV...) stay in English.",
      scope: "client",
      config: true,
      type: String,
      choices: { en: "English", th: "ภาษาไทย" },
      default: "en",
      onChange: () => scheduleRefresh(),
    });
    game.settings.register(NC_SCOPE, "nc.netRain", {
      name: "DM Bank: NET RUN code rain",
      hint: "Falling code in the background of the Netrun screen (turn off on slow machines).",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
    });
  });

  Hooks.once("ready", () => {
    registerSocket();
    registerCombatHooks();
    registerKeys();
    scheduleRefresh();
    game.cprNet = { openArchitect, openNetDeck, state: getState };
  });

  // Live data the overlay shows (HP, programs) comes from the runner's actor.
  const touch = (doc) => {
    const actor = doc?.documentName === "Actor" ? doc : doc?.parent;
    const S = getState();
    if (S?.active && actor?.id === S.actorId) scheduleRefresh();
    if (actor) refreshDecks(actor);
  };
  Hooks.on("updateActor", touch);
  Hooks.on("updateItem", touch);
  Hooks.on("createItem", touch);
  Hooks.on("deleteItem", touch);

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.ncNetRun = {
      name: "ncNetRun",
      title: "NET RUN — Architect / Jack In",
      icon: "fas fa-network-wired",
      order: 90,
      button: true,
      visible: true,
      onChange: () => openArchitect(),
    };
  });

  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!isNightCity() || sheet.actor?.type !== "character" || !sheet.actor.isOwner) return;
    buttons.unshift({ label: "NET DECK", class: "nc-netdeck-btn", icon: "fas fa-layer-group", onclick: () => openNetDeck(sheet.actor) });
  });
}
