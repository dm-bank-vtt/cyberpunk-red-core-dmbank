/**
 * DM Bank edition: game-style inventory for the Gear tab.
 *  - Category chips with counts (+ "Equipped")
 *  - Item grid with image tiles: quality frame, equip badge, amount / magazine
 *  - Detail panel for the selected item: stats, full description and labelled actions
 * Actions are routed to the system's original (hidden) gear list, so every rule
 * (reload, equip cycle, install, delete confirmation...) behaves exactly as before.
 */
import { isNightCity, ncSetting } from "./util.js";
import { assignToSlot } from "./loadout.js";

const VIEW_KEY = "cpr-dmbank.gearView";
const selected = new Map(); // actorId -> itemId
const activeCat = new Map(); // actorId -> category

const CATEGORIES = [
  ["weapon", "Weapons", "fa-gun"],
  ["ammo", "Ammo", "fa-burst"],
  ["armor", "Armor", "fa-shield-halved"],
  ["cyberware", "Cyberware", "fa-microchip"],
  ["gear", "Gear", "fa-toolbox"],
  ["drug", "Drugs", "fa-syringe"],
  ["clothing", "Clothing", "fa-shirt"],
  ["vehicle", "Vehicles", "fa-car-side"],
  ["cyberdeck", "Cyberdecks", "fa-laptop-code"],
  ["program", "Programs", "fa-code"],
  ["itemUpgrade", "Upgrades", "fa-screwdriver-wrench"],
  ["netarch", "NET Arch", "fa-network-wired"],
];

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

function getView() {
  try {
    return localStorage.getItem(VIEW_KEY) || "grid";
  } catch (err) {
    return "grid";
  }
}
function setView(v) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch (err) {
    /* ignore */
  }
}

function inventoryItems(actor, tab) {
  // Only show what the system's own gear list shows (it already filters installed items etc.).
  const ids = new Set([...tab.querySelectorAll("li.item[data-item-id]")].map((li) => li.dataset.itemId));
  return actor.items.filter((i) => ids.has(i.id) && i.type !== "skill" && i.type !== "role" && i.type !== "criticalInjury");
}

function badge(item) {
  const sys = item.system;
  if (sys.magazine && sys.magazine.max > 0) return `<span class="nc-badge nc-ammo">${sys.magazine.value}/${sys.magazine.max}</span>`;
  if (Number.isFinite(sys.amount) && sys.amount !== 1) return `<span class="nc-badge">x${sys.amount}</span>`;
  return "";
}

function equipMark(item) {
  const eq = item.system.equipped;
  if (eq === "equipped") return '<span class="nc-eq nc-eq-e" data-tooltip="Equipped">E</span>';
  if (eq === "carried") return '<span class="nc-eq nc-eq-c" data-tooltip="Carried">C</span>';
  if (item.type === "cyberware" && item.system.isInstalled) return '<span class="nc-eq nc-eq-e" data-tooltip="Installed">I</span>';
  return "";
}

function statRows(item) {
  const s = item.system;
  const rows = [];
  const add = (k, v) => {
    if (v !== undefined && v !== null && v !== "") rows.push([k, v]);
  };
  switch (item.type) {
    case "weapon":
      add("Damage", s.damage);
      add("ROF", s.rof);
      add("Skill", s.weaponSkill);
      if (s.magazine?.max) add("Magazine", `${s.magazine.value} / ${s.magazine.max}`);
      add("Hands", s.handsReq);
      add("Concealable", s.concealable?.concealable ? "Yes" : "No");
      break;
    case "armor":
      if (s.isBodyLocation) add("Body SP", `${s.bodyLocation?.sp - (s.bodyLocation?.ablation ?? 0)} / ${s.bodyLocation?.sp}`);
      if (s.isHeadLocation) add("Head SP", `${s.headLocation?.sp - (s.headLocation?.ablation ?? 0)} / ${s.headLocation?.sp}`);
      if (s.isShield) add("Shield HP", s.shieldHitPoints?.value);
      add("Penalty", s.penalty);
      break;
    case "cyberware":
      add("Type", game.i18n.localize(`CPR.global.cyberwareType.${s.type}`) || s.type);
      add("Humanity Loss", `${s.humanityLoss?.roll} (${s.humanityLoss?.static})`);
      add("Slots", s.installedItems?.slots ? `${s.installedItems.usedSlots}/${s.installedItems.slots}` : undefined);
      add("Installed", s.isInstalled ? "Yes" : "No");
      break;
    case "ammo":
      add("Variety", s.variety);
      add("Type", s.type);
      add("Amount", s.amount);
      break;
    default:
      if (Number.isFinite(s.amount)) add("Amount", s.amount);
  }
  if (s.quality) add("Quality", s.quality);
  if (s.equipped) add("State", s.equipped);
  if (s.price?.market !== undefined) add("Price", `${s.price.market} eb`);
  return rows;
}

