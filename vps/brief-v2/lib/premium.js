'use strict';
// E3a perp premium (DESIGN v0.4 §3.2; STAGE2-PLAN §8.6).
// Scored series: rolling 8 h mean of Binance BTCUSDT premium-index 1-minute closes (completed minutes).
// Check series: Binance's funding rebuilt from the premium over each funding window with the clamp rule
//   funding ≈ P + clamp(I − P, −0.05%, +0.05%), I = 0.01% per 8 h (scaled to the live interval),
// compared with the actual funding prints. OKX and Bybit 8 h premium means are cross-checks only.
const MIN = 60 * 1000;
const KEEP_MIN = 11 * 60;                 // keep 11 h of 1-minute bars (8 h window + funding-window checks)
const XCHECK_PP = 0.03;                   // declared: |Binance − median(OKX, Bybit)| above 0.03 percentage points = CROSSCHECK_FAIL

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// bars: [{t (ms open time), c (fraction)}]; returns merged, de-duplicated, trimmed, completed minutes only
function mergeBars(old = [], add = [], nowMs) {
  const m = new Map(old.map(b => [b.t, b]));
  for (const b of add) if (b.t + MIN <= nowMs && Number.isFinite(b.c) && b.c !== 0) m.set(b.t, b);   // exact zero = placeholder → dropped
  const cut = nowMs - KEEP_MIN * MIN;
  return [...m.values()].filter(b => b.t >= cut).sort((a, b) => a.t - b.t);
}

function rollingMean(bars, nowMs, hours = 8) {
  const from = nowMs - hours * 60 * MIN;
  const w = bars.filter(b => b.t >= from && b.t + MIN <= nowMs);
  const expected = hours * 60;
  return { value: w.length ? mean(w.map(b => b.c)) : null, bars: w.length, coverage: w.length / expected };
}

// Rebuild one funding print at time T (ms) with interval hours.
// weighted=true: Binance's documented method, a time-weighted average with weights 1..n rising
// toward the end of the interval (the GATED check series). weighted=false: plain mean (reported
// alongside). On hourly history 2020→2026 both matched 7,159 prints to a 0.16 bp median.
// Interest (0.01%/8h) and clamp (±0.05%) are scaled for non-8 h intervals — verify on VPS if
// Binance ever moves BTCUSDT off 8 h (it reports the interval in fundingInfo).
function rebuildFunding(bars, T, intervalH, weighted = true) {
  const w = bars.filter(b => b.t >= T - intervalH * 60 * MIN && b.t < T).sort((a, b) => a.t - b.t);
  if (w.length < intervalH * 60 * 0.9) return null;
  const start = T - intervalH * 60 * MIN;
  let P;
  if (weighted) { let sw = 0, sx = 0; for (const b of w) { const k = Math.round((b.t - start) / MIN) + 1; sw += k; sx += k * b.c; } P = sx / sw; }
  else P = mean(w.map(b => b.c));
  const I = 0.0001 * (intervalH / 8);
  const cap = 0.0005 * (intervalH / 8);
  return P + Math.min(cap, Math.max(-cap, I - P));
}

async function collectBinance(http, state, nowMs) {
  const prev = state.premiumBars || [];
  const last = prev.length ? prev[prev.length - 1].t : nowMs - KEEP_MIN * MIN;
  const start = last + MIN;
  const limit = Math.min(1000, Math.max(1, Math.ceil((nowMs - start) / MIN) + 1));
  // weight: limit <100 → 1, <500 → 2, ≤1000 → 5. After the first run this is ~15 bars (weight 1).
  const rows = await http.json('binance_premium_1m', `https://fapi.binance.com/fapi/v1/premiumIndexKlines?symbol=BTCUSDT&interval=1m&startTime=${start}&limit=${limit}`);
  const bars = mergeBars(prev, rows.map(r => ({ t: Number(r[0]), c: Number(r[4]) })), nowMs);
  state.premiumBars = bars;
  return bars;
}

async function fundingInterval(http) {
  // /fapi/v1/fundingInfo lists only symbols with an adjusted interval/cap; absent → 8 h.
  const info = await http.json('binance_funding_info', 'https://fapi.binance.com/fapi/v1/fundingInfo');
  const row = Array.isArray(info) ? info.find(x => x.symbol === 'BTCUSDT') : null;
  return { hours: row?.fundingIntervalHours ? Number(row.fundingIntervalHours) : 8, source: row ? 'fundingInfo' : 'default (BTCUSDT not adjusted)' };
}

