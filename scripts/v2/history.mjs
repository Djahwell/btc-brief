#!/usr/bin/env node
// BTC Brief V2 — history files for Stage 4 (expanding windows from 2018, point-in-time tests).
// STAGE2-PLAN v1.1 §7. Free sources only. Writes OUT/history/*.json.gz + manifest.json
// (sha256, rows, first/last, gaps). Gaps are recorded, never interpolated.
import { inflateRawSync } from 'zlib';
import { readFileSync, existsSync } from 'fs';
import { fetchBMPLTHData } from './lth.mjs';
import { buildLTHRows } from './lthalign.mjs';
import { getJSON, getBuffer, writeGz, writeJSON, isoDay, coinbaseCandles, bitstampDaily, sleep, CODE_VERSION, unzipFirst, tsSec } from './lib.mjs';

const OUT = process.env.OUT || 'out/v2';
const H = `${OUT}/history`;
const DAY = 86400, HOUR = 3600;
const now = Date.now();
const endDay = Math.floor(now / 1000 / DAY) * DAY;
const endHour = Math.floor(now / 1000 / HOUR) * HOUR;
let bitstampRows = null;
let prevManifest = null;
try { prevManifest = JSON.parse(readFileSync(`${H}/manifest.json`, 'utf8')); } catch (_) { /* first build */ }
const manifest = { schema: 'brief-v2-history/1', codeVersion: CODE_VERSION, generatedAt: new Date(now).toISOString(), files: {}, errors: [] };

function gapsOf(ts, step) {
  const g = [];
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > step) g.push({ after: new Date(ts[i - 1] * 1000).toISOString(), missing: Math.round((ts[i] - ts[i - 1]) / step) - 1 });
  return g;
}
function save(name, meta, rows, tsOf, step) {
  const ts = rows.map(tsOf);
  const sha256 = writeGz(`${H}/${name}.json.gz`, { ...meta, rows });
  manifest.files[name] = { ...meta, rows: rows.length, first: rows.length ? new Date(ts[0] * 1000).toISOString() : null, last: rows.length ? new Date(ts[ts.length - 1] * 1000).toISOString() : null, gaps: step ? gapsOf(ts, step) : [], sha256 };
  console.log(`[v2-history] ${name}: ${rows.length} rows, gaps ${manifest.files[name].gaps.length}`);
}
async function step(name, fn) { try { await fn(); } catch (e) { manifest.errors.push({ file: name, error: String(e?.message || e).slice(0, 200) }); console.warn(`[v2-history] ${name} FAILED: ${e?.message || e}`); } }

function* months(fromY, fromM) {
  const d = new Date(Date.UTC(fromY, fromM - 1, 1));
  const lastFull = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 1, 1));
  while (d <= lastFull) { yield `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; d.setUTCMonth(d.getUTCMonth() + 1); }
}
async function binanceArchive(kind, path, fromY, fromM, parse) {
  const rows = []; const missing = [];
  for (const m of months(fromY, fromM)) {
    try {
      const txt = unzipFirst(await getBuffer(`https://data.binance.vision/data/futures/um/monthly/${path}-${m}.zip`));
      for (const line of txt.split('\n')) { if (!line || !/^\d/.test(line)) continue; const r = parse(line.split(',')); if (r) rows.push(r); }
    } catch (e) { missing.push({ month: m, error: String(e.status || e.message).slice(0, 40) }); }
    await sleep(150);
  }
  const by = new Map(rows.map(r => [r.t, r])); return { rows: [...by.values()].sort((a, b) => a.t - b.t), missing };
}

// 1. Daily candles (Coinbase 2015→, Bitstamp 2014→)
await step('coinbase_daily', async () => {
  const rows = await coinbaseCandles('BTC-USD', DAY, Date.UTC(2015, 6, 20) / 1000, endDay);
  save('coinbase_daily', { source: 'Coinbase BTC-USD daily', unit: 'USD; v BTC' }, rows, r => r.t, DAY);
});
await step('bitstamp_daily', async () => {
  const rows = await bitstampDaily(Date.UTC(2014, 0, 1) / 1000, endDay);
  bitstampRows = rows;
  save('bitstamp_daily', { source: 'Bitstamp BTC-USD daily', unit: 'USD; v BTC' }, rows, r => r.t, DAY);
});

