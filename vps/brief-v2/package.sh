#!/usr/bin/env bash
# Build brief-v2-vps.zip with SHA256SUMS inside and a .sha256 next to it (Board fix 10).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-../../dist}"; mkdir -p "$OUT"
FILES=(cycle.js config.json package.json README.md .env.example install.sh rollback.sh lib/*.js systemd/* test/*.js test/fixtures/*.json)
sha256sum "${FILES[@]}" > SHA256SUMS
rm -f "$OUT/brief-v2-vps.zip"
zip -q -X "$OUT/brief-v2-vps.zip" "${FILES[@]}" SHA256SUMS
rm SHA256SUMS
( cd "$OUT" && sha256sum brief-v2-vps.zip > brief-v2-vps.zip.sha256 && cat brief-v2-vps.zip.sha256 )
