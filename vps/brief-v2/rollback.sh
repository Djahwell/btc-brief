#!/usr/bin/env bash
# BTC Brief V2 — VPS rollback. Stops and removes the timer and service; KEEPS ~/brief-v2 data
# (vintages, snapshots, state are never deleted). Does not touch any maisontoe service.
set -uo pipefail
sudo systemctl disable --now brief-v2-cycle.timer 2>/dev/null || true
sudo systemctl stop brief-v2-cycle.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/brief-v2-cycle.timer /etc/systemd/system/brief-v2-cycle.service
sudo systemctl daemon-reload
echo "Removed brief-v2-cycle timer and service. Data kept in $HOME/brief-v2."
for u in maisontoe-bot-v3 maisontoe-liq maisontoe-whales whale-market; do printf '%s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"; done
