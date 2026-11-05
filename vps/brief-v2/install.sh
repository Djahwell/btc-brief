#!/usr/bin/env bash
# BTC Brief V2 — VPS install (STAGE2-PLAN v1.1 §6, §8.11; Board build review fixes 1–3, 10).
# Run on the VPS as your normal user (not root):   cd ~/brief-v2-pkg && bash install.sh
#
# Order: checks → stage new code in ~/brief-v2.new → offline tests + live dry cycle THERE →
#        stop timer (if reinstalling) → swap code into ~/brief-v2 (data kept) → write units →
#        systemd-analyze verify → ONE run under the real systemd sandbox → check it pushed →
#        enable the timer. Any failure before the swap leaves the current install untouched.
# Never touches maisontoe-bot-v3, its ledger, maisontoe-whales, maisontoe-liq or whale-market.
set -euo pipefail
PKG="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/brief-v2"; NEW="$HOME/brief-v2.new"
BOT=maisontoe-bot-v3
OTHERS=(maisontoe-liq maisontoe-whales whale-market)
red(){ printf '\033[31m%s\033[0m\n' "$*"; }; grn(){ printf '\033[32m%s\033[0m\n' "$*"; }
fail(){ red "FAIL: $*"; red "The current install (if any) was not changed."; exit 1; }

[ "$(id -u)" -ne 0 ] || fail "run as your normal user, not root (sudo is asked only for the unit files)"
# STAGE3-PLAN §8: v1.1 is installed only after the Stage 2 tolerance gate, so the gate measures unchanged input code.
[ "$(date -u +%Y%m%d)" -ge 20261119 ] || [ "${BRIEF_V2_BEFORE_GATE:-}" = "yes" ] || fail "v1.1 installs on or after 2026-11-19 (Stage 2 gate)"

echo "== 1/10 package checksums"
( cd "$PKG" && sha256sum -c --quiet SHA256SUMS ) || fail "checksum mismatch — re-copy the package"
grn "checksums OK"

echo "== 2/10 prerequisites"
NODE="$(command -v node || true)"; [ -n "$NODE" ] || fail "node not found"
NV="$("$NODE" -e 'console.log(process.versions.node.split(".")[0])')"; [ "$NV" -ge 20 ] || fail "Node $NV < 20"
SYNC="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo unknown)"; [ "$SYNC" = "yes" ] || fail "clock not NTP-synchronised ($SYNC)"
FREE_GB=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc 0-9); [ "$FREE_GB" -ge 5 ] || fail "only ${FREE_GB} GB free"
[ -f "$DIR/.env" ] || { red "Create $DIR/.env first:"; echo "  mkdir -p $DIR && echo \"V2_PUSH_SECRET=<64 hex chars from ~/brief-v2-push-secret.txt on your Mac>\" > $DIR/.env && chmod 600 $DIR/.env"; fail "missing .env"; }
chmod 600 "$DIR/.env"
grep -Eq '^V2_PUSH_SECRET=[0-9a-f]{64}$' "$DIR/.env" || fail "$DIR/.env must contain V2_PUSH_SECRET=<64 hex chars>"
curl -s -m 15 https://btc-brief.joel-toe.workers.dev/v2/health | grep -q '"ageSec"' || fail "Worker /v2/health not reachable — deploy the Worker route first (worker/DEPLOY_V2.md)"
SCHED="$(cat /sys/block/*/queue/scheduler 2>/dev/null | head -1 || true)"
grn "node $NV, clock synced, ${FREE_GB} GB free, Worker V2 route live; disk scheduler: ${SCHED:-unknown} (IOSchedulingClass=idle only applies with bfq)"

