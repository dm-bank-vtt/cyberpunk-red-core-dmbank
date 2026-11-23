/**
 * DM Bank NET RUN: NET ARCHITECT — GM window to pick / build an architecture and launch a run.
 */
import { NC_SCOPE } from "../util.js";
import NetWindow from "./app-base.js";
import { DIFFICULTY, FLOOR_TYPES, ICE, ICE_ORDER, builtinPresets, generateArchitecture, makeFloor, makeIce, netarchItemToArch, presetToArch, rebuildFloor } from "./data.js";
import { equippedDeck, getState, interfaceRank, request } from "./engine.js";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const PRESETS_KEY = "nc.netPresets";

let draft = null;
let launchCfg = null;

function savedPresets() {
  try {
    return game.settings.get(NC_SCOPE, PRESETS_KEY) ?? [];
  } catch (err) {
    return [];
  }
}

function cloneArch(arch) {
  return { ...foundry.utils.deepClone(arch), floors: arch.floors.map((f) => rebuildFloor(f)) };
}

class NetArchitect extends NetWindow {
  static DEFAULT_OPTIONS = {
    id: "nc-net-architect",
    classes: ["nc-netwin", "nc-architect"],
    window: { title: "NET ARCHITECT", icon: "fas fa-sitemap", resizable: true },
    position: { width: 1060, height: 720 },
  };

