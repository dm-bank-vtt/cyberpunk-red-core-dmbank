/**
 * DM Bank: SCENE CLOCK — top-left HUD with the scene name, in-game time, date, temperature and
 * weather (Braindance-editor style). Everyone sees it; the GM clicks it to edit or step the time.
 * Stored in the world setting nc.sceneClock.
 */
import { NC_SCOPE } from "../util.js";
import { T } from "../net/i18n.js";

const KEY = "nc.sceneClock";
const SHOW = "nc.sceneClockShow";
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const pad = (n) => String(n).padStart(2, "0");

export const WEATHER = {
  clear: { icon: "fa-sun", night: "fa-moon", label: "Clear" },
  cloudy: { icon: "fa-cloud", label: "Overcast" },
  rain: { icon: "fa-cloud-rain", label: "Rain" },
  acid: { icon: "fa-cloud-showers-heavy", label: "Acid rain", warn: true },
  storm: { icon: "fa-cloud-bolt", label: "Storm", warn: true },
  smog: { icon: "fa-smog", label: "Smog" },
  heat: { icon: "fa-temperature-high", label: "Heatwave", warn: true },
  wind: { icon: "fa-wind", label: "Windy" },
  snow: { icon: "fa-snowflake", label: "Snow" },
};
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const DEFAULT = { minutes: 21 * 60 + 45, date: "2045-10-22", temp: 27, weather: "clear" };
let el = null;
let editor = null;

function data() {
  try {
    return { ...DEFAULT, ...(game.settings.get(NC_SCOPE, KEY) ?? {}) };
  } catch (err) {
    return { ...DEFAULT };
  }
}

const shown = () => {
  try {
    return game.settings.get(NC_SCOPE, SHOW) !== false;
  } catch (err) {
    return true;
  }
};

