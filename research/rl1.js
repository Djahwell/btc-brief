'use strict';
// Stage RL1 long-horizon indicator study (STAGE-RL-PLAN RL1). Design only, via load-long.js.
// node research/rl1.js <historyDir> <features.json> <out.json>
const fs = require('fs');
const S = require('../stage4/stats.js');
const { loadLong } = require('./load-long.js');

const IND = ['dist20', 'dist50', 'slope20', 'E1', 'dist200', 'slope200', 'T3', 'fw1Base', 'ret1', 'ret3', 'ret7', 'ret30', 'dd30', 'dd90', 'daysSinceHi30',
  'E2', 'posVAL', 'posPOC', 'posVAH', 'rvPct', 'rvRatio', 'atrPct', 'premPct', 'cbZ', 'fng', 'mvrvPct', 'lth30', 'stableX',
  'ddATH', 'ret90p', 'ret180p', 'daysSinceHalving', 'dist200w'];
const PLAN = [{ h: 30, targets: ['ret30'] }, { h: 90, targets: ['ret90', 'dd90'] }, { h: 180, targets: ['ret180'] }];

function ranks(v) { const idx = v.map((x, i) => [x, i]).filter(p => p[0] != null).sort((a, b) => a[0] - b[0]); const r = new Array(v.length).fill(null); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
function pearson(a, b) { let n = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { n++; sa += a[i]; sb += b[i]; } if (n < 30) return NaN; const ma = sa / n, mb = sb / n; let x = 0, y = 0, z = 0; for (let i = 0; i < a.length; i++) if (a[i] != null && b[i] != null) { x += (a[i] - ma) * (b[i] - mb); y += (a[i] - ma) ** 2; z += (b[i] - mb) ** 2; } return y && z ? x / Math.sqrt(y * z) : NaN; }
const mask = (v, m) => v.map((x, i) => (m[i] ? x : null));
const spear = (x, y, m) => (m ? pearson(ranks(mask(x, m)), ranks(mask(y, m))) : pearson(ranks(x), ranks(y)));
function partial(x, y, z) { const rx = ranks(x), ry = ranks(y), rz = ranks(z); const a = pearson(rx, ry), b = pearson(rx, rz), c = pearson(ry, rz); return (a - b * c) / Math.sqrt((1 - b * b) * (1 - c * c)); }
function shiftP(N, minShift, stat) { const obs = stat(0); let ge = 0, n = 0; for (let k = minShift; k <= N - minShift; k++) { const s = stat(k); if (!Number.isFinite(s)) continue; n++; if (Math.abs(s) >= Math.abs(obs)) ge++; } return { obs, p: (1 + ge) / (1 + n), shifts: n }; }
function bh(ps, q) { const m = ps.length; const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let k = -1; o.forEach(([p], j) => { if (p <= ((j + 1) / m) * q) k = j; }); const s = new Array(m).fill(false); for (let j = 0; j <= k; j++) s[o[j][1]] = true; return s; }

function main() {
  const [hist, feats, out] = process.argv.slice(2); const report = { horizons: {} };
  for (const { h, targets } of PLAN) {
    const rows = loadLong(hist, feats, h).filter(r => r.y['ret' + h] != null);
    const N = rows.length; const col = k => rows.map(r => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : null));
    const rv30 = col('rv30');
    const trend = rows.map(r => (r.dist200 == null || r.slope200 == null ? null : r.dist200 > 0 && r.slope200 > 0 ? 'up' : r.dist200 < 0 && r.slope200 < 0 ? 'down' : 'mixed'));
    const half = rows.map(r => (r.d < '2021-10-01' ? 'h1' : 'h2'));
    const res = [];
    for (const t of targets) {
      const y = rows.map(r => r.y[t]);
      for (const ind of IND) {
        const x = col(ind); const n = x.filter((v, i) => v != null && y[i] != null).length;
        if (n < 2 * h + 60) { res.push({ ind, target: t, n, skipped: 'too few days with this indicator' }); continue; }
        const pooled = shiftP(N, h, k => spear(S.rotate(x, k), y));
        const blk = Math.max(h, Math.ceil(S.politisWhite(x)));
        const boot = S.circularBlockBootstrap(N, blk, 1000, idx => spear(idx.map(i => x[i]), idx.map(i => y[i])), 20261106);
        const halves = { h1: spear(x, y, half.map(v => v === 'h1')), h2: spear(x, y, half.map(v => v === 'h2')) };
        const st = ['up', 'down', 'mixed'].map(s => { const m = trend.map(v => v === s); const c = m.filter((v, i) => v && x[i] != null).length; return { s, n: c, r: c >= 60 ? spear(x, y, m) : NaN }; }).filter(o => Number.isFinite(o.r));
        const trendPartial = st.length ? st.reduce((a, o) => a + o.r * o.n, 0) / st.reduce((a, o) => a + o.n, 0) : NaN;
        const pVol = t === 'dd90' ? shiftP(N, h, k => partial(S.rotate(x, k), y, rv30)) : null;
        const xs = x.filter(v => v != null).sort((a, b) => a - b); const edges = [0.2, 0.4, 0.6, 0.8].map(q => S.quantile(xs, q));
        const qOf = v => (v == null ? null : edges.filter(e => v > e).length);
        const qs = [0, 1, 2, 3, 4].map(q => { const m = x.map(v => qOf(v) === q); const vals = y.filter((v, i) => m[i] && v != null); const b = S.circularBlockBootstrap(N, blk, 500, idx => { const a = idx.filter(i => m[i] && y[i] != null).map(i => y[i]); return a.length ? S.mean(a) : NaN; }, 20261106 + q); return { q: q + 1, lo: q ? edges[q - 1] : null, hi: q < 4 ? edges[q] : null, n: vals.length, mean: vals.length ? S.mean(vals) : null, ci: [S.quantile(b, 0.025), S.quantile(b, 0.975)] }; });
        res.push({ ind, target: t, n, r: pooled.obs, p: pooled.p, shifts: pooled.shifts, ci: [S.quantile(boot, 0.025), S.quantile(boot, 0.975)], block: blk, halves, trendPartial, trendStates: st, partialVol: pVol, quintiles: qs });
      }
    }
    const tested = res.filter(o => !o.skipped); const sig = bh(tested.map(o => o.p), 0.10); tested.forEach((o, i) => { o.bh = sig[i]; });
    const minP = Math.min(...tested.map(o => 1 / (1 + o.shifts))); const firstThr = 0.10 / tested.length;
    for (const o of tested) { const sg = Math.sign(o.r); o.driver = o.bh && Math.sign(o.halves.h1) === sg && Math.sign(o.halves.h2) === sg && Math.sign(o.trendPartial) === sg && (o.target !== 'dd90' || (o.partialVol && o.partialVol.p < 0.05 && Math.sign(o.partialVol.obs) === sg)); }
    report.horizons[h] = { N, from: rows[0].d, to: rows[N - 1].d, independentWindows: Math.round(N / h), tests: tested.length, minPossibleP: minP, firstBHThreshold: firstThr, testable: minP <= firstThr, results: res };
    console.log(`h=${h}: ${N} days, ${tested.length} tests, min p ${minP.toFixed(5)} vs first BH threshold ${firstThr.toFixed(5)}, drivers: ${tested.filter(o => o.driver).map(o => o.ind + '/' + o.target).join(', ') || 'none'}`);
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
}
main();
