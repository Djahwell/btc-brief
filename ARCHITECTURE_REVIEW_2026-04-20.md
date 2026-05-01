# BTC Brief — Architecture Review & Lean-Pull Plan
**Date:** 2026-04-20
**Scope:** `brief-worker.js`, `dune-worker.js`, `worker/worker.js`, `BTC_MorningBrief_Nansen_live.jsx`, GitHub Actions workflows, Cloudflare Worker gate.
**Goal:** Verify the code, diagnose the waste in the Claude path, and propose the minimum set of changes to make `brief-worker.js` truly lean — i.e. the ONLY job it does on an Anthropic-billable run is build a prompt and call Claude.

---

## TL;DR

The on-demand gate you built (Worker → `workflow_dispatch` → brief-generate) is correct and already caps Claude at ≤4 calls/day. The waste is **inside** the Claude-billable run: `brief-worker.js` currently does ~1,000 lines of market/technical/macro/options/CME/CoinMetrics fetching *before* it calls Claude. If any of those fetches hangs, fails, or just runs slowly, you still pay Anthropic for the final call — and you pay extra GHA minutes every time.

The fix is mechanical: move every fetch that is not strictly required to be <1s fresh at Claude-call-time into `dune-refresh.yml` (the cron that already runs every 6h and does NOT call Anthropic), and reduce `brief-worker.js` to four steps: load cache → assemble prompt → call Claude → write JSON.

Net effect:
- Anthropic calls/day: **unchanged ceiling of ≤4**, same as today.
- Cost *per* Anthropic call: unchanged (prompt tokens roughly the same).
- GHA minutes per Claude run: ~5 min → ~30s (no market fetching).
- Failure modes that waste an Anthropic call (stale upstream, partial market data) → eliminated; stale inputs from the 6h cache are deterministic and visible before the call fires.

---

## 1. Current Architecture — What Runs Where

| Component | Schedule | Calls Anthropic? | What it fetches |
|---|---|---|---|
| `.github/workflows/dune-refresh.yml` | cron `0 */6 * * *` + manual | ❌ No | Runs `dune-worker.js` + curls CF Worker `/whale` + merges via `scripts/merge_whale.py` → writes `public/dune_cache.json` to `gh-pages`. |
| `.github/workflows/brief-generate.yml` | `workflow_dispatch` ONLY | ✅ Yes | Pulls latest `dune_cache.json` from `gh-pages` (raw.githubusercontent), runs `brief-worker.js`, deploys `public/all_data.json` to `gh-pages`. |
| `worker/worker.js` (Cloudflare) | on request from APK | ❌ No | Serves `all_data.json`, gates workflow dispatch via KV lock `triggered:<cachedAt>`, and proxies `/qqq` `/etf` `/whale` for APIs that block GHA/APK IPs. |
| `BTC_MorningBrief_Nansen_live.jsx` (APK webview) | on open | 🔸 Only if cache missing | Tries local → Worker → Pages; if `regenerating:true` polls for 15 min; otherwise renders `allData.brief`. Separately fetches its own live market data for the dashboard display (CoinGecko, Binance, etc.). |

The Worker gate is **doing its job**. The KV lock keyed on `cachedAt` guarantees at most one `workflow_dispatch` per Dune cycle even with many concurrent APK opens. That ceiling of ≤4 Claude runs/day is intact; the memory entry is accurate.

---

## 2. Code Verification — What I Found

### 2.1 Critical: MVRV has been failing since at least 2026-04-19

`public/dune_cache.json` currently contains:
```json
"mvrv_error": "HTTP 402 POST /api/v1/query/6985599/execute"
```
Dune is returning **402 Payment Required** — the free tier is exhausted. `brief-worker.js` has a CoinMetrics fallback that injects MVRV from `CapMrktCurUSD / CapRealUSD` (lines 1129-1138), so the brief still gets a value, but the `duneCache.mvrv` field stays absent and the "LIVE MVRV" block in the Claude prompt is skipped. The brief output today says "MVRV ~1.5 est." — that's the fallback path firing. **Not a blocker**, but you should know the Dune MVRV query is dead-until-quota-reset.

