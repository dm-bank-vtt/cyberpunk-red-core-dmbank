import SystemUtils from "../../utils/cpr-systemUtils.js";

const InitializeDSNPreset = () => {
  /**
   * Hook to add the system's colorsets to Dice So Nice.
   * DM Bank: the Q-Workshop branded dice systems and their face textures
   * (icons/dice/dice-so-nice/) were removed from this fork; only the
   * colour-only colorsets remain.
   * https://foundryvtt.com/packages/dice-so-nice/
   * @public
   * @memberof hookEvents
   */
  Hooks.once("diceSoNiceReady", (dice3d) => {
    /**
     * Add a colorset (theme)
     * @param {Object} colorset (see below)
     * @param {String} mode= "default","preferred"
     * The "mode" parameter have 2 modes :
     * - "default" only register the colorset
     * - "preferred" apply the colorset if the player didn't already change his dice appearance for this world.
     */

    // This will add the user's color as a default while turning edges black.
    dice3d.addColorset(
      {
        name: "user",
        description: SystemUtils.Localize("CPR.module.dsn.colorsetDefault"),
        category: SystemUtils.Localize("CPR.module.dsn.groupName"),
        background: game.user.color.toString(16), // Omitting the background turns the numbers black.
        edge: "#000000",
        material: "glass",
      },
      "preferred"
    );

    dice3d.addColorset(
      {
        name: "red",
        description: SystemUtils.Localize("CPR.module.dsn.colorsetRed"),
        category: SystemUtils.Localize("CPR.module.dsn.groupName"),
        background: "#E64539",
        edge: "#000000",
        material: "glass",
      },
      "default"
    );

    dice3d.addColorset(
      {
        name: "yellow",
        description: SystemUtils.Localize("CPR.module.dsn.colorsetYellow"),
        category: SystemUtils.Localize("CPR.module.dsn.groupName"),
        background: "#FFF300",
        edge: "#000000",
        material: "glass",
      },
      "default"
    );
  });
};

export default InitializeDSNPreset;
