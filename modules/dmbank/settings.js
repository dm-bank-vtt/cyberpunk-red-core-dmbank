import { NC_SCOPE } from "./util.js";

/**
 * Client/world settings for the DM Bank edition features.
 */
export default function registerNcSettings() {
  const client = (key, name, hint, config) =>
    game.settings.register(NC_SCOPE, `nc.${key}`, {
      name,
      hint,
      scope: "client",
      config: true,
      ...config,
    });
  const world = (key, name, hint, config) =>
    game.settings.register(NC_SCOPE, `nc.${key}`, {
      name,
      hint,
      scope: "world",
      config: true,
      ...config,
    });

  client("bootAnimation", "DM Bank: Sheet boot animation", "Play the holographic boot-up animation when a sheet opens.", {
    type: Boolean,
    default: true,
  });
  client("bootSound", "DM Bank: Sheet boot sound", "Optional sound file played when a sheet boots up (leave empty for none).", {
    type: String,
    default: "",
    filePicker: "audio",
  });
  client("sheetTilt", "DM Bank: 3D sheet tilt", "Sheets tilt slightly towards the mouse.", {
    type: Boolean,
    default: true,
    requiresReload: true,
  });
  client("wrapText", "DM Bank: Wrap long descriptions", "Long item descriptions break onto new lines instead of being cut off (sheets and item windows).", {
    type: Boolean,
    default: true,
    onChange: (value) => document.body.classList.toggle("nc-wrap", !!value),
  });
  client("cyberHud", "DM Bank: Cyberware body scan", "Show the Cyber tab as a holographic body with option slots (you can still switch to the list view).", {
    type: Boolean,
    default: true,
  });
  client("skillsFx", "DM Bank: Game-style Skills tab", "Quick Skills bar, Trained-only filter, click a row to roll, level bar.", {
    type: Boolean,
    default: true,
  });
  client("inventoryGrid", "DM Bank: Game-style inventory", "Show the Gear tab as an item grid with a detail panel (you can still switch to the list view).", {
    type: Boolean,
    default: true,
  });
  client("loadout", "DM Bank: Loadout panel", "Show the LOADOUT panel (weapons, armor, quick use) at the top of the Gear tab.", {
    type: Boolean,
    default: true,
  });
  world("autoEmp", "DM Bank: EMP follows Humanity", "Whenever Humanity changes, EMP is set to Humanity / 10 (rounded down).", {
    type: Boolean,
    default: true,
  });
  world("cyberpsycho", "DM Bank: Cyberpsychosis takeover", "When a character's EMP reaches 0 the GM takes control (players become Observers) and everyone sees an alert. Control returns when EMP rises above 0.", {
    type: Boolean,
    default: true,
  });
  world("simplePlayerSidebar", "DM Bank: Simplified player sidebar", "Off (default): players see the normal Foundry sidebar (Actors, Items, Journal…). On: players only see the Chat and Settings tabs.", {
    type: Boolean,
    default: false,
    requiresReload: true,
  });
  world("chatPanel", "DM Bank: Night City chat", "Use the cyberpunk chat panel (character card + transmission style messages).", {
    type: Boolean,
    default: true,
    requiresReload: true,
  });
  world("tokenHud", "DM Bank: Holographic turn marker & targets", "Replace the combat turn marker and target indicators with animated HUD graphics.", {
    type: Boolean,
    default: true,
    requiresReload: true,
  });
}
