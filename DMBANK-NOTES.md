# Cyberpunk RED Core - DM Bank (personal edition)

Unofficial fork of Cyberpunk RED Core v0.92.4 by The Project Red Team (GPL v3), ported to Foundry V14. See CREDITS.md.

## Features
- **Night City theme** (Settings → System → Theme): red/black glass UI with cyan accents. Switched on automatically once per client.
- **Holographic sheets**: translucent panels, scanlines, corner brackets, boot-up animation, mouse tilt.
- **Player sidebar**: normal Foundry sidebar by default; optional setting limits players to Chat + Settings.
- **Chat**: character name/role card above the input; plain messages look like "INCOMING TRANSMISSION" calls; roll cards are translucent with cyan hologram dice.
- **Token HUD**: animated red HUD rings as the combat turn marker, a lock-on reticle on your own targets, small square pips (user colour) for other players' targets.
- **Turn order bar**: END TURN button (GM, or the player whose turn it is).
- **Combat HUD**: size setting (50–160%); attacks use the system's own modifiers (role abilities, effects, wound/armor penalties).
- Compendium windows: fixed white-on-white text.
- **Cyber tab = body scan**: holographic body with a panel per system (Neuralware, Ocular, Auditory, Internal, Fashionware, Arms, External, Legs, Borgware). Shows foundational cyberware + option slots (used/total); click an empty slot to install matching cyberware, hover a piece to eject it, click to open it. HUD / LIST switch keeps the original list.
- **Humanity automation**: EMP = Humanity / 10 (rounded down) whenever Humanity changes. EMP 0 → Cyberpsychosis: GM takes control (players become Observers), full-screen alert + chat card. EMP above 0 again → control returns.
- Foundational/slot rules use the system's own install logic (a foundation is required; slots can't overflow; Humanity Loss rolled on install).
- **Skills tab**: Quick Skills bar (pinned skills as roll buttons), TRAINED ONLY filter, click a row to roll, level bar (10 segments, click to set), big cyan roll value.
- **Gear tab = inventory**: category chips with counts, item tiles (quality colour, E/C badge, ammo/amount), detail panel with stats, full description and labelled actions (GRID / LIST switch).
- **Cyber body**: uses assets/dmbank/body-scan.webp, original line art made for DM Bank (drawn from coordinates by a script; no stock or AI image).
- **V14 save bug fixed**: skill levels, equip state, ammo, item amounts, cyberdeck rez and armor tracking were only changed on screen and never saved (SystemUtils.SystemChanges).
- Fixes: Fight tab layout, Gear action buttons always visible, weapon row text overlap, long descriptions wrap (setting).

## Settings (Configure Settings → Cyberpunk RED Core - DM Bank)
- DM Bank: Sheet boot animation / boot sound / 3D sheet tilt / wrap long descriptions / cyberware body scan (per client)
- DM Bank: EMP follows Humanity / Cyberpsychosis takeover (world)
- DM Bank: Simplified player sidebar / Night City chat / Holographic turn marker & targets (world)

## Files
- styles/dmbank-theme.css, styles/dmbank-sheet.css, styles/dmbank-chat.css, styles/dmbank-cyber.css, styles/dmbank-gear.css
- modules/dmbank/ (index, settings, sheet-fx, chat, token-hud, cyber-hud, humanity, skills-fx, inventory, util)
