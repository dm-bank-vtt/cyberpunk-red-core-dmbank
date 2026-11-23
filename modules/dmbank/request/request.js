/**
 * DM Bank: ROLL REQUEST — the GM calls for a skill or stat check from one or more characters.
 * Panel docked on the left (Token controls button, Alt+R). Everyone sees the hologram roll screen;
 * each player clicks their own die, the GM can roll for anyone, reveal a hidden DV, or end it.
 * Socket namespace "ncreq". Results go to chat (whispered to the GM while the DV is hidden).
 */
import { NC_SCOPE } from "../util.js";
import { T } from "../net/i18n.js";
import { HoloDie } from "../dice/holo-dice.js";
import { countUp, fillMeter, meterHtml, modsHtml, reactorHtml, sumParts, titleHtml } from "../dice/holo-ui.js";
import { applyChatMode, controllersOf } from "../combat/duel.js";

const NS = "ncreq";
const sock = () => `system.${game.system.id}`;
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX = 8;
const STATS = ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"];
export const TIERS = [
  ["simple", 9, "Simple"],
  ["everyday", 13, "Everyday"],
  ["difficult", 15, "Difficult"],
  ["professional", 17, "Professional"],
  ["heroic", 21, "Heroic"],
  ["incredible", 24, "Incredible"],
  ["legendary", 29, "Legendary"],
];
const LINES = {
  simple: "Easy money. Don't trip on the way out.",
  everyday: "Routine gig. You've done this a hundred times, choom.",
  difficult: "This one's got teeth. Focus.",
  professional: "Pros only. Somebody's watching.",
  heroic: "Legends get made on nights like this.",
  incredible: "The odds are garbage. Roll anyway.",
  legendary: "Nobody's pulled this off. Yet.",
};

const R = { panel: null, cfg: null, req: null, secret: null, view: null };

function emit(msg) {
  game.socket.emit(sock(), { ns: NS, ...msg });
  onMessage({ ns: NS, ...msg });
}

/* ------------------------------------------------------------------ */
/* Candidates & roll specs                                             */
/* ------------------------------------------------------------------ */
function candidates(includeScene) {
  const list = [];
  const seen = new Set();
  const owned = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
  for (const a of owned.length ? owned : game.actors.filter((a) => a.type === "character")) {
    list.push({ key: a.uuid, actor: a, label: a.name, who: game.users.find((u) => !u.isGM && a.testUserPermission(u, "OWNER"))?.name ?? "GM" });
    seen.add(a.id);
  }
  if (includeScene && canvas?.scene) {
    for (const t of canvas.scene.tokens) {
      const a = t.actor;
      if (!a || (t.actorLink && seen.has(a.id))) continue;
      list.push({ key: a.uuid, actor: a, label: t.name, who: T("On scene"), token: true });
    }
  }
  return list;
}

function skillNames(actors) {
  const names = new Set();
  for (const a of actors) for (const i of a.items) if (i.type === "skill") names.add(i.name);
  return [...names].sort((x, y) => x.localeCompare(y));
}

function statLabel(k) {
  return k.toUpperCase();
}

function buildParts(actor, type, key, bonus) {
  const parts = [];
  if (type === "stat") {
    parts.push([statLabel(key), Number(actor.system.stats?.[key]?.value) || 0]);
  } else {
    const item = actor.items.find((i) => i.type === "skill" && i.name === key);
    const stat = item?.system?.stat ?? "int";
    parts.push([statLabel(stat), Number(actor.system.stats?.[stat]?.value) || 0]);
    let lvl = 0;
    try {
      lvl = Number(actor.getSkillLevel?.(key)) || Number(item?.system?.level) || 0;
    } catch (err) {
      lvl = Number(item?.system?.level) || 0;
    }
    parts.push([key, lvl]);
  }
  if (bonus) parts.push([T("Bonus"), Number(bonus)]);
  return parts;
}

/* ------------------------------------------------------------------ */
/* GM panel                                                            */
/* ------------------------------------------------------------------ */
function loadCfg() {
  let saved = {};
  try {
    saved = game.settings.get(NC_SCOPE, "nc.reqLast") ?? {};
  } catch (err) {
    saved = {};
  }
  return { mode: "same", type: "skill", key: "Perception", tier: "everyday", dv: 13, hideDv: false, scene: false, rows: {}, ...saved, rows: {} };
}

