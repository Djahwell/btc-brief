'use strict';
// RLC-1: one pre-declared long-horizon composite (rlc-declaration.json), one test on 2019-2026.
// node research/rlc.js feasibility <historyDir> <features.json>       (no outcome is read)
// node research/rlc.js run <historyDir> <features.json> <out.json>      (needs research/GO-RLC with the declaration sha)
const fs = require('fs'), zlib = require('zlib'), path = require('path'), crypto = require('crypto');
const S = require('../stage4/stats.js');
const DECL = path.join(__dirname, 'rlc-declaration.json');
const declSha = () => crypto.createHash('sha256').update(fs.readFileSync(DECL)).digest('hex');
const START = '2019-01-01', END = '2026-10-31';
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function bars(dir) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'coinbase_daily.json.gz')))).rows.map(r => ({ d: new Date(r.t * 1000).toISOString().slice(0, 10), h: r.h, l: r.l, c: r.c })); }

// Expanding percentile of ddATH, point-in-time (values up to D-1 only).
function pctATH(B) {
  const out = new Map(); let ath = 0; const seen = [];
  for (const b of B) {
    ath = Math.max(ath, b.h); const v = b.c / ath - 1;
    let lo = 0, hi = seen.length; while (lo < hi) { const m = (lo + hi) >> 1; if (seen[m] < v) lo = m + 1; else hi = m; }
    let eq = lo; while (eq < seen.length && seen[eq] === v) eq++;
    seen.splice(lo, 0, v);
    out.set(b.d, (100 * (lo + (eq - lo + 1) / 2)) / seen.length);   // mid-rank incl. today (value known at close of b.d)
  }
  return out;                                                          // keyed by bar date; used at D via D-1
}

function composite(f, pa) {
  const p = pa.get(add(f.d, -1));
  if (![f.mvrvPct, f.T3, p].every(Number.isFinite)) return null;
  const V = ((50 - f.mvrvPct) / 50 + (50 - p) / 50) / 2, T = f.T3 / 10;
  return { C: 0.5 * V + 0.5 * T, V, T };
}

function rows(dir, featsFile, h, withOutcomes) {
  const B = bars(dir); const idx = new Map(B.map((b, i) => [b.d, i])); const pa = pctATH(B);
  const feats = JSON.parse(fs.readFileSync(featsFile, 'utf8')).filter(f => f.d >= START && f.d <= add(END, -h));
  return feats.map(f => {
    const c = composite(f, pa); const r = { d: f.d, ...(c || { C: null, V: null, T: null }) };
    if (withOutcomes) { const e = B[idx.get(add(f.d, -1))], end = idx.get(add(f.d, h - 1)), j0 = idx.get(f.d);
      if (e && end != null) { let lo = Infinity; for (let k = j0; k <= end; k++) lo = Math.min(lo, B[k].l); r.ret = B[end].c / e.c - 1; r.dd = lo / e.c - 1; } else r.ret = r.dd = null; }
    return r;
  }).filter(r => r.C != null);
}

