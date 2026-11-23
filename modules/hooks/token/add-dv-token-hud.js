import HudInterface from "../../hud/interface.js";

const AddDvTokenHud = () => {
  /**
   * Add DV icon to token HUD to allow easy selection of DV table entries
   *
   * In Foundry V13+ the Token HUD is an ApplicationV2, so the hook provides a plain HTMLElement.
   *
   * @public
   * @memberof hookEvents
   * @param {TokenHUD} hud      - Instance of the token HUD provided by Foundry
   * @param {HTMLElement} html  - HTML DOM object
   */
  Hooks.on("renderTokenHUD", async (hud, html) => {
    const element = html instanceof HTMLElement ? html : html?.[0];
    if (!element) return;
    const tokenDocument = hud.document ?? hud.object?.document;
    if (!tokenDocument) return;
    const dvHudTemplate = `systems/${game.system.id}/templates/hud/dv.hbs`;
    const dvDisplay = await foundry.applications.handlebars.renderTemplate(
      dvHudTemplate,
      tokenDocument.flags
    );
    const leftColumn =
      element.querySelector(".col.left") ?? element.querySelector(".left");
    if (!leftColumn) return;
    // Avoid adding the button twice if the HUD re-renders.
    leftColumn.querySelector(".dv-table-selector")?.remove();
    leftColumn.insertAdjacentHTML("beforeend", dvDisplay);
    leftColumn
      .querySelector(".dv-table-selector")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        HudInterface.SetDvTable(tokenDocument);
        hud.clear?.();
        if (!hud.clear) hud.close?.();
      });
  });
};

export default AddDvTokenHud;
