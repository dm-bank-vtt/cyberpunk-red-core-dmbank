/**
 * DM Bank NET RUN: NET DECK — card-style cyberdeck builder + program shop.
 */
import { NC_SCOPE } from "../util.js";
import NetWindow from "./app-base.js";
import { equippedDeck, request } from "./engine.js";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const SHOP_KEY = "nc.netShop";
const QUALITY_SLOTS = { poor: 5, standard: 7, excellent: 9 };
const CLASS_LABEL = {
  antipersonnelattacker: ["ANTI-PERSONNEL", "atk"],
  antiprogramattacker: ["ANTI-PROGRAM", "atk"],
  booster: ["BOOSTER", "boost"],
  defender: ["DEFENDER", "def"],
  blackice: ["BLACK ICE", "ice"],
};

export function shopConfig() {
  try {
    return { open: false, discount: 0, hidden: [], ...(game.settings.get(NC_SCOPE, SHOP_KEY) ?? {}) };
  } catch (err) {
    return { open: false, discount: 0, hidden: [] };
  }
}

let catalogCache = null;
export async function shopCatalog() {
  if (catalogCache) return catalogCache;
  const out = [];
  const add = async (packId, filter, group) => {
    const pack = game.packs.get(packId);
    if (!pack) return;
    const docs = await pack.getDocuments();
    for (const d of docs.filter(filter)) {
      out.push({ uuid: d.uuid, name: d.name, img: d.img, type: d.type, group, price: Number(d.system.price?.market ?? 0), doc: d });
    }
  };
  await add("cyberpunk-red-core-dmbank.core_programs", () => true, "programs");
  await add("cyberpunk-red-core-dmbank.core_upgrades", (d) => d.system.type === "cyberdeck", "hardware");
  await add("cyberpunk-red-core-dmbank.core_gear", (d) => d.type === "cyberdeck", "decks");
  out.sort((a, b) => a.group.localeCompare(b.group) || a.price - b.price || a.name.localeCompare(b.name));
  catalogCache = out;
  return out;
}

const plain = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function cardHtml(item, { foot = "", dim = false, price = null } = {}) {
  const s = item.system ?? {};
  const [label, tone] = item.type === "program" ? CLASS_LABEL[s.class] ?? ["PROGRAM", "boost"] : item.type === "cyberdeck" ? ["CYBERDECK", "deck"] : ["HARDWARE", "hw"];
  const stats =
    item.type === "program"
      ? `<div class="ncd-stats"><span>ATK<b>${s.atk ?? 0}</b></span><span>DEF<b>${s.def ?? 0}</b></span><span>REZ<b>${s.rez?.max ?? 0}</b></span>${String(s.class).includes("attacker") ? `<span>DMG<b>${esc(s.damage?.blackIce || s.damage?.standard || "-")}</b></span>` : ""}</div>`
      : item.type === "cyberdeck"
        ? `<div class="ncd-stats"><span>SLOTS<b>${s.installedItems?.slots ?? "?"}</b></span><span>QUALITY<b>${esc(String(s.quality ?? "").toUpperCase())}</b></span></div>`
        : `<div class="ncd-stats"><span>SLOTS<b>${s.size ?? 1}</b></span></div>`;
  return `<div class="ncd-card ncd-${tone} ${dim ? "dim" : ""} ${s.isRezzed ? "rezzed" : ""}">
      <div class="ncd-band">${label}${s.size > 1 ? `<em>${s.size} SLOTS</em>` : ""}</div>
      <div class="ncd-art"><img src="${esc(item.img)}" alt=""></div>
      <div class="ncd-name">${esc(item.name)}</div>
      ${stats}
      <div class="ncd-text">${esc(plain(s.description?.value).slice(0, 170))}</div>
      ${price !== null ? `<div class="ncd-price">${price} eb</div>` : ""}
      <div class="ncd-foot">${foot}</div>
    </div>`;
}

