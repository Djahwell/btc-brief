// ─────────────────────────────────────────────────────────────────────────────
// freshness.js — staleness guard for brief-worker.js (added 2026-11-05)
// ─────────────────────────────────────────────────────────────────────────────
// Incident: on 2026-11-05 the brief was generated at 05:15 UTC from an
// all_data.json cached at 2026-11-04 05:21 UTC (24h old) because the 6-hourly
// data-refresh had stopped landing. The brief scored a $77,357 spot and an
// IMBALANCE_DOWN auction while BTC was already back at ~$80.4k.
//
// This module lets brief-worker:
//   1. measure how old the cache is (cachedAt),
//   2. when it's older than STALE_HOURS, pull a LIVE price + daily candles from
//      Kraken (same source data-worker uses first) and recompute AMT on them,
//   3. tell Claude exactly which inputs are live and which are still stale.
// ─────────────────────────────────────────────────────────────────────────────

import { computeAMT } from './amt.js';

export const STALE_HOURS = 8;   // data-refresh runs every 6h → 8h = one missed cycle + slack
export const ABORT_HOURS = 48;  // stale AND live refresh failed beyond this → don't call Anthropic

export function cacheAgeHours(cachedAt, now = Date.now()) {
  const t = Date.parse(cachedAt || '');
  if (!Number.isFinite(t)) return null;
  return (now - t) / 3_600_000;
}

// Live Kraken ticker + daily OHLC, shaped exactly like data-worker's _ohlcv.
export async function fetchLiveKraken() {
  const tick = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    { signal: AbortSignal.timeout(10000) });
  if (!tick.ok) throw new Error(`Kraken ticker HTTP ${tick.status}`);
  const td = await tick.json();
  if (td.error?.length) throw new Error(`Kraken ticker: ${td.error[0]}`);
  const t = td.result?.XXBTZUSD || Object.values(td.result || {})[0];
  const price = parseFloat(t?.c?.[0]);
  const open24 = parseFloat(t?.o);              // today's UTC open
  if (!(price > 0)) throw new Error('Kraken ticker: no price');

  const since = Math.floor((Date.now() - 210 * 86400 * 1000) / 1000);
  const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=${since}`,
    { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Kraken OHLC HTTP ${r.status}`);
  const d = await r.json();
  if (d.error?.length) throw new Error(`Kraken OHLC: ${d.error[0]}`);
  const rows = d.result?.XXBTZUSD || d.result?.XBTZUSD || [];
  const candles = [];
  for (const row of rows) {
    const c = parseFloat(row[4]); const v = parseFloat(row[6]);
    if (!(c > 0)) continue;
    candles.push({ date: new Date(parseInt(row[0], 10) * 1000).toISOString().slice(0, 10),
      open: parseFloat(row[1]), high: parseFloat(row[2]), low: parseFloat(row[3]), close: c, volume: v >= 0 ? v : 0 });
  }
  if (candles.length < 40) throw new Error(`Kraken OHLC: only ${candles.length} candles`);

  // True rolling 24h change from hourly bars (daily bars only give "since 00:00 UTC").
  let change24h = null;
  try {
    const h = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60&since=${Math.floor(Date.now() / 1000) - 26 * 3600}`,
      { signal: AbortSignal.timeout(10000) });
    const hd = await h.json();
    const hr = hd.result?.XXBTZUSD || hd.result?.XBTZUSD || [];
    const target = Date.now() / 1000 - 24 * 3600;
    const bar = hr.find(r => parseInt(r[0], 10) >= target);
    const ref = bar ? parseFloat(bar[1]) : null;          // open of the bar 24h ago
    if (ref > 0) change24h = ((price - ref) / ref) * 100;
  } catch { /* fall through */ }
  if (change24h == null && open24 > 0) change24h = ((price - open24) / open24) * 100;
  return { price, change24h, candles };
}

// Mutates allData in place. Returns a freshness record for the brief + prompt.
export async function ensureFresh(allData, { fetcher = fetchLiveKraken, now = Date.now() } = {}) {
  const ageH = cacheAgeHours(allData.cachedAt, now);
  const rec = {
    cachedAt: allData.cachedAt || null,
    ageHours: ageH == null ? null : Math.round(ageH * 10) / 10,
    status: 'FRESH',
    liveRefreshed: [],
    staleFields: [],
    staleSnapshotPrice: allData.market?.price ?? null,
  };
  if (ageH != null && ageH <= STALE_HOURS) return rec;

  rec.status = 'STALE';
  try {
    const live = await fetcher();
    const oldPrice = allData.market?.price;
    allData.market = { ...allData.market, price: Math.round(live.price * 10) / 10,
      marketCap: (allData.market?.marketCap && oldPrice) ? allData.market.marketCap * (live.price / oldPrice) : allData.market?.marketCap,
      change24h: live.change24h != null ? Math.round(live.change24h * 100) / 100 : allData.market?.change24h,
      priceSource: 'Kraken (live refresh at brief time)' };
    rec.liveRefreshed.push('price', 'change24h', 'marketCap');
    const amt = computeAMT(live.candles, live.price, { lookback: 30, shortLookback: 7 });
    if (amt) {
      amt.asOf = live.candles[live.candles.length - 2].date;
      amt.liveRefreshed = true;
      allData.amt = amt;
      rec.liveRefreshed.push('amt');
    }
    rec.livePrice = allData.market.price;
    rec.liveRefreshAt = new Date(now).toISOString();
    allData.liveRefreshAt = rec.liveRefreshAt;
  } catch (e) {
    rec.status = 'STALE_UNREFRESHED';
    rec.refreshError = e.message;
  }
  // Everything not refreshed above still comes from the old cache.
  rec.staleFields = ['funding/OI/F&G', 'tech (SMAs/RSI)', 'ETF flows', 'on-chain (MVRV/LTH/exchange flow)',
    'CME basis', 'macro', 'options', 'news', 'phase anchors']
    .concat(rec.liveRefreshed.includes('price') ? [] : ['price'])
    .concat(rec.liveRefreshed.includes('amt') ? [] : ['amt']);
  return rec;
}

export function buildFreshnessBlock(rec) {
  if (!rec || rec.status === 'FRESH') return '';
  const age = rec.ageHours != null ? `${rec.ageHours}h` : 'an unknown time';
  const lines = [
    `\n⚠ DATA FRESHNESS WARNING — the data cache was built ${age} ago (cachedAt ${rec.cachedAt || 'unknown'}). The 6-hourly refresh has missed cycles.`,
  ];
  if (rec.liveRefreshed.length) {
    lines.push(`  LIVE (refreshed now): ${rec.liveRefreshed.join(', ')}. Snapshot price was $${rec.staleSnapshotPrice?.toLocaleString()}; live price is $${rec.livePrice?.toLocaleString()}. Use the LIVE price and the AMT block for priceAnalysis, auctionState and todayAction.`);
  } else {
    lines.push(`  Live refresh FAILED (${rec.refreshError}). Price and AMT below are ${age} old — do NOT present them as current.`);
  }
  lines.push(`  STILL STALE (${age} old): ${rec.staleFields.join(', ')}.`,
    `  INSTRUCTION: Do not describe stale values as today's readings. Name the data age in riskWarning. Where a score axis rests mainly on stale inputs, say so in that axis's signal text. Do not let a stale snapshot price drive the price/auction axes.\n`);
  return lines.join('\n');
}