### 2.2 Whale data lifecycle is fragile

`dune-refresh.yml` does this dance:
1. Runs `dune-worker.js`, which tries `WORKER_URL/whale` → if OK, writes into `dune_cache.json` as `binanceLargeTrades`.
2. Then separately curls `WORKER_URL/whale` into `/tmp/whale.json`.
3. Then runs `scripts/merge_whale.py` to merge `/tmp/whale.json` into `dune_cache.json` (overwriting the version from step 1).

And then `brief-worker.js` (line 1086-1105) independently curls `WORKER_URL/whale` *again* if `duneCache.binanceLargeTrades` is missing. That's three independent fetch paths for the same data. The one inside `dune-worker.js` at line 1189 even uses the wrong field name (`net_whale_btc` instead of `net_taker_btc` — compare to `worker.js` line 251 which returns `net_taker_btc`).

### 2.3 ETF flow has two redundant paths in dune-worker.js

`fetchFarsidePlaywright()` (primary) + Cloudflare `/etf` (fallback). Both are correct; just noting that when Farside succeeds, the `/etf` proxy code at lines 1059-1082 is dead. Today's cache shows `etfFlow.date = "17 Apr 2026"` which is the Farside format — primary worked. OK.

### 2.4 `dune-worker.js::fetchETFFlowData_DISABLED`

Lines 720-895 are explicitly dead — marked `_DISABLED` in the function name. ~175 lines of Yahoo crumb-authentication code that no longer runs. Should be deleted.

### 2.5 JSX duplicates almost everything both workers do

`generateBrief()` at line 2492 re-fetches market data (`fetchAllMarketData`), SMAs (`fetchTechnicalLevels`), CoinMetrics (`fetchCoinMetricsData`), and Dune (`fetchDuneData`) *even when a cached brief is loaded successfully*. This isn't a Claude-cost problem (the dashboard needs live numbers to render), but it is confusing — the JSX is **not** consuming `allData.market` / `allData.tech` / `allData.coinMetrics` for its dashboard; it is computing its own. So the `market`/`tech`/`options`/`macros`/`cme`/`coinMetrics` fields that `brief-worker.js` writes into `all_data.json` are consumed **only by Claude**.

This is the most important structural finding: **everything brief-worker fetches is used exactly once — to build the Claude prompt.** The JSX does not read any of it.

### 2.6 Stale `vite.config.js.timestamp-*.mjs` files

Five Vite timestamp files from mid-April, size 14-15KB each, littering the project root. Cosmetic. Delete.

### 2.7 Stale Android bug report in the repo root

`bugreport-sdk_gphone16k_arm64-CP21.260306.017.A1-2026-04-17-21-03-05.zip` — 6.8MB sitting in the project root. Presumably got committed by accident during Capacitor debugging. Should be gitignored if not already removed.

### 2.8 `worker/wrangler.toml` KV namespace id is in the committed repo

Line 27: `id = "8543a6691b2e47a4b1a2eca45c6a789c"`. KV namespace IDs aren't secret (you need the account + auth token to use them), so this is fine. Mentioning for completeness.

---

## 3. The Waste — brief-worker.js Fetch Inventory

Here is every network call `brief-worker.js` makes *before* calling Anthropic. I've classified each by whether it genuinely needs to be fresher than the 6h Dune-cache cycle.