function fmtDate(iso) {
  const m = /^(\d{1,5})-(\d{1,2})-(\d{1,2})$/.exec(String(iso ?? ""));
  if (!m) return String(iso ?? "");
  return `${pad(Number(m[3]))} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Add minutes, rolling the date over at midnight. */
function shift(d, delta) {
  let mins = d.minutes + delta;
  let date = d.date;
  const m = /^(\d{1,5})-(\d{1,2})-(\d{1,2})$/.exec(String(date));
  while (mins < 0 || mins >= 1440) {
    const dir = mins < 0 ? -1 : 1;
    mins += dir < 0 ? 1440 : -1440;
    if (m) {
      const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      dt.setUTCDate(dt.getUTCDate() + dir);
      m[1] = String(dt.getUTCFullYear());
      m[2] = String(dt.getUTCMonth() + 1);
      m[3] = String(dt.getUTCDate());
      date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    }
  }
  return { ...d, minutes: mins, date };
}

async function save(patch) {
  if (!game.user.isGM) return;
  await game.settings.set(NC_SCOPE, KEY, { ...data(), ...patch });
}

function place() {
  if (!el) return;
  // V14 lists scenes in a column next to the controls: sit just right of it, at the top.
  const nav = document.getElementById("scene-navigation") ?? document.getElementById("navigation");
  const ctrls = document.getElementById("scene-controls")?.getBoundingClientRect();
  let left = ctrls && ctrls.width ? ctrls.right + 14 : 110;
  if (nav?.offsetParent) {
    const rights = [nav, ...nav.querySelectorAll("li, a, .ui-control")].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height).map((r) => r.right);
    if (rights.length) left = Math.max(left, ...rights) + 14;
  }
  el.style.left = `${left}px`;
  el.style.top = "16px";
  Hooks.callAll("dmbClockPlaced");
}

function render() {
  if (!shown() || !canvas?.scene) {
    el?.remove();
    el = null;
    return;
  }
  if (!el || !el.isConnected) {
    el = document.createElement("div");
    el.id = "dmb-clock";
    document.body.append(el);
    el.addEventListener("click", onClick);
  }
  const d = data();
  const h = Math.floor(d.minutes / 60);
  const min = d.minutes % 60;
  const night = h < 6 || h >= 19;
  const w = WEATHER[d.weather] ?? WEATHER.clear;
  const icon = night && w.night ? w.night : w.icon;
  const hours = [];
  for (let i = -3; i <= 3; i++) hours.push((h + i + 24) % 24);
  const name = canvas.scene.navName || canvas.scene.name;
  el.classList.toggle("gm", game.user.isGM);
  el.innerHTML = `
    <div class="ck-mark"><svg viewBox="0 0 44 44" aria-hidden="true"><path class="o" d="M8 2 H36 L42 8 V36 Q42 42 36 42 H8 L2 36 V8 Z"/><circle class="r" cx="22" cy="22" r="13"/><path class="hand" d="M22 22 L22 12" style="transform:rotate(${(d.minutes / 1440) * 720}deg)"/><path class="hand m" d="M22 22 L29 22" style="transform:rotate(${min * 6 - 90}deg)"/></svg></div>
    <div class="ck-main">
      <div class="ck-name">${esc(name)}</div>
      <div class="ck-line">
        <span class="ck-time">${pad(h)}<i>:</i>${pad(min)}</span>
        <span class="ck-sep"></span>
        <span class="ck-date">${esc(fmtDate(d.date))}</span>
        <span class="ck-sep"></span>
        <span class="ck-temp ${d.temp >= 35 ? "hot" : d.temp <= 0 ? "cold" : ""}">${Number(d.temp)}°C</span>
        <span class="ck-wx ${w.warn ? "warn" : ""}" data-tooltip="${esc(T(w.label))}"><i class="fas ${icon}"></i> ${esc(T(w.label))}</span>
      </div>
      <div class="ck-ruler" style="--m:${(min / 60) * 100}%">${hours.map((x, i) => `<span class="${i === 3 ? "now" : ""}">${pad(x)}</span>`).join("")}</div>
    </div>
    ${game.user.isGM ? `<div class="ck-gm"><a data-step="-60">−1h</a><a data-step="-10">−10m</a><a data-step="10">+10m</a><a data-step="60">+1h</a><a data-act="edit" data-tooltip="${esc(T("Edit time and weather"))}"><i class="fas fa-sliders"></i></a></div>` : ""}`;
  place();
}

function onClick(ev) {
  if (!game.user.isGM) return;
  const a = ev.target.closest("[data-step], [data-act]");
  if (!a) return;
  ev.preventDefault();
  if (a.dataset.step) save(shift(data(), Number(a.dataset.step)));
  else if (a.dataset.act === "edit") openEditor();
}

function openEditor() {
  if (editor) {
    editor.remove();
    editor = null;
    return;
  }
  const d = data();
  editor = document.createElement("form");
  editor.id = "dmb-clock-edit";
  editor.innerHTML = `
    <label><span>${esc(T("Time"))}</span><input type="time" name="time" value="${pad(Math.floor(d.minutes / 60))}:${pad(d.minutes % 60)}"></label>
    <label><span>${esc(T("Date"))}</span><input type="text" name="date" value="${esc(d.date)}" placeholder="2045-10-22"></label>
    <label><span>${esc(T("Temperature"))} °C</span><input type="number" name="temp" value="${Number(d.temp)}" min="-40" max="60"></label>
    <label><span>${esc(T("Weather"))}</span><select name="weather">${Object.entries(WEATHER).map(([k, w]) => `<option value="${k}" ${k === d.weather ? "selected" : ""}>${esc(T(w.label))}</option>`).join("")}</select></label>
    <div class="ce-btns"><button type="submit">${esc(T("Save"))}</button><button type="button" data-close>${esc(T("CANCEL"))}</button></div>`;
  document.body.append(editor);
  const r = el?.getBoundingClientRect();
  if (r) {
    editor.style.left = `${r.left}px`;
    editor.style.top = `${r.bottom + 8}px`;
  }
  editor.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close]")) {
      editor.remove();
      editor = null;
    }
  });
  editor.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(editor);
    const [hh, mm] = String(f.get("time") || "00:00").split(":").map(Number);
    await save({ minutes: ((hh || 0) * 60 + (mm || 0)) % 1440, date: String(f.get("date") || d.date).trim(), temp: Number(f.get("temp")) || 0, weather: String(f.get("weather") || "clear") });
    editor.remove();
    editor = null;
  });
}

export function registerSceneClock() {
  Hooks.once("init", () => {
    game.settings.register(NC_SCOPE, KEY, { scope: "world", config: false, type: Object, default: DEFAULT, onChange: () => render() });
    game.settings.register(NC_SCOPE, SHOW, {
      name: "DM Bank: Scene clock (top left)",
      hint: "Shows the scene name, in-game time, date, temperature and weather. The GM clicks it to change them.",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => render(),
    });
  });
  Hooks.once("ready", () => {
    render();
    window.addEventListener("resize", place);
    game.cprClock = { get: data, set: save, advance: (m) => save(shift(data(), m)) };
  });
  Hooks.on("canvasReady", () => render());
  Hooks.on("updateScene", (s) => {
    if (s.id === canvas.scene?.id) render();
  });
  for (const h of ["renderSceneNavigation", "renderSceneControls", "collapseSceneNavigation"]) Hooks.on(h, () => setTimeout(place, 50));
}
