/**
 * DM Bank edition: Cyberware "body scan" screen for the character sheet's Cyber tab.
 *
 * Shows a holographic body with one panel per cyberware system. Every panel lists its
 * foundational cyberware and the option slots inside it (filled / empty), so slot limits are
 * visible at a glance. Empty slots can be clicked to install matching cyberware; installed pieces
 * open their sheet on click and can be ejected. The original list view is one click away.
 */
import { isNightCity, ncSetting } from "./util.js";

const VIEW_KEY = "cpr-dmbank.cyberView";

/** Panel layout: which cyberware type sits where, and where its line touches the body (%). */
const SYSTEMS = {
  left: [
    { type: "neuralWare", label: "Neuralware", sub: "Nervous System", anchor: [50, 3.5] },
    { type: "cyberEye", label: "Ocular System", sub: "Cybereyes", anchor: [46.5, 7.6] },
    { type: "cyberAudioSuite", label: "Auditory System", sub: "Cyberaudio", anchor: [58.5, 8.3] },
    { type: "cyberwareInternal", label: "Internal Systems", sub: "Organs", anchor: [50, 38] },
    { type: "fashionware", label: "Fashionware", sub: "Integumentary", anchor: [21, 40] },
  ],
  right: [
    { type: "cyberArm", label: "Arms", sub: "Cyberarms", anchor: [81, 40] },
    { type: "cyberwareExternal", label: "External", sub: "Skeleton / Body", anchor: [70, 22] },
    { type: "cyberLeg", label: "Legs", sub: "Cyberlegs", anchor: [60, 68] },
    { type: "borgware", label: "Borgware", sub: "Full Conversion", anchor: [50, 30] },
  ],
};

const BODY_W = 620;
const BODY_H = 1428;
const BODY_SRC = "systems/cyberpunk-red-core-dmbank/assets/dmbank/body-scan.webp";

function bodySvg() {
  return `
<svg class="nc-body-svg" viewBox="0 0 ${BODY_W} ${BODY_H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>
    <mask id="ncBodyMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${BODY_W}" height="${BODY_H}">
      <image href="${BODY_SRC}" x="0" y="0" width="${BODY_W}" height="${BODY_H}" style="filter: brightness(3) grayscale(1)"/>
    </mask>
    <pattern id="ncScan" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="2" fill="rgba(255,255,255,0.22)"/>
    </pattern>
    <linearGradient id="ncSweep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3ef2ff" stop-opacity="0"/>
      <stop offset="0.85" stop-color="#3ef2ff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <circle class="nc-body-halo" cx="${BODY_W / 2}" cy="480" r="300" fill="none" stroke="#ff2a3d" stroke-opacity="0.25" stroke-width="3" stroke-dasharray="6 18"/>
  <circle class="nc-body-halo2" cx="${BODY_W / 2}" cy="480" r="250" fill="none" stroke="#ff2a3d" stroke-opacity="0.18" stroke-width="2"/>
  <g class="nc-floor">
    <ellipse cx="${BODY_W / 2}" cy="1400" rx="230" ry="26" fill="none" stroke="#f3e600" stroke-opacity="0.75" stroke-width="4" stroke-dasharray="22 14"/>
    <ellipse cx="${BODY_W / 2}" cy="1400" rx="160" ry="17" fill="none" stroke="#ff2a3d" stroke-opacity="0.6" stroke-width="3"/>
  </g>
  <image class="nc-body-img" href="${BODY_SRC}" x="0" y="0" width="${BODY_W}" height="${BODY_H}"/>
  <g mask="url(#ncBodyMask)">
    <rect class="nc-body-scan" x="0" y="0" width="${BODY_W}" height="${BODY_H}" fill="url(#ncScan)"/>
    <rect class="nc-body-sweep" x="0" y="-140" width="${BODY_W}" height="140" fill="url(#ncSweep)"/>
  </g>
  <line class="nc-body-sweepline" x1="40" x2="${BODY_W - 40}" y1="0" y2="0" stroke="#3ef2ff" stroke-width="2" stroke-opacity="0.7"/>
  <g class="nc-heart" transform="translate(330 350)">
    <circle r="34" fill="none" stroke="#3ef2ff" stroke-width="3"/>
    <circle r="34" fill="none" stroke="#3ef2ff" stroke-width="2" class="nc-heart-ping"/>
  </g>
</svg>`;
}

