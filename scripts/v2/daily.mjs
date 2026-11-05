#!/usr/bin/env node
// BTC Brief V2 — daily inputs job (GitHub Actions, 00:10 and 06:10 UTC).
// STAGE2-PLAN v1.1 §1, §7, §8.10. Writes OUT/daily.json (+ raw vintages).
// Every input carries value/unit/window/asOf/fetchedAt/source/scope/quality/staleAfterSec;
// each input has its own asOf. Missing = null, never 0. Nothing here scores anything.
import { getJSON, writeJSON, writeGz, input, isoDay, coinbaseCandles, bitstampDaily, CODE_VERSION } from './lib.mjs';
import { fetchBMPLTHData } from './lth.mjs';
import { buildLTHRows, lthNet30 } from './lthalign.mjs';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { computeFromLegs } = require('../../vps/brief-v2/lib/cbpremium.js');   // same code as the VPS (STAGE2-PLAN §8.8)

const OUT = process.env.OUT || 'out/v2';
const NOW = Date.now();
const today = isoDay(NOW);
const stamp = new Date(NOW).toISOString().slice(11, 16).replace(':', '');
const DAY = 86400;
const vint = (name, raw) => writeGz(`${OUT}/vintages/${today}/${stamp}-${name}.json.gz`, raw);
const result = { schema: 'brief-v2-daily/1', codeVersion: CODE_VERSION, generatedAt: new Date(NOW).toISOString(), inputs: {}, series: {}, errors: [] };
const fail = (name, e) => { result.errors.push({ input: name, error: String(e?.message || e).slice(0, 200) }); console.warn(`[v2-daily] ${name}: ${e?.message || e}`); };

// Completed UTC days only.
const endSec = Math.floor(NOW / 1000 / DAY) * DAY;
const startSec = endSec - 420 * DAY;

// 1. Daily candles: Coinbase (primary) + Bitstamp (cross-check) — E1, E2, E6, T3
let cb = [], bs = [];
try { cb = await coinbaseCandles('BTC-USD', DAY, startSec, endSec); vint('coinbase_daily', cb); } catch (e) { fail('coinbase_daily', e); }
try { bs = await bitstampDaily(startSec, endSec); vint('bitstamp_daily', bs); } catch (e) { fail('bitstamp_daily', e); }
{
  const last = cb[cb.length - 1];
  const bsLast = bs.find(x => last && x.t === last.t);
  const diffBp = last && bsLast ? Math.round((bsLast.c / last.c - 1) * 1e5) / 10 : null;
  const xOk = diffBp == null ? 'MISSING' : Math.abs(diffBp) <= 25 ? 'OK' : 'CROSSCHECK_FAIL';
  result.inputs.btc_daily_close = input({
    value: last?.c, unit: 'USD', window: '1d', asOf: last ? isoDay(last.t * 1000) : null,
    source: 'Coinbase BTC-USD daily candles', scope: 'Coinbase spot (USD)', quality: last ? (xOk === 'CROSSCHECK_FAIL' ? 'CROSSCHECK_FAIL' : 'OK') : 'MISSING',
    staleAfterSec: 2 * DAY, extra: { crosscheck: { bitstamp_close: bsLast?.c ?? null, diff_bp: diffBp, tolerance_bp: 25, status: xOk } },
  });
  // Series for E1/E2/E6/T3 (last 420 completed days). Profile volume = Coinbase + Bitstamp (fixed USD venue set).
  const bsBy = new Map(bs.map(x => [x.t, x]));
  result.series.daily_candles = {
    unit: 'USD; volume BTC', source: 'Coinbase BTC-USD (OHLC) + Bitstamp BTC-USD (volume added)', scope: 'USD spot venues',
    rows: cb.map(x => ({ d: isoDay(x.t * 1000), o: x.o, h: x.h, l: x.l, c: x.c, v_cb: x.v, v_bs: bsBy.get(x.t)?.v ?? null })),
  };
}

