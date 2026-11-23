/**
 * DM Bank: ranged attack DV bands (Cyberpunk RED single-shot table) and the range rings drawn
 * around a token while aiming.
 */

export const BANDS = [6, 12, 25, 50, 100, 200, 400, 800]; // upper edge of each band, metres
export const BAND_LABELS = ["0-6", "7-12", "13-25", "26-50", "51-100", "101-200", "201-400", "401-800"];

/** DV per band. null = out of range. */
export const RANGE_TABLE = {
  pistol: { label: "Pistol", dv: [13, 15, 20, 25, 30, 30, null, null] },
  smg: { label: "SMG", dv: [15, 13, 15, 20, 25, 25, 30, null] },
  shotgun: { label: "Shotgun (slug)", dv: [13, 15, 20, 25, 30, 35, null, null] },
  assaultRifle: { label: "Assault Rifle", dv: [17, 16, 15, 13, 15, 20, 25, 30] },
  sniperRifle: { label: "Sniper Rifle", dv: [30, 25, 25, 20, 15, 16, 17, 20] },
  bow: { label: "Bow / Crossbow", dv: [15, 13, 15, 17, 20, 22, null, null] },
  grenadeLauncher: { label: "Grenade Launcher", dv: [16, 15, 15, 17, 20, 22, 25, null] },
  rocketLauncher: { label: "Rocket Launcher", dv: [17, 16, 15, 15, 20, 20, 25, 30] },
};

/** System weaponType -> range table key (melee types return null). */
const TYPE_MAP = {
  medPistol: "pistol",
  heavyPistol: "pistol",
  vHeavyPistol: "pistol",
  smg: "smg",
  heavySmg: "smg",
  shotgun: "shotgun",
  assaultRifle: "assaultRifle",
  sniperRifle: "sniperRifle",
  bow: "bow",
  grenadeLauncher: "grenadeLauncher",
  rocketLauncher: "rocketLauncher",
  thrownWeapon: "bow",
};

export function tableKeyFor(weapon, override = null) {
  if (override && RANGE_TABLE[override]) return override;
  if (!weapon?.system?.isRanged) return null;
  return TYPE_MAP[weapon.system.weaponType] ?? "pistol";
}

/** Metres per grid unit of the scene ("m"/"yd" use the scene's own distance, anything else = 2 m a square). */
export function metresPerUnit(scene = canvas.scene) {
  const units = String(scene?.grid?.units ?? "").toLowerCase();
  if (/^(m|meter|metre|meters|metres|yd|yard|yards)$/.test(units)) return 1;
  return 2 / (Number(scene?.grid?.distance) || 1);
}

/** Distance between two canvas points in metres (Foundry's own measurement, so diagonals follow the grid rules). */
export function distanceMetres(a, b) {
  let d;
  try {
    d = canvas.grid.measurePath([a, b]).distance;
  } catch (err) {
    d = (Math.hypot(b.x - a.x, b.y - a.y) / canvas.grid.size) * (canvas.scene.grid.distance || 1);
  }
  return d * metresPerUnit();
}

export function bandFor(metres) {
  const i = BANDS.findIndex((edge) => metres <= edge + 0.5);
  return i < 0 ? BANDS.length : i;
}

export function dvAt(key, metres) {
  const t = RANGE_TABLE[key];
  if (!t) return null;
  const i = bandFor(metres);
  if (i >= t.dv.length) return null;
  return t.dv[i];
}

/* ------------------------------------------------------------------ */
/* Rings                                                               */
/* ------------------------------------------------------------------ */
let layer = null;

function dvColor(dv, best) {
  // best DV = cyan, worse shades through yellow to red
  const k = Math.max(0, Math.min(1, (dv - best) / 15));
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const c1 = [0x3e, 0xf2, 0xff];
  const c2 = [0xf3, 0xe6, 0x00];
  const c3 = [0xff, 0x2a, 0x3d];
  const c = k < 0.5 ? c1.map((v, i) => lerp(v, c2[i], k * 2)) : c2.map((v, i) => lerp(v, c3[i], (k - 0.5) * 2));
  return (c[0] << 16) + (c[1] << 8) + c[2];
}

export function clearRings() {
  if (layer) {
    layer.destroy({ children: true });
    layer = null;
  }
}

/** Draw DV bands around a token. Rings stop at the weapon's maximum range. */
export function drawRings(token, key) {
  clearRings();
  const t = RANGE_TABLE[key];
  if (!token || !t || !canvas.ready) return;
  const pxPerMetre = canvas.grid.size / ((canvas.scene.grid.distance || 1) * metresPerUnit());
  const best = Math.min(...t.dv.filter((v) => v != null));
  layer = new PIXI.Container();
  layer.eventMode = "none";
  const g = new PIXI.Graphics();
  layer.addChild(g);
  const { x, y } = token.center;
  let inner = 0;
  const labels = [];
  t.dv.forEach((dv, i) => {
    if (dv == null) return;
    const outer = BANDS[i] * pxPerMetre;
    const col = dvColor(dv, best);
    const alpha = dv === best ? 0.16 : Math.max(0.04, 0.11 - ((dv - best) / 15) * 0.07);
    // a band is a thick stroke between the inner and outer edge (no overlapping fills)
    g.lineStyle(Math.max(1, outer - inner), col, alpha);
    g.drawCircle(x, y, (outer + inner) / 2);
    g.lineStyle(dv === best ? 3 : 1.5, col, dv === best ? 0.95 : 0.6);
    g.drawCircle(x, y, outer);
    g.lineStyle(0);
    const style = new PIXI.TextStyle({
      fontFamily: "Tektur, Jost, sans-serif",
      fontSize: Math.max(14, canvas.grid.size * 0.22),
      fill: col,
      stroke: 0x000000,
      strokeThickness: 4,
      letterSpacing: 2,
    });
    const label = new PIXI.Text(`DV ${dv}  ${BAND_LABELS[i]}m`, style);
    label.anchor.set(0.5, 1);
    label.position.set(x, y - outer + 2);
    labels.push(label);
    inner = outer;
  });
  labels.forEach((l) => layer.addChild(l));
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(layer);
}

/** Autofire DVs (RED core): only SMGs, heavy SMGs and assault rifles can autofire. */
export const AUTOFIRE_TABLE = {
  smg: [20, 17, 20, 25, 30, null, null, null],
  assaultRifle: [22, 20, 17, 20, 25, null, null, null],
};

export function autofireDv(weapon, metres) {
  const t = weapon?.system?.weaponType;
  const row = t === "assaultRifle" ? AUTOFIRE_TABLE.assaultRifle : t === "smg" || t === "heavySmg" ? AUTOFIRE_TABLE.smg : null;
  if (!row) return null;
  const i = bandFor(metres);
  return i < row.length ? row[i] : null;
}
