'use strict';
// Live view builder (STAGE3-PLAN §2–§3). Pure: history files + daily.json + live readings → engine view.
// History/live join rule: keyed by date. History wins up to its last row; daily.json rows are used after
// it. Where both have a row for the same date the values are compared: a disagreement beyond tolerance
// is reported in `joinIssues` (and the family is NOT silently fixed). Duplicates inside one source are
// rejected (the source is treated as unusable for that series).
const V = require('./view.js');
const DAY = 86400;
const iso = t => new Date(t * 1000).toISOString().slice(0, 10);

// Relative tolerances for overlap checks (declared here; reported, not scored).
const TOL = { bars: 0.002, fng: 0, mvrv: 0.01, stable: 0.01, lthSupply: 0.002, prem: 1e-6 };

function join(name, hist, live, tol, issues, valueOf = r => r.v) {
  const seen = new Set();
  for (const r of live) { if (seen.has(r.d)) { issues.push({ series: name, issue: `duplicate date ${r.d} in daily.json — daily rows ignored` }); return hist.slice(); } seen.add(r.d); }
  const last = hist.length ? hist[hist.length - 1].d : '';
  const byD = new Map(hist.map(r => [r.d, r]));
  for (const r of live) {
    const h = byD.get(r.d); if (!h) continue;
    const a = valueOf(h), b = valueOf(r);
    const rel = Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
    if (tol === 0 ? a !== b : rel > tol) issues.push({ series: name, issue: `overlap ${r.d}: history ${a} vs daily ${b}` });
  }
  return hist.concat(live.filter(r => r.d > last));
}

// hist: parsed history files (as for view.prepare); P: optional cached prepare(hist) result.
// daily: parsed daily.json; live: { nowMs, premium8h (fraction), e5aZ }.
function liveView({ hist, P, daily, live }) {
  P = P || V.prepare(hist);
  const s = (daily && daily.series) || {};
  const issues = [];
  const dailyBars = (s.daily_candles?.rows || []).map(r => ({ d: r.d, o: r.o, h: r.h, l: r.l, c: r.c, v: Number.isFinite(r.v_cb) && Number.isFinite(r.v_bs) ? r.v_cb + r.v_bs : null }));
  const bars = join('daily_bars', P.bars, dailyBars, TOL.bars, issues, r => r.c);
  const prem = join('premium8h', P.prem, s.premium8h?.rows || [], TOL.prem, issues);
  const fng = join('fear_greed', P.fng, s.fear_greed?.rows || [], TOL.fng, issues);
  const mvrv = join('mvrv', P.mvrv, s.mvrv?.rows || [], TOL.mvrv, issues);
  const stable = join('stablecoins', P.stable, s.stablecoin_supply?.rows || [], TOL.stable, issues);
  const supplyHist = (hist.bmp_lth?.rows || []).map(r => ({ d: iso(r.t), v: r.v }));
  const supply = join('lth_supply', supplyHist, s.lth_supply?.rows || [], TOL.lthSupply, issues);
  const lth30 = V.lthNet30(supply.map(r => ({ t: Date.parse(r.d + 'T00:00:00Z') / 1000, v: r.v }))).map(r => ({ d: iso(r.t), v: r.v }));
  const D = new Date(live.nowMs).toISOString().slice(0, 10);
  // live.premium8h: fraction, mean of 8 completed hourly closes (same definition as view.js). Legacy % input accepted.
  const cur = Number.isFinite(live.premium8h) ? live.premium8h : Number.isFinite(live.premium8hPct) ? live.premium8hPct / 100 : null;
  return {
    view: {
      date: D,
      bars: bars.filter(b => b.d < D),
      premium8h: { refs: prem.filter(r => r.d < D), current: cur },
      e5aZ: Number.isFinite(live.e5aZ) ? live.e5aZ : null,
      fng, mvrv, lth30, stable,
    },
    joinIssues: issues,
  };
}

module.exports = { liveView, join, TOL };