| # | Function | Fetches | Update cadence in reality | Needs <6h freshness for a MORNING brief? |
|---|---|---|---|---|
| 1 | `fetchMarketSnapshot` → price/change24h/volume/mcap | Binance → Kraken → CoinCap → CoinGecko | Real-time, but the brief snapshots a single moment | **No** — a 6h-old snapshot is fine for a daily decision brief. Price at 06:00 UTC is no more "correct" than price at 00:00 UTC. |
| 2 | `fetchMarketSnapshot` → Fear & Greed (alternative.me) | | Updates ~1x/day | **No** |
| 3 | `fetchMarketSnapshot` → Funding rate (Binance fapi → Bybit → OKX) | | Updates every 8h | **No** — 6h cache ≥ source refresh interval |
| 4 | `fetchMarketSnapshot` → Open Interest (Binance → Bybit → OKX) | | Continuous | **No** — daily-level signal |
| 5 | `fetchMarketSnapshot` → Gold/PAXG + BTC/Gold ratio | | Market-hours continuous | **No** |
| 6 | `fetchMarketSnapshot` → BTC dominance (CoinGecko global) | | Continuous | **No** |
| 7 | `fetchTechnicalData` → 200-day BTC candles + SMAs | Kraken → Binance | Candle closes daily | **No** — SMAs change negligibly in 6h |
| 8 | `fetchTechnicalData` → QQQ 120d + BTC-QQQ correlation | via CF Worker `/qqq` | Equities, daily bars | **No** |
| 9 | `fetchOptionsSkew` → Deribit option book | | Continuous | **No** — skew level doesn't swing 5%+ in 6h under normal conditions |
| 10 | `fetchMacros` → DXY (Yahoo → FX fallback) | | Market-hours continuous | **No** |
| 11 | `fetchMacros` → VIX (Yahoo → CBOE CSV) | | Market-hours continuous | **No** |
| 12 | `fetchMacros` → 10Y yield (Yahoo → Treasury XML) | | Market-hours continuous | **No** |
| 13 | `fetchCME` → BTC=F vs BTC-USD basis (Yahoo → OKX) | | Market-hours continuous | **No** |
| 14 | `fetchCoinMetrics` → network health + CapReal/CapMrkt (for MVRV fallback) | | Daily | **No** |
| 15 | Whale / Binance 24h taker pressure (via curl to CF Worker) | | Rolling 24h | **No** — already fetched by `dune-refresh` |

**Conclusion:** every single fetch in `brief-worker.js` can move to `dune-worker.js` (which already runs on the same cadence and writes to the same cache). The Claude prompt does not lose any information.

The only data that *would* genuinely need fresh-at-Claude-time is "price right now" — but the brief is a daily snapshot, not an intraday trade signal. Reading the prompt template (`buildUserMessage`) confirms this: every figure is rendered as a single number, not as a delta-since-last-update. A 6h-old snapshot is fine.

---

## 4. Proposed Lean Architecture

### 4.1 Single source of truth: one cache, one pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  dune-refresh.yml  (cron 0 */6 * * *, NO Anthropic)             │
│  ────────────────────────────────────────────────────────       │
│   Runs: node data-worker.js  (renamed / merged)                 │
│     • Dune MVRV (when quota exists) or CoinMetrics fallback     │
│     • Exchange flows                                             │
│     • Farside ETF flow + SoSoValue fallback                      │
│     • BMP LTH supply                                             │
│     • DefiLlama stablecoin supply                                │
│     • [MOVED] Market snapshot: price/vol/mcap/F&G/funding/OI/    │
│       gold/dominance                                             │
│     • [MOVED] SMAs from 200d Binance candles                     │
│     • [MOVED] QQQ correlation                                    │
│     • [MOVED] Deribit options skew                               │
│     • [MOVED] Macros: DXY / VIX / 10Y                            │
│     • [MOVED] CME basis                                          │
│     • [MOVED] CoinMetrics network health                         │
│     • Whale / 24h taker pressure (via CF Worker)                 │
│   Writes: public/all_data.json  (no brief field yet)             │
│   Deploys: gh-pages single-commit                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
         ┌──────────────────┴──────────────────┐
         │  all_data.json on GitHub Pages      │
         │  cachedAt: <this run's ISO stamp>   │
         └──────────────────┬──────────────────┘
                            │
                            │ APK open → Worker reads Pages
                            │ If briefCachedAt < cachedAt → dispatch
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  brief-generate.yml  (workflow_dispatch only, CALLS Anthropic)  │
│  ────────────────────────────────────────────────────────       │
│   Runs: node brief-worker.js                                    │
│     1. Read public/all_data.json (from raw.githubusercontent)   │
│     2. Build Claude prompt from that JSON (no network fetching) │
│     3. Call Anthropic                                           │
│     4. Inject `brief` + briefCachedAt into all_data.json        │
│   Deploys: gh-pages                                             │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 What changes in each file

