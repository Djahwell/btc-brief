// node scripts/test_freshness.js [path/to/all_data.json]
import { readFileSync } from 'fs';
import { ensureFresh, buildFreshnessBlock, cacheAgeHours } from './freshness.js';
const file = process.argv[2] || 'public/all_data.json';
const base = JSON.parse(readFileSync(file, 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${m}`); };
const clone = () => JSON.parse(JSON.stringify(base));
const NOW = Date.parse(base.cachedAt) + 24 * 3.6e6;   // simulate "24h later" (the 2026-11-05 incident)

// synthetic candles: 60 days around 80k, last day in progress
const candles = Array.from({ length: 61 }, (_, i) => {
  const c = 80000 + Math.sin(i / 5) * 2500;
  return { date: new Date(Date.UTC(2026, 8, 5 + i)).toISOString().slice(0, 10), open: c, high: c + 900, low: c - 900, close: c, volume: 10000 };
});

// 1. fresh cache → untouched
{ const d = clone(); const r = await ensureFresh(d, { now: Date.parse(base.cachedAt) + 2 * 3.6e6, fetcher: async () => { throw new Error('should not be called'); } });
  ok(r.status === 'FRESH' && d.market.price === base.market.price, 'fresh (2h) cache left alone'); ok(buildFreshnessBlock(r) === '', 'no warning block when fresh'); }
// 2. stale + live ok → price & AMT replaced
{ const d = clone(); const r = await ensureFresh(d, { now: NOW, fetcher: async () => ({ price: 80420, change24h: 3.87, candles }) });
  ok(r.status === 'STALE' && r.ageHours === 24, 'stale detected at 24h');
  ok(d.market.price === 80420 && d.market.change24h === 3.87, 'live price + change written');
  ok(d.amt?.liveRefreshed && d.amt.price === 80420, `AMT recomputed on live price (state ${d.amt?.state})`);
  const b = buildFreshnessBlock(r); ok(b.includes('LIVE (refreshed now)') && b.includes('$77,356.9') && b.includes('$80,420'), 'prompt block names snapshot vs live price'); }
// 3. stale + live fails → untouched, flagged
{ const d = clone(); const r = await ensureFresh(d, { now: NOW, fetcher: async () => { throw new Error('HTTP 503'); } });
  ok(r.status === 'STALE_UNREFRESHED' && d.market.price === base.market.price, 'failed refresh leaves data, flags STALE_UNREFRESHED');
  ok(buildFreshnessBlock(r).includes('Live refresh FAILED (HTTP 503)'), 'prompt block reports failure'); }
// 4. missing cachedAt → treated as stale
{ const d = clone(); delete d.cachedAt; const r = await ensureFresh(d, { fetcher: async () => { throw new Error('x'); } });
  ok(r.status === 'STALE_UNREFRESHED' && r.ageHours === null, 'missing cachedAt treated as stale'); }
ok(cacheAgeHours('garbage') === null, 'bad timestamp → null age');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
