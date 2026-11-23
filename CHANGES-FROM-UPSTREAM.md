# Changes from upstream

DM Bank Night City Edition is a modified version of **Cyberpunk RED Core v0.92.4** by The Project Red Team
(https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core, released 2026-04-03), as the GNU GPL v3 §5(a) asks.
Modified by DM Bank; this summary was written on 2026-11-23, and the first release is YYYY-MM-DD.
Later changes are listed per version in `CHANGELOG.md`.

The copy of this file inside each release zip ends with a generated list of every file added (A),
modified (M), deleted (D) or renamed (R) compared with the upstream v0.92.4 release (`git diff --name-status`).

## Foundry V13–V14 port (2026)

Upstream v0.92.4 supports Foundry V12 only. The port makes it run on V13 and V14:

- `system.json`: compatibility 13–14 (verified 14); `template.json` replaced by `documentTypes`.
- **Active Effects**: V14 stores changes in `effect.system.changes` with a string `type` instead of a numeric
  `mode`. `CPRActiveEffect` reads both formats; suppression of effects on unequipped or uninstalled items goes
  through the `isSuppressed` getter.
- The Active Effect sheet is rewritten as an ApplicationV2 sheet, because the core `ActiveEffectConfig` is AppV2 now.
- **Chat**: `renderChatMessage` → `renderChatMessageHTML`; message `user` → `author`; the roll mode is read from
  `core.messageMode` (V14) with `ChatMessage.applyMode`.
- Token HUD DV button, Items sidebar install tree and pause animation updated for the V13+ AppV2 UI
  (`HTMLElement` instead of jQuery, `data-entry-id`, `renderGamePause`).
- **Ruler DV label** re-implemented on `Ruler` / `TokenRuler#_getWaypointLabelContext` (the DV text is appended
  next to the distance units).
- **Roll tables**: `TableResult#text` → `name` / `description` (critical injuries, DV tables, NET architecture).
- Image "show players" context menu: V14 `ContextMenu` entries (`label` / `onClick`) and the AppV2 `ImagePopout`.
- Deprecated globals replaced by their namespaced APIs (`renderTemplate`, `TextEditor`, `ActorSheet`, `ItemSheet`,
  `FormApplication`, `Dialog`, `Actors`/`Items`, `DocumentSheetConfig`, `Hotbar`).
- **V14 save bug**: skill levels, equip state, ammo, item amounts, cyberdeck rez and armor tracking changed on
  screen but were never saved (`SystemUtils.SystemChanges`). Fixed.

Known limitations: actor and item sheets are still ApplicationV1 (supported until Foundry V16), and some `-=`
deletion updates still print V14 deprecation warnings in the console (harmless).

## Package identity

- The system id is `cyberpunk-red-core-dmbank` instead of `cyberpunk-red-core`, so it installs beside the official
  system. Every `systems/cyberpunk-red-core/…` path, every `Compendium.cyberpunk-red-core.…` link, the pack
  `system` fields and the translation files in `babele/` were rewritten to the new id.
- Title "DM Bank Night City Edition: for use with Cyberpunk RED"; `url`, `manifest`, `download`, `bugs`,
  `changelog` and `readme` point at https://github.com/dm-bank-vtt/cyberpunk-red-core-dmbank.
- Compendium packs are kept as JSON in `src/packs/` and built with `@foundryvtt/foundryvtt-cli`
  (`package.json`, `scripts/packs.mjs`). `main.css` is edited directly.

## DM Bank features

All of them live in `modules/dmbank/` and `styles/dmbank-*.css`, hooked in from `cpr.js`:

- **Night City theme**: red/black glass UI with cyan accents (Settings → System → Theme).
- **Holographic sheets**: translucent panels, scanlines, corner brackets, boot-up animation and sound, mouse tilt.
- **Cyberware body scan** on the Cyber tab: a holographic body (`assets/dmbank/body-scan.webp`, own art) with a
  panel per system, foundational cyberware and option slots; click an empty slot to install, hover to eject.
  The HUD / LIST switch keeps the original list. The system's own install rules and Humanity Loss rolls apply.
- **Humanity automation**: EMP = Humanity / 10 (rounded down); at EMP 0 an optional Cyberpsychosis takeover
  gives the GM control, with a full-screen alert and a chat card.
- **Skills tab**: Quick Skills bar, TRAINED ONLY filter, click-to-roll rows, a 10-segment level bar.
- **Gear tab**: inventory grid with category chips, quality colours, badges and a detail panel (GRID / LIST switch),
  and a loadout panel.
- **Chat**: a character card above the input, INCOMING TRANSMISSION message cards, translucent roll cards with
  hologram dice, and roll requests.
- **Token HUD and combat**: animated turn rings, target reticles and pips, a turn order bar with END TURN,
  and a combat HUD (50–160%) that uses the system's own modifiers.
- **Agent**: the players list as a phone-style Agent with a button to open owned sheets.
- **Netrunning**: NET Architect, a NET overlay and a Virtuality AR view.
- An optional simplified player sidebar, and layout fixes (Fight tab, Gear buttons, weapon rows, long descriptions).

## Fixes to upstream behaviour

- On a brand-new world's first `ready`, `dataModelVersion` is set to the latest data model (38). Upstream leaves
  it at `"newCprWorld"`, so a later migration script would skip those worlds (`cpr.js`).

## Removed or replaced

- The Q-Workshop branded Dice So Nice dice systems ("Branded Logos", "Numbers") and their 166 textures in
  `icons/dice/dice-so-nice/`. Dice So Nice support and the colorsets "Blood over Chrome" and "Wet Work" stay
  (`modules/hooks/external/dice-so-nice-preset.js`, `lang/*.json`).
- `images/Repo-Header.webp` (unused).
- `images/Foundry-Background.webp` replaced by DM Bank's own Night City setup background, with no logotype.
- Added: `LICENSE`, `README.md`, `CHANGELOG.md`, `CREDITS.md`, `CREDITS-UPSTREAM.md`, this file and `fonts/OFL.txt`.