// 2. Fear & Greed — E7
try {
  const j = await getJSON('https://api.alternative.me/fng/?limit=420&format=json'); vint('fng', j);
  const rows = (j.data || []).map(x => ({ d: isoDay(Number(x.timestamp) * 1000), v: Number(x.value) })).sort((a, b) => a.d < b.d ? -1 : 1);
  const last = rows[rows.length - 1];
  result.inputs.fear_greed = input({ value: last?.v, unit: 'index 0-100', window: '1d', asOf: last?.d, source: 'alternative.me Fear & Greed', scope: 'third-party composite (includes momentum and volatility)', quality: 'OK', staleAfterSec: 2 * DAY });
  result.series.fear_greed = { rows };
} catch (e) { fail('fear_greed', e); }

// 3. MVRV — T1: CoinMetrics community (CC BY-NC 4.0, attribution) primary; BGeometrics cross-check
let cmLast = null;
try {
  const start = isoDay((startSec) * 1000);
  const j = await getJSON(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&page_size=10000&start_time=${start}`); vint('coinmetrics_mvrv', j);
  const rows = (j.data || []).map(x => ({ d: x.time.slice(0, 10), v: Number(x.CapMVRVCur) })).filter(x => Number.isFinite(x.v));
  cmLast = rows[rows.length - 1];
  result.series.mvrv = { source: 'CoinMetrics community CapMVRVCur (CC BY-NC 4.0)', rows };
} catch (e) { fail('coinmetrics_mvrv', e); }
let bg = null;
try {
  bg = await getJSON('https://bitcoin-data.com/v1/realized-price/last'); vint('bgeometrics_realized', bg);
} catch (e) { fail('bgeometrics_realized', e); }
{
  // Cross-check on BGeometrics' date: MVRV_bg = Coinbase close ÷ BGeometrics realized price.
  let xs = { status: 'MISSING' };
  const bgD = bg?.d, bgRp = Number(bg?.realizedPrice);
  const cmOnBgDay = bgD && result.series.mvrv?.rows.find(r => r.d === bgD);
  const cbOnBgDay = bgD && result.series.daily_candles?.rows.find(r => r.d === bgD);
  if (cmOnBgDay && cbOnBgDay && bgRp > 0) {
    const diffPct = Math.round((cmOnBgDay.v / (cbOnBgDay.c / bgRp) - 1) * 1e4) / 100;
    xs = { bgeometrics_date: bgD, bgeometrics_realized: bgRp, diff_pct: diffPct, tolerance_pct: 2, status: Math.abs(diffPct) <= 2 ? 'OK' : 'CROSSCHECK_FAIL' };
  }
  result.inputs.mvrv = input({
    value: cmLast?.v, unit: 'ratio', window: '1d', asOf: cmLast?.d, source: 'CoinMetrics community CapMVRVCur', scope: 'network-wide; Coin Metrics data (CC BY-NC 4.0)',
    quality: cmLast ? (xs.status === 'CROSSCHECK_FAIL' ? 'CROSSCHECK_FAIL' : 'OK') : 'MISSING', staleAfterSec: 3 * DAY, extra: { crosscheck: xs, attribution: 'Data: Coin Metrics Community (CC BY-NC 4.0)' },
  });
}

// 4. Stablecoins USDT + USDC — T4
try {
  const [usdt, usdc] = await Promise.all([1, 2].map(id => getJSON(`https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=${id}`)));
  vint('defillama_usdt', usdt.slice(-420)); vint('defillama_usdc', usdc.slice(-420));
  const m = new Map();
  for (const [arr, k] of [[usdt, 'usdt'], [usdc, 'usdc']]) for (const x of arr) {
    const d = isoDay(Number(x.date) * 1000); const v = x.totalCirculatingUSD?.peggedUSD;
    if (v != null) m.set(d, { ...(m.get(d) || { d }), [k]: v });
  }
  const rows = [...m.values()].filter(r => r.usdt != null && r.usdc != null).sort((a, b) => a.d < b.d ? -1 : 1).slice(-420).map(r => ({ d: r.d, v: r.usdt + r.usdc }));
  const last = rows[rows.length - 1];
  result.inputs.stablecoin_supply = input({ value: last?.v, unit: 'USD', window: '1d', asOf: last?.d, source: 'DefiLlama stablecoins (USDT + USDC circulating)', scope: 'USDT + USDC, all chains', quality: 'OK', staleAfterSec: 2 * DAY });
  result.series.stablecoin_supply = { rows };
} catch (e) { fail('stablecoin_supply', e); }

// 5. LTH supply — T2. Full BMP trace dated by price alignment to Bitstamp closes; the SAME code as
//    the history file (lthalign.mjs buildLTHRows), so live and backtest share one definition.
try {
  const raw = await fetchBMPLTHData({ full: true }); vint('bmp_lth_full', raw);
  if (!bs.length) throw new Error('needs Bitstamp daily closes for dating');
  const closes = bs.map(r => ({ d: isoDay(r.t * 1000), c: r.c }));
  const { rows, medianAlignErrPct, last } = buildLTHRows(raw, closes, endSec);
  const net = lthNet30(rows); const cur = net[net.length - 1];
  result.series.lth_supply = { rows: rows.map(r => ({ d: isoDay(r.t * 1000), v: r.v })) };
  result.inputs.lth_net_30d = input({ value: cur ? Math.round(cur.v) : null, unit: 'BTC/day', window: '30-day calendar change ÷ days', asOf: cur ? isoDay(cur.t * 1000) : null, source: 'Bitcoin Magazine Pro LTH supply (full trace; dated by price alignment to Bitstamp)', scope: 'network-wide, single provider', quality: cur && cur.t * 1000 >= Date.parse(last + 'T00:00:00Z') ? 'OK' : 'STALE', staleAfterSec: 3 * DAY, extra: { lth_supply_btc: rows[rows.length - 1].v, align_err_pct: medianAlignErrPct } });
} catch (e) { fail('lth_net_30d', e); }

// 6. E5a reproducibility copy (§8.8): same products, same completed hours, same code as the VPS.
//    The VPS compares its own daily medians with these; > 0.2 bp raises an alarm there.
try {
  const H = 3600; const endH = Math.floor(NOW / 1000 / H) * H; const startH = endH - 31 * 24 * H;
  const legs = async p => new Map((await coinbaseCandles(p, H, startH, endH)).map(x => [x.t, x.c]));
  const cbm = await legs('BTC-USD'); const usm = await legs('USDT-USD');
  const bnm = new Map();
  const rows = await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&startTime=${startH * 1000}`);
  for (const r of rows) { const t = Number(r[0]) / 1000; if (t >= startH && t < endH) bnm.set(t, Number(r[4])); }
  const r = computeFromLegs(cbm, usm, bnm, endH);
  result.inputs.coinbase_premium_adj_repro = input({ value: r.value, unit: '%', window: '24h median (reproducibility copy; the VPS value is the live one)', asOf: r.lastHour ? new Date((r.lastHour + H) * 1000).toISOString() : null, source: 'Coinbase BTC-USD, Coinbase USDT-USD, Binance BTCUSDT (vision), hourly', scope: 'reproducibility check only', quality: 'OK', staleAfterSec: DAY, extra: { z30: r.z, dayMedians: r.dayMedians } });
} catch (e) { fail('coinbase_premium_adj_repro', e); }

// 7. Carry forward (06:10 run): an input that worked earlier today but fails now keeps its last good
//    value with its ORIGINAL asOf, flagged carriedForward, so it is never silently dropped or relabelled.
try {
  const prev = JSON.parse(readFileSync(`${OUT}/daily.json`, 'utf8'));
  for (const [k, v] of Object.entries(prev.inputs || {})) {
    if ((!result.inputs[k] || result.inputs[k].value == null) && v?.value != null) result.inputs[k] = { ...v, carriedForward: true, carriedFrom: prev.generatedAt };
  }
} catch { /* first run: nothing to carry */ }

for (const [k, v] of Object.entries(result.inputs)) if (!v) delete result.inputs[k];
writeJSON(`${OUT}/daily.json`, result);
console.log(`[v2-daily] wrote ${OUT}/daily.json — inputs: ${Object.keys(result.inputs).join(', ')} — errors: ${result.errors.length}`);
for (const [k, v] of Object.entries(result.inputs)) console.log(`  ${k}: ${v.value} (${v.unit}) asOf ${v.asOf} [${v.quality}]`);
