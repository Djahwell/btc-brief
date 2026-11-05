'use strict';
// BTC Brief V2 — scoring engine (Stage 3 §2; constants from declaration.json).
// Pure: no I/O, no clock. The SAME file runs live on the VPS and in the Stage 4 backtest.
//
// evaluate(view, decl) → { date, declarationHash, families, scores, warnings }
// view = {
//   date: 'YYYY-MM-DD'            evaluation day D (inputs cut at D 00:00 UTC)
//   bars: [{d,o,h,l,c,v}]         daily bars (USD spot; v = Coinbase + Bitstamp volume); only d ≤ D−1 are used
//   premium8h: { refs: [{d,v}], current }   one 8 h mean per day (ending at that day's 00:00) + the current reading
//   e5aZ: number|null             Coinbase-premium z (computed from completed hours, see vps/brief-v2/lib/cbpremium.js)
//   fng, mvrv, lth30, stable: [{d,v}]   daily series; lags from the declaration are applied here
// }
const crypto = require('crypto');

const DAY = 86400000;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const roundHalfAway = x => (x < 0 ? -Math.round(-x) : Math.round(x)) + 0;   // + 0 turns −0 into 0
const finite = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function declarationHash(decl) {
  return crypto.createHash('sha256').update(JSON.stringify(decl)).digest('hex');
}

// Mid-rank percentile of x among refs (refs strictly before the current reading), 0..100.
function pctRank(refs, x) {
  let below = 0, equal = 0;
  for (const r of refs) { if (r < x) below++; else if (r === x) equal++; }
  return (below + 0.5 * equal) / refs.length * 100;
}
// Declared mapping: [zeroLow, zeroHigh] → 0; linear to ±max at fullHigh/fullLow.
function mapPct(p, m) {
  if (p > m.zeroHigh) return Math.min(m.max, m.max * (p - m.zeroHigh) / (m.fullHigh - m.zeroHigh));
  if (p < m.zeroLow) return -Math.min(m.max, m.max * (m.zeroLow - p) / (m.zeroLow - m.fullLow));
  return 0;
}

// ---- daily bar features -------------------------------------------------------------
function smaArr(vals, n) {
  const out = new Array(vals.length).fill(null); let s = 0;
  for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
function atrWilder(bars, n) {
  const out = new Array(bars.length).fill(null); let atr = null; const tr = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], pc = i ? bars[i - 1].c : b.c;
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
    if (i === n - 1) atr = mean(tr.slice(0, n));
    else if (i >= n) atr = (atr * (n - 1) + tr[i]) / n;
    if (i >= n - 1) out[i] = atr;
  }
  return out;
}
// Score one daily feature series: value at the last index vs refs = earlier values from referenceStart.
function scoreSeries(series, dates, decl, { contrarian = false } = {}) {
  const i = series.length - 1;
  const x = series[i];
  if (!finite(x)) return { score: null, reason: 'no value' };
  const refs = [];
  for (let k = 0; k < i; k++) if (finite(series[k]) && dates[k] >= decl.referenceStart) refs.push(series[k]);
  if (refs.length < decl.warmupDays) return { score: null, reason: `warm-up (${refs.length}/${decl.warmupDays} reference days)` };
  const p = pctRank(refs, x);
  const s = mapPct(p, decl.percentileMap);
  return { score: contrarian ? -s : s, pct: p, raw: x };
}

