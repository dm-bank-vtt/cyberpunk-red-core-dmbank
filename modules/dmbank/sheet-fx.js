/**
 * DM Bank edition: holographic HUD effects for sheets.
 *  - boot ("move in") animation the first time a sheet window appears
 *  - corner brackets, scan bar and a status readout in the header
 *  - subtle 3D tilt that follows the mouse
 */
import { isNightCity, ncSetting } from "./util.js";

const MAX_TILT = 2.2; // degrees

function decorate(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const appEl = root.closest(".window-app, .application") ?? root;
  if (!appEl.classList.contains("sheet")) return;
  const content = appEl.querySelector(".window-content");
  if (!content) return;

  // Boot animation only when the window element is new.
  if (!appEl.dataset.ncBooted) {
    appEl.dataset.ncBooted = "1";
    if (ncSetting("bootAnimation")) {
      appEl.classList.add("nc-boot");
      setTimeout(() => appEl.classList.remove("nc-boot"), 1400);
      const sfx = ncSetting("bootSound");
      if (sfx) {
        foundry.audio.AudioHelper.play(
          { src: sfx, volume: 0.35, autoplay: true, loop: false },
          false
        );
      }
    }
  }

  // Overlays (re-added if a re-render removed them).
  if (!content.querySelector(":scope > .nc-corners")) {
    const corners = document.createElement("div");
    corners.className = "nc-corners";
    corners.innerHTML = "<i></i><i></i><i></i><i></i>";
    content.append(corners);
  }
  if (!content.querySelector(":scope > .nc-scanbar")) {
    const bar = document.createElement("div");
    bar.className = "nc-scanbar";
    content.append(bar);
  }
  const header = appEl.querySelector(".window-header");
  if (header && !header.querySelector(".nc-readout")) {
    const doc = app.document ?? app.object;
    const readout = document.createElement("span");
    readout.className = "nc-readout";
    const kind =
      doc?.documentName === "Actor" ? "BIOMON" : doc?.documentName === "Item" ? "ITEM.DB" : "SYS";
    const code = (doc?.id ?? "00000000").slice(-6).toUpperCase();
    readout.innerHTML = `${kind}://${code} <b>&#9679;</b> LINK`;
    const title = header.querySelector(".window-title");
    title?.after(readout);
  }
  content.querySelectorAll(".actor-stats-stat").forEach((el, i) => {
    el.style.setProperty("--nc-i", i);
  });

  // Mouse tilt.
  if (ncSetting("sheetTilt") && !content.dataset.ncTilt) {
    content.dataset.ncTilt = "1";
    let frame = null;
    content.addEventListener("mousemove", (event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const form = content.querySelector(":scope > form");
        if (!form) return;
        const rect = content.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        form.style.setProperty("--nc-tilt-y", `${(x * MAX_TILT).toFixed(2)}deg`);
        form.style.setProperty("--nc-tilt-x", `${(-y * MAX_TILT).toFixed(2)}deg`);
      });
    });
    content.addEventListener("mouseleave", () => {
      const form = content.querySelector(":scope > form");
      form?.style.setProperty("--nc-tilt-x", "0deg");
      form?.style.setProperty("--nc-tilt-y", "0deg");
    });
  }
}

export default function registerSheetFx() {
  const handler = (app, html) => {
    if (!isNightCity()) return;
    try {
      decorate(app, html);
    } catch (err) {
      console.error("CPR DM Bank | sheet fx", err);
    }
  };
  Hooks.on("renderActorSheet", handler);
  Hooks.on("renderItemSheet", handler);
}
