'use strict';
// Stage R1 indicator study (STAGE-R-PLAN v1.1 R1). Design period only, via the sealed loader.
// node research/r1.js <historyDir> <features.json> <out.json>
const fs = require('fs');
const S = require('../stage4/stats.js');
const { loadDesign } = require('./load.js');

const IND = ['dist20', 'dist50', 'slope20', 'E1', 'dist200', 'slope200', 'T3', 'fw1Base', 'ret1', 'ret3', 'ret7', 'ret30', 'dd30', 'dd90', 'daysSinceHi30',
  'E2', 'posVAL', 'posPOC', 'posVAH', 'rvPct', 'rvRatio', 'atrPct', 'premPct', 'cbZ', 'fng', 'mvrvPct', 'lth30', 'stableX'];
const TARGETS = ['ret7', 'mae7'];
const MIN_SHIFT = 60;

function ranks(v) { const idx = v.map((x, i) => [x, i]).filter(p => p[0] != null).sort((a, b) => a[0] - b[0]); const r = new Array(v.length).fill(null); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
function pearsonMask(a, b, m) { let n = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) if ((!m || m[i]) && a[i] != null && b[i] != null) { n++; sa += a[i]; sb += b[i]; } if (n < 10) return NaN; const ma = sa / n, mb = sb / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) if ((!m || m[i]) && a[i] != null && b[i] != null) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN; }
const spear = (x, y, m) => { if (m) { const xs = x.map((v, i) => (m[i] ? v : null)), ys = y.map((v, i) => (m[i] ? v : null)); return pearsonMask(ranks(xs), ranks(ys)); } return pearsonMask(ranks(x), ranks(y)); };
function partial(x, y, z) { const rx = ranks(x), ry = ranks(y), rz = ranks(z); const a = pearsonMask(rx, ry), b = pearsonMask(rx, rz), c = pearsonMask(ry, rz); return (a - b * c) / Math.sqrt((1 - b * b) * (1 - c * c)); }
// two-sided circular-shift p for a statistic of (rotated x)
function shiftP(N, stat) { const obs = stat(0); let ge = 0, n = 0; for (let k = MIN_SHIFT; k <= N - MIN_SHIFT; k++) { const s = stat(k); if (!Number.isFinite(s)) continue; n++; if (Math.abs(s) >= Math.abs(obs)) ge++; } return { obs, p: (1 + ge) / (1 + n) }; }
function byFDR(ps, q) { const m = ps.length, c = Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0); const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let k = -1; o.forEach(([p], j) => { if (p <= ((j + 1) / (m * c)) * q) k = j; }); const sig = new Array(m).fill(false); for (let j = 0; j <= k; j++) sig[o[j][1]] = true; return sig; }
const quant = (sorted, q) => S.quantile(sorted, q);

