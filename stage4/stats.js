'use strict';
// Stage 4 statistics (STAGE4-DECLARATION §E, §K). Pure functions, no I/O, deterministic.
// Frozen with the declaration: any change after the freeze is a new declaration.

// Declared PRNG: mulberry32, seed 20261105.
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

// Difference of mean outcome: days with flag true minus days with flag false. Pairs with null skipped.
function diffMeans(flags, ys) {
  let s1 = 0, n1 = 0, s0 = 0, n0 = 0;
  for (let i = 0; i < ys.length; i++) {
    if (flags[i] == null || ys[i] == null) continue;
    if (flags[i]) { s1 += ys[i]; n1++; } else { s0 += ys[i]; n0++; }
  }
  return n1 && n0 ? s1 / n1 - s0 / n0 : NaN;
}

// Circular-shift null (§E): the score-derived series is rotated against the outcome series by every
// k in [minShift, N − minShift]; p = (1 + #{stat_k ≥ observed}) / (1 + #shifts). One-sided, upper.
// statFn(shiftK) must return the statistic with the score series rotated by k (k = 0 is observed).
function circularShiftP(N, statFn, minShift = 60) {
  const obs = statFn(0); let ge = 0, n = 0;
  for (let k = minShift; k <= N - minShift; k++) { const s = statFn(k); if (!Number.isFinite(s)) continue; n++; if (s >= obs) ge++; }
  return { observed: obs, p: (1 + ge) / (1 + n), shifts: n };
}
const rotate = (arr, k) => { const N = arr.length; return arr.map((_, i) => arr[(i + k) % N]); };

// Politis–White (2004) automatic block length for the CIRCULAR block bootstrap, with the
// Patton–Politis–White (2009) correction. Withheld values (null) are removed first.
function politisWhite(xIn) {
  const x = xIn.filter(v => v != null && Number.isFinite(v)); const n = x.length;
  const m0 = mean(x); const d = x.map(v => v - m0);
  const acov = k => { let s = 0; for (let i = k; i < n; i++) s += d[i] * d[i - k]; return s / n; };
  const R0 = acov(0); if (!(R0 > 0)) return 1;
  const KN = Math.max(5, Math.ceil(Math.sqrt(Math.log10(n))));
  const mmax = Math.ceil(Math.sqrt(n)) + KN;
  const thr = 2 * Math.sqrt(Math.log10(n) / n);
  const rho = []; for (let k = 0; k <= mmax + KN; k++) rho.push(acov(k) / R0);
  let mhat = null;
  for (let m = 1; m <= mmax; m++) { let ok = true; for (let k = 1; k <= KN; k++) if (Math.abs(rho[m + k] || 0) >= thr) { ok = false; break; } if (ok) { mhat = m; break; } }
  if (mhat == null) mhat = mmax;
  const M = Math.min(2 * mhat, mmax);
  const lam = t => { const a = Math.abs(t); return a <= 0.5 ? 1 : a <= 1 ? 2 * (1 - a) : 0; };
  let G = 0, g0 = 0;
  for (let k = -M; k <= M; k++) { const R = acov(Math.abs(k)); const w = lam(k / M); G += w * Math.abs(k) * R; g0 += w * R; }
  const Dcb = (4 / 3) * g0 * g0;
  let b = Math.pow((2 * G * G) / Dcb, 1 / 3) * Math.pow(n, 1 / 3);
  if (!Number.isFinite(b)) b = 1;
  return Math.min(b, 3 * Math.sqrt(n), n / 3);
}

// Circular block bootstrap of a statistic over paired day indices. Returns sorted replicate values.
function circularBlockBootstrap(N, blockLen, reps, statOnIdx, seed = 20261105) {
  const rnd = mulberry32(seed); const L = Math.max(1, Math.round(blockLen)); const out = [];
  for (let r = 0; r < reps; r++) {
    const idx = [];
    while (idx.length < N) { const s = Math.floor(rnd() * N); for (let j = 0; j < L && idx.length < N; j++) idx.push((s + j) % N); }
    const v = statOnIdx(idx); if (Number.isFinite(v)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}
const quantile = (sorted, q) => { if (!sorted.length) return NaN; const h = (sorted.length - 1) * q; const lo = Math.floor(h); return sorted[lo] + (h - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]); };

// Episodes: maximal runs of consecutive evaluated days (index-adjacent, both non-withheld) with the same label.
function episodes(labels) {
  const c = {}; let prev = null;
  for (let i = 0; i < labels.length; i++) { const l = labels[i]; if (l != null && l !== prev) c[l] = (c[l] || 0) + 1; prev = l; }
  return c;
}

// Spearman rank correlation with average ranks for ties; pairs with null skipped.
function spearman(xs, ys) {
  const pts = []; for (let i = 0; i < xs.length; i++) if (xs[i] != null && ys[i] != null) pts.push([xs[i], ys[i]]);
  const rank = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[o[k][1]] = avg; i = j + 1; } return r; };
  const rx = rank(pts.map(p => p[0])), ry = rank(pts.map(p => p[1]));
  const mx = mean(rx), my = mean(ry); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

// Holm step-down: returns rejected flags in input order.
function holm(ps, alpha = 0.05) {
  const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); const rej = new Array(ps.length).fill(false);
  for (let k = 0; k < o.length; k++) { if (o[k][0] <= alpha / (o.length - k)) rej[o[k][1]] = true; else break; }
  return rej;
}

// Tendency backtest (§K.3): exposure e_D ∈ {0,1} decided at D 00:00, earning ln(close_D / close_{D−1});
// cost 10 bp (0.001 in log terms) per switch, including the first entry from flat at the segment start.
function exposureBacktest(exposure, logRets, costPerSwitch = 0.001) {
  let cum = 0, peak = 0, maxDD = 0, prev = 0, switches = 0;
  for (let i = 0; i < logRets.length; i++) {
    const e = exposure[i] ? 1 : 0;
    if (e !== prev) { cum -= costPerSwitch; switches++; }
    cum += e * logRets[i]; prev = e;
    if (cum > peak) peak = cum;
    maxDD = Math.max(maxDD, 1 - Math.exp(cum - peak));
  }
  return { totalLogReturn: cum, maxDrawdown: maxDD, ratio: maxDD > 0 ? cum / maxDD : (cum > 0 ? Infinity : cum < 0 ? -Infinity : 0), switches };
}

module.exports = { mulberry32, mean, diffMeans, circularShiftP, rotate, politisWhite, circularBlockBootstrap, quantile, episodes, spearman, holm, exposureBacktest };
