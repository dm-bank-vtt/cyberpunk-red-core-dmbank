/**
 * DM Bank NET RUN: static rules data (Black ICE, interface actions, program bonuses, presets).
 * Stats follow the Cyberpunk RED core rulebook. Effect texts are short summaries.
 */

export const ICE = {
  asp: { name: "Asp", cls: "antipersonnel", per: 4, spd: 6, atk: 2, def: 2, rez: 15, cost: 100, icon: "fa-staff-snake", dmg: "", effect: "Destroys one random Program installed on the Netrunner's deck." },
  giant: { name: "Giant", cls: "antipersonnel", per: 2, spd: 2, atk: 8, def: 4, rez: 25, cost: 1000, icon: "fa-mountain", dmg: "3d6", effect: "3d6 brain damage, then forces an unsafe Jack Out (every rezzed enemy Black ICE you met gets its effect)." },
  hellhound: { name: "Hellhound", cls: "antipersonnel", per: 6, spd: 6, atk: 6, def: 2, rez: 20, cost: 500, icon: "fa-dog", dmg: "2d6", effect: "2d6 brain damage. Deck and clothes catch fire (unless insulated): 2 HP each turn until put out with a Meat Action. Doesn't stack." },
  kraken: { name: "Kraken", cls: "antipersonnel", per: 6, spd: 2, atk: 8, def: 4, rez: 30, cost: 1000, icon: "fa-hurricane", dmg: "3d6", effect: "3d6 brain damage. Until the end of your next Turn you can't go deeper or Jack Out safely." },
  liche: { name: "Liche", cls: "antipersonnel", per: 8, spd: 2, atk: 6, def: 2, rez: 25, cost: 500, icon: "fa-skull", dmg: "", effect: "INT, REF and DEX lowered by 1d6 for 1 hour (minimum 1). Psychosomatic." },
  raven: { name: "Raven", cls: "antipersonnel", per: 6, spd: 4, atk: 4, def: 2, rez: 15, cost: 50, icon: "fa-crow", dmg: "1d6", effect: "Derezzes one random rezzed Defender, then 1d6 brain damage." },
  scorpion: { name: "Scorpion", cls: "antipersonnel", per: 2, spd: 6, atk: 2, def: 2, rez: 15, cost: 100, icon: "fa-spider", dmg: "", effect: "MOVE lowered by 1d6 for 1 hour (minimum 1). Psychosomatic." },
  skunk: { name: "Skunk", cls: "antipersonnel", per: 2, spd: 4, atk: 4, def: 2, rez: 10, cost: 100, icon: "fa-wind", dmg: "", effect: "While it stays rezzed, Slide checks are at -2 (stacks with every Skunk)." },
  wisp: { name: "Wisp", cls: "antipersonnel", per: 4, spd: 4, atk: 4, def: 2, rez: 15, cost: 50, icon: "fa-ghost", dmg: "1d6", effect: "1d6 brain damage. NET Actions on your next Turn -1 (minimum 2)." },
  dragon: { name: "Dragon", cls: "antiprogram", per: 6, spd: 4, atk: 6, def: 6, rez: 30, cost: 1000, icon: "fa-dragon", dmg: "6d6", effect: "6d6 REZ damage to a rezzed Program. If it drops to 0 the Program is Destroyed." },
  killer: { name: "Killer", cls: "antiprogram", per: 4, spd: 8, atk: 6, def: 2, rez: 20, cost: 500, icon: "fa-crosshairs", dmg: "4d6", effect: "4d6 REZ damage to a rezzed Program. If it drops to 0 the Program is Destroyed." },
  sabertooth: { name: "Sabertooth", cls: "antiprogram", per: 8, spd: 6, atk: 6, def: 2, rez: 25, cost: 1000, icon: "fa-cat", dmg: "6d6", effect: "6d6 REZ damage to a rezzed Program. If it drops to 0 the Program is Destroyed." },
  brainwipe: { name: "Brainwipe", cls: "antipersonnel", per: 4, spd: 4, atk: 4, def: 2, rez: 15, cost: 250, icon: "fa-brain", dmg: "1d6", custom: true, effect: "(House ICE, not in the RED core book — edit freely) 1d6 brain damage and wipes the Netrunner's Cloak." },
};