function persist() {
  const { mode, type, key, tier, dv, hideDv, scene } = R.cfg;
  game.settings.set(NC_SCOPE, "nc.reqLast", { mode, type, key, tier, dv, hideDv, scene }).catch(() => {});
}

export function openRequestPanel() {
  if (!game.user.isGM) return;
  if (R.panel) {
    R.panel.remove();
    R.panel = null;
    return;
  }
  R.cfg = loadCfg();
  R.cands = candidates(R.cfg.scene);
  R.cands.slice(0, MAX).forEach((c) => (R.cfg.rows[c.key] = { on: !c.token }));
  const el = document.createElement("div");
  el.id = "dmb-req-panel";
  document.body.append(el);
  R.panel = el;
  el.addEventListener("click", onPanelClick);
  el.addEventListener("change", onPanelChange);
  el.addEventListener("pointerdown", onDragStart);
  const ctrls = document.getElementById("scene-controls")?.getBoundingClientRect();
  el.style.left = `${(ctrls?.right ?? 60) + 14}px`;
  el.style.top = "140px";
  renderPanel();
}

function specFor(c) {
  const s = R.cfg;
  const r = s.rows[c.key] ?? {};
  const each = s.mode === "each";
  const type = each ? r.type ?? s.type : s.type;
  let key = each ? r.key ?? s.key : s.key;
  if (type === "stat" && !STATS.includes(key)) key = "ref";
  if (type === "skill" && !c.actor.items.some((i) => i.type === "skill" && i.name === key)) key = skillNames([c.actor])[0] ?? key;
  const dv = each && Number.isFinite(r.dv) ? r.dv : s.dv;
  return { type, key, dv, bonus: Number(r.bonus) || 0 };
}