// ---- E2: auction location (V1 scripts/amt.js method, declared parameters) ----------
function profile(bars, bins, vaPct) {
  const lo = Math.min(...bars.map(b => b.l)), hi = Math.max(...bars.map(b => b.h));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins; const vol = new Array(bins).fill(0); let total = 0;
  for (const b of bars) {
    const v = b.v > 0 ? b.v : 0; if (!v) continue;
    const b0 = Math.max(0, Math.min(bins - 1, Math.floor((b.l - lo) / step)));
    const b1 = Math.max(0, Math.min(bins - 1, Math.floor((b.h - lo) / step)));
    for (let k = b0; k <= b1; k++) vol[k] += v / (b1 - b0 + 1);
    total += v;
  }
  if (!total) return null;
  let poc = 0; for (let k = 1; k < bins; k++) if (vol[k] > vol[poc]) poc = k;
  let lb = poc, ub = poc, acc = vol[poc];
  while (acc < total * vaPct && (lb > 0 || ub < bins - 1)) {
    const below = lb > 0 ? vol[lb - 1] : -1, above = ub < bins - 1 ? vol[ub + 1] : -1;
    if (above >= below) { ub++; acc += vol[ub]; } else { lb--; acc += vol[lb]; }
  }
  // Rounded to whole dollars exactly as V1 scripts/amt.js does.
  return { poc: Math.round(lo + (poc + 0.5) * step), vah: Math.round(lo + (ub + 1) * step), val: Math.round(lo + lb * step) };
}
function familyE2(bars, c) {
  if (bars.length < c.profileDays) return { score: null, reason: 'not enough bars' };
  const win = bars.slice(-c.profileDays);
  const p = profile(win, c.bins, c.valueAreaPct);
  if (!p) return { score: null, reason: 'no profile' };
  const price = bars[bars.length - 1].c;
  const last3 = bars.slice(-c.acceptWindow).map(b => b.c), lastN = bars.slice(-c.probeWindow);
  const above = last3.filter(x => x > p.vah).length, below = last3.filter(x => x < p.val).length;
  const probedHigh = lastN.some(b => b.h > p.vah), probedLow = lastN.some(b => b.l < p.val);
  let state;
  if (price > p.vah && above >= c.acceptCloses) state = 'IMBALANCE_UP';
  else if (price < p.val && below >= c.acceptCloses) state = 'IMBALANCE_DOWN';
  else if (price > p.vah) state = 'TESTING_VAH';
  else if (price < p.val) state = 'TESTING_VAL';
  else if (probedHigh && !probedLow) state = 'FAILED_AUCTION_HIGH';
  else if (probedLow && !probedHigh) state = 'FAILED_AUCTION_LOW';
  else state = 'BALANCE';
  let s = c.scores[state];
  if (state === 'IMBALANCE_UP') s += c.extraClosePoint * (above - c.acceptCloses);
  if (state === 'IMBALANCE_DOWN') s -= c.extraClosePoint * (below - c.acceptCloses);
  s = Math.max(-c.cap, Math.min(c.cap, s));
  return { score: s, state, poc: p.poc, vah: p.vah, val: p.val, price };
}

// ---- helpers for dated series with publish lags -----------------------------------------
function usable(series, D, lagDays) {
  const cutoff = addDays(D, -lagDays);
  return (series || []).filter(r => r.d <= cutoff && finite(r.v)).sort((a, b) => (a.d < b.d ? -1 : 1));
}
// The latest usable value must be dated at the expected day (D − lag) or at most staleGraceDays older.
function freshEnough(rows, D, lagDays, grace) {
  if (!rows.length) return false;
  return rows[rows.length - 1].d >= addDays(D, -lagDays - grace);
}

function scorecards(fam, warn, decl) {
  const sc = decl.scorecards; const scores = {};
  const card = (names, quorum, mod) => {
    const act = names.filter(n => fam[n] && fam[n].score != null);
    if (act.length < quorum) return { score: null, band: null, active: act.length, of: names.length, withheld: true, reason: `quorum ${act.length}/${names.length}` };
    let s = roundHalfAway(mean(act.map(n => fam[n].score)));   // §3: mean, rounded half away from zero
    if (mod) s = roundHalfAway(mod(s));                          // E6b: round(score / 2); V-E2: min(score, +2)
    s = Math.max(-10, Math.min(10, s));
    return { score: s, band: sc.bands.find(b => s >= b.min).name, active: act.length, of: names.length, withheld: false };
  };
  const e = sc.entry.families;
  const gate = s => (fam.E1.score != null && fam.E1.score < 0 ? Math.min(s, sc.e2CapWhenTrendNegative) : s);
  const halve = s => (warn.e6TopDecile ? s / 2 : s);
  scores['V-E1/E6a'] = card(e, sc.entry.quorum);
  scores['V-E1/E6b'] = card(e, sc.entry.quorum, halve);
  scores['V-E2/E6a'] = card(e, sc.entry.quorum, gate);
  scores['V-E2/E6b'] = card(e, sc.entry.quorum, s => halve(gate(s)));
  const t = sc.tendency;
  scores['V-T1/T2+'] = card(['T1', 'T2+', 'T3', 'T4'], t.quorum);
  scores['V-T1/T2-'] = card(['T1', 'T2-', 'T3', 'T4'], t.quorum);
  scores['T-noT2 (sensitivity)'] = card(['T1', 'T3', 'T4'], 3);
  scores['E1-alone (baseline)'] = card(['E1'], 1);

  return scores;
}