export const ICE_ORDER = ["hellhound", "kraken", "liche", "raven", "giant", "asp", "wisp", "skunk", "scorpion", "dragon", "killer", "sabertooth", "brainwipe"];

let iceSeq = 0;
export function makeIce(key, overrides = {}) {
  const base = ICE[key] ?? ICE.hellhound;
  iceSeq += 1;
  return {
    uid: `${key}-${Date.now().toString(36)}${iceSeq}${Math.floor(Math.random() * 1e4).toString(36)}`,
    key,
    name: base.name,
    cls: base.cls,
    per: base.per,
    spd: base.spd,
    atk: base.atk,
    def: base.def,
    rez: base.rez,
    rezMax: base.rez,
    dmg: base.dmg,
    effect: base.effect,
    icon: base.icon,
    derezzed: false,
    ...overrides,
  };
}

export const FLOOR_TYPES = {
  password: { label: "PASSWORD", icon: "fa-key", hint: "Backdoor to get past it" },
  file: { label: "FILE", icon: "fa-file-code", hint: "Eye-Dee to read it" },
  control: { label: "CONTROL NODE", icon: "fa-sliders", hint: "Control to take over a device" },
  ice: { label: "BLACK ICE", icon: "fa-skull-crossbones", hint: "Hostile programs" },
  empty: { label: "EMPTY", icon: "fa-circle-notch", hint: "Nothing here" },
};

/** Interface abilities used as NET Actions. dvFrom: floor | arch | opposed | none */
export const ABILITIES = {
  pathfinder: { name: "Pathfinder", icon: "fa-route", dvFrom: "arch", booster: "See Ya", desc: "Maps the Architecture below you. Every floor whose DV you beat (going down in order) is revealed." },
  backdoor: { name: "Backdoor", icon: "fa-key", dvFrom: "floor", booster: "Worm", needs: "password", desc: "Cracks the Password on this floor so you can go deeper." },
  control: { name: "Control", icon: "fa-sliders", dvFrom: "floor", needs: "control", desc: "Takes over the Control Node on this floor (cameras, turrets, doors...)." },
  eyedee: { name: "Eye-Dee", icon: "fa-magnifying-glass", dvFrom: "floor", needs: "file", desc: "Identifies the File on this floor and reads what it holds." },
  virus: { name: "Virus", icon: "fa-virus", dvFrom: "arch", needsBottom: true, desc: "Leaves a Virus on the lowest floor. Tell the GM what it should do." },
  cloak: { name: "Cloak", icon: "fa-user-secret", dvFrom: "none", booster: "Eraser", desc: "Hides your tracks. The result is what another Netrunner must beat to find out you were here." },
  slide: { name: "Slide", icon: "fa-person-running", dvFrom: "opposed", needsIce: true, desc: "Slips away from engaged Black ICE (Interface + 1d10 vs ICE PER + 1d10) so you can move on." },
  zap: { name: "Zap", icon: "fa-bolt", dvFrom: "opposed", needsIce: true, desc: "Attacks a Black ICE: Interface + 1d10 vs its DEF + 1d10. Deals 1d6 REZ." },
  scanner: { name: "Scanner", icon: "fa-satellite-dish", dvFrom: "none", desc: "Scans for Access Points nearby (meat-space). Logged for the GM." },
};
export const ABILITY_ORDER = ["pathfinder", "backdoor", "control", "eyedee", "slide", "zap", "cloak", "virus", "scanner"];

/** Booster programs: program name -> bonus. */
export const BOOSTERS = {
  worm: { ability: "backdoor", value: 2 },
  eraser: { ability: "cloak", value: 2 },
  "see ya": { ability: "pathfinder", value: 2 },
  "speedy gonzalvez": { ability: "speed", value: 2 },
};

