import CPRActiveEffect, { CHANGE_MODE_TO_TYPE } from "./cpr-active-effect.js";
import CPRMod from "./rolls/cpr-modifiers.js";
import CPR from "./system/config.js";
import LOGGER from "./utils/cpr-logger.js";
import SystemUtils from "./utils/cpr-systemUtils.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

/**
 * Our own Active Effect sheet, which improves the UX a bit. Specifically this allows us to
 * implement user-readable keys for the mods, and different "usage" types. Most of that logic
 * lives in cpr-active-effect.js.
 *
 * Rewritten as an ApplicationV2 sheet for Foundry V13/V14, where the core ActiveEffectConfig
 * (and every document sheet registered for ActiveEffect) is ApplicationV2 based.
 *
 * @extends {DocumentSheetV2}
 */
export default class CPRActiveEffectSheet extends HandlebarsApplicationMixin(
  DocumentSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ["cpr-active-effect-sheet", "active-effect-sheet", "sheet"],
    position: { width: 675, height: "auto" },
    window: {
      resizable: true,
      icon: "fa-solid fa-gears",
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    actions: {
      cprAddChange: CPRActiveEffectSheet.#onAddChange,
      cprDeleteChange: CPRActiveEffectSheet.#onDeleteChange,
      cprEditImage: CPRActiveEffectSheet.#onEditImage,
      cprSaveAndClose: CPRActiveEffectSheet.#onSaveAndClose,
    },
  };

  static PARTS = {
    form: {
      template: "systems/cyberpunk-red-core-dmbank/templates/effects/cpr-active-effect-sheet.hbs",
      scrollable: [".changes-list"],
    },
  };

  /**
   * The currently displayed tab ("details" or "effects").
   * @type {string}
   */
  _cprActiveTab = "effects";

  /**
   * Respect the "resizeCPRSheets" system setting for the initial height.
   *
   * @override
   */
  _initializeApplicationOptions(options) {
    const appOptions = super._initializeApplicationOptions(options);
    try {
      if (game.settings.get(game.system.id, "resizeCPRSheets")) {
        appOptions.position.height = 300;
      }
    } catch (err) {
      LOGGER.debug(err);
    }
    return appOptions;
  }

  /**
   * Shorthand for the effect being configured.
   * @type {CPRActiveEffect}
   */
  get effect() {
    return this.document;
  }

  /**
   * Prepares data for the CPRActiveEffectSheet.
   *
   * @override
   * @return {Promise<Object>} The prepared data.
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { effect } = this;
    const changesPath = CPRActiveEffect.getChangesPath(effect);
    const isV14 = changesPath === "system.changes";
    const changes = CPRActiveEffect.getChanges(effect);

    // Convert Changes into CPRMods, which have a more convenient data structure.
    const modList = CPRMod.getAllModifiers([effect], true);

    // Prepare input elements for each Change.
    modList.forEach((change, i) => {
      const name = `${changesPath}.${i}.key`;
      const selectClasses = ["key-key"];
      const value = change.key;
      const sourceChange = changes[i] ?? {};
      change.rawValue = sourceChange.value ?? change.value ?? "";
      switch (change.category) {
        // Prepare the select drop-down for skill keys.
        case "skill": {
          const select = foundry.applications.fields.createSelectInput({
            name,
            options: CPRActiveEffectSheet.getSkillOptionConfigs(effect, value),
            value,
          });
          select.classList.add(...selectClasses);
          change.keyInput = new Handlebars.SafeString(select.outerHTML);
          break;
        }
        // Prepare the text input for custom keys.
        case "custom": {
          const textInput = foundry.applications.fields.createTextInput({
            name,
            value,
          });
          textInput.classList.add("key-input");
          change.keyInput = new Handlebars.SafeString(textInput.outerHTML);
          break;
        }
        // Prepare the select drop-down for all other keys.
        default: {
          const otherOptionConfigs = CPRActiveEffectSheet.getOtherOptionConfigs(
            effect,
            value
          );
          const select = foundry.applications.fields.createSelectInput({
            name,
            options: otherOptionConfigs[change.category] ?? [],
            value,
          });
          select.classList.add(...selectClasses);
          change.keyInput = new Handlebars.SafeString(select.outerHTML);
          break;
        }
      }

      // Prepare the mode input.
      const modeName = isV14 ? `${changesPath}.${i}.type` : `${changesPath}.${i}.mode`;
      if (change.category === "stat") {
        const modeOptions = Object.entries(CPR.effectModifierModes).map(
          ([mode, label]) => ({
            value: isV14 ? CHANGE_MODE_TO_TYPE[mode] : String(mode),
            label: SystemUtils.Localize(label),
          })
        );
        const select = foundry.applications.fields.createSelectInput({
          name: modeName,
          options: modeOptions,
          value: isV14
            ? CHANGE_MODE_TO_TYPE[change.changeMode] ?? "add"
            : String(change.changeMode ?? 2),
        });
        if (!isV14) select.dataset.dtype = "Number";
        change.modeInput = new Handlebars.SafeString(select.outerHTML);
      } else {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = modeName;
        hidden.value = isV14 ? "add" : "2";
        if (!isV14) hidden.dataset.dtype = "Number";
        change.modeInput = new Handlebars.SafeString(hidden.outerHTML);
      }
    });

    return foundry.utils.mergeObject(context, {
      effect,
      modList,
      changesPath,
      activeTab: this._cprActiveTab,
      editable: this.isEditable,
    });
  }

  /**
   * Wire up the (simple) tab navigation and QoL listeners after each render.
   *
   * @override
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const html = this.element;

    html.querySelectorAll("nav.sheet-tabs [data-cpr-tab]").forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        this._cprActivateTab(tab.dataset.cprTab);
      });
    });
    this._cprActivateTab(this._cprActiveTab);

    // QoL - Select all text when grabbing text input.
    html.querySelectorAll("input[type=text]").forEach((input) => {
      input.addEventListener("focusin", () => input.select());
    });
  }

  /**
   * Show a tab of the sheet.
   *
   * @param {String} tabName
   */
  _cprActivateTab(tabName) {
    this._cprActiveTab = tabName;
    this.element
      ?.querySelectorAll("[data-cpr-tab]")
      .forEach((el) =>
        el.classList.toggle("active", el.dataset.cprTab === tabName)
      );
    this.element
      ?.querySelectorAll("section.tab[data-cpr-tab]")
      .forEach((el) => {
        el.style.display = el.dataset.cprTab === tabName ? "" : "none";
      });
  }

  /**
   * Turn the submitted changes (an index-keyed object after expansion) back into an array,
   * merged with the existing source changes so fields we do not show (priority, phase...) are
   * kept. Also make sure "stat" mods can never be situational.
   *
   * @override
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData
      ? super._processFormData(event, form, formData)
      : foundry.utils.expandObject(formData.object);
    const changesPath = CPRActiveEffect.getChangesPath(this.effect);
    const submitted = foundry.utils.getProperty(data, changesPath);
    if (submitted && typeof submitted === "object") {
      const changes = foundry.utils.deepClone(
        foundry.utils.getProperty(this.effect._source, changesPath) ?? []
      );
      Object.entries(submitted).forEach(([index, change]) => {
        const i = Number(index);
        const merged = { ...(changes[i] ?? {}), ...change };
        if ("mode" in merged) merged.mode = Number(merged.mode);
        changes[i] = merged;
      });
      foundry.utils.setProperty(data, changesPath, changes);
    }

    const cats = data.flags?.[game.system.id]?.changes?.cats;
    if (cats) {
      Object.entries(cats).forEach(([index, category]) => {
        if (category === "stat") {
          foundry.utils.setProperty(
            data,
            `flags.${game.system.id}.changes.situational.${index}`,
            { isSituational: false, onByDefault: false }
          );
        }
      });
    }
    return data;
  }

  /**
   * Handle adding a new change (read: mod) to the changes array. A new
   * change is always added to the end of the array, never in the middle.
   *
   * @this {CPRActiveEffectSheet}
   */
  static async #onAddChange(event) {
    event.preventDefault();
    if (!this.isEditable) return;
    await this.submit();
    const { effect } = this;
    const changesPath = CPRActiveEffect.getChangesPath(effect);
    const changes = foundry.utils.deepClone(
      foundry.utils.getProperty(effect._source, changesPath) ?? []
    );
    const idx = changes.length;
    LOGGER.debug(`adding change defaults for changes.${idx}`);
    changes.push(CPRActiveEffect.buildChange({ key: "", value: "0", mode: 2 }));
    await effect.update({
      [changesPath]: changes,
      // we set the default "key category" here.
      // we also give it a "situational" flag.
      [`flags.${game.system.id}.changes.cats.${idx}`]: "skill",
      [`flags.${game.system.id}.changes.situational.${idx}`]: {
        isSituational: false,
        onByDefault: false,
      },
    });
  }

  /**
   * Delete a change (read: mod) provided by an active effect. If the deleted change is in the
   * middle of the list, we need to collapse all of the flags beyond it down one "element".
   * (regenerating from scratch is actually hard because you cannot reverse look up what the
   * values should be due to AEs and custom skills)
   *
   * @this {CPRActiveEffectSheet}
   */
  static async #onDeleteChange(event, target) {
    event.preventDefault();
    if (!this.isEditable) return;
    const modnum = parseInt(target.dataset.index, 10);
    const { effect } = this;
    const changesPath = CPRActiveEffect.getChangesPath(effect);
    // First, delete the change itself in the AE
    const changes = foundry.utils.deepClone(
      foundry.utils.getProperty(effect._source, changesPath) ?? []
    );
    changes.splice(modnum, 1);
    // Second, remove the corresponding flag for the deleted change
    const changeFlags =
      foundry.utils.getProperty(effect, `flags.${game.system.id}.changes`) ??
      {};
    const newFlags = { cats: {}, situational: {} };
    const reindex = (entries, target) => {
      entries
        .map(([index, value]) => [Number(index), value])
        .sort((a, b) => a[0] - b[0])
        .forEach(([index, value]) => {
          if (index < modnum) {
            target[String(index)] = value;
            // we deliberately skip idx === modnum, that's the deleted change
          } else if (index > modnum) {
            target[String(index - 1)] = value;
          }
        });
    };
    reindex(Object.entries(changeFlags.cats ?? {}), newFlags.cats);
    reindex(
      Object.entries(changeFlags.situational ?? {}),
      newFlags.situational
    );

    // Finally, update the underlying AE. We replace the whole flag object so that stale
    // indexes beyond the end of the changes array are removed.
    await effect.unsetFlag(game.system.id, "changes");
    await effect.update({
      [changesPath]: changes,
      [`flags.${game.system.id}.changes`]: newFlags,
    });
  }

  /**
   * Pick a new image for the effect.
   *
   * @this {CPRActiveEffectSheet}
   */
  static async #onEditImage(event) {
    event.preventDefault();
    if (!this.isEditable) return;
    const FilePickerClass =
      foundry.applications.apps.FilePicker.implementation ??
      foundry.applications.apps.FilePicker;
    const picker = new FilePickerClass({
      type: "image",
      current: this.effect.img,
      callback: (path) => this.effect.update({ img: path }),
    });
    picker.browse();
  }

  /**
   * Submit the form (if anything is pending) and close the sheet.
   *
   * @this {CPRActiveEffectSheet}
   */
  static async #onSaveAndClose(event) {
    event.preventDefault();
    if (this.isEditable) await this.submit();
    this.close();
  }

  /**
   * Generate a mapping of skill names and bonus object references for the AE sheet. If the AE
   * comes from an Item, we look up all non-core skill items in the world, and use that list.
   * If it comes from an actor, we loop over the skills it owns and generate a mapping with that.
   *
   * This is then used to create the Select element for the AE sheet (for Skill keys).
   *
   * @param {Object} effect - the AE in question
   * @param {String} currentKey - the key of the change being rendered (never disabled)
   * @return {Object} - sorted object of skill keys to names
   */
  static getSkillOptionConfigs(effect, currentKey) {
    const skillMap = { ...CPR.activeEffectKeys.skill };
    let skillList = [];
    if (effect.parent?.documentName === "Item") {
      skillList = game.items.filter((i) => i.type === "skill");
    } else if (effect.parent?.documentName === "Actor") {
      const actor = effect.parent;
      skillList = actor.items.filter((i) => i.type === "skill");
    }

    for (const skill of skillList) {
      skillMap["bonuses.".concat(SystemUtils.slugify(skill.name))] = skill.name;
    }

    const changes = CPRActiveEffect.getChanges(effect);
    const skillOptionConfigs = Object.entries(skillMap).map(([key, value]) => {
      return {
        value: key,
        label: SystemUtils.Localize(value),
        disabled:
          key !== currentKey && changes.some((change) => change.key === key),
      };
    });

    return skillOptionConfigs.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Generates configuration options, from which a Select element is created.
   * for all keys except those in the "skill" category.
   *
   * @param {Object} effect - The effect data used to generate the configuration options.
   * @param {String} currentKey - the key of the change being rendered (never disabled)
   * @return {Object} The configuration options for other effect categories.
   */
  static getOtherOptionConfigs(effect, currentKey) {
    const configs = {};
    const changes = CPRActiveEffect.getChanges(effect);
    const aeKeyEntries = Object.entries(CPR.activeEffectKeys);
    aeKeyEntries.forEach(([categoryKey, data]) => {
      configs[categoryKey] = Object.entries(data).map(([effectKey, value]) => {
        return {
          value: effectKey,
          label: SystemUtils.Localize(value),
          disabled:
            effectKey !== currentKey &&
            changes.some((change) => change.key === effectKey),
        };
      });
    });

    return configs;
  }
}