function main() {
  const [hist, feats, out] = process.argv.slice(2);
  const rows = loadDesign(hist, feats).filter(r => r.y);
  const N = rows.length; const col = k => rows.map(r => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : null));
  const Y = { ret7: rows.map(r => r.y.ret7), mae7: rows.map(r => r.y.mae7) };
  const rv30 = col('rv30');
  const trend = rows.map(r => (r.dist200 == null || r.slope200 == null ? null : r.dist200 > 0 && r.slope200 > 0 ? 'up' : r.dist200 < 0 && r.slope200 < 0 ? 'down' : 'mixed'));
  const rvs = col('rvPct').filter(x => x != null).sort((a, b) => a - b); const t1 = quant(rvs, 1 / 3), t2 = quant(rvs, 2 / 3);
  const vol = rows.map(r => (r.rvPct == null ? null : r.rvPct <= t1 ? 'lowVol' : r.rvPct <= t2 ? 'midVol' : 'highVol'));
  const cells = {}; rows.forEach((r, i) => { if (trend[i] && vol[i]) { const k = `${trend[i]}/${vol[i]}`; (cells[k] ||= []).push(i); } });
  const year = rows.map(r => (r.d < '2022-01-01' ? '2021H2' : r.d < '2023-01-01' ? '2022' : r.d < '2024-01-01' ? '2023' : '2024H1'));
  const half = rows.map(r => (r.d < '2023-01-01' ? 'h1' : 'h2'));
  const res = []; const pooledPs = [];
  for (const ind of IND) {
    const x = col(ind);
    for (const t of TARGETS) {
      const y = Y[t];
      const pooled = shiftP(N, k => spear(S.rotate(x, k), y));
      const blk = Math.max(20, Math.ceil(S.politisWhite(x)));
      const boot = S.circularBlockBootstrap(N, blk, 2000, idx => spear(idx.map(i => x[i]), idx.map(i => y[i])), 20261106);
      const yrs = Object.fromEntries(['2021H2', '2022', '2023', '2024H1'].map(Y2 => [Y2, spear(x, y, year.map(v => v === Y2))]));
      const halves = { h1: spear(x, y, half.map(v => v === 'h1')), h2: spear(x, y, half.map(v => v === 'h2')) };
      // partial after trend: day-weighted mean of within-state Spearman
      const st = ['up', 'down', 'mixed'].map(s => { const m = trend.map(v => v === s); const n = m.filter(Boolean).length; return { s, n, r: n >= 30 ? spear(x, y, m) : NaN }; }).filter(o => Number.isFinite(o.r));
      const wTrend = st.reduce((a, o) => a + o.r * o.n, 0) / st.reduce((a, o) => a + o.n, 0);
      const partVol = t === 'mae7' ? shiftP(N, k => partial(S.rotate(x, k), y, rv30)) : null;
      const partVolHalves = t === 'mae7' ? { h1: partial(x.map((v, i) => (half[i] === 'h1' ? v : null)), y.map((v, i) => (half[i] === 'h1' ? v : null)), rv30.map((v, i) => (half[i] === 'h1' ? v : null))), h2: partial(x.map((v, i) => (half[i] === 'h2' ? v : null)), y.map((v, i) => (half[i] === 'h2' ? v : null)), rv30.map((v, i) => (half[i] === 'h2' ? v : null))) } : null;
      // quintiles (design edges) with block-bootstrap intervals of the quintile mean
      const xs = x.filter(v => v != null).sort((a, b) => a - b); const edges = [0.2, 0.4, 0.6, 0.8].map(q => quant(xs, q));
      const qOf = v => (v == null ? null : edges.filter(e => v > e).length);
      const qs = [0, 1, 2, 3, 4].map(q => { const m = x.map(v => qOf(v) === q); const vals = y.filter((v, i) => m[i] && v != null); const b = S.circularBlockBootstrap(N, blk, 1000, idx => { const a = idx.filter(i => m[i] && y[i] != null).map(i => y[i]); return a.length ? S.mean(a) : NaN; }, 20261106 + q); return { q: q + 1, n: vals.length, mean: vals.length ? S.mean(vals) : null, ci: [quant(b, 0.025), quant(b, 0.975)] }; });
      // condition cells (n >= 150): cell effect and interaction vs pooled
      const cellRes = Object.entries(cells).filter(([, ix]) => ix.length >= 150).map(([k, ix]) => {
        const m = rows.map((_, i) => false); ix.forEach(i => { m[i] = true; });
        const c = shiftP(N, kk => spear(S.rotate(x, kk), y, m));
        const inter = shiftP(N, kk => { const xr = S.rotate(x, kk); return spear(xr, y, m) - spear(xr, y); });
        const hh = { h1: spear(x, y, m.map((v, i) => v && half[i] === 'h1')), h2: spear(x, y, m.map((v, i) => v && half[i] === 'h2')) };
        return { cell: k, n: ix.length, r: c.obs, p: c.p, interaction: inter.obs, pInter: inter.p, halves: hh };
      });
      const o = { ind, target: t, n: x.filter((v, i) => v != null && y[i] != null).length, r: pooled.obs, p: pooled.p, ci: [quant(boot, 0.025), quant(boot, 0.975)], block: blk, years: yrs, halves, trendPartial: wTrend, trendStates: st, partialVol: partVol, partialVolHalves: partVolHalves, quintiles: qs, cells: cellRes };
      res.push(o); pooledPs.push(pooled.p);
    }
  }
  const sig = byFDR(pooledPs, 0.10); res.forEach((o, i) => { o.fdr = sig[i]; });
  // mechanical roles (STAGE-R-PLAN v1.1)
  const roles = {};
  for (const ind of IND) {
    const d = res.find(o => o.ind === ind && o.target === 'ret7'), m = res.find(o => o.ind === ind && o.target === 'mae7');
    const sgn = Math.sign(d.r); const yrsSame = Object.values(d.years).filter(v => Number.isFinite(v) && Math.sign(v) === sgn).length;
    const dirDriver = d.fdr && yrsSame >= 3 && Math.sign(d.trendPartial) === sgn;
    const pv = m.partialVol; const riskDriver = m.fdr && pv && pv.p < 0.05 && Math.sign(m.partialVolHalves.h1) === Math.sign(pv.obs) && Math.sign(m.partialVolHalves.h2) === Math.sign(pv.obs);
    const mod = t => (t.cells || []).filter(c => c.p < 0.05 && c.pInter < 0.05 && Math.sign(c.halves.h1) === Math.sign(c.r) && Math.sign(c.halves.h2) === Math.sign(c.r));
    roles[ind] = { direction: dirDriver ? 'driver' : (mod(d).length ? 'modifier candidate' : 'drop'), risk: riskDriver ? 'driver' : (mod(m).length ? 'modifier candidate' : 'drop'), dirCells: mod(d).map(c => c.cell), riskCells: mod(m).map(c => c.cell) };
  }
  // keep at most 2 modifiers per rating (largest |cell effect|)
  for (const [t, key, cellsKey] of [['ret7', 'direction', 'dirCells'], ['mae7', 'risk', 'riskCells']]) {
    const cands = IND.filter(i => roles[i][key] === 'modifier candidate').map(i => ({ i, eff: Math.max(...res.find(o => o.ind === i && o.target === t).cells.filter(c => roles[i][cellsKey].includes(c.cell)).map(c => Math.abs(c.r))) })).sort((a, b) => b.eff - a.eff);
    cands.forEach((c, j) => { roles[c.i][key] = j < 2 ? 'modifier' : 'drop'; });
  }
  const cellCounts = Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, v.length]));
  fs.writeFileSync(out, JSON.stringify({ N, from: rows[0].d, to: rows[N - 1].d, volTercileEdges: [t1, t2], cellCounts, results: res, roles }, null, 1));
  console.log('R1 done', N, 'days', rows[0].d, '→', rows[N - 1].d);
}
main();
