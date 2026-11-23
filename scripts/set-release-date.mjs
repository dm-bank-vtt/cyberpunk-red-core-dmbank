// Writes the v1.0.0 release date into every place that shows it, so they stay one shared value:
// the CHANGELOG 1.0.0 heading and the "first release" date in README.md, CREDITS.md and
// CHANGES-FROM-UPSTREAM.md. Run before tagging v1.0.0:  node scripts/set-release-date.mjs 2026-12-01
// (The site page's disclaimer carries the same date; set it there too.)
import { readFileSync, writeFileSync } from "node:fs";

const date = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: node scripts/set-release-date.mjs YYYY-MM-DD");
  process.exit(2);
}
const edits = [
  ["CHANGELOG.md", /^## 1\.0\.0 - (?:YYYY-MM-DD|\d{4}-\d{2}-\d{2})$/m, `## 1.0.0 - ${date}`],
  ["README.md", /first release (?:YYYY-MM-DD|\d{4}-\d{2}-\d{2})/, `first release ${date}`],
  ["CREDITS.md", /first release (?:YYYY-MM-DD|\d{4}-\d{2}-\d{2})/, `first release ${date}`],
  ["CHANGES-FROM-UPSTREAM.md", /first release is (?:YYYY-MM-DD|\d{4}-\d{2}-\d{2})/, `first release is ${date}`],
];
for (const [file, re, text] of edits) {
  const before = readFileSync(file, "utf8");
  if (!re.test(before)) throw new Error(`${file}: date marker not found`);
  writeFileSync(file, before.replace(re, text));
  console.log(`${file}: ${text}`);
}
