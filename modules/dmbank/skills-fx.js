/**
 * DM Bank edition: game-style Skills tab.
 *  - Quick Skills strip: pinned skills as big roll buttons at the top
 *  - "Trained only" filter (hides level 0 skills and empty categories)
 *  - Click anywhere on a skill row to roll it; the roll value (Base) is shown big
 *  - Skill level as a 10-segment bar (click a segment to set the level)
 */
import { isNightCity, ncSetting } from "./util.js";

const TRAINED_KEY = "cpr-dmbank.trainedOnly";

function getTrainedOnly() {
  try {
    return localStorage.getItem(TRAINED_KEY) === "1";
  } catch (err) {
    return false;
  }
}
function setTrainedOnly(value) {
  try {
    localStorage.setItem(TRAINED_KEY, value ? "1" : "0");
  } catch (err) {
    /* ignore */
  }
}

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

function readLevel(row) {
  const input = row.querySelector("input.skill-input");
  return Math.max(0, Math.min(10, parseInt(input?.value ?? "0", 10) || 0));
}

function buildPips(row, editable) {
  const cell = row.querySelector(".skill-level");
  const input = cell?.querySelector("input.skill-input");
  if (!cell || !input || cell.querySelector(".nc-pips")) return;
  const level = readLevel(row);
  const pips = document.createElement("div");
  pips.className = "nc-pips";
  pips.dataset.tooltip = `Level ${level}`;
  for (let i = 1; i <= 10; i++) {
    const pip = document.createElement("i");
    pip.dataset.lvl = i;
    if (i <= level) pip.classList.add("on");
    pips.append(pip);
  }
  if (editable) {
    pips.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pip = event.target.closest("i[data-lvl]");
      if (!pip) return;
      const clicked = Number(pip.dataset.lvl);
      const current = readLevel(row);
      const next = clicked === current ? clicked - 1 : clicked;
      input.value = String(next);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  cell.classList.add("nc-has-pips");
  cell.prepend(pips);
}

function buildToolbar(app, tab, rows) {
  tab.querySelector(":scope > .nc-skillbar")?.remove();
  const pinned = rows.filter((row) => row.querySelector(".skill-favorite i.fa-thumbtack:not(.unpinned)"));
  const bar = document.createElement("div");
  bar.className = "nc-skillbar";
  const trained = getTrainedOnly();
  const buttons = pinned
    .map((row) => {
      const name = row.querySelector(".rollable")?.textContent.trim() ?? "?";
      const stat = row.querySelector(".text-pill")?.textContent.trim() ?? "";
      const base = row.querySelector(".skill-base")?.textContent.trim() ?? "";
      return `<a class="nc-quick" data-item-id="${row.dataset.itemId}" data-tooltip="Roll ${esc(name)}">
          <span class="nc-quick-stat">${esc(stat)}</span><span class="nc-quick-name">${esc(name)}</span><span class="nc-quick-base">${esc(base)}</span>
        </a>`;
    })
    .join("");
  bar.innerHTML = `
    <div class="nc-skillbar-head">
      <span class="nc-skillbar-title"><i class="fas fa-bolt"></i> QUICK SKILLS</span>
      <a class="nc-toggle ${trained ? "active" : ""}" data-nc-action="trained"><i class="fas fa-filter"></i> TRAINED ONLY</a>
    </div>
    <div class="nc-quick-list">${buttons || '<span class="nc-quick-hint">Pin a skill (<i class="fas fa-thumbtack"></i>) to add it here</span>'}</div>`;
  tab.prepend(bar);
  bar.addEventListener("click", (event) => {
    const quick = event.target.closest(".nc-quick");
    if (quick) {
      event.preventDefault();
      tab.querySelector(`li.item[data-item-id="${quick.dataset.itemId}"] .rollable`)?.click();
      return;
    }
    const toggle = event.target.closest('[data-nc-action="trained"]');
    if (toggle) {
      event.preventDefault();
      const next = !getTrainedOnly();
      setTrainedOnly(next);
      toggle.classList.toggle("active", next);
      applyTrainedFilter(tab, next);
    }
  });
}

function applyTrainedFilter(tab, on) {
  tab.classList.toggle("nc-trained-only", on);
  // Each category is a ".collapsible" block (header + its own list): hide blocks with no trained skill.
  tab.querySelectorAll(".collapsible").forEach((block) => {
    const rows = block.querySelectorAll("li.item[data-nc-lvl]");
    if (!rows.length) return;
    const any = [...rows].some((li) => li.dataset.ncLvl !== "0");
    block.classList.toggle("nc-cat-empty", on && !any);
  });
}

function enhance(app, html) {
  if (!isNightCity() || ncSetting("skillsFx") === false) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const tab = root.querySelector(".tab.skills-tab");
  if (!tab) return;
  const rows = [...tab.querySelectorAll("li.item[data-item-id]")].filter((row) => row.querySelector("input.skill-input"));
  if (!rows.length) return;
  const editable = app.isEditable;
  tab.classList.add("nc-skills");
  for (const row of rows) {
    row.dataset.ncLvl = String(readLevel(row));
    buildPips(row, editable);
    if (!row.dataset.ncClick) {
      row.dataset.ncClick = "1";
      row.addEventListener("click", (event) => {
        if (event.target.closest("input, a, .nc-pips, .skill-favorite, button")) return;
        row.querySelector(".rollable")?.click();
      });
    }
  }
  buildToolbar(app, tab, rows);
  applyTrainedFilter(tab, getTrainedOnly());
}

export default function registerSkillsFx() {
  Hooks.on("renderActorSheet", (app, html) => {
    try {
      enhance(app, html);
    } catch (err) {
      console.error("CPR DM Bank | skills", err);
    }
  });
}
