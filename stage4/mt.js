'use strict';
// Maison Toé relevance report (STAGE4-DECLARATION §G, §M). Descriptive, run once, after the main test.
// For every V4 Stage 3 twin trade (twin R, the per-signal replay) the frozen engine is evaluated at the
// trade's signal time t (UTC), point-in-time:
//   daily families: bars closed before t (d < date(t)), lags relative to date(t) as at D 00:00;
//   E3a: mean of the 8 completed hourly premium-index closes ending at floor_hour(t), refs before date(t);
//   E5a: 24 completed hours ending at floor_hour(t), z against the 30 prior UTC-day medians.
const E = require('../engine-v2/engine.js');
const V = require('../engine-v2/view.js');
const S = require('./stats.js');

const H = 3600;
const BANDS3 = [['≤ −3', s => s <= -3], ['−2…+2', s => s >= -2 && s <= 2], ['≥ +3', s => s >= 3]];
const WINDOW = ['2021-06-01', '2026-10-29'];

function hourlyPremium(hist) { return new Map(hist.binance_premium_index_1h.rows.filter(r => r.close != null && r.close !== 0).map(r => [r.t, r.close])); }

function evalAt(P, ph, decl, tSec) {
  const D = new Date(tSec * 1000).toISOString().slice(0, 10);
  const end = Math.floor(tSec / H) * H;
  const base = V.viewAt(P, D);
  const xs = []; for (let k = 8; k >= 1; k--) { const v = ph.get(end - k * H); if (v == null) break; xs.push(v); }
  let lo = 0, hi = P.adj.length; while (lo < hi) { const m = (lo + hi) >> 1; if (P.adj[m].t < end - 31 * 86400) lo = m + 1; else hi = m; }
  const win = []; for (let i = lo; i < P.adj.length && P.adj[i].t < end; i++) win.push(P.adj[i]);
  const view = { ...base, premium8h: { refs: base.premium8h.refs, current: xs.length === 8 ? xs.reduce((a, b) => a + b, 0) / 8 : null }, e5aZ: V.e5aFromAdj(win, end).z };
  const r = E.evaluate(view, decl);
  const g = k => (r.scores[k] && !r.scores[k].withheld ? r.scores[k].score : null);
  return { entry: g(decl.candidates.primary.entry), e1: g('E1-alone (baseline)'), tendency: g(decl.candidates.primary.tendency) };
}

// Trade-day clustered bootstrap of a statistic over trades (resample UTC days with replacement).
function clusterBoot(trades, stat, reps = 10000, seed = 20261105) {
  const days = [...new Set(trades.map(t => t.day))]; const by = new Map(days.map(d => [d, trades.filter(t => t.day === d)]));
  const rnd = S.mulberry32(seed); const out = [];
  for (let r = 0; r < reps; r++) { const smp = []; for (let i = 0; i < days.length; i++) smp.push(...by.get(days[Math.floor(rnd() * days.length)])); const v = stat(smp); if (Number.isFinite(v)) out.push(v); }
  out.sort((a, b) => a - b); return [S.quantile(out, 0.025), S.quantile(out, 0.975)];
}

function report(trades, key) {
  const scored = trades.filter(t => t[key] != null);
  const bands = BANDS3.map(([name, f]) => {
    const g = scored.filter(t => f(t[key])); const R = g.map(t => t.R);
    return { band: name, n: g.length, tradeDays: new Set(g.map(t => t.day)).size, meanR: g.length ? S.mean(R) : null, winRate: g.length ? R.filter(x => x > 0).length / g.length : null,
      meanR_CI95: g.length >= 5 ? clusterBoot(g, s => S.mean(s.map(t => t.R))) : null };
  });
  const rho = S.spearman(scored.map(t => t[key]), scored.map(t => t.R));
  return { score: key, trades: trades.length, scored: scored.length, withheld: trades.length - scored.length, bands, spearman: rho,
    spearman_CI95: scored.length >= 10 ? clusterBoot(scored, s => S.spearman(s.map(t => t[key]), s.map(t => t.R))) : null };
}

function run({ P, hist, decl, cmp }) {
  const ph = hourlyPremium(hist); const out = {};
  for (const sys of ['box', 'trend']) {
    const trades = [];
    for (const r of cmp[sys]) {
      if (typeof r.twin_R !== 'number' || !Number.isFinite(r.twin_R)) continue;
      const tSec = Date.parse(r.sig.replace(' ', 'T') + ':00Z') / 1000; const day = r.sig.slice(0, 10);
      if (day < WINDOW[0] || day > WINDOW[1]) continue;
      trades.push({ sig: r.sig, day, N: r.N ?? null, R: r.twin_R, ...evalAt(P, ph, decl, tSec) });
    }
    out[sys] = { trades: trades.length, entry: report(trades, 'entry'), e1Alone: report(trades, 'e1'), tendency: report(trades, 'tendency'), rows: trades };
  }
  return { window: WINDOW, note: 'Descriptive, run once. Replay period was also V4 research (all of 2020–2026 seen). E1-alone shown because E1 overlaps the bots\' own trend condition.', ...out };
}

module.exports = { run, evalAt, report, clusterBoot, WINDOW };