export const DIFFICULTY = {
  basic: { label: "BASIC", dv: 6, table: "All Other Floors (Basic)" },
  standard: { label: "STANDARD", dv: 8, table: "All Other Floors (Standard)" },
  uncommon: { label: "UNCOMMON", dv: 10, table: "All Other Floors (Uncommon)" },
  advanced: { label: "ADVANCED", dv: 12, table: "All Other Floors (Advanced)" },
};

export function netActionsForRank(rank) {
  const r = Number(rank) || 0;
  if (r >= 10) return 5;
  if (r >= 7) return 4;
  if (r >= 4) return 3;
  return 2;
}

let floorSeq = 0;
export function makeFloor(type = "empty", data = {}) {
  floorSeq += 1;
  return {
    id: `f${Date.now().toString(36)}${floorSeq}${Math.floor(Math.random() * 1e4).toString(36)}`,
    type,
    name: data.name ?? "",
    dv: data.dv ?? (type === "ice" || type === "empty" ? null : 6),
    desc: data.desc ?? "",
    info: data.info ?? "",
    revealed: data.revealed ?? false,
    cleared: false,
    ice: (data.ice ?? []).map((k) => (typeof k === "string" ? makeIce(k) : makeIce(k.key, k))),
  };
}

/** Parse a roll-table line such as "Hellhound x3", "Password DV8", "Killer, Skunk". */
export function floorFromText(text) {
  const t = String(text ?? "").trim();
  let m = t.match(/^(password|file|control node)\s*dv\s*(\d+)/i);
  if (m) {
    const kind = m[1].toLowerCase() === "control node" ? "control" : m[1].toLowerCase();
    return makeFloor(kind, { dv: Number(m[2]) });
  }
  const ice = [];
  for (const part of t.split(",")) {
    m = part.trim().match(/^([a-z ]+?)(?:\s*x\s*(\d+))?$/i);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    if (!ICE[key]) continue;
    for (let i = 0; i < Number(m[2] ?? 1); i++) ice.push(key);
  }
  if (ice.length) return makeFloor("ice", { ice });
  return makeFloor("empty", { name: t });
}

/** Random architecture using the system's own NET roll tables (core book procedure). */
export async function generateArchitecture(difficulty = "standard") {
  const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.standard;
  const pack = game.packs.get("cyberpunk-red-core-dmbank.internal_net-rolltables");
  const tables = pack ? await pack.getDocuments() : [];
  const lobby = tables.find((t) => t.name.startsWith("First Two Floors"));
  const body = tables.find((t) => t.name === diff.table);
  const count = Math.max(3, (await new Roll("3d6").evaluate()).total);
  const pick = async (table) => {
    if (!table) return "Password DV6";
    const roll = await new Roll(table.formula).evaluate();
    const result = table.results.find((r) => roll.total >= r.range[0] && roll.total <= r.range[1]);
    return result?.name || result?.description || result?.text || "";
  };
  const floors = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    let text = await pick(i < 2 ? lobby : body);
    // The book says to reroll duplicates of the lobby table and repeated body results.
    let guard = 0;
    while (seen.has(text) && guard < 6 && i >= 2) {
      text = await pick(body);
      guard += 1;
    }
    if (i >= 2) seen.add(text);
    floors.push(floorFromText(text));
  }
  return { name: `${diff.label} ARCHITECTURE`, difficulty, dv: diff.dv, floors };
}

