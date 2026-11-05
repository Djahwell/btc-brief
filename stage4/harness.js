'use strict';
// Stage 4 test harness (STAGE4-DECLARATION §A–§G, §K). Frozen with the declaration (hash in §J).
// evaluateRange(): daily engine outputs at D 00:00 (the same engine as live).
// analyze(): outcomes (§C) and every test (§E), sensitivities (§D) — pure given its inputs.
const E = require('../engine-v2/engine.js');
const V = require('../engine-v2/view.js');
const S = require('./stats.js');

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const BANDS = ['Strong bear', 'Bear', 'Neutral', 'Bull', 'Strong bull'];   // ascending

const CONST = {
  entryCandidates: ['V-E1/E6a', 'V-E1/E6b', 'V-E2/E6a', 'V-E2/E6b'],
  tendencyCandidates: ['V-T1/T2+', 'V-T1/T2-'],
  preferenceOrder: ['V-E1/E6a', 'V-E1/E6b', 'V-E2/E6a', 'V-E2/E6b'],
  mainWindow: ['2021-06-01', '2026-10-29'],
  robustnessWindow: ['2019-01-01', '2021-05-31'],
  segments: { S1: ['2019-01-01', '2020-05-10'], S2: ['2020-05-11', '2024-04-19'], S3: ['2024-04-20', '2026-10-31'] },
  bullPlus: 3, minEpisodes: 30, minShift: 60, alpha: 0.05, reps: 10000, seed: 20261105, blockFloor: 20,
  maeMarginPP: 0.005, costPerSwitch: 0.001, sensitivityBlocks: [10, 40, 60],
  lagPlusOne: { fear_greed: 2, mvrv: 3, lth: 3, stablecoins: 3 },   // bars, E3a, E5a unchanged; grace unchanged
};

function evaluateRange(P, decl, from, to) {
  const out = [];
  for (let D = from; D <= to; D = addDays(D, 1)) {
    const r = E.evaluate(V.viewAt(P, D), decl);
    const card = k => (r.scores[k] && !r.scores[k].withheld ? r.scores[k].score : null);
    const row = { d: D, scores: {}, famScores: Object.fromEntries(Object.entries(r.families).map(([k, v]) => [k, v.score ?? null])) };
    for (const k of Object.keys(r.scores)) row.scores[k] = card(k);
    out.push(row);
  }
  return out;
}

function lagPlusOneDecl(decl) { const d = JSON.parse(JSON.stringify(decl)); Object.assign(d.lagsDays, CONST.lagPlusOne); return d; }

// §C outcomes from the frozen Coinbase bars.
function outcomesFor(dates, bars) {
  const byD = new Map(bars.map(b => [b.d, b]));
  return dates.map(D => {
    const e = byD.get(addDays(D, -1)); const w = []; for (let k = 0; k <= 6; k++) w.push(byD.get(addDays(D, k)));
    if (!e || w.some(x => !x)) return { ret7: null, mae7: null };
    return { ret7: w[6].c / e.c - 1, mae7: Math.min(...w.map(b => b.l)) / e.c - 1 };
  });
}

const bandOf = (s, decl) => (s == null ? null : decl.scorecards.bands.find(b => s >= b.min).name);