// 2. Coinbase premium legs, hourly from 2021-05 (USDT-USD listing)
await step('coinbase_premium_legs_1h', async () => {
  const s = Date.UTC(2021, 4, 1) / 1000;
  const c = await coinbaseCandles('BTC-USD', HOUR, s, endHour);
  const u = await coinbaseCandles('USDT-USD', HOUR, s, endHour);
  const b = new Map();
  let st = s * 1000;
  while (st < endHour * 1000) {
    const r = await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&startTime=${st}`);
    if (!r.length) break;
    for (const x of r) if (x[0] / 1000 < endHour) b.set(x[0] / 1000, Number(x[4]));
    st = r[r.length - 1][0] + 1; if (r.length < 1000) break; await sleep(200);
  }
  const um = new Map(u.map(x => [x.t, x.c]));
  const rows = c.filter(x => um.has(x.t) && b.has(x.t)).map(x => ({ t: x.t, cb: x.c, usdt: um.get(x.t), bn: b.get(x.t), adj_pct: (x.c / (b.get(x.t) * um.get(x.t)) - 1) * 100 }));
  save('coinbase_premium_legs_1h', { source: 'Coinbase BTC-USD, Coinbase USDT-USD, Binance BTCUSDT (vision mirror) hourly closes', unit: 'USD / USDT; adj_pct %' }, rows, r => r.t, HOUR);
});

// 3. Binance premium index (1h) and funding, 2020→ (monthly archive)
await step('binance_premium_index_1h', async () => {
  const { rows, missing } = await binanceArchive('pi', 'premiumIndexKlines/BTCUSDT/1h/BTCUSDT-1h', 2020, 1, f => {
    const t = tsSec(f[0]); const close = Number(f[4]);
    return { t, close: close === 0 ? null : close, open: Number(f[1]) };   // exact zeros = placeholders → missing
  });
  save('binance_premium_index_1h', { source: 'data.binance.vision premiumIndexKlines BTCUSDT 1h', unit: 'fraction', missingMonths: missing }, rows, r => r.t, HOUR);
});
await step('binance_funding', async () => {
  const { rows, missing } = await binanceArchive('fr', 'fundingRate/BTCUSDT/BTCUSDT-fundingRate', 2020, 1, f => ({ t: tsSec(f[0]), interval_h: Number(f[1]), rate: Number(f[2]) }));
  save('binance_funding', { source: 'data.binance.vision fundingRate BTCUSDT', unit: 'fraction per interval', missingMonths: missing }, rows, r => r.t, null);
});

// 4. Fear & Greed, CoinMetrics MVRV, BGeometrics realized price, DefiLlama stablecoins
await step('fear_greed', async () => {
  const j = await getJSON('https://api.alternative.me/fng/?limit=0&format=json');
  const rows = j.data.map(x => ({ t: Number(x.timestamp), v: Number(x.value) })).sort((a, b) => a.t - b.t);
  save('fear_greed', { source: 'alternative.me', unit: 'index' }, rows, r => r.t, DAY);
});
await step('coinmetrics_mvrv', async () => {
  let url = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=10000&start_time=2010-01-01';
  const rows = [];
  while (url) { const j = await getJSON(url); for (const x of j.data) rows.push({ t: Date.parse(x.time) / 1000, v: Number(x.CapMVRVCur) }); url = j.next_page_url; }
  save('coinmetrics_mvrv', { source: 'CoinMetrics community CapMVRVCur', unit: 'ratio', licence: 'CC BY-NC 4.0' }, rows, r => r.t, DAY);
});
await step('bgeometrics_realized', async () => {
  const j = await getJSON('https://bitcoin-data.com/v1/realized-price');
  const rows = j.map(x => ({ t: Number(x.unixTs), v: Number(x.realizedPrice) })).filter(r => r.v > 0).sort((a, b) => a.t - b.t);
  save('bgeometrics_realized', { source: 'BGeometrics free tier', unit: 'USD' }, rows, r => r.t, DAY);
});
await step('stablecoins_usdt_usdc', async () => {
  const [a, b] = await Promise.all([1, 2].map(id => getJSON(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${id}`)));
  const m = new Map();
  for (const [arr, k] of [[a, 'usdt'], [b, 'usdc']]) for (const x of arr) { const t = Number(x.date); const v = x.totalCirculatingUSD?.peggedUSD; if (v != null) m.set(t, { ...(m.get(t) || { t }), [k]: v }); }
  const rows = [...m.values()].sort((x, y) => x.t - y.t);
  save('stablecoins_usdt_usdc', { source: 'DefiLlama', unit: 'USD' }, rows, r => r.t, DAY);
});

// A scraped source must not block the audited files: on failure the previous bmp_lth file is kept
// (the worktree is not cleaned) and the failure is listed under manifest.warnings.
async function softStep(name, fn) { try { await fn(); } catch (e) { const prev = prevManifest?.files?.[name] && existsSync(`${H}/${name}.json.gz`) ? prevManifest.files[name] : null;
  if (prev) manifest.files[name] = { ...prev, keptFrom: prevManifest.generatedAt };
  (manifest.warnings ||= []).push({ file: name, error: String(e?.message || e).slice(0, 200), keptPrevious: !!prev }); console.warn(`[v2-history] ${name} FAILED (kept previous): ${e?.message || e}`); } }

// BMP LTH supply, full trace (T2). Dated by monotonic alignment of BMP's BTC price line to Bitstamp
// closes (lthalign.mjs). Fail closed: median price error > 0.5% or last date > 3 days old → no file.
await softStep('bmp_lth', async () => {
  if (!bitstampRows) throw new Error('needs bitstamp_daily');
  const raw = await fetchBMPLTHData({ full: true });
  const closes = bitstampRows.map(r => ({ d: isoDay(r.t * 1000), c: r.c }));
  const { rows, medianAlignErrPct: med, ambiguousDatePct } = buildLTHRows(raw, closes, endDay);
  save('bmp_lth', { source: 'Bitcoin Magazine Pro LTH supply (full chart trace; dated by price alignment to Bitstamp closes)', unit: 'BTC', medianAlignErrPct: med, ambiguousDatePct, revisionNote: 'values as published at build time; earlier vintages may differ' }, rows, r => r.t, DAY);
});

writeJSON(`${H}/manifest.json`, manifest);
console.log(`[v2-history] manifest written; errors: ${manifest.errors.length}`);
if (manifest.errors.length) process.exitCode = 1;