function renderPanel() {
  const el = R.panel;
  if (!el) return;
  const s = R.cfg;
  const scroll = el.querySelector(".rq-list")?.scrollTop ?? 0;
  const sel = R.cands.filter((c) => s.rows[c.key]?.on);
  const actors = (sel.length ? sel : R.cands).map((c) => c.actor);
  const skills = skillNames(actors);
  if (s.type === "skill" && !skills.includes(s.key)) s.key = skills.includes("Perception") ? "Perception" : skills[0] ?? "";
  if (s.type === "stat" && !STATS.includes(s.key)) s.key = "ref";
  const keyOpts = (type, cur, list = skills) => (type === "stat" ? STATS.map((k) => `<option value="${k}" ${k === cur ? "selected" : ""}>${statLabel(k)}</option>`) : list.map((k) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(k)}</option>`)).join("");
  const seg = (name, list, cur) => list.map(([v, l, tip]) => `<a class="${String(v) === String(cur) ? "on" : ""}" data-set="${name}" data-val="${esc(v)}" ${tip ? `data-tooltip="${esc(tip)}"` : ""}>${esc(l)}</a>`).join("");
  const each = s.mode === "each";
  const rows = R.cands
    .map((c) => {
      const r = s.rows[c.key] ?? {};
      const sp = specFor(c);
      const mod = r.on ? sumParts(buildParts(c.actor, sp.type, sp.key, sp.bonus)) : null;
      return `<div class="rq-row ${r.on ? "on" : ""}">
          <a class="rq-check" data-row="${esc(c.key)}" data-toggle="on"></a>
          <img src="${esc(c.actor.img)}" alt="">
          <div class="rq-who"><b>${esc(c.label)}</b><small>${esc(c.who)}</small></div>
          ${r.on ? `<span class="rq-mod">${mod >= 0 ? "+" : "−"}${Math.abs(mod)}</span><label class="rq-mini">±<input type="number" data-row="${esc(c.key)}" data-rset="bonus" value="${sp.bonus}" min="-20" max="20"></label>` : ""}
          ${
            each && r.on
              ? `<div class="rq-rowspec">
              <select data-row="${esc(c.key)}" data-rset="type"><option value="skill" ${sp.type === "skill" ? "selected" : ""}>${esc(T("Skill"))}</option><option value="stat" ${sp.type === "stat" ? "selected" : ""}>${esc(T("Stat"))}</option></select>
              <select data-row="${esc(c.key)}" data-rset="key">${keyOpts(sp.type, sp.key, skillNames([c.actor]))}</select>
              <label class="rq-mini">DV<input type="number" data-row="${esc(c.key)}" data-rset="dv" value="${sp.dv}" min="1" max="40"></label>
            </div>`
              : ""
          }
        </div>`;
    })
    .join("");
  const count = sel.length;
  const why = !count ? T("Pick at least one character.") : count > MAX ? T("Up to 8 characters.") : "";
  el.innerHTML = `
    <div class="rq-head" data-drag><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L21 7 V17 L12 22 L3 17 V7 Z"/><path class="k" d="M12 6 L17 9 V15 L12 18 L7 15 V9 Z"/></svg><b>${esc(T("Roll request"))}</b><a class="rq-x" data-close><i class="fas fa-xmark"></i></a></div>
    <div class="rq-body">
      <div class="rq-seg wide">${seg("mode", [["same", T("Everyone rolls the same")], ["each", T("Different roll each")]], s.mode)}</div>
      ${
        each
          ? `<p class="rq-hint">${esc(T("Set each character's roll in the list. The difficulty here is the default."))}</p>`
          : `<div class="rq-field"><label>${esc(T("Roll"))}</label><div class="rq-seg">${seg("type", [["skill", T("Skill")], ["stat", T("Stat")]], s.type)}</div></div>
             <div class="rq-field"><select data-set="key">${keyOpts(s.type, s.key)}</select></div>`
      }
      <div class="rq-field"><label>${esc(T("Difficulty"))}</label><div class="rq-tiers">${seg("tier", TIERS.map(([k, dv, l]) => [k, `${dv}`, T(l)]), s.tier)}</div></div>
      <div class="rq-field rq-dvrow">
        <label class="rq-dv">DV<input type="number" data-set="dv" value="${s.dv}" min="1" max="40"></label>
        <a class="rq-switch ${s.hideDv ? "on" : ""}" data-set="hideDv" data-val="${s.hideDv ? "" : "1"}"><i></i>${esc(T("Hide DV from players"))}</a>
      </div>
      <div class="rq-listhead"><span>${esc(T("Who rolls"))}</span><span class="${count > MAX ? "err" : ""}">${count} / ${MAX}</span>
        <a data-all="1">${esc(T("All"))}</a><a data-all="">${esc(T("None"))}</a>
        <a class="rq-switch sm ${s.scene ? "on" : ""}" data-set="scene" data-val="${s.scene ? "" : "1"}"><i></i>${esc(T("Scene tokens"))}</a></div>
      <div class="rq-list">${rows || `<p class="rq-hint">${esc(T("No characters found."))}</p>`}</div>
    </div>
    <div class="rq-foot"><span class="rq-why">${esc(why)}</span><a class="rq-go ${why ? "off" : ""}" data-go>${esc(T("Call the roll"))}</a></div>`;
  const list = el.querySelector(".rq-list");
  if (list) list.scrollTop = scroll;
}

function onPanelClick(ev) {
  const t = ev.target.closest("a");
  if (!t) return;
  const s = R.cfg;
  const d = t.dataset;
  if ("close" in d) {
    R.panel.remove();
    R.panel = null;
    return;
  }
  if ("go" in d) return startRequest();
  if ("all" in d) {
    let n = 0;
    for (const c of R.cands) (s.rows[c.key] ??= {}).on = !!d.all && n++ < MAX;
    return renderPanel();
  }
  if (d.toggle) {
    const r = (s.rows[d.row] ??= {});
    r.on = !r.on;
    return renderPanel();
  }
  if (d.set) {
    if (d.set === "tier") {
      s.tier = d.val;
      s.dv = TIERS.find((x) => x[0] === d.val)?.[1] ?? s.dv;
    } else if (d.set === "hideDv") s.hideDv = !!d.val;
    else if (d.set === "scene") {
      s.scene = !!d.val;
      R.cands = candidates(s.scene);
    } else s[d.set] = d.val;
    persist();
    renderPanel();
  }
}

function onPanelChange(ev) {
  const t = ev.target;
  const d = t.dataset;
  const s = R.cfg;
  if (d.rset) {
    const r = (s.rows[d.row] ??= {});
    if (d.rset === "dv" || d.rset === "bonus") {
      const v = parseInt(t.value, 10);
      r[d.rset] = Number.isFinite(v) ? v : undefined;
    } else {
      if (d.rset === "type") delete r.key;
      r[d.rset] = t.value;
    }
  } else if (d.set === "dv") {
    const v = parseInt(t.value, 10);
    if (Number.isFinite(v)) {
      s.dv = Math.max(1, Math.min(40, v));
      s.tier = TIERS.find((x) => x[1] === s.dv)?.[0] ?? "";
    }
  } else if (d.set) s[d.set] = t.value;
  else return;
  persist();
  renderPanel();
}

function onDragStart(ev) {
  const el = R.panel;
  if (!ev.target.closest("[data-drag]") || ev.target.closest("a")) return;
  const r = el.getBoundingClientRect();
  const ox = ev.clientX - r.left;
  const oy = ev.clientY - r.top;
  const move = (e) => {
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - ox))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy))}px`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  ev.preventDefault();
}

function startRequest() {
  const s = R.cfg;
  const sel = R.cands.filter((c) => s.rows[c.key]?.on).slice(0, MAX);
  if (!sel.length) return;
  const secret = {};
  const players = sel.map((c, i) => {
    const sp = specFor(c);
    secret[c.key] = sp.dv;
    return {
      key: c.key,
      name: c.label,
      img: c.actor.img,
      userIds: controllersOf(c.actor),
      title: sp.type === "stat" ? `${statLabel(sp.key)} ${T("check")}` : `${sp.key} ${T("check")}`,
      parts: buildParts(c.actor, sp.type, sp.key, sp.bonus),
      dv: s.hideDv ? null : sp.dv,
      tone: i % 2 ? "cyan" : "cyan",
    };
  });
  const titles = new Set(players.map((p) => p.title));
  const tierName = TIERS.find((x) => x[0] === s.tier)?.[2];
  const req = {
    id: foundry.utils.randomID(10),
    title: titles.size === 1 ? players[0].title : T("Roll request"),
    line: LINES[s.tier] ? T(LINES[s.tier]) : "",
    tier: tierName ? T(tierName) : "",
    hideDv: !!s.hideDv,
    players,
    owner: game.user.id,
  };
  R.panel?.remove();
  R.panel = null;
  R.secret = secret;
  emit({ t: "start", req });
}

/* ------------------------------------------------------------------ */
/* Roll screen                                                         */
/* ------------------------------------------------------------------ */
function canRoll(p) {
  return game.user.isGM || (p.userIds ?? []).includes(game.user.id);
}

function dvFor(p) {
  if (p.dv != null) return p.dv;
  if (game.user.isGM && R.secret?.[p.key] != null) return R.secret[p.key];
  return null;
}

function sideHtml(p, i) {
  const dv = dvFor(p);
  const mine = canRoll(p);
  return `<div class="dd-side ${p.tone ?? "cyan"}" data-side="${i}">
      ${reactorHtml(mine ? 'data-act="roll"' : "")}
      <div class="dd-id"><img src="${esc(p.img)}" alt=""><b class="dd-who">${esc(p.name)}</b></div>
      <div class="rq-sub">${esc(p.title)}</div>
      <div class="dd-mods">${modsHtml(p.parts)}</div>
      ${meterHtml({ dv: dv ?? 0, hidden: dv == null, base: sumParts(p.parts) })}
      <div class="dd-total"></div>
      <div class="dd-action">${mine ? `<a class="dd-roll" data-act="roll"><span>${esc(T("ROLL"))}</span></a>` : `<span class="dd-wait">${esc(T("waiting…"))}</span>`}</div>
    </div>`;
}

function showRequest(req) {
  closeView(true);
  R.req = req;
  R.rolls = {};
  R.rolling = {}; // was never reset: slot i stayed locked after the first request
  const el = document.createElement("div");
  el.id = "dmb-req";
  const n = req.players.length;
  el.innerHTML = `<div class="dd-box solo n${Math.min(n, 8)}">
      <div class="dd-band"></div>
      ${titleHtml(req.title, req.tier ? `${req.tier}${req.hideDv && !game.user.isGM ? "" : ""}` : "")}
      ${req.line ? `<div class="rq-line">${esc(req.line)}</div>` : ""}
      <div class="dd-row">${req.players.map((p, i) => sideHtml(p, i)).join("")}</div>
      ${
        game.user.isGM
          ? `<div class="rq-gm"><a data-act="rollRest">${esc(T("Roll remaining"))}</a>${req.hideDv ? `<a data-act="reveal">${esc(T("Reveal DV"))}</a>` : ""}<a data-act="end">${esc(T("End"))}</a></div>`
          : `<a class="dd-cancel" data-act="dismiss" data-tooltip="${esc(T("Hide"))}"><i class="fas fa-xmark"></i></a>`
      }
    </div>`;
  document.body.append(el);
  el.addEventListener("click", onViewClick);
  const dice = {};
  req.players.forEach((p, i) => {
    const slot = el.querySelector(`[data-side="${i}"] .dd-die`);
    const die = new HoloDie("d10", p.tone ?? "cyan");
    slot.append(die.el);
    dice[i] = die;
  });
  R.view = { el, dice };
}

function closeView(quiet = false) {
  const v = R.view;
  R.view = null;
  if (!v) return;
  for (const d of Object.values(v.dice)) d.destroy();
  if (quiet) v.el.remove();
  else {
    v.el.querySelector(".dd-box")?.classList.add("leave");
    setTimeout(() => v.el.remove(), 330);
  }
}

async function rollD10() {
  const r = await new Roll("1d10").evaluate();
  const face = r.total;
  let extra = 0;
  if (face === 10) extra = (await new Roll("1d10").evaluate()).total;
  else if (face === 1) extra = -(await new Roll("1d10").evaluate()).total;
  return { face, extra };
}

async function doRoll(i) {
  const req = R.req;
  const p = req?.players[i];
  if (!p || R.rolls[i] || R.rolling?.[i] || !canRoll(p)) return;
  R.rolling = { ...(R.rolling ?? {}), [i]: true };
  R.view?.dice[i]?.spin();
  const side = R.view?.el.querySelector(`[data-side="${i}"]`);
  side?.classList.add("rolling");
  side?.querySelector(".dd-action")?.replaceChildren();
  let r;
  try {
    r = await rollD10();
  } catch (err) {
    console.error("DM Bank | roll request: roll failed", err);
    // Unlock the slot and give the button back so the player can try again.
    delete R.rolling[i];
    side?.classList.remove("rolling");
    const act = side?.querySelector(".dd-action");
    if (act) act.innerHTML = `<a class="dd-roll" data-act="roll"><span>${esc(T("ROLL"))}</span></a>`;
    return;
  }
  // The request may have been ended or replaced while the die was rolling.
  if (R.req?.id !== req.id) return;
  emit({ t: "roll", id: req.id, i, face: r.face, extra: r.extra, total: sumParts(p.parts) + r.face + r.extra, by: game.user.id });
}

async function landRoll({ i, face, extra, total }) {
  const v = R.view;
  if (!v) return;
  R.rolls[i] = { face, extra, total };
  const side = v.el.querySelector(`[data-side="${i}"]`);
  const die = v.dice[i];
  if (!side || !die) return;
  side.classList.add("rolling");
  side.querySelector(".dd-action")?.replaceChildren();
  if (die.state !== "spin") die.spin();
  await sleep(300);
  await Promise.race([die.roll(face), sleep(2400)]);
  side.classList.remove("rolling");
  side.classList.add("landed");
  countUp(side.querySelector(".dd-total"), total);
  const p = R.req.players[i];
  const dv = dvFor(p);
  fillMeter(side.querySelector(".dd-meter"), total, { pass: dv == null ? null : total > dv });
  if (dv != null) side.classList.add(total > dv ? "pass" : "fail");
  if (extra) side.insertAdjacentHTML("beforeend", `<div class="dd-crit ${extra > 0 ? "good" : "bad"}">${extra > 0 ? `${T("CRITICAL")} +${extra}` : `${T("FUMBLE")} ${extra}`}</div>`);
}

function reveal(dvs) {
  const v = R.view;
  if (!v || !R.req) return;
  R.req.players.forEach((p, i) => {
    const dv = dvs?.[p.key];
    if (dv == null) return;
    p.dv = dv;
    const side = v.el.querySelector(`[data-side="${i}"]`);
    const old = side?.querySelector(".dd-meter");
    if (!old) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = meterHtml({ dv, base: sumParts(p.parts) });
    old.replaceWith(tmp.firstElementChild);
    const r = R.rolls[i];
    if (r) {
      fillMeter(side.querySelector(".dd-meter"), r.total, { pass: r.total > dv });
      side.classList.add(r.total > dv ? "pass" : "fail");
    }
  });
}

async function postCard(i, r) {
  const req = R.req;
  const p = req?.players[i];
  if (!p) return;
  const dv = R.secret?.[p.key] ?? p.dv;
  const pass = dv != null ? r.total > dv : null;
  const actor = fromUuidSync(p.key);
  const content = `<div class="dmb-card ${pass === false ? "miss" : ""}">
      <div class="dmb-card-head"><b>${esc(p.title)}</b><small>${esc(req.tier ?? "")}</small></div>
      <div class="dmb-card-line">${(p.parts ?? []).map((x) => `${esc(x[0])} ${x[1]}`).join(" + ")} + d10(${r.face}${r.extra ? (r.extra > 0 ? ` +${r.extra}` : ` ${r.extra}`) : ""}) = <b>${r.total}</b></div>
      ${dv != null ? `<div class="dmb-card-line vs">DV ${dv}</div>` : ""}
      ${pass === null ? "" : `<div class="dmb-card-verdict">${esc(pass ? T("SUCCESS") : T("FAIL"))}</div>`}
    </div>`;
  const data = { content, speaker: ChatMessage.getSpeaker({ actor: actor?.documentName === "Actor" ? actor : undefined }) };
  if (req.hideDv) applyChatMode(data, "gmroll");
  await ChatMessage.create(data);
}

function onViewClick(ev) {
  const t = ev.target.closest("[data-act]");
  if (!t) return;
  ev.preventDefault();
  const act = t.dataset.act;
  if (act === "roll") {
    const i = Number(t.closest("[data-side]")?.dataset.side);
    if (Number.isFinite(i)) doRoll(i);
  } else if (act === "rollRest" && game.user.isGM) {
    R.req.players.forEach((p, i) => {
      if (!R.rolls[i]) doRoll(i);
    });
  } else if (act === "reveal" && game.user.isGM) {
    emit({ t: "reveal", id: R.req.id, dvs: R.secret });
    t.remove();
  } else if (act === "end" && game.user.isGM) {
    emit({ t: "close", id: R.req.id });
  } else if (act === "dismiss") closeView();
}

function onMessage(msg) {
  if (msg?.ns !== NS) return;
  if (msg.t === "start") return showRequest(msg.req);
  if (!R.req || msg.id !== R.req.id) return;
  if (msg.t === "roll") {
    landRoll(msg);
    if (game.user.id === R.req.owner) setTimeout(() => postCard(msg.i, msg), 2600);
  } else if (msg.t === "reveal") reveal(msg.dvs);
  else if (msg.t === "close") {
    closeView();
    R.req = null;
    R.secret = null;
    R.rolls = {};
    R.rolling = {};
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */
export function registerRollRequest() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, "nc.reqLast", { scope: "client", config: false, type: Object, default: {} });
    game.keybindings.register(NC_SCOPE, "rollRequest", {
      name: "DM Bank: Open the roll request panel",
      hint: "GM only.",
      editable: [{ key: "KeyR", modifiers: ["Alt"] }],
      restricted: true,
      onDown: () => {
        openRequestPanel();
        return true;
      },
    });
  });
  Hooks.once("ready", () => {
    game.socket.on(sock(), onMessage);
    game.cprRequest = { open: openRequestPanel };
  });
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.dmbRollRequest = { name: "dmbRollRequest", title: "Roll request", icon: "fas fa-dice-d10", order: 93, button: true, visible: true, onChange: () => openRequestPanel() };
  });
}
