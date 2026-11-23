/**
 * Mapping between the legacy numeric Active Effect change modes (CONST.ACTIVE_EFFECT_MODES, V13 and older)
 * and the string change types used by Foundry V14+ (EffectChangeData#type).
 */
export const CHANGE_MODE_TO_TYPE = {
  0: "custom",
  1: "multiply",
  2: "add",
  3: "downgrade",
  4: "upgrade",
  5: "override",
};

export const CHANGE_TYPE_TO_MODE = Object.fromEntries(
  Object.entries(CHANGE_MODE_TO_TYPE).map(([mode, type]) => [
    type,
    Number(mode),
  ])
);

/**
 * Extend the base ActiveEffect class to implement system-specific logic.
 * @extends {ActiveEffect}
 */
export default class CPRActiveEffect extends ActiveEffect {
  /**
   * Foundry V14 moved the changes array from ActiveEffect#changes to ActiveEffect#system#changes.
   * Most of this system (and its templates) reads `effect.changes`, so we return the right array
   * for whichever generation of Foundry we are running on.
   *
   * @param {ActiveEffect|Object} effect
   * @returns {Array<Object>}
   */
  static getChanges(effect) {
    if (!effect) return [];
    const systemChanges = effect.system?.changes;
    if (Array.isArray(systemChanges)) return systemChanges;
    const sourceChanges = effect._source?.changes ?? effect.changes;
    return Array.isArray(sourceChanges) ? sourceChanges : [];
  }

  /**
   * The data path at which the changes array is stored for updates.
   *
   * @param {ActiveEffect} effect
   * @returns {String}
   */
  static getChangesPath(effect) {
    return Array.isArray(effect?.system?.changes) ? "system.changes" : "changes";
  }

  /**
   * Return the legacy numeric change mode of a change, whether the change uses the V14 `type`
   * string or the older numeric `mode`.
   *
   * @param {Object} change
   * @returns {Number}
   */
  static getChangeMode(change) {
    if (!change) return 2;
    if (typeof change.mode === "number") return change.mode;
    if (typeof change.changeMode === "number") return change.changeMode;
    if (typeof change.type === "string" && change.type in CHANGE_TYPE_TO_MODE) {
      return CHANGE_TYPE_TO_MODE[change.type];
    }
    const parsed = Number.parseInt(change.mode, 10);
    return Number.isNaN(parsed) ? 2 : parsed;
  }

  /**
   * Build the data for a new change, in the format the running Foundry version expects.
   *
   * @param {Object} data - {key, value, mode}
   * @returns {Object}
   */
  static buildChange({ key = "", value = "0", mode = 2 } = {}) {
    if (game.release.generation >= 14) {
      return { key, value, type: CHANGE_MODE_TO_TYPE[mode] ?? "add" };
    }
    return { key, value, mode };
  }

  /**
   * Convenience getter for retrieving how an effect is "used", this is actually stored
   * on the item providing the effect.
   *
   * XXX: LOGGER calls do not work in this getter. I don't know why; use console.
   */
  get usage() {
    const item = this.parent;
    if (!item) return null;
    return item.system?.usage ?? null;
  }

  /**
   * set the key category for a mod
   *
   * @param {Number} num - the index of the mod in the changes array
   * @param {String} category - the key category value to set
   */
  async setModKeyCategory(num, category) {
    await this.setFlag(game.system.id, `changes.cats.${num}`, category);
  }

  /**
   * Determine if this effect is suppressed because of some game mechanic, like the item is not
   * equipped. Foundry skips suppressed effects when applying them to an actor, so overriding this
   * getter is all that is needed to keep unequipped/uninstalled gear from applying its mods.
   *
   * @override
   * @returns {Boolean}
   */
  get isSuppressed() {
    if (super.isSuppressed) return true;
    if (this.disabled) return false;
    const doc = this.parent;
    if (!doc) return false; // happens on item delete
    if (doc.documentName === "Actor") return false; // we never suppress actor effects
    if (typeof doc.areEffectsSuppressed !== "function") return false;
    try {
      return !!doc.areEffectsSuppressed();
    } catch (err) {
      return false;
    }
  }

  /**
   * Kept for backwards compatibility with code that still calls it. Suppression is now computed
   * on the fly by the isSuppressed getter.
   */
  // eslint-disable-next-line class-methods-use-this
  determineSuppression() {}
}

// On Foundry V14+ `changes` is no longer a field of ActiveEffect itself. Provide a getter so the
// rest of the system and its Handlebars templates (`effect.changes`) keep working.
if (!("changes" in (ActiveEffect.schema?.fields ?? {}))) {
  Object.defineProperty(CPRActiveEffect.prototype, "changes", {
    get() {
      const changes = this.system?.changes ?? this._source?.changes;
      return Array.isArray(changes) ? changes : [];
    },
    configurable: true,
  });
}