function tileHtml(item, isSelected) {
  const quality = item.system.quality ?? "standard";
  return `<div class="nc-itile nc-q-${esc(quality)} ${isSelected ? "selected" : ""} item" data-item-id="${item.id}" draggable="true" data-tooltip="${esc(item.name)}">
      <div class="nc-itile-img"><img src="${esc(item.img)}" alt="">${equipMark(item)}${badge(item)}</div>
      <div class="nc-itile-name">${esc(item.name)}</div>
    </div>`;
}

async function detailHtml(item, tab) {
  if (!item) return `<div class="nc-detail-empty"><i class="fas fa-crosshairs"></i><span>SELECT AN ITEM</span></div>`;
  const rows = statRows(item)
    .map(([k, v]) => `<div class="nc-stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join("");
  const TE = foundry.applications.ux.TextEditor.implementation;
  const desc = await TE.enrichHTML(item.system.description?.value ?? "", { async: true, relativeTo: item });
  // Labelled copies of the original row's action links.
  const row = tab.querySelector(`li.item[data-item-id="${item.id}"]`);
  const actions = row ? [...row.querySelectorAll(":scope > .gear-actions a")] : [];
  const buttons = actions
    .map((a, i) => {
      const icon = a.querySelector("i")?.className ?? "fas fa-circle";
      const label = a.dataset.tooltip || a.querySelector("i")?.dataset.tooltip || a.dataset.action || a.dataset.actionType || "Action";
      const danger = (a.dataset.actionType || a.dataset.action) === "delete" ? " nc-danger" : "";
      return `<a class="nc-act${danger}" data-proxy="${i}"><i class="${esc(icon)}"></i><span>${esc(label)}</span></a>`;
    })
    .join("");
  const typeLabel = game.i18n.localize(`TYPES.Item.${item.type}`) || item.type;
  const assign = [];
  if (item.type === "weapon") {
    assign.push(["primary", "fa-gun", "Primary"], ["secondary", "fa-person-rifle", "Secondary"], ["melee", "fa-khanda", "Melee"]);
  }
  if (item.type === "armor") assign.push(["armor", "fa-shield-halved", "Wear"]);
  if (!["cyberware", "vehicle", "netarch"].includes(item.type)) assign.push(["quick", "fa-bolt", "Quick use"]);
  const assignHtml = assign.length
    ? `<div class="nc-assign"><span>LOADOUT →</span>${assign
        .map(([k, i, l]) => `<a class="nc-assign-btn" data-nc-assign="${k}"><i class="fas ${i}"></i> ${l}</a>`)
        .join("")}</div>`
    : "";
  return `<div class="nc-detail-head">
      <div class="nc-detail-img nc-q-${esc(item.system.quality ?? "standard")}"><img src="${esc(item.img)}" alt=""></div>
      <div class="nc-detail-title"><b>${esc(item.name)}</b><span>${esc(typeLabel)}</span></div>
    </div>
    <div class="nc-detail-stats">${rows}</div>
    <div class="nc-detail-desc">${desc || '<span class="nc-dim">No description.</span>'}</div>
    ${assignHtml}
    <div class="nc-detail-actions">
      <a class="nc-act" data-nc-action="open"><i class="fas fa-up-right-from-square"></i><span>Open</span></a>${buttons}
    </div>`;
}

async function render(app, root) {
  const actor = app.actor;
  const tab = root.querySelector(".tab.gear-tab");
  if (!tab) return;
  // Renders overlap when several updates land at once (equip + flag + armor). Only the newest may draw,
  // otherwise two panels end up stacked and the visible one has no drag/click listeners.
  const ticket = (tab._ncInvTicket = (tab._ncInvTicket ?? 0) + 1);
  tab.querySelector(":scope > .nc-inventory")?.remove();
  const view = getView();
  tab.classList.toggle("nc-grid-mode", view === "grid");

  const items = inventoryItems(actor, tab);
  const counts = {};
  for (const i of items) counts[i.type] = (counts[i.type] ?? 0) + 1;
  const equippedCount = items.filter((i) => i.system.equipped === "equipped").length;
  let cat = activeCat.get(actor.id) ?? "all";
  if (cat !== "all" && cat !== "equipped" && !counts[cat]) cat = "all";

  const chips = [
    `<a class="nc-cat ${cat === "all" ? "active" : ""}" data-cat="all">ALL <b>${items.length}</b></a>`,
    `<a class="nc-cat ${cat === "equipped" ? "active" : ""}" data-cat="equipped"><i class="fas fa-hand-fist"></i> EQUIPPED <b>${equippedCount}</b></a>`,
    ...CATEGORIES.filter(([key]) => counts[key]).map(
      ([key, label, icon]) => `<a class="nc-cat ${cat === key ? "active" : ""}" data-cat="${key}"><i class="fas ${icon}"></i> ${label.toUpperCase()} <b>${counts[key]}</b></a>`
    ),
  ].join("");

  const order = CATEGORIES.map(([k]) => k);
  const shown = items
    .filter((i) => cat === "all" || (cat === "equipped" ? i.system.equipped === "equipped" : i.type === cat))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name));
  let sel = selected.get(actor.id);
  if (!shown.find((i) => i.id === sel)) sel = shown[0]?.id;
  const selItem = actor.items.get(sel);

  const detail = await detailHtml(selItem, tab);
  if (tab._ncInvTicket !== ticket) return;
  tab.querySelectorAll(":scope > .nc-inventory").forEach((e) => e.remove());
  const inv = document.createElement("div");
  inv.className = "nc-inventory";
  inv.innerHTML = `
    <div class="nc-inv-top">
      <div class="nc-cats">${chips}</div>
      <div class="nc-cyber-view nc-gear-view"><a data-view="grid" class="${view === "grid" ? "active" : ""}">GRID</a><a data-view="list" class="${view !== "grid" ? "active" : ""}">LIST</a></div>
    </div>
    <div class="nc-inv-body">
      <div class="nc-grid">${shown.map((i) => tileHtml(i, i.id === sel)).join("") || '<div class="nc-dim nc-grid-empty">Nothing here, choom.</div>'}</div>
      <div class="nc-detail">${detail}</div>
    </div>`;
  if (view !== "grid") inv.classList.add("nc-collapsed");
  const loadout = tab.querySelector(":scope > .nc-loadout");
  if (loadout) loadout.after(inv);
  else tab.prepend(inv);
  wire(app, inv, tab);
}

function wire(app, inv, tab) {
  const actor = app.actor;
  inv.addEventListener("click", async (event) => {
    const viewBtn = event.target.closest("[data-view]");
    if (viewBtn) {
      event.preventDefault();
      setView(viewBtn.dataset.view);
      app.render(false);
      return;
    }
    const catBtn = event.target.closest(".nc-cat");
    if (catBtn) {
      event.preventDefault();
      activeCat.set(actor.id, catBtn.dataset.cat);
      render(app, app.element[0]);
      return;
    }
    const tile = event.target.closest(".nc-itile");
    if (tile) {
      event.preventDefault();
      selected.set(actor.id, tile.dataset.itemId);
      inv.querySelectorAll(".nc-itile.selected").forEach((t) => t.classList.remove("selected"));
      tile.classList.add("selected");
      inv.querySelector(".nc-detail").innerHTML = await detailHtml(actor.items.get(tile.dataset.itemId), tab);
      return;
    }
    const assignBtn = event.target.closest("[data-nc-assign]");
    if (assignBtn) {
      event.preventDefault();
      if (!app.isEditable) return;
      const id = selected.get(actor.id) ?? inv.querySelector(".nc-itile.selected")?.dataset.itemId;
      await assignToSlot(actor, assignBtn.dataset.ncAssign, actor.items.get(id));
      return;
    }
    const act = event.target.closest(".nc-act");
    if (act) {
      event.preventDefault();
      const id = selected.get(actor.id) ?? inv.querySelector(".nc-itile.selected")?.dataset.itemId;
      if (act.dataset.ncAction === "open") {
        actor.items.get(id)?.sheet.render(true);
        return;
      }
      const row = tab.querySelector(`li.item[data-item-id="${id}"]`);
      const original = row ? [...row.querySelectorAll(":scope > .gear-actions a")][Number(act.dataset.proxy)] : null;
      original?.click();
    }
  });
  inv.addEventListener("dblclick", (event) => {
    const tile = event.target.closest(".nc-itile");
    if (tile) actor.items.get(tile.dataset.itemId)?.sheet.render(true);
  });
  if (app.isEditable) {
    // One delegated listener (survives tile re-draws); also works when the drag starts on the tile's <img>.
    inv.addEventListener("dragstart", (ev) => {
      const tile = ev.target.closest?.(".nc-itile");
      const item = tile && actor.items.get(tile.dataset.itemId);
      if (!item || !ev.dataTransfer) return;
      ev.stopPropagation();
      ev.dataTransfer.effectAllowed = "copyMove";
      ev.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ type: "Item", uuid: item.uuid, system: { actorId: actor.id, tokenId: app.token?.id ?? null, data: item } })
      );
      const img = tile.querySelector("img");
      if (img) ev.dataTransfer.setDragImage(img, 24, 24);
    });
    inv.querySelectorAll(".nc-itile img").forEach((img) => img.setAttribute("draggable", "false"));
  }
}

export default function registerInventory() {
  Hooks.on("renderActorSheet", (app, html) => {
    if (!isNightCity() || ncSetting("inventoryGrid") === false) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || !app.actor || !["character", "mook"].includes(app.actor.type)) return;
    render(app, root).catch((err) => console.error("CPR DM Bank | inventory", err));
  });
}