/** Built-in example architectures (original content, one per difficulty). */
export function builtinPresets() {
  return [
    {
      id: "pre-basic",
      name: "Corner Store POS",
      difficulty: "basic",
      dv: 6,
      floors: [
        ["password", { dv: 6, name: "Login", desc: "Default password on a sticky note: 'kibble'." }],
        ["file", { dv: 6, name: "Sales Ledger", info: "Daily take, supplier list, the owner's side deal with the Tyger Claws." }],
        ["ice", { ice: ["wisp"] }],
        ["control", { dv: 6, name: "Shutters & Camera", desc: "Front shutters + 1 camera." }],
      ],
    },
    {
      id: "pre-standard",
      name: "Clinic Records Server",
      difficulty: "standard",
      dv: 8,
      floors: [
        ["password", { dv: 6, name: "Front Desk" }],
        ["ice", { ice: ["skunk"] }],
        ["file", { dv: 8, name: "Patient Records", info: "Implant serials and addresses of recent patients." }],
        ["password", { dv: 8, name: "Admin Gate" }],
        ["ice", { ice: ["hellhound"] }],
        ["control", { dv: 8, name: "Security Doors", desc: "All internal doors and the ripperdoc's vault." }],
      ],
    },
    {
      id: "pre-uncommon",
      name: "Gang Stash House",
      difficulty: "uncommon",
      dv: 10,
      floors: [
        ["password", { dv: 8, name: "Lobby Lock" }],
        ["ice", { ice: ["raven", "raven"] }],
        ["file", { dv: 10, name: "Drop Schedule", info: "Times and places for the next three weapon drops." }],
        ["password", { dv: 10, name: "Inner Ring" }],
        ["ice", { ice: ["kraken"] }],
        ["control", { dv: 10, name: "Auto-Turrets", desc: "Two ceiling turrets (SP 10, 4d6 ARs)." }],
        ["ice", { ice: ["liche"] }],
        ["file", { dv: 10, name: "Boss's Ledger", info: "Who the gang pays in NCPD." }],
      ],
    },
    {
      id: "pre-advanced",
      name: "Corporate Vault Node",
      difficulty: "advanced",
      dv: 12,
      floors: [
        ["password", { dv: 8, name: "Public Portal" }],
        ["ice", { ice: ["killer"] }],
        ["password", { dv: 12, name: "Employee Gate" }],
        ["ice", { ice: ["hellhound", "hellhound"] }],
        ["control", { dv: 12, name: "Building Security", desc: "Doors, elevators, and the drone bay." }],
        ["ice", { ice: ["dragon"] }],
        ["password", { dv: 12, name: "Executive Layer" }],
        ["ice", { ice: ["giant"] }],
        ["file", { dv: 12, name: "Project Files", info: "The prototype schematics the fixer wants." }],
      ],
    },
  ];
}

export function presetToArch(preset) {
  return {
    name: preset.name,
    difficulty: preset.difficulty,
    dv: preset.dv,
    floors: preset.floors.map((f) => (Array.isArray(f) ? makeFloor(f[0], f[1]) : rebuildFloor(f))),
  };
}

/** Copy a stored floor, giving it (and its ICE) fresh ids and a clean state. */
export function rebuildFloor(f) {
  const floor = makeFloor(f.type, { ...f, ice: [] });
  floor.ice = (f.ice ?? []).map((i) => makeIce(i.key, { ...i, uid: undefined, derezzed: false, rez: i.rezMax ?? i.rez }));
  for (const ice of floor.ice) if (!ice.uid) ice.uid = makeIce(ice.key).uid;
  return floor;
}

/** Convert a system "NET Architecture" item into an architecture. */
export function netarchItemToArch(item) {
  const floors = [...(item.system.floors ?? [])]
    .sort((a, b) => Number(a.floor) - Number(b.floor) || a.index - b.index)
    .map((f) => {
      const dv = Number(f.dv) || null;
      const content = f.content ?? "";
      if (content.endsWith("password")) return makeFloor("password", { dv: dv ?? 6, desc: f.description });
      if (content.endsWith("file")) return makeFloor("file", { dv: dv ?? 6, desc: f.description });
      if (content.endsWith("controlnode")) return makeFloor("control", { dv: dv ?? 6, desc: f.description });
      if (content.endsWith("blackice")) {
        const key = String(f.blackice ?? "").split(".").pop();
        return makeFloor("ice", { ice: ICE[key] ? [key] : ["hellhound"], desc: f.description });
      }
      return makeFloor("empty", { desc: f.description });
    });
  return { name: item.name, difficulty: "standard", dv: 8, floors };
}
