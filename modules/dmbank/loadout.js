/**
 * DM Bank edition: LOADOUT panel at the top of the Gear tab.
 *  - Status strip: HP, wound state, hands, REF / DEX, LUCK
 *  - Weapon slots: PRIMARY, SECONDARY, MELEE (magazine counter, bullet pips, reserve ammo)
 *  - ARMOR: tracked head / body / shield with SP, ablate and repair
 *  - QUICK USE: 4 slots for drugs, grenades, gear...
 * Weapon buttons click the system's own (hidden) Fight tab controls, so every roll,
 * fire mode and reload rule works exactly like the original sheet.
 * Slot choices live in the actor flag `flags.cyberpunk-red-core-dmbank.loadout`.
 */
import { NC_SCOPE, isNightCity, ncSetting } from "./util.js";
import CPR from "../system/config.js";

const FLAG = "loadout";
const WEAPON_SLOTS = [
  ["primary", "PRIMARY", "fa-gun"],
  ["secondary", "SECONDARY", "fa-person-rifle"],
  ["melee", "MELEE", "fa-khanda"],
];
const QUICK_COUNT = 4;
const COLLAPSE_KEY = "cpr-dmbank.loadoutCollapsed";
function isCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch (err) {
    return false;
  }
}

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function readFlag(actor) {
  const raw = actor.getFlag(NC_SCOPE, FLAG) ?? {};
  const quick = Array.isArray(raw.quick) ? raw.quick.slice(0, QUICK_COUNT) : [];
  while (quick.length < QUICK_COUNT) quick.push(null);
  return { primary: raw.primary ?? null, secondary: raw.secondary ?? null, melee: raw.melee ?? null, quick };
}

const isWeapon = (i) => i?.type === "weapon";
const isEquipped = (i) => i?.system?.equipped === "equipped";

