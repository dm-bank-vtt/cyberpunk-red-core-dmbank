import SystemUtils from "./cpr-systemUtils.js";

/**
 * Open an image popout and share it with the other players.
 *
 * @param {{name: string, img: string, uuid: string}} data
 */
function showImageToPlayers(data) {
  const V2ImagePopout = foundry.applications?.apps?.ImagePopout;
  if (V2ImagePopout) {
    // Foundry V13+ (ApplicationV2)
    const popout = new V2ImagePopout({
      src: data.img,
      uuid: data.uuid,
      window: { title: data.name },
      shareable: true,
    });
    popout.render({ force: true });
    popout.shareImage?.();
    return;
  }
  // Foundry V12 and older
  // eslint-disable-next-line no-undef
  const popout = new ImagePopout(data.img, {
    title: data.name,
    shareable: true,
  });
  popout.render(true);
  popout.shareImage(true);
}

/**
 * Sets up a ContextMenu that appears when the provided selector is right clicked.
 * The ContextMenu contains a menu item that enables the user to share an image with other players.
 * @param {Object} html - The DOM object (jQuery or HTMLElement)
 * @param {string} contextMenuTargetSelector - The selector for the element that will open the ContextMenu when right clicked
 * @param {{name: string, img: string}} data - The created ContextMenu
 */
export default function createImageContextMenu(
  html,
  contextMenuTargetSelector,
  data
) {
  const label = SystemUtils.Format("CPR.sheets.image.showPlayers");
  const onClick = () => showImageToPlayers(data);
  const container = html instanceof HTMLElement ? html : html?.[0] ?? html;
  const ContextMenuClass =
    foundry.applications?.ux?.ContextMenu?.implementation ??
    foundry.applications?.ux?.ContextMenu ??
    globalThis.ContextMenu;

  // Foundry V14 renamed menu entry keys: name -> label, callback -> onClick, condition -> visible.
  const menuItems =
    game.release.generation >= 14
      ? [{ label, icon: "fas fa-eye", onClick }]
      : [
          {
            name: label,
            icon: '<i class="fas fa-eye"></i>',
            callback: onClick,
          },
        ];
  return new ContextMenuClass(container, contextMenuTargetSelector, menuItems, {
    jQuery: false,
  });
}