function entryTests(rows, outs, decl, cand, blockOverride = null) {
  const N = rows.length;
  const sc = rows.map(r => r.scores[cand]); const e1 = rows.map(r => r.scores['E1-alone (baseline)']);
  const ret = outs.map(o => o.ret7), mae = outs.map(o => o.mae7);
  const bull = s => (s == null ? null : s >= CONST.bullPlus);
  // H1
  const h1 = S.circularShiftP(N, k => S.diffMeans(S.rotate(sc, k).map(bull), ret), CONST.minShift);
  // H2: candidate difference minus E1-alone difference on the same dates (both scored); scores rotated jointly.
  const h2stat = k => { const a = S.rotate(sc, k), b = S.rotate(e1, k); const both = a.map((x, i) => (x != null && b[i] != null)); return S.diffMeans(a.map((x, i) => (both[i] ? bull(x) : null)), ret) - S.diffMeans(b.map((x, i) => (both[i] ? bull(x) : null)), ret); };
  const h2 = S.circularShiftP(N, h2stat, CONST.minShift);
  // Episodes: per band, and Bull+ / non-Bull+ as merged labels.
  const epBand = S.episodes(sc.map(s => bandOf(s, decl)));
  const epBull = S.episodes(sc.map(s => (s == null ? null : (s >= CONST.bullPlus ? 'bullPlus' : 'other'))));
  const bullOk = (epBull.bullPlus || 0) >= CONST.minEpisodes && (epBull.other || 0) >= CONST.minEpisodes;
  // C3: circular block bootstrap of (Bull+ MAE − non-Bull+ MAE); upper end = 97.5th percentile.
  const pw = S.politisWhite(sc);
  const block = blockOverride ?? Math.max(CONST.blockFloor, Math.ceil(pw));
  const maeStat = idx => S.diffMeans(idx.map(i => bull(sc[i])), idx.map(i => mae[i]));
  const boot = S.circularBlockBootstrap(N, block, CONST.reps, maeStat, CONST.seed);
  const maeDiff = S.diffMeans(sc.map(bull), mae);
  const c3upper = S.quantile(boot, 0.975);
  // C5: band means non-decreasing over bands with ≥ 30 episodes (needs ≥ 2 such bands) + Spearman.
  const bandMeans = {};
  for (const b of BANDS) { const v = ret.filter((x, i) => x != null && bandOf(sc[i], decl) === b); bandMeans[b] = { n: v.length, episodes: epBand[b] || 0, mean: v.length ? S.mean(v) : null }; }
  const eligible = BANDS.filter(b => bandMeans[b].episodes >= CONST.minEpisodes);
  let mono = eligible.length >= 2; for (let i = 1; i < eligible.length; i++) if (bandMeans[eligible[i]].mean < bandMeans[eligible[i - 1]].mean) mono = false;
  const sp = S.circularShiftP(N, k => S.spearman(S.rotate(sc, k), ret), CONST.minShift);
  return {
    candidate: cand, days: N, scoredDays: sc.filter(x => x != null).length, withheldDays: sc.filter(x => x == null).length,
    H1: { stat: h1.observed, p: h1.p, shifts: h1.shifts }, H2: { stat: h2.observed, p: h2.p },
    episodes: { byBand: epBand, bullPlus: epBull.bullPlus || 0, nonBullPlus: epBull.other || 0, sufficient: bullOk },
    C3: { maeDiff, upper975: c3upper, block, politisWhite: pw, pass: Number.isFinite(c3upper) && c3upper < CONST.maeMarginPP },
    C5: { bandMeans, eligibleBands: eligible, monotone: mono, spearman: sp.observed, spearmanP: sp.p, pass: mono && sp.observed > 0 && sp.p < 0.05 },
  };
}

function tendencyTests(rowsAll, bars, decl, cand, segs = Object.keys(CONST.segments)) {
  const byD = new Map(bars.map(b => [b.d, b]));
  const res = {};
  for (const seg of segs) { const [a, b] = CONST.segments[seg];
    const rows = rowsAll.filter(r => r.d >= a && r.d <= b && byD.get(r.d) && byD.get(addDays(r.d, -1)));
    const lr = rows.map(r => Math.log(byD.get(r.d).c / byD.get(addDays(r.d, -1)).c));
    const rule = rows.map(r => (r.scores[cand] != null && r.scores[cand] >= CONST.bullPlus ? 1 : 0));   // withheld → flat
    const always = rows.map(() => 1);
    // 200-day rule: at D 00:00, long if close(D−1) > SMA200(D−1) and SMA200(D−1) > SMA200(D−21).
    const closes = bars.map(b => b.c); const idx = new Map(bars.map((x, i) => [x.d, i]));
    const sma = i => { if (i < 199) return null; let s = 0; for (let k = i - 199; k <= i; k++) s += closes[k]; return s / 200; };
    const ma = rows.map(r => { const i = idx.get(addDays(r.d, -1)); const s0 = sma(i), s1 = sma(i - 20); return s0 != null && s1 != null && closes[i] > s0 && s0 > s1 ? 1 : 0; });
    const R = S.exposureBacktest(rule, lr, CONST.costPerSwitch), A = S.exposureBacktest(always, lr, CONST.costPerSwitch), M = S.exposureBacktest(ma, lr, CONST.costPerSwitch);
    res[seg] = { days: rows.length, withheldDays: rows.filter(r => r.scores[cand] == null).length, rule: R, alwaysLong: A, sma200: M, beatsBoth: R.ratio > A.ratio && R.ratio > M.ratio };
  }
  return { candidate: cand, segments: res, pass: Object.values(res).every(s => s.beatsBoth) };
}

