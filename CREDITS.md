# Credits & License

## Original system
DM Bank Night City Edition is an **unofficial fork** of **Cyberpunk RED Core** for Foundry VTT,
created and maintained by **The Project Red Team** and contributors.

- Foundry package: https://foundryvtt.com/packages/cyberpunk-red-core
- Source code: https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core
- Based on version **v0.92.4**

Almost everything that makes this system work (actor and item data, rules automation,
roll logic, compendia, sheets) is their work. All credit for it goes to them.
If you enjoy this fork, please thank and support the original team.

This fork is **not affiliated with or endorsed by The Project Red Team**.
Please do not report bugs in this fork to the original project; report them to this fork instead
(https://github.com/dm-bank-vtt/cyberpunk-red-core-dmbank/issues).

Upstream's own credits for art, icons, maps and fonts are kept verbatim in `CREDITS-UPSTREAM.md`,
together with the additions this package needs. The font licence is in `fonts/OFL.txt`.

## What this fork changes (DM Bank)
- Port to Foundry VTT **V13–V14**, including fixes for values that were not being saved.
- Night City visual theme, holographic sheets, cyberware body scan, inventory grid and loadout panel.
- Combat HUD, turn order bar, hologram dice, roll requests, NET Architect / NET overlay, Virtuality AR view.
- Removed: the Q-Workshop branded Dice So Nice dice, `images/Repo-Header.webp` and upstream's setup background.

Most DM Bank additions live in `modules/dmbank/` and `styles/dmbank-*.css`, but the port also changed
many original files. `CHANGES-FROM-UPSTREAM.md` summarises the changes with their dates, and the copy
in each release zip lists every added, modified and removed file compared with upstream v0.92.4.

## DM Bank art
- `assets/dmbank/body-scan.webp` (the Cyber tab body scan) and `images/Foundry-Background.webp`
  (the setup background) are original work made for DM Bank and are released with this system under the GPL v3.

## License
The original Cyberpunk RED Core system is licensed under the **GNU General Public License v3 (GPL v3)**.
This fork is a modified version and is distributed under the **same GPL v3 license**.
You may share and modify it, but any redistribution must stay GPL v3 and keep these credits.
The source is in the repository: https://github.com/dm-bank-vtt/cyberpunk-red-core-dmbank
(the compendium packs are built from `src/packs/`; see README.md).
Full text: `LICENSE` (https://www.gnu.org/licenses/gpl-3.0.txt).

## Disclaimer
DM Bank Night City Edition is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.

This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED. Cyberpunk is a registered trademark of CD PROJEKT S.A.

This is an unofficial fork of Cyberpunk RED Core v0.92.4 by The Project Red Team (https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core), modified by DM Bank (first release 2026-11-24). It is not affiliated with or endorsed by The Project Red Team. Licensed under the GNU GPL v3; see LICENSE. Third-party art, icons, maps and fonts are credited in CREDITS-UPSTREAM.md under their own terms. You need the Cyberpunk RED core rulebook to play.