function evaluate(view, decl) {
  const D = view.date; const M = decl.percentileMap; const fam = {}; const warn = {};
  const bars = (view.bars || []).filter(b => b.d <= addDays(D, -1)).sort((a, b) => (a.d < b.d ? -1 : 1));
  const barsFresh = bars.length > 0 && bars[bars.length - 1].d >= addDays(D, -decl.lagsDays.daily_bars - decl.staleGraceDays);
  const dates = bars.map(b => b.d), closes = bars.map(b => b.c);

  // E1 trend & structure
  if (!barsFresh) fam.E1 = { score: null, reason: 'daily bars stale' };
  else {
    const atr = atrWilder(bars, decl.e1.atr), s20 = smaArr(closes, decl.e1.sma[0]), s50 = smaArr(closes, decl.e1.sma[1]);
    const a = closes.map((c, i) => (s20[i] != null && atr[i] ? (c - s20[i]) / atr[i] : null));
    const b = closes.map((c, i) => (s50[i] != null && atr[i] ? (c - s50[i]) / atr[i] : null));
    const L = decl.e1.slopeLookback;
    const sl = closes.map((c, i) => (i >= L && s20[i] != null && s20[i - L] != null && atr[i] ? (s20[i] - s20[i - L]) / atr[i] : null));
    const parts = [a, b, sl].map(x => scoreSeries(x, dates, decl));
    if (parts.some(p => p.score == null)) fam.E1 = { score: null, reason: parts.find(p => p.score == null).reason };
    else fam.E1 = { score: roundHalfAway(mean(parts.map(p => p.score))), parts: { dist20: parts[0], dist50: parts[1], slope20: parts[2] } };
  }
  // E2 auction location
  fam.E2 = barsFresh ? familyE2(bars, decl.e2) : { score: null, reason: 'daily bars stale' };
  if (fam.E2.score != null) fam.E2.score = roundHalfAway(fam.E2.score);
  // E3a perp premium (contrarian at the top; bottom needs the trigger)
  {
    const pr = view.premium8h || {}; const x = pr.current;
    const refs = (pr.refs || []).filter(r => r.d < D && r.d >= decl.referenceStart && finite(r.v)).map(r => r.v);
    if (!finite(x)) fam.E3a = { score: null, reason: 'no current premium' };
    else if (refs.length < decl.warmupDays) fam.E3a = { score: null, reason: `warm-up (${refs.length}/${decl.warmupDays})` };
    else {
      const p = pctRank(refs, x); let s = 0; let trigger = null;
      if (p > M.zeroHigh) s = -mapPct(p, M);
      else if (p < M.zeroLow) {
        const n1 = decl.e3a.triggerRecentDays, n2 = decl.e3a.triggerPriorDays;
        if (bars.length >= n1 + n2) {
          const recent = Math.min(...closes.slice(-n1)), prior = Math.min(...closes.slice(-(n1 + n2), -n1));
          trigger = recent > prior;
          s = trigger ? -mapPct(p, M) : 0;          // mapPct is negative below zeroLow → score positive
        }
      }
      fam.E3a = { score: roundHalfAway(s), pct: p, raw: x, trigger };
    }
  }
  // E5a Coinbase premium z
  fam.E5a = finite(view.e5aZ) ? { score: Math.max(-10, Math.min(10, roundHalfAway(view.e5aZ * 10 / decl.e5a.zFull))), raw: view.e5aZ } : { score: null, reason: 'no z' };
  // E7 Fear & Greed extremes
  {
    const rows = usable(view.fng, D, decl.lagsDays.fear_greed); const c = decl.e7;
    if (!freshEnough(rows, D, decl.lagsDays.fear_greed, decl.staleGraceDays)) fam.E7 = { score: null, reason: 'fear & greed stale' };
    else {
      const v = rows[rows.length - 1].v; let s = 0;
      if (v <= c.fearAt) s = Math.min(10, 10 * (c.fearAt - v) / (c.fearAt - c.fearFull));
      else if (v >= c.greedAt) s = -Math.min(10, 10 * (v - c.greedAt) / (c.greedFull - c.greedAt));
      fam.E7 = { score: roundHalfAway(s), raw: v, asOf: rows[rows.length - 1].d };
    }
  }
  // E6 volatility regime (not a vote)
  if (barsFresh) {
    const n = decl.e6.rvDays; const lr = closes.map((c, i) => (i ? Math.log(c / closes[i - 1]) : null));
    const rv = lr.map((x, i) => { if (i < n) return null; const w = lr.slice(i - n + 1, i + 1); const m = mean(w); return Math.sqrt(w.reduce((s, y) => s + (y - m) ** 2, 0) / (n - 1)) * Math.sqrt(365); });
    const r = scoreSeries(rv, dates, decl);
    fam.E6 = { score: null, pct: r.pct ?? null, raw: r.raw ?? null, topDecile: r.pct != null ? r.pct >= decl.e6.topDecilePct : null, reason: r.reason || 'regime only (not a vote)' };
    warn.e6TopDecile = fam.E6.topDecile;
  } else fam.E6 = { score: null, reason: 'daily bars stale', topDecile: null };

  // Tendency families
  const dailyFam = (key, series, lagKey, opts = {}) => {
    const rows = usable(series, D, decl.lagsDays[lagKey]);
    if (!freshEnough(rows, D, decl.lagsDays[lagKey], decl.staleGraceDays)) return { score: null, reason: `${key} stale` };
    const vals = rows.map(r => r.v), ds = rows.map(r => r.d);
    const r = scoreSeries(opts.transform ? opts.transform(vals) : vals, ds, decl, { contrarian: !!opts.contrarian });
    return r.score == null ? r : { ...r, score: roundHalfAway(opts.sign === -1 ? -r.score : r.score), asOf: ds[ds.length - 1] };
  };
  fam.T1 = dailyFam('mvrv', view.mvrv, 'mvrv', { contrarian: decl.t1.contrarian });
  fam['T2+'] = dailyFam('lth', view.lth30, 'lth', { sign: 1 });
  fam['T2-'] = dailyFam('lth', view.lth30, 'lth', { sign: -1 });
  if (!barsFresh) fam.T3 = { score: null, reason: 'daily bars stale' };
  else {
    const c = decl.t3; const atr = atrWilder(bars, c.atr), s200 = smaArr(closes, c.sma);
    const a = closes.map((x, i) => (s200[i] != null && atr[i] ? (x - s200[i]) / atr[i] : null));
    const sl = closes.map((x, i) => (i >= c.slopeLookback && s200[i] != null && s200[i - c.slopeLookback] != null && atr[i] ? (s200[i] - s200[i - c.slopeLookback]) / atr[i] : null));
    const parts = [a, sl].map(x => scoreSeries(x, dates, decl));
    fam.T3 = parts.some(p => p.score == null) ? { score: null, reason: parts.find(p => p.score == null).reason } : { score: roundHalfAway(mean(parts.map(p => p.score))), parts: { dist200: parts[0], slope200: parts[1] } };
  }
  fam.T4 = dailyFam('stablecoins', view.stable, 'stablecoins', {
    transform: vals => {
      const g = vals.map((v, i) => (i >= decl.t4.growthDays ? v / vals[i - decl.t4.growthDays] - 1 : null));
      return g.map((x, i) => { if (x == null || i < decl.t4.medianDays) return null; const w = g.slice(i - decl.t4.medianDays, i).filter(finite); return w.length ? x - median(w) : null; });
    },
  });

  const scores = scorecards(fam, warn, decl);

  return { date: D, declarationHash: declarationHash(decl), families: fam, scores, primary: decl.candidates.primary, warnings: warn };
}

module.exports = { evaluate, scorecards, declarationHash, pctRank, mapPct, roundHalfAway, profile, familyE2, atrWilder, smaArr, addDays };
