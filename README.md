# DM Bank Night City Edition

**A Foundry VTT system for use with Cyberpunk RED.** Free and unofficial. Foundry V13–V14.

> DM Bank Night City Edition is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.
>
> This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED. Cyberpunk is a registered trademark of CD PROJEKT S.A.
>
> This is an unofficial fork of Cyberpunk RED Core v0.92.4 by The Project Red Team (https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core), modified by DM Bank (first release 2026-11-24). It is not affiliated with or endorsed by The Project Red Team. Licensed under the GNU GPL v3; see [LICENSE](LICENSE). Third-party art, icons, maps and fonts are credited in [CREDITS-UPSTREAM.md](CREDITS-UPSTREAM.md) under their own terms. You need the Cyberpunk RED core rulebook to play.

![DM Bank Night City Edition](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-1.webp)

## Features

The rules automation, compendia and sheets of the original system, ported to Foundry V13–V14 and given the DM Bank Night City UI.

- **Holographic character sheet**: translucent panels, scanlines, a boot-up animation and an optional 3D tilt.

  ![Holographic character sheet](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-2.webp)

- **Cyberware body scan**: the Cyber tab shows a holographic body with a panel per system (Neuralware, Ocular, Auditory, Internal, Fashionware, Arms, External, Legs, Borgware). Click an empty slot to install matching cyberware; the system's own install rules and Humanity Loss rolls still apply.

  ![Cyberware body scan](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-3.webp)

- **Skills with Quick Skills**: pin skills as roll buttons, filter to trained skills, click a row to roll.

  ![Skills with Quick Skills](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-4.webp)

- **Gear grid**: weapons, armor and cyberdecks as tiles with category chips, quality colours and a detail panel.

  ![Gear grid: weapons, armor, cyberdecks](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-5.webp)

- **INCOMING TRANSMISSION chat cards**: plain messages arrive as calls, and roll cards get hologram dice.

  ![INCOMING TRANSMISSION chat cards](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-6.webp)

- **Token HUD and combat tracker**: animated turn rings, target reticles, a turn order bar with END TURN, and a combat HUD that uses the system's own modifiers.

  ![Token HUD and combat tracker](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-7.webp)

- **NET ARCHITECT**: the GM builds a NET Architecture floor by floor, from presets, a saved library or the core random tables.

  ![NET ARCHITECT: build the NET floor by floor](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-12.webp)

- **NET RUN**: Netrunning plays out over the board, with the NET Actions, the architecture floors and the GM's run controls on screen.

  ![NET RUN: Netrunning on the board](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-8.webp)

- **NET DECK and NET MARKET**: build the cyberdeck from program cards and buy programs when the GM opens the shop.

  ![NET DECK and NET MARKET program shop](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-9.webp)

- **Roll request**: the GM calls for a skill or stat check and everyone rolls on the same hologram screen.

  ![Roll request: hologram group checks](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-10.webp)

- **Combat HUD**: a shortcut bar for weapons, quick-use items, Evasion and Luck, with ammo, fire modes and range rings.

  ![Combat HUD shortcut bar](https://dm-bank-vtt.com/media/cyberpunk-red-core-dmbank/banner-11.webp)

Also: Humanity automation (EMP follows Humanity, with an optional Cyberpsychosis takeover), a Night City theme, and the fix for values that Foundry V14 never saved (skill levels, equip state, ammo, item amounts, cyberdeck rez, armor tracking). Most DM Bank features have a switch in Configure Settings.

## Install

In Foundry: **Game Systems → Install System**, paste this into **Manifest URL**, and click Install:

```
https://github.com/dm-bank-vtt/cyberpunk-red-core-dmbank/releases/latest/download/system.json
```

Then create a **new world** with DM Bank Night City Edition. Foundry V13 and V14 are supported; 1.0.0 was tested on V14 (build 368) and not yet on V13, so please report anything that breaks there.

Page: https://dm-bank-vtt.com/modules/cyberpunk-red-core-dmbank/

## Existing worlds

This release is for **new worlds only**. Worlds from the official Cyberpunk RED Core can't be moved to this system yet. A migration tool is planned (no date yet); follow [GitHub Releases](https://github.com/dm-bank-vtt/cyberpunk-red-core-dmbank/releases).

**Don't edit `world.json` yourself** to switch a world over. The world opens, but its settings, situational modifiers, shops and compendium links silently break.

## For Module authors

Foundry matches Modules to systems by id, so a Module made only for the official `cyberpunk-red-core` does not show in worlds using this system. Users can't fix that themselves, because Foundry overwrites their edits on update. If your Module works with this system, add `cyberpunk-red-core-dmbank` next to `cyberpunk-red-core` in your `module.json`:

```json
"relationships": {
  "systems": [
    { "id": "cyberpunk-red-core", "type": "system" },
    { "id": "cyberpunk-red-core-dmbank", "type": "system" }
  ]
}
```

Compendium and document links use the system id too: `Compendium.cyberpunk-red-core-dmbank.<pack>…` and `systems/cyberpunk-red-core-dmbank/…`.

## Reporting bugs

Report bugs on [GitHub Issues](https://github.com/dm-bank-vtt/cyberpunk-red-core-dmbank/issues) or in [#cyberpunk-red on the DM Bank Discord](https://discord.gg/c7CTUVuwk3) (when you join, pick the Cyberpunk RED answer in the welcome questions to see the channel). Include your Foundry version, the system version, whether the world is new, your active Modules and the console log (F12).

**Please don't report bugs in this fork to The Project Red Team.** They are not responsible for it.

## Support

DM Bank Night City Edition is free. If you'd like to say thanks, you can leave a Tip on [Ko-fi](https://ko-fi.com/dmbank). It doesn't unlock anything.

## Credits & License

- The original system is **Cyberpunk RED Core** by The Project Red Team and contributors: almost everything that makes this system work is their work. See [CREDITS.md](CREDITS.md).
- Third-party art, icons, maps and fonts: [CREDITS-UPSTREAM.md](CREDITS-UPSTREAM.md) (upstream's v0.92.4 credits, verbatim, plus additions) and [fonts/OFL.txt](fonts/OFL.txt).
- What DM Bank changed, with dates: [CHANGES-FROM-UPSTREAM.md](CHANGES-FROM-UPSTREAM.md). The copy in each release zip also lists every added, modified and removed file.
- **Source**: the compendium packs are built from the JSON in [`src/packs/`](src/packs) with `npm ci && npm run pack` (`npm run unpack` goes the other way). `main.css` is edited directly in this fork; its original LESS source is `src/less` at upstream's [`v0.92.4` tag](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/tree/v0.92.4/src/less).
- This system is based on upstream v0.92.4. Later upstream fixes are merged by hand, with no fixed schedule.
- Licensed under the **GNU General Public License v3**; see [LICENSE](LICENSE).