echo "== 3/10 recording live services (bot PID must not change)"
bot_state(){ printf '%s %s\n' "$(systemctl is-active $BOT 2>/dev/null || true)" "$(systemctl show -p MainPID --value $BOT 2>/dev/null || echo -)"; }
others_state(){ for u in "${OTHERS[@]}"; do printf '%s=%s ' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"; done; echo; }
BOT_BEFORE="$(bot_state)"; OTH_BEFORE="$(others_state)"
echo "bot: $BOT_BEFORE | $OTH_BEFORE"

echo "== 4/10 staging new code in $NEW"
rm -rf "$NEW"; mkdir -p "$NEW"
for f in cycle.js config.json package.json README.md .env.example; do cp "$PKG/$f" "$NEW/"; done
cp -r "$PKG/lib" "$PKG/test" "$PKG/systemd" "$PKG/engine" "$NEW/"
cp "$DIR/.env" "$NEW/.env"; chmod 600 "$NEW/.env"

echo "== 5/10 offline tests (staged copy)"
( cd "$NEW" && "$NODE" --test test/units.test.js test/e2e.test.js ) || fail "offline tests"
grn "offline tests passed"

echo "== 6/10 live dry cycle (staged copy; real exchanges; writes only under $NEW/dry; pushes nothing)"
( cd "$NEW" && timeout 170 nice -n 15 "$NODE" cycle.js --dry-run ) | tee /tmp/brief-v2-dry.log || fail "dry cycle exited with an error"
for k in perp_premium_binance_8h oi_btc_total coinbase_premium_adj; do
  grep -q "$k: .*\[OK\]" /tmp/brief-v2-dry.log || fail "$k not OK in the dry cycle (see log above)"
done
LIQ="$("$NODE" -e '
const fs=require("fs"),p=process.argv[1];const f=fs.readdirSync(p+"/dry/snapshots").find(x=>x.endsWith(".jsonl"));
const s=JSON.parse(fs.readFileSync(p+"/dry/snapshots/"+f,"utf8").trim().split("\n").pop()).snapshot;
const l=s.inputs.liquidations_24h,h=l.heartbeat||{};
console.log([l.quality,h.filesRead,h.badRows,h.service,(h.headerErrors||[]).join("|"),s.runs.binanceMaxUsedWeight1m].join(";"));' "$NEW")"
IFS=';' read -r LQ LFILES LBAD LSVC LHDR LWEIGHT <<<"$LIQ"
echo "liquidations: quality=$LQ files=$LFILES badRows=$LBAD service=$LSVC ${LHDR:+headerErrors=$LHDR}"
echo "Binance max used weight seen (whole IP, includes the bot): $LWEIGHT of 2400 (job stops its own calls above 1200)"
[ "${LBAD:-0}" = "0" ] || fail "liquidation CSV rows could not be parsed ($LBAD bad rows) — format differs from ts,venue,inst,liq,price,btc,usd,raw; send me the log"
[ -z "$LHDR" ] || fail "liquidation CSV header problem: $LHDR"
grep -q "\[cycle\] engine" /tmp/brief-v2-dry.log || fail "engine line missing from the dry cycle"
grep -q "engine (CANDIDATE" /tmp/brief-v2-dry.log || red "note: the engine withheld its scores in the dry cycle (see the engine line above); inputs are unaffected"
grn "dry cycle OK"

echo "== 7/10 live services unchanged during checks?"
[ "$(bot_state)" = "$BOT_BEFORE" ] || fail "the bot changed state or PID during the checks"
grn "bot unchanged ($BOT_BEFORE)"

echo "== 8/10 swapping code into $DIR (timer paused if present; data kept)"
WAS_ACTIVE=0; if systemctl is-active --quiet brief-v2-cycle.timer; then WAS_ACTIVE=1; sudo systemctl stop brief-v2-cycle.timer; fi
while systemctl is-active --quiet brief-v2-cycle.service; do sleep 2; done          # let a running cycle finish
mkdir -p "$DIR"
# Keep the code being replaced so `bash rollback.sh --previous` can restore it (data is never touched).
if [ -f "$DIR/cycle.js" ]; then
  rm -rf "$DIR/.prev-code"; mkdir -p "$DIR/.prev-code"
  for x in cycle.js config.json package.json README.md .env.example lib test systemd engine; do if [ -e "$DIR/$x" ]; then cp -r "$DIR/$x" "$DIR/.prev-code/"; fi; done
fi
rm -rf "$DIR/lib" "$DIR/test" "$DIR/systemd" "$DIR/engine"
cp -r "$NEW/lib" "$NEW/test" "$NEW/systemd" "$NEW/engine" "$DIR/"
for f in cycle.js config.json package.json README.md .env.example; do cp "$NEW/$f" "$DIR/"; done
rm -rf "$NEW"

echo "== 9/10 units: write, verify, ONE run inside the real systemd sandbox"
for u in service timer; do
  sed -e "s#__USER__#$(id -un)#g" -e "s#__DIR__#$DIR#g" -e "s#__NODE__#$NODE#g" "$DIR/systemd/brief-v2-cycle.$u" | sudo tee /etc/systemd/system/brief-v2-cycle.$u >/dev/null
done
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/brief-v2-cycle.service /etc/systemd/system/brief-v2-cycle.timer || { red "unit verification failed"; bash "$PKG/rollback.sh"; exit 1; }
sudo systemctl start brief-v2-cycle.service || true
journalctl -u brief-v2-cycle -n 12 --no-pager || true
OK="$("$NODE" -e 'const s=require(process.argv[1]+"/status.json");console.log((s.push&&s.push.ok?"push-ok":"push-FAIL")+" "+(s.runs&&s.runs.clock&&s.runs.clock.synced?"clock-ok":"clock-FAIL")+" "+JSON.stringify(s.quality))' "$DIR" 2>/dev/null || echo "no-status")"
echo "sandboxed run: $OK"
case "$OK" in push-ok\ clock-ok*) grn "sandboxed run pushed to the Worker";; *) red "sandboxed run did not push (see above)"; bash "$PKG/rollback.sh"; exit 1;; esac
[ "$(bot_state)" = "$BOT_BEFORE" ] || { red "WARNING: the bot changed state/PID — rolling back"; bash "$PKG/rollback.sh"; exit 1; }

echo "== 10/10 enabling the timer"
sudo systemctl enable --now brief-v2-cycle.timer
grn "Installed. Bot unchanged ($BOT_BEFORE). Other services now: $(others_state)"
systemctl list-timers brief-v2-cycle.timer --no-pager | head -3
echo "Watch:  journalctl -u brief-v2-cycle -n 30 --no-pager   |   cat $DIR/status.json"
echo "Health: curl -s https://btc-brief.joel-toe.workers.dev/v2/health"
echo "Undo:   bash $PKG/rollback.sh"
