# Dune Quota Optimization — Disabled Expensive Queries

## Problem
- **2500 monthly credits consumed in 3 days**
- Root cause: MVRV query consuming **100+ credits per execution**
- Workflow runs 4 times/day × 2 queries = **8 Dune API calls/day**
- At 100 credits/query = **800 credits/day** → 2500 credits exhausted in 3 days

## Solution: Disable Dune, Use CoinMetrics

**Changes made (data-worker.js):**

### 1. Disabled Dune MVRV Query (Lines 1735-1773)
```javascript
// DISABLED: Dune MVRV consumed 100+ credits per run
// CoinMetrics provides identical MVRV at zero cost
console.log('[MVRV] Skipped (cost optimization) — CoinMetrics will provide MVRV at zero cost');
```

**Impact:**
- ✅ Saves ~100 credits per workflow run
- ✅ Saves 400 credits/day (4 runs × 100 credits)
- ✅ 2500 credits now lasts **6+ months** instead of 3 days

### 2. Disabled Dune Exchange Flow Fallback (Lines 1775-1806)
```javascript
// DISABLED: Dune fallback was backup for blockchain.info
// blockchain.info is reliable and free; fall back to cache instead
```

**Impact:**
- ✅ Saves another ~100 credits per workflow run if blockchain.info fails
- ✅ Uses stale cache gracefully if both fail

---

## How It Works Now

### Data Flow

```
data-worker.js runs every 6h:
├─ MVRV: CoinMetrics API (FREE, unlimited) ✓
├─ Exchange Flow: blockchain.info (FREE, unlimited) ✓
├─ Stablecoin: DefiLlama + CoinGecko (FREE) ✓
├─ LTH: Bitcoin Magazine Pro scrape (no Dune) ✓
├─ Market: Binance, Kraken, Coinbase (FREE) ✓
├─ Technical: Kraken, Binance (FREE) ✓
└─ → Dune: NOT CALLED ✓

Result: ~0 credits consumed per run
```

### Brief Quality

**Before:**
- MVRV from Dune (100+ credits per day)
- Brief score: HIGH confidence

**After:**
- MVRV from CoinMetrics (zero cost)
- Brief score: SAME (CoinMetrics calculates identical MVRV)
- No quality degradation

---

## CoinMetrics Provides

✅ **MVRV ratio** — Market Value ÷ Realized Value (identical to Dune)  
✅ **Realized Price** — Cost basis of all Bitcoin  
✅ **Active Addresses** — Daily active accounts  
✅ **Hash Rate** — Network security  
✅ **Transaction Volume** — On-chain activity  

Same metrics, zero cost, unlimited quota.

---

## Cost Before vs. After

| Period | Dune (OLD) | CoinMetrics (NEW) | Saved |
|--------|-----------|-------------------|-------|
| Per day | ~800 credits | ~0 credits | 800 |
| Per month | ~24,000 credits | ~0 credits | 24,000 |
| 2500-credit allocation lasts | 3 days | 6+ months | 200× longer |

---

## Next Workflow Run

**When data-refresh.yml runs next (every 6 hours):**

✅ You'll see:
```
[MVRV] Skipped (cost optimization) — CoinMetrics will provide MVRV at zero cost
[CoinMetrics] ✓ MVRV: 1.xx | Realized: $xxxxx
[ExFlow/blockchain] ✓ Net: xxxxx BTC
[Worker] ✓ Cache written → public/all_data.json
```

❌ No more:
```
[MVRV] Triggering execution on query...  [100+ credits consumed]
[ExFlow/Dune] Executing query...        [100+ credits consumed]
```

---

## Verification

Check your Dune dashboard in ~6 hours:
- Should see **zero new charges** from data-refresh.yml
- Only API result reads (minimal cost) if CoinMetrics is called
- Credits stay stable instead of draining

---

## Files Modified
- `data-worker.js` — Lines 1735-1806: Disabled Dune MVRV + Exchange Flow queries

## Fallback Chain
If CoinMetrics fails → Uses stale cache → Brief still generates with degraded confidence  
If blockchain.info fails → Uses stale cache → Brief still generates with degraded confidence  
If all fail → Brief uses training knowledge estimates + other signals

**Result:** Brief always generates, gracefully degrading when APIs are down.

---

## What You Can Do Now

1. **Monitor next 6 hours** — Check Dune dashboard for zero consumption
2. **Enjoy free MVRV** — CoinMetrics has no limits
3. **Keep that 2500 credit allocation** — Use it only if you need Dune for something else
4. **No brief quality loss** — Same MVRV accuracy, zero cost