**`brief-worker.js` — strip to ~250 lines (currently 1,169)**

Keep:
- `loadEnv`
- `loadAllData()` (new — reads `public/all_data.json` the workflow pre-fetched)
- `buildUserMessage(d)` — lines 837-951, **unchanged logic** (it already reads from a single `d` object)
- `callClaude` + `parseClaudeJSON` + `SYSTEM_PROMPT` — unchanged
- `runBriefWorker` — reduced to: load → build → call → write

Delete from `brief-worker.js`:
- `yfetch`, `stooqFetch`, `stooqHistory`, `yfExtract` (lines 63-131)
- `fetchMarketSnapshot` (lines 135-369)
- `fetchTechnicalData` (lines 371-505)
- `fetchOptionsSkew` (lines 506-530)
- `fetchMacros` (lines 531-698)
- `fetchCME` (lines 699-756)
- `fetchCoinMetrics` (lines 761-815)
- `computePhase` — **keep** if it's pure (inspect), it's logic not a fetch
- Whale curl fallback (lines 1083-1105)

Result: `brief-worker.js` makes exactly one network call — to `api.anthropic.com`. If `all_data.json` is missing or malformed, the worker aborts **before** calling Anthropic and no money is spent.

**`dune-worker.js` — rename to `data-worker.js`, add the transplanted modules**

Move the deleted functions from `brief-worker.js` into this file. Rename the module-level file(s) so the name matches the new responsibility ("fetch all non-Anthropic data, whatever the source"). Add a final step:

```js
const allData = {
  ...payload,                // Dune/Farside/BMP/Stablecoin/Whale/MVRV/ExFlow
  market,                    // transplanted
  tech,                      // transplanted
  options,                   // transplanted
  macros,                    // transplanted
  cme,                       // transplanted
  coinMetrics,               // transplanted
  cachedAt: new Date().toISOString(),
  // NOTE: briefCachedAt is written by brief-worker only
};
writeFileSync('public/all_data.json', JSON.stringify(allData, null, 2));
```

This turns the cron output from `dune_cache.json` into the fuller `all_data.json`, **minus the `brief` field**. When `brief-worker.js` runs, it adds `brief` + `briefCachedAt` and re-uploads.

**`.github/workflows/dune-refresh.yml`**

- Rename job/workflow for clarity: `Refresh Data Cache (no Claude call)`.
- The curl-whale dance + `merge_whale.py` step can go away — `dune-worker.js` already attempts whale via Worker (line 1189). The only reason the curl step exists today is that Node's native `fetch` silently fails on the GHA runner for this specific URL. Investigate (probably an IPv6 or keepalive issue) or just keep the curl step — cost is zero. **Suggest: keep the curl path, remove the duplicate fetch inside `dune-worker.js` at lines 1188-1194** so there's one mechanism.
- Deploy step: now deploys `all_data.json` (the full enriched cache), not `dune_cache.json`. Drop the "preserve all_data.json from Pages" hack at lines 80-87 — it only existed because the two workflows wrote different files.

**`.github/workflows/brief-generate.yml`**

- Replace the "Fetch latest dune_cache.json" step with "Fetch latest all_data.json" (same curl, different filename).
- Keep everything else identical.

**`worker/worker.js`**

- No change to `handleBrief`. The freshness check `briefMs >= cacheMs` still works — `cachedAt` now rolls on the new combined cron, `briefCachedAt` still rolls only on Claude runs.
- `/qqq` `/etf` `/whale` proxies stay.

**`BTC_MorningBrief_Nansen_live.jsx`**

- No required changes. The JSX consumes `allData.brief` for the cached brief display and independently fetches for the dashboard — both continue to work.
- Optional cleanup (separate PR): the JSX could read `allData.market` / `allData.tech` / etc. to avoid its own re-fetch and render faster on app open. Not in scope for this refactor.