class NetDeck extends NetWindow {
  static DEFAULT_OPTIONS = {
    classes: ["nc-netwin", "nc-netdeck"],
    window: { title: "NET DECK", icon: "fas fa-layer-group", resizable: true },
    position: { width: 980, height: 720 },
  };

  constructor(actor, options = {}) {
    super({ ...options, id: `nc-net-deck-${actor.id}` });
    this.actor = actor;
    this.tab = "deck";
    this.shopGroup = "programs";
  }

  get title() {
    return `NET DECK // ${this.actor.name}`;
  }

  async buildHTML() {
    const actor = this.actor;
    const gm = game.user.isGM;
    const tabs = `<nav class="ncd-tabs">
        <a class="${this.tab === "deck" ? "on" : ""}" data-a="tab" data-t="deck"><i class="fas fa-layer-group"></i> MY DECK</a>
        <a class="${this.tab === "shop" ? "on" : ""}" data-a="tab" data-t="shop"><i class="fas fa-store"></i> NET MARKET ${shopConfig().open ? '<b class="ncd-open">OPEN</b>' : '<b class="ncd-closed">CLOSED</b>'}</a>
        <span class="ncd-eb"><i class="fas fa-coins"></i> ${actor.system.wealth?.value ?? 0} eb</span>
      </nav>`;
    return `<div class="ncd">${tabs}${this.tab === "deck" ? this.deckHtml(actor, gm) : await this.shopHtml(actor, gm)}</div>`;
  }

