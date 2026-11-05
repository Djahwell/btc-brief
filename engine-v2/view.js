'use strict';
// Point-in-time view builder for history (Stage 4 backtest, golden files, parity checks).
// STAGE4-PLAN §2: every input is cut at D 00:00 UTC with the declared publish lags.
// The engine applies the daily-series lags itself (evaluate → usable()); this file only
// (1) normalises the v2-data history files, (2) builds the intraday-derived readings
// (E3a 8 h premium mean, E5a z) from completed hours before D 00:00.
const H = 3600, DAY = 86400;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// E5a — identical definition to vps/brief-v2/lib/cbpremium.js computeFromLegs (parity-tested).
function e5aFromAdj(adjRows, endSec) {
  // adjRows: [{t, adj}] sorted, adj in %, only hours < endSec are used.
  const rows = adjRows.filter(r => r.t < endSec && r.t >= endSec - 31 * DAY);
  const last24 = rows.filter(r => r.t >= endSec - 24 * H).map(r => r.adj);
  const curDayStart = Math.floor(endSec / DAY) * DAY;
  const byDay = new Map();
  for (const r of rows) { const d = Math.floor(r.t / DAY) * DAY; if (d >= curDayStart) continue; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r.adj); }
  const days = [...byDay.keys()].sort((a, b) => a - b).slice(-30).filter(d => byDay.get(d).length >= 20);
  const Dm = days.map(d => median(byDay.get(d)));
  const value = last24.length >= 20 ? median(last24) : null;
  if (value == null || Dm.length < 25) return { value, z: null };
  const mu = Dm.reduce((s, x) => s + x, 0) / Dm.length;
  const sd = Math.sqrt(Dm.reduce((s, x) => s + (x - mu) ** 2, 0) / Dm.length);
  return { value, z: sd > 0 ? (value - mu) / sd : null };
}

// T2 — same definition as scripts/v2/lthalign.mjs lthNet30 (parity-tested): calendar 30-day change ÷ days,
// base = latest row on or before d − 30, span ≤ 35 days (the BMP trace has missing days).
function lthNet30(rows) {
  const out = []; let k = 0;
  for (let i = 0; i < rows.length; i++) {
    const target = rows[i].t - 30 * DAY;
    while (k + 1 < rows.length && rows[k + 1].t <= target) k++;
    if (rows[k].t > target) continue;
    const span = (rows[i].t - rows[k].t) / DAY;
    if (span > 35) continue;
    out.push({ t: rows[i].t, v: (rows[i].v - rows[k].v) / span });
  }
  return out;
}

// hist: parsed history files keyed by name (as in v2-data/v2/history, gunzipped JSON).
function prepare(hist) {
  const bs = new Map(hist.bitstamp_daily.rows.map(r => [r.t, r.v]));
  const bars = hist.coinbase_daily.rows.map(r => ({ d: iso(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v + (bs.get(r.t) || 0) }));
  // E3a: one reading per day = mean of the 8 hourly closes ending at that day's 00:00 (all 8 required).
  const ph = new Map(hist.binance_premium_index_1h.rows.map(r => [r.t, r.close]));
  const prem = [];
  const t0 = Math.ceil(hist.binance_premium_index_1h.rows[0].t / DAY) * DAY;
  const t1 = hist.binance_premium_index_1h.rows[hist.binance_premium_index_1h.rows.length - 1].t + H;
  for (let d = t0; d <= t1; d += DAY) {
    const xs = []; for (let k = 8; k >= 1; k--) { const v = ph.get(d - k * H); if (v != null) xs.push(v); }
    if (xs.length === 8) prem.push({ d: iso(d), v: xs.reduce((s, x) => s + x, 0) / 8 });
  }
  const adj = hist.coinbase_premium_legs_1h.rows
    .filter(r => r.cb > 0 && r.bn > 0 && r.usdt > 0)
    .map(r => ({ t: r.t, adj: (r.cb / (r.bn * r.usdt) - 1) * 100 }))
    .sort((a, b) => a.t - b.t);
  let firstUsdc = null;
  const stable = [];
  for (const r of hist.stablecoins_usdt_usdc.rows) {
    if (r.usdc != null && firstUsdc == null) firstUsdc = r.t;
    if (r.usdt == null) continue;
    if (firstUsdc != null && r.t >= firstUsdc && r.usdc == null) continue;   // once USDC exists, both legs are required
    stable.push({ d: iso(r.t), v: r.usdt + (r.usdc || 0) });
  }
  return {
    bars, prem, adj, stable,
    fng: hist.fear_greed.rows.map(r => ({ d: iso(r.t), v: r.v })),
    mvrv: hist.coinmetrics_mvrv.rows.map(r => ({ d: iso(r.t), v: r.v })),
    lth30: hist.bmp_lth ? lthNet30(hist.bmp_lth.rows).map(r => ({ d: iso(r.t), v: r.v })) : [],
  };
}

// View for evaluation day D ('YYYY-MM-DD'), cut at D 00:00 UTC.
function viewAt(P, D) {
  const endSec = Date.parse(D + 'T00:00:00Z') / 1000;
  const prem = P.prem.filter(r => r.d <= D);
  const cur = prem.length && prem[prem.length - 1].d === D ? prem[prem.length - 1].v : null;
  // E5a: binary-search the window to keep the backtest fast.
  let lo = 0, hi = P.adj.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (P.adj[m].t < endSec - 31 * DAY) lo = m + 1; else hi = m; }
  const win = []; for (let i = lo; i < P.adj.length && P.adj[i].t < endSec; i++) win.push(P.adj[i]);
  const e5 = e5aFromAdj(win, endSec);
  return {
    date: D,
    bars: P.bars.filter(b => b.d < D),
    premium8h: { refs: prem.filter(r => r.d < D), current: cur },
    e5aZ: e5.z,
    fng: P.fng, mvrv: P.mvrv, lth30: P.lth30, stable: P.stable,
  };
}

module.exports = { prepare, viewAt, e5aFromAdj, lthNet30 };