function analyze({ evals, evalsLag, bars, decl }) {
  const inW = (rows, [a, b]) => rows.filter(r => r.d >= a && r.d <= b);
  const main = inW(evals, CONST.mainWindow); const outs = outcomesFor(main.map(r => r.d), bars);
  const entry = CONST.entryCandidates.map(c => entryTests(main, outs, decl, c));
  const ps = []; entry.forEach(t => ps.push(t.H1.p, t.H2.p));
  const rej = S.holm(ps, CONST.alpha);
  entry.forEach((t, i) => {
    t.H1.holmReject = rej[2 * i]; t.H2.holmReject = rej[2 * i + 1];
    t.pass = t.H1.holmReject && t.H2.holmReject && t.episodes.sufficient && t.C3.pass && t.C5.pass;
    t.passWithoutNumber = t.H1.holmReject && t.H2.holmReject && t.episodes.sufficient && t.C3.pass && !t.C5.pass;   // band shown without the number
  });
  const tendency = CONST.tendencyCandidates.map(c => tendencyTests(evals, bars, decl, c));
  // Sensitivities (reported, never selectable)
  const rob = inW(evals, CONST.robustnessWindow); const robOut = outcomesFor(rob.map(r => r.d), bars);
  const robStat = S.diffMeans(rob.map(r => (r.scores['R-E1E2E7 (robustness 2019–2021)'] == null ? null : r.scores['R-E1E2E7 (robustness 2019–2021)'] >= CONST.bullPlus)), robOut.map(o => o.ret7));
  const primary = entry.find(t => t.candidate === decl.candidates.primary.entry);
  const robustness = { statistic: 'H1 difference, robustness card (E1, E2, E7 at 3/3), Bull+ ≥ +3', value: robStat, primaryMainH1: primary.H1.stat, label: Math.sign(robStat) === Math.sign(primary.H1.stat) ? 'consistent' : 'unstable' };
  const blocks = Object.fromEntries(CONST.sensitivityBlocks.map(b => [b, entryTests(main, outs, decl, decl.candidates.primary.entry, b).C3]));
  let lag = null;
  if (evalsLag) {
    const mainL = inW(evalsLag, CONST.mainWindow); const outsL = outcomesFor(mainL.map(r => r.d), bars);
    lag = { entry: CONST.entryCandidates.map(c => { const t = entryTests(mainL, outsL, decl, c); return { candidate: c, H1: t.H1, H2: t.H2, C3: t.C3.pass, C5: t.C5.pass }; }),
      tendency: CONST.tendencyCandidates.map(c => tendencyTests(evalsLag, bars, decl, c)) };
  }
  const noT2 = tendencyTests(evals, bars, decl, 'T-noT2 (sensitivity)', ['S2', 'S3']);   // S1 excluded (T4 warming up)
  // §K.8 labels
  tendency.forEach(t => { const l = lag && lag.tendency.find(x => x.candidate === t.candidate); t.label = !t.pass ? 'descriptive' : l && !l.pass ? 'lag-sensitive (shown as descriptive)' : 'in-sample consistent'; });
  const entryPassing = CONST.preferenceOrder.filter(c => entry.find(t => t.candidate === c).pass);
  return { constants: CONST, entry, entryPassing, entryChosen: entryPassing[0] || null, tendency, sensitivities: { robustness, blocks, lagPlusOne: lag, tendencyNoT2_S2S3: noT2 } };
}

module.exports = { CONST, evaluateRange, lagPlusOneDecl, outcomesFor, entryTests, tendencyTests, analyze, addDays };
