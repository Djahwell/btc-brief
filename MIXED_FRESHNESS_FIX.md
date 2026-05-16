# Mixed Freshness Fix — LTH/Stablecoin Data

## Problem
The `all_data.json` had **mixed freshness** — some fields recent, others stale:
- Global `cachedAt`: May 1 (15 days old)
- `lthData.date`: April 30 (stale)
- `stablecoinSupply.date`: May 1 (fresher)
- `market.price`: Current BTC price

The app checked only the global `cachedAt` and rejected everything older than 20 hours, even if individual fields were fresh.

## Root Cause
When data-worker fetches new data:
1. It reads the old all_data.json
2. Merges old + new fields
3. **Updates only the global `cachedAt`** to current time

So if the LTH fetch fails, it keeps the old lthData but marks the entire file as "fresh" with a new cachedAt.

## Fixes Applied

### 1. Data Worker (data-worker.js)
**Only update global `cachedAt` if we actually got fresh data:**
```javascript
const hasFreshData = payload.lthData || payload.stablecoinSupply || 
                     payload.market || payload.mvrv || payload.exchangeFlow;
const freshCachedAt = hasFreshData ? new Date().toISOString() : prev.cachedAt;
```

Now if all data sources fail, cachedAt stays at the prior time (rather than falsely marking it as fresh).

### 2. App Logic (BTC_MorningBrief_Nansen_live.jsx)
**Check individual field dates instead of just global cachedAt:**
```javascript
// Use field's own date if available, otherwise fall back to cachedAt
var checkDate = cacheRes.lthData.date
  ? new Date(cacheRes.lthData.date + 'T00:00:00Z').getTime()
  : new Date(cacheRes.cachedAt).getTime();
```

Now the app accepts data if the individual field is fresh, even if cachedAt is older.

## Testing

After the workflow runs again:
1. If all data fetches succeed → global `cachedAt` updates, everything fresh
2. If some fetches fail → `cachedAt` stays old, but individual fields retain their dates
3. App now checks field dates first, so won't reject LTH/stablecoin data just because the global timestamp is old

## Next Steps
- Push these changes
- Next workflow run will demonstrate the fix
- Individual fields now correctly reflect their own freshness

## Files Modified
- `data-worker.js` — Line ~1583: Only update cachedAt when fresh data exists
- `BTC_MorningBrief_Nansen_live.jsx` — Lines ~2256, ~2284: Check individual field dates
