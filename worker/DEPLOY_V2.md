# Deploy the V2 Worker route (BTC Brief V2, Stage 2)

Adds `/v2/snapshot`, `/v2/health` and a 15-minute stale-data alert to the existing `btc-brief` Worker. V1 routes (`/brief`, `/qqq`, `/etf`, `/whale`) and V1's KV keys are unchanged: V2 only uses keys starting with `v2:`.

Run from Mac Terminal in your `BTC Brief Mac` folder.

## 0. Get the code
```bash
cd ~/Documents/Claude/Projects/"BTC Brief Mac"   # adjust if different
git pull
cd worker
```

## 1. Check the deploy starts from live V1 (before)
`wrangler deploy` replaces the whole script, so first confirm the live Worker is the V1 code in this repo:
```bash
npx wrangler deployments list | head -20        # note the current version id (for rollback)
git diff HEAD~10 -- worker.js | head -40         # V2 changes only: one import, one /v2/ route, one scheduled()
```
V1 smoke test (save the output):
```bash
for p in brief qqq etf whale; do echo -n "$p "; curl -s -o /dev/null -w "%{http_code}\n" https://btc-brief.joel-toe.workers.dev/$p; done
```
All four should print 200.

## 2. Secrets (use `echo -n` — a trailing newline silently breaks them)
```bash
openssl rand -hex 32 > ~/brief-v2-push-secret.txt          # keep this file: the VPS needs the same value
echo -n "$(cat ~/brief-v2-push-secret.txt)" | npx wrangler secret put V2_PUSH_SECRET
```
Optional phone alert: install the **ntfy** app, subscribe to a long random topic name, then:
```bash
echo -n "brief-v2-<your-random-topic>" | npx wrangler secret put NTFY_TOPIC
```

## 3. Deploy
```bash
npx wrangler deploy
```

## 4. Check (after)
```bash
for p in brief qqq etf whale; do echo -n "$p "; curl -s -o /dev/null -w "%{http_code}\n" https://btc-brief.joel-toe.workers.dev/$p; done   # all 200, as before
curl -s https://btc-brief.joel-toe.workers.dev/v2/health      # {"ok":false,"ageSec":null,...} until the VPS pushes
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://btc-brief.joel-toe.workers.dev/v2/snapshot   # 400 (unsigned push refused)
```

## Rollback
```bash
npx wrangler rollback <version id noted in step 1>
```
V2 keys (`v2:snapshot`, `v2:alert`) can stay in KV; V1 never reads them.