  async buildHTML() {
    const S = getState();
    const live = S?.active;
    if (!draft) draft = live ? foundry.utils.deepClone(S.arch) : presetToArch(builtinPresets()[1]);
    if (!launchCfg) launchCfg = { actorId: "", controllers: null, opts: { dvHidden: true, gmConfirm: false, autoIce: false, showAll: true } };

    const lib = [
      ...builtinPresets().map((p) => `<a class="nca-lib" data-a="preset" data-id="${p.id}"><i class="fas fa-cube"></i><span>${esc(p.name)}</span><small>${DIFFICULTY[p.difficulty].label} · ${p.floors.length} FL</small></a>`),
      ...savedPresets().map((p) => `<a class="nca-lib saved ${draft.presetId === p.id ? "on" : ""}" data-a="saved" data-id="${p.id}"><i class="fas fa-floppy-disk"></i><span>${esc(p.name)}</span><small>SAVED · ${p.floors.length} FL</small><i class="fas fa-xmark nca-del" data-a="delPreset" data-id="${p.id}"></i></a>`),
      ...game.items.filter((i) => i.type === "netarch").map((i) => `<a class="nca-lib item" data-a="item" data-id="${i.id}"><i class="fas fa-network-wired"></i><span>${esc(i.name)}</span><small>WORLD ITEM</small></a>`),
    ].join("");

    const typeOpts = (cur) => Object.entries(FLOOR_TYPES).map(([k, t]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${t.label}</option>`).join("");
    const iceOpts = ICE_ORDER.map((k) => `<option value="${k}">${ICE[k].name}${ICE[k].custom ? " *" : ""}</option>`).join("");
    const floors = draft.floors
      .map((f, i) => {
        const t = FLOOR_TYPES[f.type] ?? FLOOR_TYPES.empty;
        const ice = (f.ice ?? [])
          .map((c, j) => `<span class="nca-ice"><i class="fas ${esc(c.icon || ICE[c.key]?.icon)}"></i>${esc(c.name)}<a data-a="rmIce" data-f="${i}" data-j="${j}"><i class="fas fa-xmark"></i></a></span>`)
          .join("");
        return `<div class="nca-floor nca-t-${f.type}">
            <div class="nca-fnum">${String(i + 1).padStart(2, "0")}<i class="fas ${t.icon}"></i></div>
            <div class="nca-fbody">
              <div class="nca-frow">
                <select data-f="${i}" data-k="type">${typeOpts(f.type)}</select>
                <input type="text" data-f="${i}" data-k="name" value="${esc(f.name)}" placeholder="Name (optional)">
                ${f.type === "ice" || f.type === "empty" ? "" : `<label>DV</label><input type="number" class="nca-dv" data-f="${i}" data-k="dv" value="${f.dv ?? ""}" min="0">`}
                <label class="nca-chk"><input type="checkbox" data-f="${i}" data-k="revealed" ${f.revealed ? "checked" : ""}> Known</label>
              </div>
              ${f.type === "ice" ? `<div class="nca-frow nca-icerow">${ice}<select data-addice="${i}"><option value="">+ Black ICE…</option>${iceOpts}</select></div>` : ""}
              <div class="nca-frow">
                <input type="text" class="nca-wide" data-f="${i}" data-k="desc" value="${esc(f.desc)}" placeholder="GM note (hidden from players)">
                ${f.type === "file" ? `<input type="text" class="nca-wide" data-f="${i}" data-k="info" value="${esc(f.info)}" placeholder="File content (shown after Eye-Dee)">` : ""}
              </div>
            </div>
            <div class="nca-fbtns">
              <a data-a="up" data-f="${i}" data-tooltip="Move up"><i class="fas fa-arrow-up"></i></a>
              <a data-a="down" data-f="${i}" data-tooltip="Move down"><i class="fas fa-arrow-down"></i></a>
              <a data-a="dup" data-f="${i}" data-tooltip="Duplicate"><i class="fas fa-clone"></i></a>
              <a data-a="del" data-f="${i}" data-tooltip="Delete"><i class="fas fa-trash"></i></a>
            </div>
          </div>`;
      })
      .join("");

    // Player characters first; NPCs only when they can actually run (Interface > 0 or a cyberdeck equipped).
    const byRank = (a, b) => interfaceRank(b) - interfaceRank(a) || a.name.localeCompare(b.name);
    const pool = game.actors.filter((a) => a.type === "character" || a.type === "mook");
    const playerRunners = pool.filter((a) => a.hasPlayerOwner).sort(byRank);
    const npcRunners = pool.filter((a) => !a.hasPlayerOwner && (interfaceRank(a) > 0 || equippedDeck(a))).sort(byRank);
    const runners = [...playerRunners, ...npcRunners];
    if (!runners.some((a) => a.id === launchCfg.actorId)) launchCfg.actorId = runners[0]?.id ?? "";
    const runnerOpt = (a) => `<option value="${a.id}" ${a.id === launchCfg.actorId ? "selected" : ""}>${esc(a.name)} — Interface ${interfaceRank(a)}</option>`;
    const runnerOpts =
      (playerRunners.length ? `<optgroup label="PLAYERS">${playerRunners.map(runnerOpt).join("")}</optgroup>` : "") +
      (npcRunners.length ? `<optgroup label="NPC NETRUNNERS">${npcRunners.map(runnerOpt).join("")}</optgroup>` : "");
    const runner = game.actors.get(launchCfg.actorId);
    const owners = game.users.filter((u) => !u.isGM && runner?.testUserPermission(u, "OWNER")).map((u) => u.id);
    const controllers = launchCfg.controllers ?? owners;
    const deck = equippedDeck(runner);
    const tg = (k, l) => `<a class="nca-tog ${launchCfg.opts[k] ? "on" : ""}" data-a="opt" data-k="${k}">${l}</a>`;

    return `<div class="nca">
        <aside class="nca-left">
          <div class="nca-h">LIBRARY</div>
          <div class="nca-libs" data-keep-scroll>${lib}</div>
          <div class="nca-h">RANDOM (CORE TABLES)</div>
          <div class="nca-gen">${Object.entries(DIFFICULTY).map(([k, d]) => `<a data-a="gen" data-d="${k}">${d.label}<small>DV ${d.dv}</small></a>`).join("")}</div>
        </aside>
        <section class="nca-mid">
          <div class="nca-head">
            <input type="text" class="nca-name" data-k="archName" value="${esc(draft.name)}">
            <label>ARCH DV</label><select data-k="archDv">${[6, 8, 10, 12, 14].map((v) => `<option value="${v}" ${Number(draft.dv) === v ? "selected" : ""}>${v}</option>`).join("")}</select>
            <a class="nca-save" data-a="savePreset" data-tooltip="${draft.presetId ? "Overwrite this saved architecture" : "Save to the library on the left"}"><i class="fas fa-floppy-disk"></i> ${draft.presetId ? "Save" : "Save to library"}</a>
            ${draft.presetId ? '<a class="nca-save ghost" data-a="saveNew" data-tooltip="Keep the old one and save a copy"><i class="fas fa-copy"></i> Save as new</a>' : ""}
          </div>
          <div class="nca-floors" data-keep-scroll>${floors || '<div class="nca-dim">No floors yet.</div>'}</div>
          <div class="nca-add">ADD FLOOR: ${Object.entries(FLOOR_TYPES).map(([k, t]) => `<a data-a="add" data-t="${k}"><i class="fas ${t.icon}"></i> ${t.label}</a>`).join("")}</div>
        </section>
        <aside class="nca-right">
          <div class="nca-h">NETRUNNER</div>
          <select data-k="actor">${runnerOpts}</select>
          <div class="nca-runner">${runner ? `<img src="${esc(runner.img)}" alt=""><div><b>${esc(runner.name)}</b><small>INTERFACE ${interfaceRank(runner)} · ${deck ? esc(deck.name) : '<span class="nca-warn">NO CYBERDECK</span>'}</small></div>` : ""}</div>
          <div class="nca-h">WHO CAN CONTROL</div>
          <div class="nca-users">${game.users.filter((u) => !u.isGM).map((u) => `<a class="nca-tog ${controllers.includes(u.id) ? "on" : ""}" data-a="user" data-id="${u.id}"><i class="fas fa-gamepad"></i> ${esc(u.name)}</a>`).join("") || '<span class="nca-dim">No players</span>'}</div>
          <div class="nca-h">OPTIONS</div>
          <div class="nca-opts">${tg("dvHidden", "Hide DV from players")}${tg("gmConfirm", "GM confirms every result")}${tg("autoIce", "Black ICE acts automatically")}${tg("showAll", "Everyone sees the run")}</div>
          <div class="nca-note"><i class="fas fa-circle-info"></i> If the runner is in a started combat, the run follows the turn order. Otherwise it is a free run.</div>
          <div class="nca-actions">
            ${live ? `<a class="nca-btn" data-a="apply"><i class="fas fa-rotate"></i> APPLY TO LIVE RUN</a>` : ""}
            <a class="nca-btn nca-go" data-a="launch"><i class="fas fa-plug"></i> ${live ? "RESTART RUN" : "JACK IN"}</a>
          </div>
        </aside>
      </div>`;
  }

  async onAction(a, el) {
    const i = Number(el.dataset.f);
    switch (a) {
      case "preset":
        draft = presetToArch(builtinPresets().find((p) => p.id === el.dataset.id));
        break;
      case "saved": {
        const src = savedPresets().find((p) => p.id === el.dataset.id);
        draft = cloneArch(src);
        draft.presetId = src.id;
        break;
      }
      case "delPreset": {
        const list = savedPresets().filter((p) => p.id !== el.dataset.id);
        await game.settings.set(NC_SCOPE, PRESETS_KEY, list);
        break;
      }
      case "item":
        draft = netarchItemToArch(game.items.get(el.dataset.id));
        break;
      case "gen":
        draft = await generateArchitecture(el.dataset.d);
        break;
      case "add":
        draft.floors.push(makeFloor(el.dataset.t, el.dataset.t === "ice" ? { ice: ["hellhound"] } : { dv: Number(draft.dv) || 6 }));
        break;
      case "up":
        if (i > 0) [draft.floors[i - 1], draft.floors[i]] = [draft.floors[i], draft.floors[i - 1]];
        break;
      case "down":
        if (i < draft.floors.length - 1) [draft.floors[i + 1], draft.floors[i]] = [draft.floors[i], draft.floors[i + 1]];
        break;
      case "dup":
        draft.floors.splice(i + 1, 0, rebuildFloor(draft.floors[i]));
        break;
      case "del":
        draft.floors.splice(i, 1);
        break;
      case "rmIce":
        draft.floors[i].ice.splice(Number(el.dataset.j), 1);
        break;
      case "opt":
        launchCfg.opts[el.dataset.k] = !launchCfg.opts[el.dataset.k];
        break;
      case "user": {
        const runner = game.actors.get(launchCfg.actorId);
        const base = launchCfg.controllers ?? game.users.filter((u) => !u.isGM && runner?.testUserPermission(u, "OWNER")).map((u) => u.id);
        const set = new Set(base);
        if (set.has(el.dataset.id)) set.delete(el.dataset.id);
        else set.add(el.dataset.id);
        launchCfg.controllers = [...set];
        break;
      }
      case "savePreset":
      case "saveNew": {
        const list = savedPresets();
        const copy = foundry.utils.deepClone(draft);
        // Saved copies start clean: nothing cracked, no ICE damage.
        for (const f of copy.floors) {
          f.cleared = false;
          f.visited = false;
          f.infoShown = false;
          for (const ice of f.ice ?? []) {
            ice.derezzed = false;
            ice.rez = ice.rezMax ?? ice.rez;
          }
        }
        const idx = a === "savePreset" && draft.presetId ? list.findIndex((p) => p.id === draft.presetId) : -1;
        if (idx >= 0) {
          copy.id = draft.presetId;
          list[idx] = copy;
        } else {
          copy.id = `user-${foundry.utils.randomID(8)}`;
          if (a === "saveNew") copy.name = `${copy.name} (copy)`;
          list.push(copy);
        }
        await game.settings.set(NC_SCOPE, PRESETS_KEY, list);
        draft.presetId = copy.id;
        if (a === "saveNew") draft.name = copy.name;
        ui.notifications.info(`NET ARCHITECT: saved "${copy.name}" to the library`);
        break;
      }
      case "apply":
        request("gm.arch", { arch: foundry.utils.deepClone(draft) });
        ui.notifications.info("NET ARCHITECT: live architecture updated");
        return;
      case "launch":
        return this.launch();
      default:
        return;
    }
    this.render();
  }

  async launch() {
    if (!draft.floors.length) {
      ui.notifications.warn("Add at least one floor.");
      return;
    }
    const runner = game.actors.get(launchCfg.actorId);
    if (!runner) {
      ui.notifications.warn("Pick a Netrunner.");
      return;
    }
    if (!equippedDeck(runner)) ui.notifications.warn(`${runner.name} has no cyberdeck — programs won't be available.`);
    const controllers = launchCfg.controllers ?? game.users.filter((u) => !u.isGM && runner.testUserPermission(u, "OWNER")).map((u) => u.id);
    const arch = cloneArch(draft);
    ui.notifications.info(`NET RUN: jacking ${runner.name} into ${arch.name}...`);
    const before = getState()?.sid;
    request("gm.launch", { arch, actorId: runner.id, controllers, opts: { ...launchCfg.opts } });
    this.close();
    setTimeout(() => {
      const S = getState();
      if (!S?.active || S.sid === before) {
        const gmName = game.users.activeGM?.name ?? "none";
        ui.notifications.error(`NET RUN: the run did not start. Active GM client: ${gmName}. Refresh (F5) every GM window and try again.`, { permanent: true });
      }
    }, 4000);
  }

  onInput(t) {
    if (t.dataset.addice !== undefined) {
      if (!t.value) return;
      const f = draft.floors[Number(t.dataset.addice)];
      f.ice = [...(f.ice ?? []), makeIce(t.value)];
      this.render();
      return;
    }
    const k = t.dataset.k;
    if (!k) return;
    if (k === "archName") draft.name = t.value;
    else if (k === "archDv") draft.dv = Number(t.value);
    else if (k === "actor") {
      launchCfg.actorId = t.value;
      launchCfg.controllers = null;
      this.render();
    } else if (t.dataset.f !== undefined) {
      const f = draft.floors[Number(t.dataset.f)];
      if (k === "revealed") f.revealed = t.checked;
      else if (k === "dv") f.dv = t.value === "" ? null : Number(t.value);
      else if (k === "type") {
        f.type = t.value;
        if (t.value === "ice" && !(f.ice ?? []).length) f.ice = [makeIce("hellhound")];
        if (["password", "file", "control"].includes(t.value) && !f.dv) f.dv = Number(draft.dv) || 6;
        this.render();
      } else f[k] = t.value;
    }
  }
}

let app = null;
export function openArchitect({ fresh = false } = {}) {
  if (!game.user.isGM) return;
  if (fresh) draft = null;
  const S = getState();
  if (S?.active && !app?.rendered) draft = foundry.utils.deepClone(S.arch);
  app ??= new NetArchitect();
  app.render({ force: true });
}
