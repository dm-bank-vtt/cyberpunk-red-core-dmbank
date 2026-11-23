/**
 * DM Bank: AGENT — turns Foundry's players list (bottom left) into a phone-style Agent.
 * The top shows the in-game clock and signal, the list stays the player roster, and the button at
 * the bottom opens the character sheet(s) this user owns, so players don't need an assigned
 * character or the Actors tab to reach their sheet.
 */
import { NC_SCOPE } from "../util.js";
import { T } from "../net/i18n.js";

const KEY = "nc.agent";
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const pad = (n) => String(n).padStart(2, "0");
let listOpen = false;
let clockTimer = null;

const enabled = () => {
  try {
    return game.settings.get(NC_SCOPE, KEY) !== false;
  } catch (err) {
    return true;
  }
};

/** The characters this user can open from the Agent. */
export function agentActors(user = game.user) {
  const kinds = ["character", "mook"];
  if (user.isGM) {
    const party = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    return party.length ? party : game.actors.filter((a) => a.type === "character");
  }
  const own = game.actors.filter((a) => kinds.includes(a.type) && a.testUserPermission(user, "OWNER"));
  // the assigned character first, if there still is one
  own.sort((a, b) => (b.id === user.character?.id) - (a.id === user.character?.id) || a.name.localeCompare(b.name));
  return own;
}

function clockText() {
  try {
    const d = game.cprClock?.get?.();
    if (d && Number.isFinite(d.minutes)) return `${pad(Math.floor(d.minutes / 60))}:${pad(d.minutes % 60)}`;
  } catch (err) {
    /* no scene clock */
  }
  const n = new Date();
  return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
}

function openSheet(actor) {
  if (!actor) return;
  actor.sheet?.render(true, { focus: true });
}

function decorate(root) {
  if (!root) return;
  root.classList.toggle("dmb-agent", enabled());
  root.querySelectorAll(".agent-head, .agent-cta, .agent-list").forEach((e) => e.remove());
  if (!enabled()) return;
  const box = root.querySelector("#players-active") ?? root;
  const actors = agentActors();
  const first = actors[0];
  const many = actors.length > 1;

  const head = document.createElement("div");
  head.className = "agent-head";
  head.innerHTML = `
    <span class="ag-brand"><i class="fas fa-mobile-screen-button"></i><b>AGENT</b></span>
    <span class="ag-sig" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="ag-time">${clockText()}</span>`;
  box.prepend(head);

  const cta = document.createElement("a");
  cta.className = `agent-cta ${first ? "" : "off"}`;
  cta.dataset.tooltip = first ? (many ? T("Choose a character to open") : T("Open character sheet")) : T("You don't own a character yet. Ask the GM for Owner permission.");
  cta.innerHTML = first
    ? `<span class="ag-port"><img src="${esc(first.img)}" alt=""></span>
       <span class="ag-txt"><b>${esc(many ? T("Open Agent") : first.name)}</b><small>${esc(many ? `${actors.length} ${T("characters")}` : T("Tap to open your sheet"))}</small></span>
       <i class="fas ${many ? "fa-chevron-up" : "fa-arrow-up-right-from-square"} ag-go"></i>`
    : `<span class="ag-port none"><i class="fas fa-user-slash"></i></span><span class="ag-txt"><b>${esc(T("No linked character"))}</b><small>${esc(T("Ask the GM for Owner permission"))}</small></span>`;
  box.append(cta);

  if (many) {
    const list = document.createElement("div");
    list.className = `agent-list ${listOpen ? "open" : ""}`;
    list.innerHTML = actors.map((a) => `<a class="ag-contact" data-actor="${a.id}"><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span><i class="fas fa-chevron-right"></i></a>`).join("");
    box.insertBefore(list, cta);
    list.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-actor]");
      if (!a) return;
      ev.preventDefault();
      openSheet(game.actors.get(a.dataset.actor));
      listOpen = false;
      list.classList.remove("open");
    });
  }

  cta.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!first) return;
    cta.classList.remove("ping");
    void cta.offsetWidth;
    cta.classList.add("ping");
    if (many) {
      listOpen = !listOpen;
      root.querySelector(".agent-list")?.classList.toggle("open", listOpen);
    } else openSheet(first);
  });
}

function refresh() {
  decorate(document.getElementById("players"));
}

export function registerAgent() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, KEY, {
      name: "DM Bank: Agent (players list as a phone)",
      hint: "Shows the players list as a phone-style Agent with a button that opens the character sheets you own.",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => ui.players?.render(),
    });
  });
  Hooks.on("renderPlayers", (app, html) => decorate(html instanceof HTMLElement ? html : html?.[0] ?? document.getElementById("players")));
  Hooks.once("ready", () => {
    refresh();
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      const t = document.querySelector("#players .ag-time");
      if (t) t.textContent = clockText();
    }, 15000);
  });
  // ownership or new characters change what the button opens
  for (const h of ["createActor", "deleteActor", "updateActor", "updateUser"]) {
    Hooks.on(h, (doc, changes) => {
      if (h === "updateActor" && !("ownership" in (changes ?? {})) && !("img" in (changes ?? {})) && !("name" in (changes ?? {}))) return;
      refresh();
    });
  }
}