/** Resolve what each slot shows: stored choice if it is still equipped, otherwise auto-fill from equipped weapons. */
export function resolveLoadout(actor) {
  const flag = readFlag(actor);
  const result = { primary: null, secondary: null, melee: null, quick: [] };
  const used = new Set();
  for (const [slot] of WEAPON_SLOTS) {
    const item = actor.items.get(flag[slot]);
    if (isWeapon(item) && isEquipped(item)) {
      result[slot] = item;
      used.add(item.id);
    }
  }
  const equipped = actor.items
    .filter((i) => isWeapon(i) && isEquipped(i) && !used.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const take = (pred) => {
    const idx = equipped.findIndex(pred);
    return idx >= 0 ? equipped.splice(idx, 1)[0] : null;
  };
  if (!result.primary) result.primary = take((i) => i.system.isRanged);
  if (!result.secondary) result.secondary = take((i) => i.system.isRanged);
  if (!result.melee) result.melee = take((i) => !i.system.isRanged);
  result.quick = flag.quick.map((id) => actor.items.get(id) ?? null);
  return result;
}

async function saveSlot(actor, slot, id) {
  const flag = readFlag(actor);
  if (slot.startsWith("quick")) {
    const idx = Number(slot.split(":")[1]);
    flag.quick = flag.quick.map((q) => (q === id ? null : q));
    flag.quick[idx] = id;
  } else {
    for (const [s] of WEAPON_SLOTS) if (flag[s] === id) flag[s] = null;
    flag[slot] = id;
  }
  await actor.setFlag(NC_SCOPE, FLAG, flag);
}

function armorLocations(item) {
  const s = item.system;
  const locs = [];
  if (s.isHeadLocation) locs.push("head");
  if (s.isBodyLocation) locs.push("body");
  if (s.isShield) locs.push("shield");
  return locs;
}

/**
 * Put an item into a loadout slot. Weapons/armor are equipped automatically; a weapon that
 * was in that slot before goes back to "carried".
 */
export async function assignToSlot(actor, slot, item) {
  if (!actor || !item || item.parent !== actor) return;
  if (slot === "quick") {
    const flag = readFlag(actor);
    let idx = flag.quick.indexOf(item.id);
    if (idx < 0) idx = flag.quick.indexOf(null);
    if (idx < 0) {
      ui.notifications.warn("QUICK USE is full. Remove an item first.");
      return;
    }
    await saveSlot(actor, `quick:${idx}`, item.id);
    return;
  }
  if (slot.startsWith("quick:")) {
    await saveSlot(actor, slot, item.id);
    return;
  }
  const canWear = typeof item.system?.equipped === "string";
  if (slot === "armor") {
    if (item.type !== "armor") {
      // Goggles, clothing, cyberdecks…: dropping them on the gear area simply puts them on.
      if (!canWear) {
        ui.notifications.warn(`${item.name} can't be equipped.`);
        return;
      }
      if (!isEquipped(item)) await item.update({ "system.equipped": "equipped" });
      ui.notifications.info(`${item.name}: EQUIPPED`);
      return;
    }
    if (!isEquipped(item)) await item.update({ "system.equipped": "equipped" });
    for (const loc of armorLocations(item)) await actor.updateTrackedArmor(loc, item.id);
    return;
  }
  if (!isWeapon(item)) {
    if (item.type === "armor") return assignToSlot(actor, "armor", item);
    if (canWear) {
      if (!isEquipped(item)) await item.update({ "system.equipped": "equipped" });
      ui.notifications.info(`${item.name}: EQUIPPED`);
      return;
    }
    ui.notifications.warn(`${item.name} is not a weapon.`);
    return;
  }
  const current = resolveLoadout(actor)[slot];
  if (current && current.id !== item.id) {
    await current.update({ "system.equipped": "carried" });
  }
  if (!isEquipped(item)) {
    if (typeof actor.canHoldWeapon === "function" && !actor.canHoldWeapon(item)) {
      ui.notifications.warn(game.i18n.localize("CPR.messages.warningTooManyHands"));
    }
    await item.update({ "system.equipped": "equipped" });
  }
  await saveSlot(actor, slot, item.id);
}

export async function clearSlot(actor, slot) {
  if (slot.startsWith("quick:")) {
    const flag = readFlag(actor);
    flag.quick[Number(slot.split(":")[1])] = null;
    await actor.setFlag(NC_SCOPE, FLAG, flag);
    return;
  }
  if (slot.startsWith("armor:")) {
    const item = actor.items.get(slot.split(":")[1]);
    if (!item) return;
    for (const loc of armorLocations(item)) {
      if (actor.system.externalData?.[`currentArmor${loc[0].toUpperCase()}${loc.slice(1)}`]?.id === item.id) {
        await actor.updateTrackedArmor(loc);
      }
    }
    await item.update({ "system.equipped": "carried" });
    return;
  }
  const item = resolveLoadout(actor)[slot];
  const flag = readFlag(actor);
  flag[slot] = null;
  await actor.setFlag(NC_SCOPE, FLAG, flag);
  if (item) await item.update({ "system.equipped": "carried" });
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function attackBase(actor, weapon) {
  const s = weapon.system;
  const stat = s.isRanged && s.weaponType !== "thrownWeapon" ? "ref" : "dex";
  const statVal = num(actor.system.stats?.[stat]?.value);
  const skill = typeof actor.getSkillLevel === "function" ? num(actor.getSkillLevel(s.weaponSkill)) : 0;
  return { stat: stat.toUpperCase(), total: statVal + skill + num(s.attackmod) };
}

function reserveAmmo(actor, weapon) {
  const varieties = weapon.system.ammoVariety ?? [];
  if (!varieties.length) return 0;
  return actor.items
    .filter((i) => i.type === "ammo" && varieties.includes(i.system.variety))
    .reduce((sum, i) => sum + num(i.system.amount), 0);
}

function fightCtl(root, id, selector) {
  return root.querySelector(`.weapon-grid[data-item-id="${id}"] ${selector}`);
}

function modeOn(root, id, mode) {
  return !!fightCtl(root, id, `.fire-checkbox[data-fire-mode="${mode}"] i.fa-circle-dot`);
}

function bulletPips(value, max) {
  if (max <= 0) return "";
  if (max > 40) {
    const pct = Math.round((value / max) * 100);
    return `<div class="nc-lo-magbar"><i style="width:${pct}%"></i></div>`;
  }
  let html = "";
  for (let i = 0; i < max; i++) html += `<i class="${i < value ? "on" : ""}"></i>`;
  return `<div class="nc-lo-bullets">${html}</div>`;
}

function weaponCard(actor, root, slot, label, icon, weapon) {
  if (!weapon) {
    return `<div class="nc-lo-slot nc-lo-${slot} nc-lo-empty" data-slot="${slot}">
        <div class="nc-lo-label"><i class="fas ${icon}"></i> ${label}</div>
        <div class="nc-lo-drop"><i class="fas fa-plus"></i><span>DRAG A WEAPON HERE</span></div>
      </div>`;
  }
  const s = weapon.system;
  const atk = attackBase(actor, weapon);
  const ranged = !!s.isRanged;
  const max = ranged ? num(s.magazine?.max) : 0;
  const value = ranged ? num(s.magazine?.value) : 0;
  const loaded = s.loadedAmmo;
  const ammoName = loaded
    ? game.i18n.localize(CPR.ammoTypes?.[loaded.system.type] ?? "") || loaded.name
    : "UNLOADED";
  const reserve = ranged ? reserveAmmo(actor, weapon) : 0;
  const ratio = max > 0 ? value / max : 1;
  const state = ranged && max > 0 ? (value === 0 ? "nc-lo-dry" : ratio < 0.25 ? "nc-lo-low" : "") : "";
  const id = weapon.id;
  const btn = (key, ico, text, extra = "") =>
    `<a class="nc-lo-btn ${extra}" data-lo="${key}" data-item-id="${id}" data-tooltip="${esc(text)}"><i class="fas ${ico}"></i><span>${esc(text)}</span></a>`;
  const modes = [];
  if (fightCtl(root, id, '.fire-checkbox[data-fire-mode="aimed"]')) modes.push(btn("aimed", "fa-crosshairs", "Aimed", modeOn(root, id, "aimed") ? "on" : ""));
  if (fightCtl(root, id, '.fire-checkbox[data-fire-mode="autofire"]')) modes.push(btn("autofire", "fa-burst", "Autofire", modeOn(root, id, "autofire") ? "on" : ""));
  if (fightCtl(root, id, '.fire-checkbox[data-fire-mode="suppressive"]')) modes.push(btn("suppressive", "fa-wind", "Suppress", modeOn(root, id, "suppressive") ? "on" : ""));
  const actions = [btn("attack", "fa-hand-fist", "Attack", "nc-lo-main-btn")];
  if (fightCtl(root, id, ".rollable[data-roll-type='damage']")) actions.push(btn("damage", "fa-droplet", "Damage"));
  if (ranged) {
    if (fightCtl(root, id, '[data-action="reload-ammo"]')) actions.push(btn("reload", "fa-rotate-right", "Reload", value === 0 ? "nc-lo-urgent" : ""));
    actions.push(btn("ammo", "fa-arrow-right-arrow-left", "Ammo"));
  }
  const ammoBlock = ranged
    ? `<div class="nc-lo-ammo">
          <div class="nc-lo-count"><b>${value}</b><span>/${max}</span></div>
          <small>${esc(ammoName)}</small>
          <small class="nc-lo-reserve" data-tooltip="Matching ammo in inventory">RES ${reserve}</small>
        </div>`
    : `<div class="nc-lo-ammo nc-lo-melee-tag"><i class="fas fa-infinity"></i><small>MELEE</small></div>`;
  return `<div class="nc-lo-slot nc-lo-${slot} ${state}" data-slot="${slot}" data-item-id="${id}">
      <div class="nc-lo-label"><i class="fas ${icon}"></i> ${label}
        <a class="nc-lo-x" data-lo="clear" data-tooltip="Unequip (back to Carried)"><i class="fas fa-xmark"></i></a></div>
      <div class="nc-lo-body">
        <div class="nc-lo-img nc-q-${esc(s.quality ?? "standard")}" data-lo="open" data-item-id="${id}"><img src="${esc(weapon.img)}" alt=""></div>
        <div class="nc-lo-info">
          <b class="nc-lo-name" data-lo="open" data-item-id="${id}">${esc(weapon.name)}</b>
          <div class="nc-lo-stats">
            <span><em>DMG</em>${esc(s.damage)}</span>
            <span><em>ROF</em>${esc(s.rof)}</span>
            <span data-tooltip="${atk.stat} + ${esc(s.weaponSkill)} + weapon mod"><em>ATK</em>+${atk.total}</span>
            ${s.handsReq ? `<span><em>HANDS</em>${esc(s.handsReq)}</span>` : ""}
          </div>
        </div>
        ${ammoBlock}
      </div>
      ${ranged ? bulletPips(value, max) : ""}
      ${state === "nc-lo-dry" ? '<div class="nc-lo-warn">EMPTY // RELOAD</div>' : state === "nc-lo-low" ? '<div class="nc-lo-warn">LOW AMMO</div>' : ""}
      <div class="nc-lo-btns">${actions.join("")}${modes.length ? `<span class="nc-lo-sep"></span>${modes.join("")}` : ""}</div>
    </div>`;
}

function armorRow(actor, loc, label) {
  const ext = actor.system.externalData?.[`currentArmor${loc[0].toUpperCase()}${loc.slice(1)}`] ?? {};
  const item = actor.items.get(ext.id);
  if (!item) return `<div class="nc-lo-arm nc-lo-arm-empty" data-loc="${loc}"><em>${label}</em><span class="nc-dim">— none —</span></div>`;
  const cur = num(ext.value);
  const max = Math.max(num(ext.max), 1);
  const pct = Math.round((cur / max) * 100);
  return `<div class="nc-lo-arm ${pct < 50 ? "nc-lo-arm-low" : ""}" data-loc="${loc}" data-item-id="${item.id}">
      <em>${label}</em>
      <span class="nc-lo-arm-name" data-lo="open" data-item-id="${item.id}">${esc(item.name)}</span>
      <div class="nc-lo-arm-bar"><i style="width:${pct}%"></i></div>
      <b>${cur}<small>/${num(ext.max)}</small></b>
      <a class="nc-lo-mini" data-lo="ablate" data-loc="${loc}" data-tooltip="${loc === "shield" ? "Damage shield −1" : "Ablate −1"}"><i class="fas fa-minus"></i></a>
      <a class="nc-lo-mini" data-lo="repair" data-loc="${loc}" data-tooltip="Repair +1 (Shift: full)"><i class="fas fa-wrench"></i></a>
      <a class="nc-lo-mini" data-lo="clear" data-slot="armor:${item.id}" data-tooltip="Take off"><i class="fas fa-xmark"></i></a>
    </div>`;
}

function quickSlot(item, idx) {
  if (!item) {
    return `<div class="nc-lo-q nc-lo-q-empty" data-slot="quick:${idx}"><span class="nc-lo-key">${idx + 1}</span><i class="fas fa-plus"></i></div>`;
  }
  const amount = Number.isFinite(item.system.amount) ? item.system.amount : null;
  const hint = item.type === "drug" ? "Use" : item.type === "weapon" ? "Attack" : "Open";
  return `<div class="nc-lo-q ${amount === 0 ? "nc-lo-q-out" : ""}" data-slot="quick:${idx}" data-item-id="${item.id}" data-tooltip="${esc(item.name)}<br>Click: ${hint} · Right-click: remove">
      <span class="nc-lo-key">${idx + 1}</span>
      <img src="${esc(item.img)}" alt="">
      ${amount !== null ? `<span class="nc-lo-q-amt">x${amount}</span>` : ""}
      <span class="nc-lo-q-name">${esc(item.name)}</span>
    </div>`;
}

function statusStrip(actor) {
  const d = actor.system.derivedStats ?? {};
  const hp = num(d.hp?.value);
  const hpMax = Math.max(num(d.hp?.max), 1);
  const hpPct = Math.round((hp / hpMax) * 100);
  const wound = d.currentWoundState ?? "notWounded";
  const woundLabel = game.i18n.localize(`CPR.global.woundState.${wound}`);
  let hands = "";
  if (typeof actor._getHands === "function" && typeof actor._getFreeHands === "function") {
    const total = actor._getHands();
    const used = total - actor._getFreeHands();
    hands = `<div class="nc-lo-st ${used > total ? "nc-lo-st-bad" : ""}"><em>HANDS</em><b>${used}/${total}</b></div>`;
  }
  const st = actor.system.stats ?? {};
  return `<div class="nc-lo-status">
      <div class="nc-lo-hp ${hpPct < 50 ? "nc-lo-hp-low" : ""}"><em>HP</em><div class="nc-lo-hpbar"><i style="width:${hpPct}%"></i></div><b>${hp}<small>/${hpMax}</small></b></div>
      <div class="nc-lo-st nc-lo-wound nc-w-${esc(wound)}"><em>STATUS</em><b>${esc(woundLabel)}</b></div>
      ${hands}
      <div class="nc-lo-st"><em>REF</em><b>${num(st.ref?.value)}</b></div>
      <div class="nc-lo-st"><em>DEX</em><b>${num(st.dex?.value)}</b></div>
      <div class="nc-lo-st"><em>LUCK</em><b>${num(st.luck?.value)}<small>/${num(st.luck?.max)}</small></b></div>
    </div>`;
}

function render(app, root) {
  const actor = app.actor;
  const tab = root.querySelector(".tab.gear-tab");
  if (!tab) return;
  tab.querySelector(":scope > .nc-loadout")?.remove();
  const lo = resolveLoadout(actor);
  const el = document.createElement("div");
  el.className = `nc-loadout${isCollapsed() ? " nc-lo-collapsed" : ""}`;
  el.innerHTML = `
    <div class="nc-lo-head"><span class="nc-lo-title"><i class="fas fa-crosshairs"></i> LOADOUT</span><span class="nc-lo-sub">// COMBAT READY</span><a class="nc-lo-fold" data-lo="fold" data-tooltip="Collapse / expand"><i class="fas fa-chevron-up"></i></a></div>
    ${statusStrip(actor)}
    <div class="nc-lo-weapons">
      ${WEAPON_SLOTS.map(([slot, label, icon]) => weaponCard(actor, root, slot, label, icon, lo[slot])).join("")}
    </div>
    <div class="nc-lo-lower">
      <div class="nc-lo-armor" data-slot="armor">
        <div class="nc-lo-label"><i class="fas fa-shield-halved"></i> ARMOR</div>
        ${armorRow(actor, "head", "HEAD")}${armorRow(actor, "body", "BODY")}${armorRow(actor, "shield", "SHIELD")}
      </div>
      <div class="nc-lo-quick">
        <div class="nc-lo-label"><i class="fas fa-bolt"></i> QUICK USE</div>
        <div class="nc-lo-qrow">${lo.quick.map((item, i) => quickSlot(item, i)).join("")}</div>
      </div>
    </div>`;
  tab.prepend(el);
  wire(app, el, root);
}

function proxyClick(root, id, selector) {
  const ctl = fightCtl(root, id, selector);
  if (ctl) {
    ctl.click();
    return true;
  }
  return false;
}

function wire(app, el, root) {
  const actor = app.actor;
  const editable = app.isEditable;
  el.addEventListener("click", async (event) => {
    const t = event.target.closest("[data-lo]");
    if (!t) {
      // Empty quick slot: hint
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const key = t.dataset.lo;
    const id = t.dataset.itemId ?? t.closest("[data-item-id]")?.dataset.itemId;
    switch (key) {
      case "fold": {
        const next = !el.classList.contains("nc-lo-collapsed");
        el.classList.toggle("nc-lo-collapsed", next);
        try {
          localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
        } catch (err) {
          /* ignore */
        }
        break;
      }
      case "open":
        actor.items.get(id)?.sheet.render(true);
        break;
      case "attack":
        if (!proxyClick(root, id, ".rollable[data-roll-type='attack']")) ui.notifications.warn("Equip the weapon first.");
        break;
      case "damage":
        proxyClick(root, id, ".rollable[data-roll-type='damage']");
        break;
      case "reload":
        proxyClick(root, id, '[data-action="reload-ammo"]');
        break;
      case "ammo":
        proxyClick(root, id, '[data-action="select-ammo"]');
        break;
      case "aimed":
      case "autofire":
      case "suppressive":
        proxyClick(root, id, `.fire-checkbox[data-fire-mode="${key}"]`);
        break;
      case "ablate":
        if (editable) await actor._ablateArmor(t.dataset.loc, 1);
        break;
      case "repair": {
        if (!editable) break;
        const loc = t.dataset.loc;
        const ext = actor.system.externalData?.[`currentArmor${loc[0].toUpperCase()}${loc.slice(1)}`] ?? {};
        const amount = event.shiftKey ? Math.max(num(ext.max) - num(ext.value), 0) : 1;
        if (amount > 0) await actor._ablateArmor(loc, -amount);
        break;
      }
      case "clear": {
        if (!editable) break;
        const slot = t.dataset.slot ?? t.closest("[data-slot]")?.dataset.slot;
        if (slot) await clearSlot(actor, slot);
        break;
      }
      default:
    }
  });

  // Quick-use slots
  el.querySelectorAll(".nc-lo-q[data-item-id]").forEach((q) => {
    q.addEventListener("click", async (event) => {
      event.preventDefault();
      const item = actor.items.get(q.dataset.itemId);
      if (!item) return;
      if (item.type === "drug" && typeof item.snort === "function") {
        if (num(item.system.amount) <= 0) {
          ui.notifications.warn(`${item.name}: none left.`);
          return;
        }
        await item.snort();
      } else if (item.type === "weapon" && proxyClick(root, item.id, ".rollable[data-roll-type='attack']")) {
        /* attacked */
      } else {
        item.sheet.render(true);
      }
    });
    q.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      if (editable) await clearSlot(actor, q.dataset.slot);
    });
  });

  if (!editable) return;
  // Drag & drop from the inventory grid / item list onto a slot.
  const targets = el.querySelectorAll(".nc-lo-slot, .nc-lo-q, .nc-lo-armor");
  targets.forEach((target) => {
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      target.classList.add("nc-lo-hover");
    });
    target.addEventListener("dragleave", (event) => {
      if (!target.contains(event.relatedTarget)) target.classList.remove("nc-lo-hover");
    });
    target.addEventListener("drop", async (event) => {
      target.classList.remove("nc-lo-hover");
      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch (err) {
        return;
      }
      if (data?.type !== "Item") return;
      // Resolve against this sheet's actor by id: for unlinked tokens the uuid can resolve to a
      // different Actor instance than app.actor, which made drops silently fail.
      const id = String(data.uuid ?? "").split(".").pop();
      const fromUuid = data.uuid ? fromUuidSync(data.uuid) : null;
      const sameActor = fromUuid?.parent?.id === actor.id || data.system?.actorId === actor.id;
      const item = sameActor ? actor.items.get(id) : null;
      if (!item) return; // items from elsewhere: let the sheet handle it
      event.preventDefault();
      event.stopPropagation();
      await assignToSlot(actor, target.dataset.slot, item);
    });
  });
}

export default function registerLoadout() {
  Hooks.on("renderActorSheet", (app, html) => {
    if (!isNightCity() || ncSetting("loadout") === false) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || !app.actor || app.actor.type !== "character") return;
    try {
      render(app, root);
    } catch (err) {
      console.error("CPR DM Bank | loadout", err);
    }
  });
}
