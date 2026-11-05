#!/usr/bin/env bash
# BTC Brief V2 — VPS rollback. Stops and removes the timer and service; KEEPS ~/brief-v2 data
# (vintages, snapshots, state are never deleted). Does not touch any maisontoe service.
set -uo pipefail
DIR="$HOME/brief-v2"
if [ "${1:-}" = "--previous" ]; then
  # Restore the code that the last install replaced (e.g. v1.1 → v1.0). Data, history and snapshots stay.
  [ -d "$DIR/.prev-code" ] || { echo "no previous code kept in $DIR/.prev-code"; exit 1; }
  sudo systemctl stop brief-v2-cycle.timer 2>/dev/null || true
  while case "$(systemctl show -p ActiveState --value brief-v2-cycle.service 2>/dev/null)" in activating|active|deactivating|reloading) true;; *) false;; esac; do sleep 2; done   # a running oneshot is "activating"
  rm -rf "$DIR/lib" "$DIR/test" "$DIR/systemd" "$DIR/engine"
  cp -r "$DIR/.prev-code/." "$DIR/"
  sudo systemctl start brief-v2-cycle.timer
  echo "Restored previous code ($(grep -o "brief-v2-vps/[0-9.]*" "$DIR/cycle.js" | head -1)); timer restarted. Snapshots from it carry no scores block, so the page withholds."
  for u in maisontoe-bot-v3 maisontoe-liq maisontoe-whales whale-market; do printf '%s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"; done
  exit 0
fi
sudo systemctl disable --now brief-v2-cycle.timer 2>/dev/null || true
sudo systemctl stop brief-v2-cycle.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/brief-v2-cycle.timer /etc/systemd/system/brief-v2-cycle.service
sudo systemctl daemon-reload
echo "Removed brief-v2-cycle timer and service. Data kept in $HOME/brief-v2."
for u in maisontoe-bot-v3 maisontoe-liq maisontoe-whales whale-market; do printf '%s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"; done