function getView() {
  try {
    return localStorage.getItem(VIEW_KEY) || "hud";
  } catch (err) {
    return "hud";
  }
}
function setView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (err) {
    /* ignore */
  }
}

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** Total option slots of a container item, including upgrades. */
function totalSlots(item) {
  const free = item.availableInstallSlots?.() ?? 0;
  const used = item.system.installedItems?.usedSlots ?? 0;
  return Math.max(0, free + used);
}

function collect(actor) {
  const cyber = actor.itemTypes.cyberware;
  const topLevel = cyber.filter(
    (c) => c.system.isInstalled && c.system.installedIn?.[0] === actor.id
  );
  const uninstalled = cyber.filter((c) => !c.system.isInstalled);
  const byType = {};
  for (const item of topLevel) {
    (byType[item.system.type] ??= []).push(item);
  }
  return { topLevel, uninstalled, byType };
}

function tileHtml(item, { extraClass = "", size = 1 } = {}) {
  const sizeBadge = size > 1 ? `<span class="nc-tile-size">x${size}</span>` : "";
  return `<div class="nc-tile ${extraClass}" data-item-id="${item.id}" data-tooltip="${esc(item.name)}">
      <img src="${esc(item.img)}" alt="">
      ${sizeBadge}
      <a class="nc-tile-eject" data-nc-action="eject" data-item-id="${item.id}" data-tooltip="Uninstall"><i class="fas fa-eject"></i></a>
    </div>`;
}

function foundationRow(actor, foundation) {
  const options = foundation.getInstalledItems?.() ?? [];
  const slots = totalSlots(foundation);
  const used = foundation.system.installedItems?.usedSlots ?? 0;
  const free = Math.max(0, slots - used);
  let html = `<div class="nc-frow">${tileHtml(foundation, { extraClass: "nc-foundation" })}<div class="nc-slots">`;
  for (const opt of options) {
    html += tileHtml(opt, { extraClass: "nc-option", size: opt.system.size ?? 1 });
  }
  const shown = Math.min(free, 6);
  for (let i = 0; i < shown; i++) {
    html += `<div class="nc-tile nc-empty" data-nc-action="install-option" data-type="${foundation.system.type}" data-tooltip="Empty slot — install"><i class="fas fa-plus"></i></div>`;
  }
  if (free > shown) html += `<div class="nc-more">+${free - shown}</div>`;
  html += `</div></div>`;
  return { html, used, slots, name: foundation.name };
}

function panelHtml(actor, system, data) {
  const foundations = data.byType[system.type] ?? [];
  let rows = "";
  let used = 0;
  let slots = 0;
  for (const f of foundations) {
    const row = foundationRow(actor, f);
    rows += row.html;
    used += row.used;
    slots += row.slots;
  }
  let status;
  let statusClass = "";
  if (!foundations.length) {
    status = "No foundation";
    statusClass = "nc-dim";
    rows = `<div class="nc-frow"><div class="nc-tile nc-empty nc-need-foundation" data-nc-action="install-foundation" data-type="${system.type}" data-tooltip="Install foundational cyberware"><i class="fas fa-plus"></i></div></div>`;
  } else if (slots === 0) {
    status = "Mods unavailable";
    statusClass = "nc-dim";
  } else {
    status = `Option slots <b>${used}/${slots}</b>`;
    if (used >= slots) statusClass = "nc-full";
  }
  return `<section class="nc-sys" data-type="${system.type}" data-anchor="${system.anchor.join(",")}">
      <header><span class="nc-sys-label">${esc(system.label)}</span><span class="nc-sys-sub">${esc(system.sub)}</span></header>
      <div class="nc-sys-status ${statusClass}">${status}</div>
      ${rows}
    </section>`;
}

