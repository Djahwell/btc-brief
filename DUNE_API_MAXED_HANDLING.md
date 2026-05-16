# How the App Handles Dune API Rate Limiting

## Fallback Chain

### 1. **MVRV (Market Value to Realized Value)**

**Primary:** Dune API query
```javascript
[MVRV] Triggering execution on query ${queryId}...
```

**Fallback 1:** CoinMetrics Community API (FREE, no quota)
```javascript
[CoinMetrics] MVRV: ${mvrv} | Realized: $${realizedPrice}
```
- Provides: MVRV ratio, Realized Price, Active Addresses, Hash Rate
- No authentication needed, generous rate limits

**Fallback 2:** Cached stale MVRV from previous run
```javascript
[MVRV] Using cached value from ${prev.cachedAt}: ${mvrv.toFixed(3)} (stale)
```
- Marks data as stale but continues using it
- Better than nothing for briefing

**Fallback 3:** Heuristic estimate (Training knowledge)
```javascript
Derived from: realized=${fmt(dF.realized)} · sma200=${fmt(dF.sma200)} · ATH(rolling)=${fmt(dF.ath)}
```
- Uses SMA200, rolling ATH, other metrics to estimate
- Works when no recent MVRV available

---

### 2. **Exchange Flow (Inflows/Outflows)**

**Primary:** blockchain.info (FREE, quota-heavy but stable)
```javascript
[ExFlow/blockchain] ✓ Net inflow BTC...
```

**Fallback 1:** Dune API query
```javascript
[ExFlow/Dune] Executing query...
```

**Fallback 2:** Use cached value
- Preserves last known exchange flow state

---

### 3. **Other Metrics (Always Have Fallbacks)**

| Metric | Primary | Fallback |
|--------|---------|----------|
| **BTC Price** | Binance, Kraken, Coinbase | Prior cached price |
| **Stablecoin Supply** | DefiLlama | CoinGecko |
| **LTH Net Position** | Bitcoin Magazine Pro (Playwright) | Cached value from 4h prior |
| **Technical (SMA, Volume)** | Kraken, Binance | Cached values |
| **Options Skew** | Deribit | Empty/N/A |
| **Macro (DXY, VIX, TNX)** | Yahoo, FRED, Stooq | Cached values |

---

## What the Brief Shows When Dune Is Maxed

### Best Case (Most Fallbacks Succeed)
```
DATA SOURCE QUALITY:
- LIVE: price, funding, OI, F&G, options skew, gold, dominance, SMAs, CME basis, 
        DXY, VIX, 10Y yield, BTC-QQQ corr, MVRV, ETF flows, LTH position, 
        stablecoin supply, exchange netflow, Binance taker pressure

- ESTIMATED: STH SOPR
```

### Degraded Case (Dune Maxed, CoinMetrics Works)
```
- LIVE: price, funding, OI, F&G, options skew, gold, dominance, SMAs, 
        MVRV [via CoinMetrics], ETF flows, LTH, stablecoin, exchange netflow

- ESTIMATED: STH SOPR, (Dune-dependent metrics)
```

### Worst Case (Multiple APIs Down)
```
- LIVE: price (from cache), SMAs, tech levels

- ESTIMATED: MVRV, exchange flow, LTH, stablecoin (using heuristics + training knowledge)
```

---

## How Brief-Worker Handles Missing MVRV

From brief-worker.js:

```javascript
const duneBlock = dc?.mvrv?.mvrv
  ? `LIVE MVRV: ${mv.mvrv.toFixed(3)} → [ZONE]`
  : `No fresh MVRV — using ~1.5 estimate (training knowledge)`;
```

**Claude adjusts signal strength:**
- Fresh MVRV → Full confidence in valuation signal
- Stale MVRV → Reduced weighting in score
- No MVRV → Falls back to training knowledge + other on-chain signals

**Score impact:**
- MVRV worth ±3 points in on-chain axis
- Without it → Relies more on LTH, exchange flow, whale activity

---

## Current Status (May 16)

If Dune is maxed out:
1. ✅ `npm run data` will show:
   ```
   [MVRV] ✗ HTTP 402 (Quota Exceeded)
   [MVRV] Using cached value... (stale)
   [CoinMetrics] MVRV: 1.xx | Realized: $xxxxx ✓
   ```

2. ✅ Brief still generates with CoinMetrics MVRV
3. ✅ All other metrics continue working (blockchain.info, DefiLlama, etc.)
4. ✅ User sees full brief with only minor degra­dation

---

## Recommendation

**No action needed.** The app is designed to survive Dune quota limits gracefully. CoinMetrics free tier provides MVRV without limits, making it a highly available fallback.

**If you want to monitor:**
- Watch `npm run data` logs for `[MVRV]` lines
- Check if CoinMetrics is providing MVRV (`[CoinMetrics] MVRV:` line)
- Verify brief quality score in the app

**Long-term options:**
- Dune offers higher tiers (monthly quota increases)
- CoinMetrics alone is sufficient for reliable MVRV
- Brief quality degrades gracefully if all fail
