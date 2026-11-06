'use strict';
// Frozen evidence for the condition read (STAGE-C-PLAN C0.3): for each row state on 2019-2026, what the next
// 90 days looked like. Descriptive: "not a tested link to later price". Medians and ranges, not means.
// node research/condition-evidence.js <historyDir> <features.json> <out.json>
const fs = require('fs'), zlib = require('zlib'), path = require('path'), crypto = require('crypto');
const C = require('../engine-v2/condition.js'); const { loadLong } = require('./load-long.js');
const decl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'engine-v2', 'condition-declaration.json'), 'utf8'));
const [hist, ff, out] = process.argv.slice(2);
const bars = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(hist, 'coinbase_daily.json.gz')))).rows.map(r => ({ d: new Date(r.t * 1000).toISOString().slice(0, 10), h: r.h, l: r.l, c: r.c }));
const BS = C.barSeries(bars.filter(b => b.d <= '2026-10-31'));
const H = 90; const rows = loadLong(hist, ff, H, '2026-10-31').filter(r => r.y.ret90 != null && r.y.dd90 != null);
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); const h = (s.length - 1) * p, lo = Math.floor(h); return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]); };
const ST = rows.map(r => C.states({ ...r, ...(BS.get(C.addDays(r.d, -1)) || {}), oiChg7d: null, liq: null }, decl));
const res = { generated: new Date().toISOString().slice(0, 10), horizonDays: H, period: `${rows[0].d} .. ${rows.at(-1).d}`, label: 'Not a tested link to later price (2019-26). Medians and 10-90% ranges of the next 90 days for days in this state; windows = days / 90; episodes = separate runs (a gap of more than 30 days starts a new one).',
  historySha: crypto.createHash('sha256').update(fs.readFileSync(path.join(hist, 'coinbase_daily.json.gz'))).digest('hex'),
  allDays: { days: rows.length, medianRet: q(rows.map(r => r.y.ret90), 0.5), upShare: rows.filter(r => r.y.ret90 > 0).length / rows.length, medianDip: q(rows.map(r => r.y.dd90), 0.5) }, rows: {} };
for (const k of Object.keys(decl.rows)) {
  res.rows[k] = {};
  for (const s of Object.keys(decl.rows[k].states)) {
    const idx = ST.map((x, i) => (x[k].state === s ? i : -1)).filter(i => i >= 0);
    let ep = 0, last = null; for (const i of idx) { const d = Date.parse(rows[i].d); if (last == null || (d - last) / 864e5 > 30) ep++; last = d; }
    const w = idx.length / H; const r = idx.map(i => rows[i].y.ret90), dd = idx.map(i => rows[i].y.dd90);
    res.rows[k][s] = w < 4 ? { days: idx.length, windows: +w.toFixed(1), episodes: ep, suppressed: true }
      : { days: idx.length, windows: +w.toFixed(1), episodes: ep, medianRet: q(r, 0.5), p10: q(r, 0.1), p90: q(r, 0.9), upShare: r.filter(x => x > 0).length / r.length, medianDip: q(dd, 0.5), p90Dip: q(dd, 0.1) };
  }
}
{ // score bands
  const SC = ST.map(x => C.score(x, decl)); res.score = {};
  for (const b of ['Strong bull', 'Bull', 'Neutral', 'Bear', 'Strong bear']) {
    const idx = SC.map((x, i) => (!x.withheld && x.band === b ? i : -1)).filter(i => i >= 0);
    let ep = 0, last = null; for (const i of idx) { const d = Date.parse(rows[i].d); if (last == null || (d - last) / 864e5 > 30) ep++; last = d; }
    const w = idx.length / H; const r = idx.map(i => rows[i].y.ret90), dd = idx.map(i => rows[i].y.dd90);
    res.score[b] = w < 4 ? { days: idx.length, windows: +w.toFixed(1), episodes: ep, suppressed: true } : { days: idx.length, windows: +w.toFixed(1), episodes: ep, medianRet: q(r, 0.5), p10: q(r, 0.1), p90: q(r, 0.9), upShare: r.filter(x => x > 0).length / r.length, medianDip: q(dd, 0.5) };
  }
  res.score.withheldDays = SC.filter(x => x.withheld).length;
  console.log('score', JSON.stringify(Object.fromEntries(Object.entries(res.score).map(([k, o]) => [k, o.suppressed ? `${o.days}d sup` : o.days ? `${o.days}d ${o.windows}w ${o.episodes}ep med ${(o.medianRet * 100).toFixed(0)}% up ${(o.upShare * 100).toFixed(0)}% dip ${(o.medianDip * 100).toFixed(0)}%` : o]))));
}
fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
for (const [k, v] of Object.entries(res.rows)) console.log(k.padEnd(12), Object.entries(v).map(([s, o]) => `${s}:${o.days}d/${o.windows}w/${o.episodes}ep${o.suppressed ? ' (sup)' : ` med ${(o.medianRet * 100).toFixed(0)}% up ${(o.upShare * 100).toFixed(0)}% dip ${(o.medianDip * 100).toFixed(0)}%`}`).join(' | '));
console.log('all', JSON.stringify(res.allDays));
