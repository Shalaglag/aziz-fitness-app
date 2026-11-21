#!/usr/bin/env bash
# Runs inside the emulator (see .github/workflows/update-test.yml):
# install the published build, log a set, install the new build over it, check the set is still there.
# Needs old.apk and new.apk in the repo root and maestro on PATH.
set -euo pipefail
PKG=com.azizfitness.app
OUT=${MAESTRO_OUT:-maestro-out}
mkdir -p "$OUT"
# On a failed flow, print what Maestro can see (texts, hints, ids) so the next fix needs no guessing.
dump() { echo "== Screen as Maestro sees it"; maestro hierarchy > "$OUT/hierarchy-$1.json" 2>/dev/null || true
  node -e 'const h=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const w=n=>{const a=n.attributes||{};const t=[a.text,a["hintText"],a["accessibilityText"],a["resource-id"]].filter(Boolean);if(t.length)console.log(JSON.stringify(t),a.bounds||"");(n.children||[]).forEach(w)};w(h)' "$OUT/hierarchy-$1.json" | head -150 || true; }
code() { adb shell dumpsys package "$PKG" | grep -m1 -o 'versionCode=[0-9]*' | cut -d= -f2; }

adb logcat -c || true
(adb logcat -v time "*:W" > "$OUT/logcat.txt" 2>&1 &)

echo "== Install the published build"
adb install -g old.apk
OLD=$(code); echo "installed versionCode $OLD"

echo "== Old build: log a set"
maestro test .maestro/update-test/1-old-build-log-set.yaml || { dump old; exit 1; }

echo "== Update to this PR's build (same as the in-app Update: replace, keep data)"
adb install -r -g new.apk
NEW=$(code); echo "installed versionCode $NEW"
if [ "$NEW" -le "$OLD" ]; then echo "::error::the update did not install (versionCode $OLD -> $NEW)"; exit 1; fi

echo "== New build: the set must still be there"
maestro test .maestro/update-test/2-new-build-check-data.yaml || { dump new; exit 1; }
echo "Update kept the data: build $OLD -> $NEW"
