/**
 * Look up the DV for a given distance on the DV table stored on a token.
 *
 * @param {Token|null} token - the token whose DV table flag should be used
 * @param {Number} distance - the measured distance
 * @returns {String|null} - text to display, or null if nothing should be shown
 */
function getDvLabel(token, distance) {
  if (!token) {
    return `DV: ${game.i18n.localize("CPR.messages.warningRulerNoToken")}`;
  }
  const DvTable = token.document.getFlag(game.system.id, "cprDvTable");
  if (!DvTable || typeof DvTable !== "object") return null;
  const displayTable = DvTable.name.replace(/^DV /, "");
  const table = foundry.utils.duplicate(DvTable.table);
  if (typeof table !== "object" || Object.keys(table).length === 0) return null;
  let DV = 0;
  for (const range of Object.keys(table)) {
    const [start, end] = range.split("_");
    if (
      parseInt(distance, 10) >= parseInt(start, 10) &&
      parseInt(distance, 10) <= parseInt(end, 10)
    ) {
      DV = table[range];
    }
  }
  if (DV > 0) return `DV: ${DV} ${displayTable}`;
  return null;
}

/**
 * Find the token to use for DV lookups when using the measurement ruler: the controlled token,
 * or the only owned character/mook token on the scene.
 *
 * @returns {Token|false}
 */
function getRulerToken() {
  let token = canvas.tokens.controlled[0];
  if (!token) {
    const ownedTokens = canvas.tokens.ownedTokens.filter(
      (t) =>
        t.actor?.constructor.name === "CPRCharacterActor" ||
        t.actor?.constructor.name === "CPRMookActor"
    );
    token = ownedTokens.length === 1 ? ownedTokens[0] : false;
  }
  return token;
}

/**
 * Add the DV text to a waypoint label context. Foundry V13+ renders ruler labels from a
 * Handlebars template, so we append the DV text to the displayed units of the distance.
 *
 * @param {Object|void} context - label context from Foundry
 * @param {Object} waypoint - the ruler waypoint
 * @param {Token|null} token - the token to use for the DV table
 * @returns {Object|void}
 */
function addDvToLabelContext(context, waypoint, token) {
  if (!context) return context;
  const distance =
    waypoint?.measurement?.distance ?? waypoint?.distance ?? undefined;
  if (distance === undefined) return context;
  const dvLabel = getDvLabel(token, distance);
  if (!dvLabel) return context;
  context.cprDv = dvLabel;
  context.units = `${context.units ?? canvas.grid.units ?? ""} | ${dvLabel}`;
  return context;
}

/**
 * Show the DV for the measured range on the ruler (measure tool) and on the token drag ruler.
 *
 * Foundry V12 used `Ruler#_getSegmentLabel`, Foundry V13+ uses
 * `Ruler#_getWaypointLabelContext` and a separate TokenRuler for dragged tokens.
 */
export default function overrideRulerFunctions() {
  const BaseRuler = foundry.canvas?.interaction?.Ruler;
  const BaseTokenRuler = foundry.canvas?.placeables?.tokens?.TokenRuler;

  if (BaseRuler?.prototype?._getWaypointLabelContext) {
    const RulerClass = CONFIG.Canvas.rulerClass ?? BaseRuler;
    class CPRRuler extends RulerClass {
      _getWaypointLabelContext(waypoint, state) {
        const context = super._getWaypointLabelContext(waypoint, state);
        if (this.user && !this.user.isSelf) return context;
        return addDvToLabelContext(context, waypoint, getRulerToken());
      }
    }
    CONFIG.Canvas.rulerClass = CPRRuler;
  }

  if (BaseTokenRuler?.prototype?._getWaypointLabelContext) {
    const TokenRulerClass = CONFIG.Token.rulerClass ?? BaseTokenRuler;
    class CPRTokenRuler extends TokenRulerClass {
      _getWaypointLabelContext(waypoint, state) {
        const context = super._getWaypointLabelContext(waypoint, state);
        const token = this.token ?? null;
        if (!token?.isOwner) return context;
        if (
          token.actor?.type !== "character" &&
          token.actor?.type !== "mook"
        ) {
          return context;
        }
        return addDvToLabelContext(context, waypoint, token);
      }
    }
    CONFIG.Token.rulerClass = CPRTokenRuler;
  }

  // Foundry V12 and older.
  const LegacyRuler = globalThis.Ruler;
  if (
    !BaseRuler?.prototype?._getWaypointLabelContext &&
    LegacyRuler?.prototype?._getSegmentLabel
  ) {
    const foundryPrototype = LegacyRuler.prototype._getSegmentLabel;
    LegacyRuler.prototype._getSegmentLabel = function _getSegmentLabel(
      segment,
      totalDistance
    ) {
      let returnLabel = foundryPrototype.call(this, segment, totalDistance);
      if (this.user.isSelf) {
        const dvLabel = getDvLabel(getRulerToken() || null, segment.distance);
        if (dvLabel) returnLabel = `${returnLabel}\n${dvLabel}`;
      }
      return returnLabel;
    };
  }
}

const foundryValidate = foundry.abstract.DataModel.prototype.validate;
/**
 * Override for the validate function of Foundry's DataModel.
 * If migration is running, always return true.
 * Otherwise, call the original validate function.
 * @param {object} options
 * @returns {boolean} - The result of the validation.
 */
export function validateOverride(options) {
  if (game.cpr.MigrationRunner.needsMigration) return true;
  return foundryValidate.call(this, options);
}