  deckHtml(actor, gm) {
    const decks = actor.itemTypes.cyberdeck ?? [];
    const deck = equippedDeck(actor);
    if (!deck) {
      return `<div class="ncd-nodeck"><i class="fas fa-microchip"></i><b>NO CYBERDECK</b><p>A Netrunner needs a cyberdeck to carry programs.</p>
          ${gm ? '<div class="ncd-row"><a class="ncd-btn" data-a="giveDeck" data-q="poor">GIVE POOR (5)</a><a class="ncd-btn" data-a="giveDeck" data-q="standard">GIVE STANDARD (7)</a><a class="ncd-btn" data-a="giveDeck" data-q="excellent">GIVE EXCELLENT (9)</a></div>' : '<a class="ncd-btn" data-a="tab" data-t="shop">VISIT THE NET MARKET</a>'}
        </div>`;
    }
    const inst = deck.system.installedItems ?? { list: [], slots: 7, usedSlots: 0 };
    const installed = inst.list.map((id) => actor.items.get(id)).filter(Boolean);
    const used = installed.reduce((s, i) => s + Number(i.system.size ?? 1), 0);
    const free = Number(inst.slots) - used;
    let segs = "";
    for (let i = 0; i < inst.slots; i++) segs += `<i class="${i < used ? "on" : ""}"></i>`;
    const loose = actor.items.filter((i) => (i.type === "program" || (i.type === "itemUpgrade" && i.system.type === "cyberdeck")) && !i.system.isInstalled);
    const editable = actor.isOwner;
    const q = String(deck.system.quality ?? "standard");
    return `<div class="ncd-deckhead">
        <div class="ncd-deckimg"><img src="${esc(deck.img)}" alt=""></div>
        <div class="ncd-deckinfo">
          <b>${esc(deck.name)}</b>
          <div class="ncd-quality">${Object.entries(QUALITY_SLOTS).map(([k, n]) => `<a class="${q === k ? "on" : ""}" ${gm ? `data-a="quality" data-q="${k}"` : "disabled"} data-tooltip="${gm ? "GM: set quality" : "Quality"}">${k.toUpperCase()} · ${n}</a>`).join("")}</div>
          <div class="ncd-slots"><label>SLOTS</label><div class="ncd-seg">${segs}</div><b>${used}/${inst.slots}</b></div>
        </div>
        ${decks.length > 1 ? `<select class="ncd-decksel" data-k="deck">${decks.map((d) => `<option value="${d.id}" ${d.id === deck.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>` : ""}
      </div>
      <div class="ncd-sec">INSTALLED <small>${installed.length} CARD(S)</small></div>
      <div class="ncd-grid" data-keep-scroll>${installed.map((i) => cardHtml(i, { foot: editable ? `<a class="ncd-btn ncd-btn-ghost" data-a="eject" data-id="${i.id}"><i class="fas fa-eject"></i> EJECT</a>` : "" })).join("") || '<div class="ncd-dim">Empty deck.</div>'}</div>
      <div class="ncd-sec">IN YOUR BAG <small>${loose.length} CARD(S)</small></div>
      <div class="ncd-grid">${loose
        .map((i) => {
          const fits = Number(i.system.size ?? 1) <= free;
          return cardHtml(i, { dim: !fits, foot: editable ? `<a class="ncd-btn" data-a="install" data-id="${i.id}" ${fits ? "" : "disabled"}><i class="fas fa-download"></i> ${fits ? "INSTALL" : "NO SLOT"}</a>` : "" });
        })
        .join("") || '<div class="ncd-dim">No spare programs. Buy some in the NET MARKET.</div>'}</div>`;
  }

  async shopHtml(actor, gm) {
    const cfg = shopConfig();
    if (!cfg.open && !gm) return '<div class="ncd-nodeck"><i class="fas fa-store-slash"></i><b>NET MARKET OFFLINE</b><p>Your fixer hasn\'t opened shop yet.</p></div>';
    const cat = await shopCatalog();
    const groups = [["programs", "PROGRAMS"], ["hardware", "DECK HARDWARE"], ["decks", "CYBERDECKS"]];
    const shown = cat.filter((c) => c.group === this.shopGroup && (gm || !cfg.hidden.includes(c.uuid)));
    const price = (p) => Math.max(0, Math.round(p * (1 - (Number(cfg.discount) || 0) / 100)));
    const eb = Number(actor.system.wealth?.value ?? 0);
    const gmBar = gm
      ? `<div class="ncd-gmbar">
          <a class="ncd-tog ${cfg.open ? "on" : ""}" data-a="shopOpen"><i class="fas fa-power-off"></i> SHOP ${cfg.open ? "OPEN" : "CLOSED"}</a>
          <label>DISCOUNT %</label><input type="number" data-k="discount" value="${cfg.discount}" min="-200" max="100">
          <span class="ncd-dim">Eye = shown to players. GIVE = free to ${esc(actor.name)}.</span>
        </div>`
      : "";
    return `${gmBar}
      <nav class="ncd-sub">${groups.map(([k, l]) => `<a class="${this.shopGroup === k ? "on" : ""}" data-a="group" data-g="${k}">${l}</a>`).join("")}</nav>
      <div class="ncd-grid ncd-shop" data-keep-scroll>${shown
        .map((c) => {
          const p = price(c.price);
          const hidden = cfg.hidden.includes(c.uuid);
          const foot = `${actor.isOwner && cfg.open ? `<a class="ncd-btn" data-a="buy" data-uuid="${c.uuid}" ${eb >= p ? "" : "disabled"}><i class="fas fa-cart-shopping"></i> BUY</a>` : ""}${gm ? `<a class="ncd-btn ncd-btn-ghost" data-a="give" data-uuid="${c.uuid}"><i class="fas fa-gift"></i> GIVE</a><a class="ncd-btn ncd-btn-ghost ${hidden ? "" : "on"}" data-a="hide" data-uuid="${c.uuid}"><i class="fas ${hidden ? "fa-eye-slash" : "fa-eye"}"></i></a>` : ""}`;
          return cardHtml(c.doc, { price: p, foot, dim: hidden });
        })
        .join("")}</div>`;
  }

  async onAction(a, el) {
    const actor = this.actor;
    const deck = equippedDeck(actor);
    switch (a) {
      case "tab":
        this.tab = el.dataset.t;
        break;
      case "group":
        this.shopGroup = el.dataset.g;
        break;
      case "install": {
        const item = actor.items.get(el.dataset.id);
        if (item && deck) await deck.installItems([item]);
        break;
      }
      case "eject": {
        const item = actor.items.get(el.dataset.id);
        if (item && deck) await deck.uninstallItems([item]);
        break;
      }
      case "quality": {
        if (!game.user.isGM || !deck) return;
        const q = el.dataset.q;
        const used = deck.system.installedItems?.usedSlots ?? 0;
        if (QUALITY_SLOTS[q] < used) {
          ui.notifications.warn("Eject some cards first — they wouldn't fit.");
          return;
        }
        await deck.update({ "system.quality": q, "system.installedItems.slots": QUALITY_SLOTS[q] });
        break;
      }
      case "giveDeck": {
        const cat = await shopCatalog();
        const want = { poor: "Cyberdeck (Poor)", standard: "Cyberdeck", excellent: "Cyberdeck (Excellent)" }[el.dataset.q];
        const entry = cat.find((c) => c.name === want);
        if (entry) await giveItem(actor, entry.uuid, { equip: true });
        break;
      }
      case "give":
        await giveItem(actor, el.dataset.uuid);
        ui.notifications.info("Given.");
        break;
      case "buy":
        request("shop.buy", { actorId: actor.id, uuid: el.dataset.uuid });
        break;
      case "hide": {
        const cfg = shopConfig();
        const set = new Set(cfg.hidden);
        if (set.has(el.dataset.uuid)) set.delete(el.dataset.uuid);
        else set.add(el.dataset.uuid);
        await game.settings.set(NC_SCOPE, SHOP_KEY, { ...cfg, hidden: [...set] });
        break;
      }
      case "shopOpen": {
        const cfg = shopConfig();
        await game.settings.set(NC_SCOPE, SHOP_KEY, { ...cfg, open: !cfg.open });
        break;
      }
      default:
        return;
    }
    this.render();
  }

  async onInput(t) {
    if (t.dataset.k === "deck") {
      for (const d of this.actor.itemTypes.cyberdeck) {
        const want = d.id === t.value ? "equipped" : "carried";
        if (d.system.equipped !== want) await d.update({ "system.equipped": want });
      }
      this.render();
    } else if (t.dataset.k === "discount" && game.user.isGM) {
      await game.settings.set(NC_SCOPE, SHOP_KEY, { ...shopConfig(), discount: Number(t.value) || 0 });
      this.render();
    }
  }
}

export async function giveItem(actor, uuid, { equip = false } = {}) {
  const src = await fromUuid(uuid);
  if (!src) return null;
  const data = src.toObject();
  delete data._id;
  if (equip && "equipped" in (data.system ?? {})) data.system.equipped = "equipped";
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/** GM side of a purchase (called by the engine). */
export async function processPurchase(userId, { actorId, uuid }) {
  const user = game.users.get(userId);
  const actor = game.actors.get(actorId);
  if (!user || !actor || !actor.testUserPermission(user, "OWNER")) return;
  const cfg = shopConfig();
  if (!cfg.open || cfg.hidden.includes(uuid)) return;
  const entry = (await shopCatalog()).find((c) => c.uuid === uuid);
  if (!entry) return;
  const price = Math.max(0, Math.round(entry.price * (1 - (Number(cfg.discount) || 0) / 100)));
  const eb = Number(actor.system.wealth?.value ?? 0);
  if (eb < price) return;
  await actor.deltaLedgerProperty("wealth", -price, `NET MARKET: ${entry.name}`);
  await giveItem(actor, uuid);
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="nc-net-card"><b><i class="fas fa-cart-shopping"></i> NET MARKET</b><span>${esc(actor.name)} bought <b>${esc(entry.name)}</b> for ${price} eb</span></div>`,
  });
}

const open = new Map();
export function openNetDeck(actor) {
  if (!actor) {
    ui.notifications.warn("No actor.");
    return;
  }
  let app = open.get(actor.id);
  if (!app) {
    app = new NetDeck(actor);
    open.set(actor.id, app);
  }
  app.render({ force: true });
}

export function refreshDecks(actor) {
  for (const [id, app] of open) if (app.rendered && (!actor || id === actor.id)) app.render();
}
