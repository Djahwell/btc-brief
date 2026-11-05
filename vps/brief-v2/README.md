# BTC Brief V2 — VPS data cycle (Stage 2)

A short job, run every 15 minutes (:07/:22/:37/:52) by a systemd timer. It collects the inputs GitHub cannot reach, builds a snapshot of raw values (no scores yet), stores every raw response, and pushes the snapshot, signed, to the Worker (`/v2/snapshot`).

| Input | Source | Notes |
|---|---|---|
| `perp_premium_binance_8h` (E3a) | Binance premium index, 1-minute bars | Scored series = 8 h rolling mean. Check series rebuilds each funding print. OKX/Bybit are cross-checks only (limit 0.03 pp) |
| `funding_context` | Binance, Bybit, OKX | Context only (dead band at 0.01%) |
| `oi_btc_total` (E3b) | Binance, Bybit, OKX USDT-linear + USD-inverse perps | Contract specs checked live every cycle. No partial total is shown as the market total |
| `coinbase_premium_adj` (E5a) | Coinbase BTC-USD, Coinbase USDT-USD, Binance spot (vision mirror) | Rebuilt from completed hours every cycle. 24 h median plus a z-score against the 30 prior daily medians |
| `liquidations_24h` (E4) | `~/maisontoe-whales/private/liq/*.csv` (**read-only**) | Lower bound. STALE if the recorder's heartbeat is old or the service is inactive |
| `daily.*` | GitHub `v2-data` branch `v2/daily.json` | Candles, F&G, MVRV, stablecoins, LTH |

**Safety (STAGE2-PLAN §8).** Memory is capped at 256 MB, CPU at 25%, and the job runs at nice 15 with idle I/O, as your user. The filesystem is read-only except `~/brief-v2`. The job stops if free disk falls below max(5 GB, 20%). Binance request weight is shared with the bot's IP: the job fetches only new bars, stops Binance calls above 20% of the limit, and never retries a 429/418. Nothing here touches `maisontoe-bot-v3`, its ledger, `maisontoe-whales`, `maisontoe-liq` or `whale-market`.

## Install (from Mac Terminal)
1. Deploy the Worker route first (`worker/DEPLOY_V2.md`). Keep `~/brief-v2-push-secret.txt`.
2. Copy the package to the VPS and verify it:
   ```bash
   cd ~/Downloads && shasum -a 256 -c brief-v2-vps.zip.sha256
   scp brief-v2-vps.zip ubuntu@57.131.199.106:~/        # use your usual VPS user
   ssh ubuntu@57.131.199.106
   ```
3. On the VPS:
   ```bash
   rm -rf ~/brief-v2-pkg && unzip -q ~/brief-v2-vps.zip -d ~/brief-v2-pkg && cd ~/brief-v2-pkg
   mkdir -p ~/brief-v2 && echo "V2_PUSH_SECRET=<paste the 64 hex chars>" > ~/brief-v2/.env && chmod 600 ~/brief-v2/.env
   bash install.sh
   ```
   `install.sh` checks the checksums, Node and the clock. It records the bot's state and PID, runs the offline tests, then runs one live dry cycle (written under `~/brief-v2/dry`, nothing pushed). It checks that the bot is unchanged, and only then installs the timer. If any step fails, nothing is installed.

## Check
```bash
journalctl -u brief-v2-cycle -n 30 --no-pager
cat ~/brief-v2/status.json
curl -s https://btc-brief.joel-toe.workers.dev/v2/health
```

## Rollback
```bash
bash ~/brief-v2-pkg/rollback.sh      # removes timer + service, keeps ~/brief-v2 data
```

## Files written (all under `~/brief-v2`)
`vintages/YYYY-MM-DD/*.jsonl` (raw responses, gzipped after the day ends) · `snapshots/YYYY-MM-DD.jsonl` (every snapshot, with whether it was pushed and when the Worker received it) · `snapshots/daily/YYYY-MM-DD.json` (first snapshot after 00:00 UTC) · `state.json` · `status.json`. Expected growth: under ~2 MB a day before compression.