function humanityBar(actor) {
  const hum = actor.system.derivedStats?.humanity ?? { value: 0, max: 0 };
  const emp = actor.system.stats?.emp ?? { value: 0, max: 0 };
  const max = Math.max(1, Number(hum.max) || 0, Number(emp.max) * 10);
  const value = Math.max(0, Number(hum.value) || 0);
  const pct = Math.min(100, (value / max) * 100);
  const capPct = Math.min(100, ((Number(hum.max) || 0) / max) * 100);
  const risk = emp.value <= 0 ? "nc-psycho" : emp.value <= 2 ? "nc-risk" : "";
  let ticks = "";
  for (let i = 10; i < max; i += 10) ticks += `<i style="left:${(i / max) * 100}%"></i>`;
  const warn =
    emp.value <= 0
      ? `<span class="nc-warn">CYBERPSYCHOSIS</span>`
      : emp.value <= 2
        ? `<span class="nc-warn">PSYCHOSIS RISK</span>`
        : `<span class="nc-ok">STABLE</span>`;
  return `<div class="nc-hum ${risk}">
      <div class="nc-hum-label">HUMANITY <b>${value}</b>/<span>${hum.max}</span></div>
      <div class="nc-hum-bar"><div class="nc-hum-cap" style="width:${capPct}%"></div><div class="nc-hum-fill" style="width:${pct}%"></div>${ticks}</div>
      <div class="nc-hum-emp">EMP <b>${emp.value}</b>/${emp.max}</div>
      ${warn}
    </div>`;
}

function buildHud(actor) {
  const data = collect(actor);
  const totalLoss = data.topLevel.length;
  const left = SYSTEMS.left.map((s) => panelHtml(actor, s, data)).join("");
  const right = SYSTEMS.right.map((s) => panelHtml(actor, s, data)).join("");
  const chips = data.uninstalled
    .map(
      (c) =>
        `<a class="nc-chip" data-nc-action="install" data-item-id="${c.id}" data-tooltip="Install ${esc(c.name)}"><img src="${esc(c.img)}" alt="">${esc(c.name)}</a>`
    )
    .join("");
  const wrap = document.createElement("div");
  wrap.className = "nc-cyberhud";
  wrap.innerHTML = `
    <div class="nc-cyber-top">
      <div class="nc-cyber-title"><i class="fas fa-microchip"></i> CYBERWARE <span>// BODY SCAN</span></div>
      ${humanityBar(actor)}
      <div class="nc-cyber-view">
        <a data-nc-action="view" data-view="hud" class="active">HUD</a><a data-nc-action="view" data-view="list">LIST</a>
      </div>
    </div>
    <div class="nc-cyber-stage">
      <svg class="nc-links"></svg>
      <div class="nc-col nc-col-left">${left}</div>
      <div class="nc-body-wrap">${bodySvg()}<div class="nc-body-count">${totalLoss} SYSTEMS ONLINE</div></div>
      <div class="nc-col nc-col-right">${right}</div>
    </div>
    <div class="nc-cyber-inv">
      <span class="nc-inv-label">UNINSTALLED // ${data.uninstalled.length}</span>
      <div class="nc-inv-list">${chips || '<span class="nc-dim">No spare cyberware</span>'}</div>
    </div>`;
  return wrap;
}

/** Draw the connector lines from each panel to its anchor on the body. */
function drawLinks(hud) {
  const svg = hud.querySelector("svg.nc-links");
  const stage = hud.querySelector(".nc-cyber-stage");
  const body = hud.querySelector(".nc-body-svg");
  if (!svg || !stage || !body || !stage.offsetWidth) return;
  const s = stage.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
  // The SVG keeps its aspect ratio inside its box; work out the drawn area.
  const ratio = BODY_W / BODY_H;
  let bw = b.width;
  let bh = b.height;
  if (bw / bh > ratio) bw = bh * ratio;
  else bh = bw / ratio;
  const bx = b.left - s.left + (b.width - bw) / 2;
  const by = b.top - s.top + (b.height - bh) / 2;
  let paths = "";
  hud.querySelectorAll(".nc-sys").forEach((panel) => {
    const [ax, ay] = panel.dataset.anchor.split(",").map(Number);
    const tx = bx + (ax / 100) * bw;
    const ty = by + (ay / 100) * bh;
    const p = panel.getBoundingClientRect();
    const isLeft = panel.closest(".nc-col-left");
    const px = isLeft ? p.right - s.left : p.left - s.left;
    const py = p.top - s.top + 12;
    const mx = isLeft ? px + 14 : px - 14;
    const dim = panel.querySelector(".nc-sys-status.nc-dim") ? " nc-link-dim" : "";
    paths += `<path class="nc-link${dim}" d="M${px},${py} L${mx},${py} L${tx},${ty}"/><circle class="nc-link-dot${dim}" cx="${tx}" cy="${ty}" r="2.5"/>`;
  });
  svg.innerHTML = paths;
}