async function fundingChecks(http, bars, intervalH) {
  const prints = await http.json('binance_funding_prints', 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=5');
  return prints.map(p => {
    const T = Number(p.fundingTime); const actual = Number(p.fundingRate);
    const rebuilt = rebuildFunding(bars, T, intervalH, true);
    const plain = rebuildFunding(bars, T, intervalH, false);
    const bp = x => x == null || !Number.isFinite(actual) ? null : Math.round((x - actual) * 1e4 * 1000) / 1000;
    return { fundingTime: new Date(T).toISOString(), actual, rebuilt_weighted: rebuilt, err_bp: bp(rebuilt), err_bp_plain_mean: bp(plain) };
  });
}

async function okxPremium8h(http, nowMs) {
  const from = nowMs - 8 * 60 * MIN; let after = ''; const vals = [];
  for (let i = 0; i < 6; i++) {
    const j = await http.json('okx_premium', `https://www.okx.com/api/v5/public/premium-history?instId=BTC-USDT-SWAP${after}`, { store: i === 0 });
    const d = j?.data || []; if (!d.length) break;
    for (const r of d) { const t = Number(r.ts); if (t >= from) vals.push(Number(r.premium)); }
    const oldest = Number(d[d.length - 1].ts); if (oldest < from) break;
    after = `&after=${oldest}`;
  }
  // coverage: OKX sampling is about one value per minute (verify on VPS); report how much of 8 h was reached
  return vals.length ? { value: mean(vals), n: vals.length, coverage: Math.min(1, vals.length / 480) } : { value: null, n: 0, coverage: 0 };
}

async function bybitPremium8h(http) {
  const j = await http.json('bybit_premium', 'https://api.bybit.com/v5/market/premium-index-price-kline?category=linear&symbol=BTCUSDT&interval=1&limit=480');
  const rows = j?.result?.list || [];
  const vals = rows.slice(1).map(r => Number(r[4])).filter(Number.isFinite);      // newest first; [0] is the open minute
  return vals.length ? { value: mean(vals), n: vals.length } : { value: null, n: 0 };
}

async function computeE3a(http, state, nowMs) {
  const res = { scored: null, check: null, crosscheck: null, errors: [] };
  let bars = state.premiumBars || [];
  try { bars = await collectBinance(http, state, nowMs); } catch (e) { res.errors.push(`binance premium: ${e.message}`); }
  const rm = rollingMean(bars, nowMs, 8);
  let intervalH = 8, intervalSrc = 'default';
  try { const fi = await fundingInterval(http); intervalH = fi.hours; intervalSrc = fi.source; } catch (e) { res.errors.push(`fundingInfo: ${e.message}`); }
  try { res.check = { intervalH, intervalSrc, prints: await fundingChecks(http, bars, intervalH) }; } catch (e) { res.errors.push(`funding prints: ${e.message}`); }
  const xs = {};
  try { xs.okx = await okxPremium8h(http, nowMs); } catch (e) { xs.okx = { value: null, error: e.message }; }
  try { xs.bybit = await bybitPremium8h(http); } catch (e) { xs.bybit = { value: null, error: e.message }; }
  const others = [xs.okx.coverage >= 0.5 ? xs.okx.value : null, xs.bybit.value].filter(v => v != null && Number.isFinite(v));
  let xStatus = 'MISSING', diffPP = null;
  if (rm.value != null && others.length) { diffPP = (rm.value - median(others)) * 100; xStatus = Math.abs(diffPP) <= XCHECK_PP ? 'OK' : 'CROSSCHECK_FAIL'; }
  res.crosscheck = { okx_coverage: xs.okx.coverage ?? null, okx_pct: xs.okx.value == null ? null : xs.okx.value * 100, bybit_pct: xs.bybit.value == null ? null : xs.bybit.value * 100, diff_pp: diffPP, tolerance_pp: XCHECK_PP, status: xStatus };
  const fresh = rm.coverage >= 0.9;
  res.scored = {
    value: fresh ? rm.value * 100 : null, unit: '%', window: '8h rolling mean of 1m closes', bars: rm.bars, coverage: Math.round(rm.coverage * 1000) / 1000,
    asOf: bars.length ? new Date(bars[bars.length - 1].t + MIN).toISOString() : null,
    quality: !bars.length ? 'MISSING' : !fresh ? 'STALE' : xStatus === 'CROSSCHECK_FAIL' ? 'CROSSCHECK_FAIL' : 'OK',
  };
  return res;
}

module.exports = { computeE3a, mergeBars, rollingMean, rebuildFunding, XCHECK_PP };
