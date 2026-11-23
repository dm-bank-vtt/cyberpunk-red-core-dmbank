# Changelog

All notable changes to DM Bank Night City Edition are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).
The in-game changelog compendium is upstream's and is not updated for this fork.

## 1.0.0 - YYYY-MM-DD

### Based on

- [Cyberpunk RED Core v0.92.4](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/releases/v0.92.4) by The Project Red Team (GPL v3).

### Added

- Night City theme: red/black glass UI with cyan accents.
- Holographic character sheets with a boot-up animation and an optional 3D tilt.
- Cyberware body scan on the Cyber tab: install cyberware into slots on a holographic body.
- Skills with Quick Skills, a TRAINED ONLY filter and click-to-roll rows.
- Gear grid for weapons, armor and cyberdecks, with a detail panel and a loadout panel.
- INCOMING TRANSMISSION chat cards, hologram dice on roll cards, and roll requests.
- Token HUD turn rings and target reticles, a turn order bar with END TURN, and a combat HUD.
- Humanity automation: EMP follows Humanity, with an optional Cyberpsychosis takeover.
- Agent: the players list as a phone-style Agent.
- Netrunning: NET Architect, a NET overlay and a Virtuality AR view.
- Compendium sources as JSON in `src/packs/`, built with `npm run pack`.

### Fixed

- Foundry V14 save bug: skill levels, equip state, ammo, item amounts, cyberdeck rez and armor tracking changed on screen but were never saved.
- New worlds now record `dataModelVersion` 38 on their first start. Upstream leaves it at `"newCprWorld"`, so a later data migration would skip them.

### Changed

- Runs on Foundry V13–V14 (upstream v0.92.4 stops at V12).
- New name "DM Bank Night City Edition: for use with Cyberpunk RED" and the system id `cyberpunk-red-core-dmbank`, so it installs beside the official system.

### Removed

- The Q-Workshop branded Dice So Nice dice theme. Dice So Nice support and the colorsets "Blood over Chrome" and "Wet Work" remain.
- `images/Repo-Header.webp`.
- Upstream's setup background, replaced by DM Bank's own Night City background.

### Known limitations

- New worlds only. Worlds from the official Cyberpunk RED Core can't be moved yet; don't edit `world.json` by hand.
- Modules made only for `cyberpunk-red-core` don't show in worlds using this system until their authors add `cyberpunk-red-core-dmbank` to their manifest.
- Actor and item sheets are still ApplicationV1.
