# Deploying the on-demand BTC Brief Worker

This turns your architecture from "Anthropic called 4× per day on cron" into "Anthropic called 0× per day unless someone opens the app, and at most once across all users per day."

## New architecture at a glance

```
┌────────────────┐     ┌──────────────────┐    ┌──────────────────────┐
│   Android APK  │─────│  Cloudflare      │───│   GitHub Actions     │
│  (or browser)  │  →  │  Worker /brief   │ → │   brief-generate.yml │
└────────────────┘     │                  │    │   (calls Anthropic)  │
                       │  KV lock:         │    └──────────────┬───────┘
                       │  triggered:DATE  │                   │
                       └─────────┬────────┘                   ▼
                                 │                ┌──────────────────────┐
                                 │                │   GitHub Pages        │
                                 └─────────────── │   all_data.json      │
                                   reads          └──────────────────────┘
```

* Workflow runs on `workflow_dispatch` only — **no cron**. If nobody opens the app on a vacation day, `brief-generate.yml` never runs, and Anthropic is never billed.
* `dune-refresh.yml` still runs every 6h on cron. It calls **only** the Dune API (no Anthropic) so your on-chain cache stays warm without cost.
* KV key `triggered:YYYY-MM-DD` (TTL 20 min) guarantees at most one workflow run per day even if 50 APK users open the app in the same second.

## One-time deployment steps

### 1. Create a GitHub fine-grained PAT

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new.
2. Resource owner: **Djahwell**. Repository access: **Only select repositories → `btc-brief`**.
3. Repository permissions: set **Actions → Read and write**. Nothing else.
4. Expiration: 1 year (you'll rotate after).
5. Copy the token (starts with `github_pat_...`) — you won't see it again.

### 2. Install `wrangler` and log in

```bash
npm install -g wrangler
wrangler login       # opens browser, authorise with your Cloudflare account
```

If you don't have a Cloudflare account, create a free one first at `cloudflare.com`. No credit card required for the free Worker tier.

### 3. Create the KV namespace

```bash
cd worker
wrangler kv namespace create BRIEF_KV
```

This prints something like:
```
[[kv_namespaces]]
binding = "BRIEF_KV"
id = "a1b2c3d4e5f6..."
```

Copy the `id` value and paste it into `worker/wrangler.toml` in place of `REPLACE_WITH_KV_NAMESPACE_ID`.

### 4. Set the Worker secrets

From inside `worker/`:

```bash
wrangler secret put GITHUB_PAT
# paste the fine-grained PAT from step 1

wrangler secret put GITHUB_REPO
# paste: Djahwell/btc-brief

wrangler secret put WORKFLOW_FILE
# paste: brief-generate.yml

wrangler secret put PAGES_URL
# paste: https://djahwell.github.io/btc-brief/all_data.json
```

### 5. Deploy the Worker

```bash
wrangler deploy
```

You should see:
```
Published btc-brief (x.xx sec)
  https://btc-brief.<your-subdomain>.workers.dev
```

Copy the URL. That's your Worker endpoint.

### 6. Wire the APK to the Worker

In `BTC_MorningBrief_Nansen_live.jsx`, find this line near the top:

```js
const WORKER_URL = 'https://btc-brief.REPLACE_ME.workers.dev/brief';
```

Replace `REPLACE_ME` with your actual Cloudflare subdomain so the URL matches the one from step 5, and keep the trailing `/brief` path.

### 7. Push workflow changes + rebuild the APK

```bash
git add worker/ .github/workflows/ BTC_MorningBrief_Nansen_live.jsx DEPLOY_WORKER.md
git commit -m "feat: on-demand Claude via Cloudflare Worker (1 call/day cap)"
git push
```

Then rebuild the APK:

```bash
npm run cap:sync
npm run cap:open
# in Android Studio: Build → Build Bundle(s)/APK(s) → Build APK
```

### 8. Smoke-test

```bash
# Fresh open of the day — should return the existing data (stale from yesterday
# if this is your first trigger) plus `regenerating: true`:
curl -s https://btc-brief.<your-subdomain>.workers.dev/brief | jq '.regenerating, .briefCachedAt'

# Watch the GitHub Actions tab: `Generate Brief (on-demand · calls Anthropic)`
# should be running. It takes ~3–5 min.

# Hit the worker again ~10 min later — now should return fresh brief with
# today's briefCachedAt and no `regenerating` flag:
curl -s https://btc-brief.<your-subdomain>.workers.dev/brief | jq '.briefCachedAt, .brief.overallBias'
```

The `wrangler tail` command streams live logs from the Worker if you want to
watch traffic.

## How the "only 1 call per day" guarantee works

1. APK opens → calls `GET /brief`.
2. Worker fetches the current `all_data.json` from GitHub Pages.
3. If `briefCachedAt` starts with today's UTC date → return it, done. No trigger.
4. If stale:
   - Worker atomically checks KV `triggered:YYYY-MM-DD`.
   - If already set → return stale data with `regenerating: true` (another user triggered it; Anthropic will only be called once).
   - If not set → set it with TTL 20 min, POST to GitHub `workflow_dispatch`, return stale data with `regenerating: true`.
5. GitHub Actions runs `brief-generate.yml` (~3–5 min) → deploys new `all_data.json`.
6. APK polls the Worker every 45s; on the next hit `briefCachedAt` now = today → auto-refresh.

## What happens on weekends / vacations

Nobody opens the APK → `GET /brief` is never called → `workflow_dispatch` is never triggered → Anthropic is **not called**. You pay $0 for idle days.

`dune-refresh.yml` still runs every 6h but that costs nothing (Dune API is already included in your plan; no Anthropic touch).

## Disaster recovery

- **Worker is down.** The APK's `loadAllData()` falls back to reading `ALL_DATA_URL` directly from GitHub Pages. Users get yesterday's brief with no regeneration; no Anthropic call.
- **GitHub Actions fails.** The KV lock expires after 20 min; the next APK open will retry the trigger. Anthropic is still capped at 1 call per successful run.
- **PAT leaked.** Revoke it in GitHub → Developer settings. Worst case an attacker can only trigger `brief-generate.yml` (bounded by the KV lock) — they cannot touch your repo contents or other workflows because the PAT is scoped `Actions: write` on this single repo.
- **Daily Anthropic budget exceeded.** Set a monthly max in the Anthropic console; the lock plus the 1-per-day architecture makes billable runs deterministic (≤30 per month).

## Cost ceiling

| Service             | Usage                | Cost   |
|---------------------|----------------------|--------|
| Cloudflare Worker   | <1,000 req/day       | $0     |
| Cloudflare KV       | ~1 write/day, some reads | $0 |
| GitHub Actions      | ~5 min × 30 days = 2.5h/mo | $0 (public repo) |
| Anthropic API       | ≤1 call/day × `claude-sonnet-4-6` × ~7K tokens out | ~$0.05–0.10/call |

So the **monthly hard ceiling is roughly $3**, and vacation days cost zero.
