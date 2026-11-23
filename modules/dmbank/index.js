/**
 * Cyberpunk RED Core - DM Bank edition: entry point for the custom UI features.
 */
import registerNcSettings from "./settings.js";
import registerSheetFx from "./sheet-fx.js";
import registerChat from "./chat.js";
import registerTokenHud from "./token-hud.js";
import registerCyberHud from "./cyber-hud.js";
import registerHumanity from "./humanity.js";
import registerSkillsFx from "./skills-fx.js";
import registerInventory from "./inventory.js";
import registerLoadout from "./loadout.js";
import registerNet from "./net/index.js";
import { registerEncounter } from "./combat/encounter.js";
import { registerTurnHud } from "./combat/tracker.js";
import { registerDuel } from "./combat/duel.js";
import { registerCombatHud } from "./combat/hud.js";
import { registerVirtuality } from "./ar/ar.js";
import { registerSceneClock } from "./hud/scene-clock.js";
import { registerRollRequest } from "./request/request.js";
import { registerAgent } from "./hud/agent.js";
import { NC_SCOPE } from "./util.js";

export default function registerDmBank() {
  Hooks.once("init", () => {
    registerNcSettings();
    // Hidden flag so the Night City theme is switched on once for every client.
    game.settings.register(NC_SCOPE, "nc.themeApplied", {
      scope: "client",
      config: false,
      type: Boolean,
      default: false,
    });
  });
  Hooks.once("ready", async () => {
    document.body.classList.toggle("nc-wrap", !!game.settings.get(NC_SCOPE, "nc.wrapText"));
    if (!game.settings.get(NC_SCOPE, "nc.themeApplied")) {
      await game.settings.set(NC_SCOPE, "nc.themeApplied", true);
      if (game.settings.get(NC_SCOPE, "theme") !== "nightcity") {
        await game.settings.set(NC_SCOPE, "theme", "nightcity");
      }
    }
  });
  registerSheetFx();
  registerChat();
  registerTokenHud();
  registerCyberHud();
  registerHumanity();
  registerSkillsFx();
  registerInventory();
  registerLoadout();
  registerNet();
  registerEncounter();
  registerTurnHud();
  registerDuel();
  registerCombatHud();
  registerVirtuality();
  registerSceneClock();
  registerRollRequest();
  registerAgent();
  // Extra stylesheet loaded at runtime (no world relaunch needed for new CSS files).
  Hooks.once("init", () => {
    const href = `systems/${game.system.id}/styles/dmbank-combat.css`;
    if (![...document.styleSheets].some((s) => s.href?.includes("dmbank-combat.css"))) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${href}?v=${game.system.version}`;
      document.head.append(link);
    }
  });
}