function chooseAndInstall(actor, candidates, title) {
  if (!candidates.length) {
    ui.notifications.warn("No matching uninstalled cyberware on this character.");
    return;
  }
  const buttons = candidates
    .map(
      (c) =>
        `<button type="button" class="nc-pick" data-id="${c.id}"><img src="${esc(c.img)}" width="28" height="28"> ${esc(c.name)} <small>(slots: ${c.system.size ?? 1}, HL ${esc(c.system.humanityLoss?.roll)})</small></button>`
    )
    .join("");
  const dlg = new foundry.applications.api.DialogV2({
    window: { title },
    classes: ["nc-pick-dialog"],
    content: `<div class="nc-pick-list">${buttons}</div>`,
    buttons: [{ action: "cancel", label: "Cancel", default: true }],
  });
  dlg.render({ force: true }).then(() => {
    dlg.element.querySelectorAll(".nc-pick").forEach((btn) =>
      btn.addEventListener("click", async () => {
        dlg.close();
        await actor.installCyberware(btn.dataset.id);
      })
    );
  });
}

function activate(app, hud) {
  const actor = app.actor;
  hud.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-nc-action], .nc-tile[data-item-id]");
    if (!target || !hud.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    const action = target.dataset.ncAction;
    if (!app.isEditable && action && action !== "view") return;
    switch (action) {
      case "view": {
        setView(target.dataset.view);
        app.render(false);
        return;
      }
      case "eject":
        await actor.uninstallCyberware(target.dataset.itemId);
        return;
      case "install":
        await actor.installCyberware(target.dataset.itemId);
        return;
      case "install-option": {
        const type = target.dataset.type;
        const list = actor.itemTypes.cyberware.filter(
          (c) => !c.system.isInstalled && !c.system.isFoundational && c.system.type === type
        );
        chooseAndInstall(actor, list, "Install option cyberware");
        return;
      }
      case "install-foundation": {
        const type = target.dataset.type;
        const list = actor.itemTypes.cyberware.filter(
          (c) => !c.system.isInstalled && c.system.isFoundational && c.system.type === type
        );
        chooseAndInstall(actor, list, "Install foundational cyberware");
        return;
      }
      default: {
        const item = actor.items.get(target.dataset.itemId);
        item?.sheet.render(true);
      }
    }
  });
}

function inject(app, html) {
  if (!isNightCity() || ncSetting("cyberHud") === false) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actor = app.actor;
  if (!root || !actor || !["character", "mook"].includes(actor.type)) return;
  const tab = root.querySelector(".tab.cyberware-tab");
  if (!tab) return;
  tab.querySelector(":scope > .nc-cyberhud")?.remove();
  const view = getView();
  tab.classList.toggle("nc-hud-mode", view === "hud");
  const hud = buildHud(actor);
  if (view !== "hud") {
    // Compact switcher above the original list.
    hud.classList.add("nc-collapsed");
    hud.querySelector('[data-view="hud"]').classList.remove("active");
    hud.querySelector('[data-view="list"]').classList.add("active");
  }
  tab.prepend(hud);
  activate(app, hud);
  const redraw = () => requestAnimationFrame(() => drawLinks(hud));
  redraw();
  const ro = new ResizeObserver(redraw);
  ro.observe(hud);
  // Tabs are hidden until clicked; draw again when the Cyber tab becomes visible.
  root.querySelectorAll('.navtabs-right [data-tab="cyberware"]').forEach((t) => t.addEventListener("click", () => setTimeout(redraw, 30)));
}

export default function registerCyberHud() {
  Hooks.on("renderActorSheet", (app, html) => {
    try {
      inject(app, html);
    } catch (err) {
      console.error("CPR DM Bank | cyber hud", err);
    }
  });
}