function ranks(v) { const idx = v.map((x, i) => [x, i]).filter(p => p[0] != null).sort((a, b) => a[0] - b[0]); const r = new Array(v.length).fill(null); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
function pearson(a, b) { let n = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { n++; sa += a[i]; sb += b[i]; } if (n < 30) return NaN; const ma = sa / n, mb = sb / n; let x = 0, y = 0, z = 0; for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { x += (a[i] - ma) * (b[i] - mb); y += (a[i] - ma) ** 2; z += (b[i] - mb) ** 2; } return y && z ? x / Math.sqrt(y * z) : NaN; }
const spear = (x, y) => pearson(ranks(x), ranks(y));
const partial = (x, y, z) => { const a = spear(x, y), b = spear(x, z), c = spear(y, z); return (a - b * c) / Math.sqrt((1 - b * b) * (1 - c * c)); };
const shiftOf = (h, C) => Math.max(h, Math.ceil(S.politisWhite(C)));
const band = c => (c >= 0.3 ? 'strongFavourable' : c >= 0.15 ? 'favourable' : c > -0.15 ? 'neutral' : c > -0.3 ? 'unfavourable' : 'strongUnfavourable');

function feasibility(dir, ff) {
  const out = {};
  for (const h of [30, 90, 180]) { const R = rows(dir, ff, h, false); const C = R.map(r => r.C); const s = shiftOf(h, C); const eff = (R.length - 2 * s) / s;
    out[h] = { N: R.length, from: R[0].d, to: R.at(-1).d, shift: s, effectiveRotations: +eff.toFixed(1), minP: +(1 / (1 + eff)).toFixed(4), bands: Object.fromEntries(['strongFavourable', 'favourable', 'neutral', 'unfavourable', 'strongUnfavourable'].map(b => [b, R.filter(r => band(r.C) === b).length])) }; }
  out.holmFirst = 0.05; out.feasible = { 30: out[30].minP <= 0.05, 90: out[90].minP <= 0.05 };
  return out;
}

function run(dir, ff) {
  const go = path.join(__dirname, 'GO-RLC'); if (!fs.existsSync(go) || fs.readFileSync(go, 'utf8').trim() !== declSha()) throw new Error('GO-RLC missing or not matching the declaration sha');
  const rep = { declarationSha: declSha(), horizons: {} };
  for (const h of [30, 90, 180]) {
    const R = rows(dir, ff, h, true).filter(r => r.ret != null); const N = R.length; const C = R.map(r => r.C), y = R.map(r => r.ret), T = R.map(r => r.T);
    const s = shiftOf(h, C); const obs = spear(C, y); let ge = 0, n = 0;
    for (let k = s; k <= N - s; k += s) { const v = spear(S.rotate(C, k), y); if (!Number.isFinite(v)) continue; n++; if (Math.abs(v) >= Math.abs(obs)) ge++; }   // s-spaced grid (Board RLC check #1)
    const half = R.map(r => r.d < '2023-01-01'); const hs = m => spear(C.map((v, i) => (half[i] === m ? v : null)), y);
    const blk = Math.max(h, s);
    const bands = ['strongFavourable', 'favourable', 'neutral', 'unfavourable', 'strongUnfavourable'].map((b, bi) => {
      const m = R.map(r => band(r.C) === b); const v = R.filter((r, i) => m[i]); const runs = v.length ? R.reduce((a, r, i) => a + (m[i] && (i === 0 || !m[i - 1]) ? 1 : 0), 0) : 0;
      const bs = S.circularBlockBootstrap(N, blk, 1000, idx => { const a = idx.filter(i => m[i]).map(i => y[i]); return a.length ? S.mean(a) : NaN; }, 20261106 + bi);
      return { band: b, days: v.length, separateStretches: runs, independentWindows: +(v.length / h).toFixed(1), meanRet: v.length ? S.mean(v.map(r => r.ret)) : null, medianRet: v.length ? S.quantile(v.map(r => r.ret).sort((a, b) => a - b), 0.5) : null, ci: [S.quantile(bs, 0.025), S.quantile(bs, 0.975)], meanDD: v.length ? S.mean(v.map(r => r.dd)) : null, shareUp: v.length ? v.filter(r => r.ret > 0).length / v.length : null };
    });
    rep.horizons[h] = { N, from: R[0].d, to: R.at(-1).d, shift: s, rotations: n, spearman: obs, p: (1 + ge) / (1 + n), halves: { to2022: hs(true), from2023: hs(false) }, partialGivenTrend: partial(C, y, T), trendAlone: spear(T, y), valuationAlone: spear(R.map(r => r.V), y), bands, alwaysLong: S.mean(y) };
  }
  const ps = [30, 90].map(h => rep.horizons[h].p); const order = ps[0] <= ps[1] ? [30, 90] : [90, 30];
  let ok = true; rep.holm = {}; order.forEach((h, j) => { const thr = 0.10 / (2 - j); const sig = ok && rep.horizons[h].p <= thr; if (!sig) ok = false; rep.holm[h] = { threshold: thr, significant: sig }; });
  for (const h of [30, 90]) { const H = rep.horizons[h]; H.pass = rep.holm[h].significant && H.spearman > 0 && H.halves.to2022 > 0 && H.halves.from2023 > 0; H.label = !H.pass ? 'fail' : (H.partialGivenTrend > 0 && H.valuationAlone > 0 ? 'pass' : 'pass, but trend-driven'); }
  return rep;
}

const [mode, dir, ff, out] = process.argv.slice(2);
if (require.main === module) {
  if (mode === 'feasibility') console.log(JSON.stringify({ declarationSha: declSha(), ...feasibility(dir, ff) }, null, 1));
  else if (mode === 'run') { const r = run(dir, ff); fs.writeFileSync(out, JSON.stringify(r, null, 1)); console.log('written', out); }
}
module.exports = { composite, pctATH, band, declSha };
