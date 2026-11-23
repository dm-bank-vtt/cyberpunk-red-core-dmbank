#!/usr/bin/env bash
# Builds a System Package release: build/system.json, build/system.zip and build/notes.md.
# Used by .github/workflows/release-system.yml; also runs locally (Git Bash) for a dry run.
#   bash scripts/release.sh v1.0.0
# Fails if: (1) the tag isn't vX.Y.Z, (2) CHANGELOG has no "## X.Y.Z" heading, (3) system.json
# doesn't parse or its id is wrong, (4) the pack build fails, (5) the zip lacks a root system.json
# or contains LOCK or src/, (6) the zip is over 150 MB. Also refuses an unset or mismatched
# first-release date (README, CREDITS and CHANGELOG must agree).
set -euo pipefail

ID="cyberpunk-red-core-dmbank"
REPO_URL="https://github.com/dm-bank-vtt/${ID}"
UPSTREAM_TAG="upstream-v0.92.4"
MAX_BYTES=$((150 * 1024 * 1024))

fail() { echo "::error::$*" >&2; echo "RELEASE FAILED: $*" >&2; exit 1; }

TAG="${1:-${GITHUB_REF_NAME:-}}"
# (1) stable tags only
[[ "$TAG" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] \
  || fail "tag '$TAG' is not vX.Y.Z. System Packages have stable releases only; send test builds by hand."
VERSION="${TAG#v}"

# (2) CHANGELOG section
grep -Eq "^## ${VERSION//./\\.}( |$)" CHANGELOG.md || fail "CHANGELOG.md has no '## ${VERSION}' heading"
FIRST_DATE="$(sed -nE 's/^## 1\.0\.0 - ([0-9]{4}-[0-9]{2}-[0-9]{2})$/\1/p' CHANGELOG.md | head -1)"
[[ -n "$FIRST_DATE" ]] || fail "CHANGELOG '## 1.0.0' has no release date yet (run: node scripts/set-release-date.mjs YYYY-MM-DD)"
for f in README.md CREDITS.md; do
  grep -q "first release ${FIRST_DATE}" "$f" || fail "$f disclaimer does not say 'first release ${FIRST_DATE}'"
done

# (3) system.json
node -e '
  const fs = require("fs");
  let d;
  try { d = JSON.parse(fs.readFileSync("system.json", "utf8")); } catch (e) { console.error("system.json does not parse: " + e.message); process.exit(1); }
  if (d.id !== process.argv[1]) { console.error(`system.json id is "${d.id}", expected "${process.argv[1]}"`); process.exit(1); }
' "$ID" || fail "system.json check failed"

# (4) packs
npm ci --no-audit --no-fund || fail "npm ci failed"
npm run pack || fail "pack build failed"

# Stage the package
rm -rf build && mkdir -p build/pkg
tar --exclude='./.git*' --exclude='./.github' --exclude='./src' --exclude='./node_modules' \
    --exclude='./package.json' --exclude='./package-lock.json' --exclude='./scripts' --exclude='./build' \
    --exclude='*.bak' --exclude='*.map' --exclude='.DS_Store' --exclude='Thumbs.db' --exclude='desktop.ini' \
    --exclude='./.vscode' --exclude='./.idea' --exclude='*.swp' --exclude='*~' \
    --exclude='./DMBANK-NOTES.md' --exclude='LOCK' --exclude='LOG' --exclude='LOG.old' \
    -cf - . | tar -xf - -C build/pkg

# Step 1: stamp version and the pinned download
node -e '
  const fs = require("fs");
  const [file, version, url] = process.argv.slice(1);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  d.version = version;
  d.download = `${url}/releases/download/v${version}/system.zip`;
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
' build/pkg/system.json "$VERSION" "$REPO_URL"
cp build/pkg/system.json build/system.json

# Step 3: append the generated file list to the zip's copy of CHANGES-FROM-UPSTREAM.md
if git rev-parse -q --verify "refs/tags/${UPSTREAM_TAG}" >/dev/null; then
  {
    echo
    echo "## Files changed since upstream v0.92.4 (generated for v${VERSION})"
    echo
    echo "A = added, M = modified, D = deleted, R = renamed. Pack sources are compared as JSON in \`src/packs/\`."
    echo
    echo '```'
    git -c core.quotepath=off diff --name-status -M "${UPSTREAM_TAG}..HEAD"
    echo '```'
  } >> build/pkg/CHANGES-FROM-UPSTREAM.md
else
  fail "tag ${UPSTREAM_TAG} not found (fetch with full history and tags)"
fi

# Step 4: zip without Zip64, system.json at the root
ZIP="$PWD/build/system.zip"
if command -v zip >/dev/null; then
  (cd build/pkg && zip -q -r -X -fz- "$ZIP" .)
else
  # Local fallback (Windows): bsdtar writes plain zip for files of known size.
  (cd build/pkg && /c/Windows/System32/tar.exe -a -cf "$(cygpath -w "$ZIP" 2>/dev/null || echo "$ZIP")" --format zip *)
fi

# (5) zip contents
LIST="$(unzip -Z1 "$ZIP")"
grep -qx 'system.json' <<<"$LIST" || fail "zip has no root system.json"
if grep -Eq '(^|/)LOCK$' <<<"$LIST"; then fail "zip contains a LevelDB LOCK file"; fi
if grep -Eq '^src/' <<<"$LIST"; then fail "zip contains src/"; fi
node -e '
  const b = require("fs").readFileSync(process.argv[1]);
  const tail = b.subarray(Math.max(0, b.length - 70000));
  if (tail.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06]))) { console.error("zip uses Zip64"); process.exit(1); }
' "$ZIP" || fail "zip uses Zip64"

# (6) size
SIZE="$(wc -c <"$ZIP" | tr -d ' ')"
(( SIZE <= MAX_BYTES )) || fail "zip is ${SIZE} bytes, over 150 MB"

# Step 5: notes from the CHANGELOG section
awk -v v="$VERSION" '
  $0 ~ "^## " { if (on) exit; if (index($0, "## " v) == 1) { on = 1; next } }
  on { print }
' CHANGELOG.md > build/notes.md
[[ -s build/notes.md ]] || fail "CHANGELOG section for ${VERSION} is empty"

echo "OK: v${VERSION}, $(grep -c . <<<"$LIST") entries, ${SIZE} bytes -> build/system.json, build/system.zip, build/notes.md"