---

## 5. Bugs & Dead Code to Clean Up (bonus)

Low-risk deletions that shrink the repo without changing behaviour:

1. `dune-worker.js` lines 720-897 — `fetchETFFlowData_DISABLED`. Entirely dead.
2. `dune-worker.js` lines 1188-1194 — whale fetch inside the worker (shadowed by the curl step in the workflow). Pick one, delete the other.
3. `vite.config.js.timestamp-*.mjs` — 5 files, 14-15KB each, Vite ephemera that shouldn't be committed. Add `*.timestamp-*.mjs` to `.gitignore`.
4. `bugreport-sdk_gphone16k_arm64-CP21.260306.017.A1-2026-04-17-21-03-05.zip` — 6.8MB Android bugreport. Delete + gitignore `bugreport-*.zip`.
5. `env.env.textClipping` (189 bytes at repo root) — macOS text-clipping artifact from dragging an .env into Finder. Delete.
6. `Generate` (44 bytes) — unclear what this is; likely accidental. Inspect and likely delete.
7. Memory: add an entry after this refactor lands saying "brief-worker.js is prompt-only — do not add fetches here."

---

## 6. What this costs you to deploy

- Anthropic cost: unchanged (same tokens, same model, same ≤4 calls/day).
- GHA minutes: slightly lower overall — the cron job picks up ~5 min of market fetching but only runs 4x/day (20 min/day added), while brief-generate drops ~5 min per run (up to 20 min/day saved). Approximately net-zero, but the **cost you save is Anthropic calls that would have been wasted if a market fetch hung**. Today if Yahoo Finance is down and `fetchMacros` times out at 12s × 3 series, you burn 36s of GHA + still call Claude with `DXY: unavailable`. After the refactor, you either have fresh macro from the last cron or you have 6h-stale macro — and either way Claude still runs exactly once.
- Risk: low — the prompt builder (`buildUserMessage`) is already pure-of-JSON-in, string-out. Moving the producers upstream doesn't change its contract.

---

## 7. Open Questions Before I Refactor

These are the decisions I need from you before I start editing files:

1. **Rename `dune-worker.js` → `data-worker.js`?** Keeping the `dune` name is misleading since it'll fetch 15 data sources, only 2 of which are Dune. I recommend renaming; small blast radius (two references: `package.json` scripts, `dune-refresh.yml`).

2. **Keep the `public/dune_cache.json` intermediate file, or collapse into just `public/all_data.json`?** I recommend collapsing — one file, one source of truth. The only reason `dune_cache.json` exists separately today is because the two workflows wrote different files.

3. **What should happen if `all_data.json` is missing/unreachable when `brief-worker.js` starts?** Options:
   - (a) Abort without calling Claude (safe, zero cost, but user sees "regenerating" forever until next Dune cron).
   - (b) Call Claude with a minimal "no data available today" prompt (wastes a call but produces *something*).
   - My recommendation: **(a)** — consistent with your cost-minimization objective.

4. **Do you want me to clean up the dead code in section 5 as part of this refactor, or keep it as a separate pass?**

5. **Worker `/whale` `/etf` `/qqq` proxies stay — confirmed?** These are independent of the refactor and the APK / JSX still uses `/etf` and `/qqq` for its own dashboard fetches (lines 2037, 975 of the JSX). Don't touch them.

---

Once you answer these five, I'll execute the refactor in this order:
1. Move fetch functions from `brief-worker.js` into `dune-worker.js` (or renamed `data-worker.js`).
2. Slim `brief-worker.js` down to load-build-call-write.
3. Update both workflow YAMLs to match the new file layout.
4. Update `scripts/merge_whale.py` (or delete it) per your answer on #2.
5. Dead-code cleanup per section 5.
6. Verification: run `node data-worker.js` locally and diff the resulting `all_data.json` field-for-field against today's cached one, to confirm no schema change for the JSX.
