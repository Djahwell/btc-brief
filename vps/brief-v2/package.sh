#!/usr/bin/env bash
# Build brief-v2-vps-1.1.zip with SHA256SUMS inside and a .sha256 next to it (Board fix 10).
set -euo pipefail
cd "$(dirname "$0")"
# Copy the shared engine (single source: ../../engine-v2) and record its hashes (parity test reads them).
rm -rf engine; mkdir -p engine/test engine/golden
cp ../../engine-v2/engine.js ../../engine-v2/view.js ../../engine-v2/live.js ../../engine-v2/summary.js ../../engine-v2/fw1.js ../../engine-v2/declaration.json ../../engine-v2/declaration-fw1.json engine/
cp ../../engine-v2/test/synth.js engine/test/
cp ../../engine-v2/golden/synthetic.json engine/golden/
( cd engine && sha256sum engine.js view.js live.js summary.js fw1.js declaration.json declaration-fw1.json test/synth.js golden/synthetic.json > MANIFEST )
trap 'rm -rf engine' EXIT
OUT="${1:-../../dist}"; mkdir -p "$OUT"
FILES=(cycle.js config.json package.json README.md .env.example install.sh rollback.sh lib/*.js systemd/* test/*.js test/fixtures/*.json engine/*.js engine/declaration.json engine/declaration-fw1.json engine/MANIFEST engine/test/synth.js engine/golden/synthetic.json)
sha256sum "${FILES[@]}" > SHA256SUMS
rm -f "$OUT/brief-v2-vps-1.1.zip"
zip -q -X "$OUT/brief-v2-vps-1.1.zip" "${FILES[@]}" SHA256SUMS
rm SHA256SUMS
( cd "$OUT" && sha256sum brief-v2-vps-1.1.zip > brief-v2-vps-1.1.zip.sha256 && cat brief-v2-vps-1.1.zip.sha256 )
