'use strict';
// FW1 forward test (FORWARD-FW1.md §Forward test). Frozen before the first FW1 record (hash in the doc).
// Input: frozen daily records (Worker /v2/frozen rows, oldest first) and Coinbase daily bars {d,o,h,l,c}.
// The series is the calendar from the first frozen record carrying FW1 up to the last day whose 7-day
// outcome is complete; missing and withheld days are nulls INSIDE the series (they rotate with it).
const S = require('./stats.js');
const DAY = 864e5;
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const monthsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (30.4375 * DAY);
const BANDS = ['Strong bear', 'Bear', 'Neutral', 'Bull', 'Strong bull'];
const C = { checkpoints: [12, 18, 24], minEpisodes: 20, minShift: 30, alpha: 0.05, beyondTrendP: 0.20, maeMargin: -0.01, blockFloor: 10, reps: 10000, seed: 20261106, minBandEpisodes: 10, cost: 0.001, minLongShare: 0.10 };

function series(frozen, bars) {
  const byD = new Map(bars.map(b => [b.d, b]));
  const have = new Map(frozen.map(f => [f.date, f]));
  const first = frozen.filter(f => !f.missing && f.engine && f.engine.fw1).map(f => f.date).sort()[0];
  if (!first) return null;
  const rows = [];
  for (let d = first; byD.get(add(d, 6)); d = add(d, 1)) {
    const f = have.get(d); const e = byD.get(add(d, -1)); const w = []; for (let k = 0; k <= 6; k++) w.push(byD.get(add(d, k)));
    const fw = f && !f.missing && f.engine && f.engine.fw1 ? f.engine.fw1 : null;
    const sc = c => (c && !c.withheld && Number.isFinite(c.score) ? c.score : null);
    rows.push({ d, entry: sc(fw && fw.entry), tendency: sc(fw && fw.tendency), e1: f && f.engine && f.engine.families && Number.isFinite(f.engine.families.E1?.score) ? f.engine.families.E1.score : null,
      ret7: e && w.every(Boolean) ? w[6].c / e.c - 1 : null, mae7: e && w.every(Boolean) ? Math.min(...w.map(b => b.l)) / e.c - 1 : null,
      lr: e && byD.get(d) ? Math.log(byD.get(d).c / e.c) : null });
  }
  return { first, rows };
}

function bandOf(s) { return s == null ? null : s >= 6 ? 'Strong bull' : s >= 3 ? 'Bull' : s >= -2 ? 'Neutral' : s >= -5 ? 'Bear' : 'Strong bear'; }

function entryVerdict(rows, now) {
  const N = rows.length; const sc = rows.map(r => r.entry), e1 = rows.map(r => r.e1), ret = rows.map(r => r.ret7), mae = rows.map(r => r.mae7);
  const bull = s => (s == null ? null : s >= 3);
  const ep = S.episodes(sc.map(s => (s == null ? null : s >= 3 ? 'bullPlus' : 'other')));
  const h1 = S.circularShiftP(N, k => S.diffMeans(S.rotate(sc, k).map(bull), ret), C.minShift);
  const bt = S.circularShiftP(N, k => { const a = S.rotate(sc, k), b = S.rotate(e1, k); const both = a.map((x, i) => x != null && b[i] != null); return S.diffMeans(a.map((x, i) => (both[i] ? bull(x) : null)), ret) - S.diffMeans(b.map((x, i) => (both[i] ? bull(x) : null)), ret); }, C.minShift);
  const block = Math.max(C.blockFloor, Math.ceil(S.politisWhite(sc)));
  const boot = S.circularBlockBootstrap(N, block, C.reps, idx => S.diffMeans(idx.map(i => bull(sc[i])), idx.map(i => mae[i])), C.seed);
  const maeLow = S.quantile(boot, 0.025);
  const epB = S.episodes(sc.map(bandOf)); const elig = BANDS.filter(b => (epB[b] || 0) >= C.minBandEpisodes);
  const means = Object.fromEntries(BANDS.map(b => { const v = ret.filter((x, i) => x != null && bandOf(sc[i]) === b); return [b, v.length ? S.mean(v) : null]; }));
  let order = elig.length >= 2; for (let i = 1; i < elig.length; i++) if (means[elig[i]] < means[elig[i - 1]]) order = false;
  const pass = h1.observed > 0 && h1.p < C.alpha && bt.observed > 0 && Number.isFinite(maeLow) && maeLow > C.maeMargin && order;
  return { days: N, episodes: { bullPlus: ep.bullPlus || 0, other: ep.other || 0, byBand: epB }, H1: { stat: h1.observed, p: h1.p }, beyondTrend: { stat: bt.observed, p: bt.p },
    risk: { maeDiffLow025: maeLow, block }, order: { eligible: elig, means, ok: order }, pass,
    label: !pass ? 'failed' : bt.p < C.beyondTrendP ? 'passed — adds beyond trend' : 'passed — the trend-led score works (additions not shown to add value)' };
}

function tendencyVerdict(rows, bars) {
  const closes = bars.map(b => b.c), idx = new Map(bars.map((b, i) => [b.d, i]));
  const sma = i => (i >= 199 ? closes.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200 : null);
  const r = rows.filter(x => x.lr != null); const lr = r.map(x => x.lr);
  const rule = r.map(x => (x.tendency != null && x.tendency >= 3 ? 1 : 0));
  const ma = r.map(x => { const i = idx.get(add(x.d, -1)); const a = sma(i), b = sma(i - 20); return a != null && b != null && closes[i] > a && a > b ? 1 : 0; });
  const R = S.exposureBacktest(rule, lr, C.cost), A = S.exposureBacktest(r.map(() => 1), lr, C.cost), M = S.exposureBacktest(ma, lr, C.cost);
  const longShare = rule.reduce((a, b) => a + b, 0) / (rule.length || 1);
  const pass = R.ratio > A.ratio && R.ratio > M.ratio && R.ratio > 0 && longShare >= C.minLongShare;
  return { rule: R, alwaysLong: A, sma200: M, longShare, pass, label: pass ? 'forward-consistent (one regime)' : 'failed' };
}

// Status at time `nowIso`. Extensions are decided by episode counts only, never by p-values.
function fw1Status(frozen, bars, nowIso) {
  const s = series(frozen, bars); if (!s) return { status: 'not started' };
  const age = monthsBetween(s.first, nowIso); const out = { first: s.first, months: Math.round(age * 10) / 10, days: s.rows.length, constants: C };
  const cp = [...C.checkpoints].reverse().find(m => age >= m);
  if (!cp) return { ...out, status: 'collecting', nextCheck: `${C.checkpoints[0]} months` };
  const ep = S.episodes(s.rows.map(r => (r.entry == null ? null : r.entry >= 3 ? 'bullPlus' : 'other')));
  const enough = (ep.bullPlus || 0) >= C.minEpisodes && (ep.other || 0) >= C.minEpisodes;
  const final = cp === 24;
  if (!enough && !final) return { ...out, status: 'extended (episodes)', episodes: ep, nextCheck: `${C.checkpoints[C.checkpoints.indexOf(cp) + 1]} months` };
  const entry = enough ? entryVerdict(s.rows, nowIso) : { pass: false, label: 'failed — too few episodes at 24 months', episodes: ep };
  return { ...out, status: 'decided', checkpoint: cp, entry, tendency: final ? tendencyVerdict(s.rows, bars) : { status: 'decided at 24 months' } };
}

module.exports = { fw1Status, series, entryVerdict, tendencyVerdict, C };
