#!/usr/bin/env bash
# BTC Brief V2 — VPS install (STAGE2-PLAN v1.1 §6, §8.11). Run on the VPS as your normal user (not root):
#   cd ~/brief-v2-pkg && bash install.sh
# Tests first; installs NOTHING if any test fails. Never touches maisontoe-bot-v3, its ledger,
# maisontoe-whales, maisontoe-liq or whale-market (liquidation files are only read).
set -euo pipefail
PKG="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/brief-v2"
WATCH=(maisontoe-bot-v3 maisontoe-liq maisontoe-whales whale-market)
red(){ printf '\033[31m%s\033[0m\n' "$*"; }; grn(){ printf '\033[32m%s\033[0m\n' "$*"; }
fail(){ red "FAIL: $*"; red "Nothing was installed."; exit 1; }

[ "$(id -u)" -ne 0 ] || fail "run as your normal user, not root (sudo is asked only for the two unit files)"

echo "== 1/8 package checksums"
( cd "$PKG" && sha256sum -c --quiet SHA256SUMS ) || fail "checksum mismatch — re-copy the package"
grn "checksums OK"

echo "== 2/8 prerequisites"
NODE="$(command -v node || true)"; [ -n "$NODE" ] || fail "node not found"
NV="$("$NODE" -e 'console.log(process.versions.node.split(".")[0])')"; [ "$NV" -ge 20 ] || fail "Node $NV < 20"
SYNC="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"; [ "$SYNC" = "yes" ] || fail "clock not NTP-synchronised ($SYNC)"
FREE_GB=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc 0-9); [ "$FREE_GB" -ge 5 ] || fail "only ${FREE_GB} GB free"
grn "node $NV at $NODE, clock synced, ${FREE_GB} GB free"

echo "== 3/8 recording the state of the live services (must be identical after install)"
snap_state(){ for u in "${WATCH[@]}"; do printf '%s %s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)" "$(systemctl show -p MainPID --value "$u" 2>/dev/null || echo -)"; done; }
BEFORE="$(snap_state)"; echo "$BEFORE"

echo "== 4/8 copying files to $DIR (vintages/snapshots/state kept if reinstalling)"
mkdir -p "$DIR"
for f in cycle.js config.json package.json README.md .env.example; do cp "$PKG/$f" "$DIR/"; done
rm -rf "$DIR/lib" "$DIR/test" "$DIR/systemd"; cp -r "$PKG/lib" "$PKG/test" "$PKG/systemd" "$DIR/"
if [ ! -f "$DIR/.env" ]; then
  [ -n "${V2_PUSH_SECRET:-}" ] || { red "No $DIR/.env yet. Create it first:"; echo "  echo \"V2_PUSH_SECRET=<the 64 hex chars from ~/brief-v2-push-secret.txt on your Mac>\" > $DIR/.env && chmod 600 $DIR/.env"; fail "missing .env"; }
  printf 'V2_PUSH_SECRET=%s\n' "$V2_PUSH_SECRET" > "$DIR/.env"
fi
chmod 600 "$DIR/.env"
grep -Eq '^V2_PUSH_SECRET=[0-9a-f]{64}$' "$DIR/.env" || fail ".env must contain V2_PUSH_SECRET=<64 hex chars>"

echo "== 5/8 offline tests"
( cd "$DIR" && "$NODE" --test test/units.test.js test/e2e.test.js ) || fail "offline tests"
grn "offline tests passed"

echo "== 6/8 live dry cycle (real exchanges, writes only under $DIR/dry, pushes nothing)"
( cd "$DIR" && timeout 170 nice -n 15 "$NODE" cycle.js --dry-run ) | tee /tmp/brief-v2-dry.log || fail "dry cycle exited with an error"
grep -q 'perp_premium_binance_8h: .*\[OK\]' /tmp/brief-v2-dry.log || fail "Binance premium index not OK in the dry cycle (see log above)"
grep -q 'oi_btc_total: .*\[OK\]' /tmp/brief-v2-dry.log || fail "open interest not OK in the dry cycle (see log above)"
grep -q 'coinbase_premium_adj: .*\[OK\]' /tmp/brief-v2-dry.log || fail "Coinbase premium not OK in the dry cycle (see log above)"
if grep -q 'liquidations_24h: .*\[OK\]' /tmp/brief-v2-dry.log; then grn "liquidation recorder read OK"; else red "note: liquidations STALE in dry cycle (recorder heartbeat) — not blocking"; fi
"$NODE" -e '
const fs=require("fs"),p=process.argv[1];const f=fs.readdirSync(p+"/dry/snapshots").find(x=>x.endsWith(".jsonl"));
const s=JSON.parse(fs.readFileSync(p+"/dry/snapshots/"+f,"utf8").trim().split("\n").pop()).snapshot;
const l=s.inputs.liquidations_24h; console.log("liquidation files read:",l.heartbeat&&l.heartbeat.filesRead,"bad rows:",l.heartbeat&&l.heartbeat.badRows,"service:",l.heartbeat&&l.heartbeat.service);
console.log("binance max used weight (whole IP, incl. the bot):",s.runs.binanceMaxUsedWeight1m);' "$DIR"
grn "dry cycle OK"

echo "== 7/8 live services unchanged?"
AFTER="$(snap_state)"; [ "$BEFORE" = "$AFTER" ] || { echo "$AFTER"; fail "a live service changed state or PID during the checks"; }
grn "unchanged"

echo "== 8/8 installing the timer (sudo for the two unit files)"
for u in service timer; do
  sed -e "s#__USER__#$(id -un)#g" -e "s#__DIR__#$DIR#g" -e "s#__NODE__#$NODE#g" "$DIR/systemd/brief-v2-cycle.$u" | sudo tee /etc/systemd/system/brief-v2-cycle.$u >/dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now brief-v2-cycle.timer
AFTER2="$(snap_state)"; [ "$BEFORE" = "$AFTER2" ] || { echo "$AFTER2"; red "WARNING: a live service changed after install — run bash $PKG/rollback.sh"; exit 1; }
grn "Installed. Next runs:"; systemctl list-timers brief-v2-cycle.timer --no-pager | head -3
echo "Watch:  journalctl -u brief-v2-cycle -n 30 --no-pager     |  status: cat $DIR/status.json"
echo "Undo:   bash $PKG/rollback.sh"
