// Build or extract the compendium packs listed in system.json.
//   npm run pack     src/packs/<path>/*.json  ->  packs/<path>/ (LevelDB)
//   npm run unpack   packs/<path>/ (LevelDB)  ->  src/packs/<path>/*.json
// Optional second argument: the package root (default: the repo root).
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { ClassicLevel } from "classic-level";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Embedded collections whose ids a primary document lists.
const EMBEDDED = new Set(["items", "effects", "pages", "results", "categories", "cards", "sounds", "combatants",
  "groups", "levels", "tokens", "notes", "lights", "drawings", "templates", "tiles", "walls", "regions", "behaviors"]);

const mode = process.argv[2];
if (!["pack", "unpack"].includes(mode)) {
  console.error("usage: node scripts/packs.mjs <pack|unpack> [packageRoot]");
  process.exit(2);
}
const root = path.resolve(process.argv[3] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const manifest = JSON.parse(readFileSync(path.join(root, "system.json"), "utf8"));

let count = 0;
for (const pack of manifest.packs) {
  const db = path.join(root, pack.path);
  const src = path.join(root, "src", pack.path);
  if (mode === "pack") {
    if (!existsSync(src)) throw new Error(`missing pack source: ${path.relative(root, src)}`);
    rmSync(db, { recursive: true, force: true });
    await compilePack(src, db, { recursive: true });
  } else {
    if (!existsSync(db)) throw new Error(`missing pack: ${pack.path}`);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "cpr-pack-"));
    try {
      cpSync(db, tmp, { recursive: true });
      await dropDanglingRefs(tmp, pack.path);
      await extractPack(tmp, src, { clean: true });
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Windows may hold the LOCK file a moment longer; the temp folder is harmless.
      }
    }
  }
  count += 1;
}
console.log(`${mode}: ${count} packs done`);

// A primary document can list an embedded id (e.g. a journal page) whose record is
// missing from the LevelDB. Foundry ignores such ids; the CLI crashes on them. Drop
// them from a temporary copy before extracting, and say so.
async function dropDanglingRefs(dir, label) {
  const level = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "json", createIfMissing: false });
  const keys = new Set(await level.keys().all());
  const fixes = [];
  for await (const [key, doc] of level.iterator()) {
    // Also checks embedded records, e.g. an Actor's Item listing its own effects.
    const [, collection, id] = key.split("!");
    let changed = false;
    for (const [field, value] of Object.entries(doc)) {
      if (!EMBEDDED.has(field) || !Array.isArray(value)) continue;
      const kept = value.filter((v) => typeof v !== "string" || keys.has(`!${collection}.${field}!${id}.${v}`));
      if (kept.length !== value.length) {
        fixes.push(`${doc.name ?? id}: ${value.length - kept.length} missing ${field}`);
        doc[field] = kept;
        changed = true;
      }
    }
    if (changed) await level.put(key, doc);
  }
  await level.close();
  if (fixes.length) console.warn(`${label}: dropped dangling refs (${fixes.join("; ")})`);
}
