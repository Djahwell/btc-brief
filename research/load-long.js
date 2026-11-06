'use strict';
// Stage RL sealed loader (STAGE-RL-PLAN RL0). For horizon h days: rows from 2019-01-01 up to
// 2024-06-30 − h (every outcome window ends inside the design period); no bar after 2024-06-30 is
// loaded; no indicator row after the cut-off is returned. Slow indicators are added from bars ≤ D−1.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const START = '2019-01-01', CUT = '2024-06-30';
const HALVINGS = ['2016-07-09', '2020-05-11', '2024-04-20'];
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayNum = d => Date.parse(d + 'T00:00:00Z') / 864e5;

function bars(historyDir) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(historyDir, 'coinbase_daily.json.gz')))).rows
    .map(r => ({ d: new Date(r.t * 1000).toISOString().slice(0, 10), h: r.h, l: r.l, c: r.c }))
    .filter(b => b.d <= CUT);                                         // nothing after the cut-off, ever
}

function slow(B, idx, D) {
  const i = idx.get(add(D, -1)); if (i == null) return {};
  const c = B[i].c; let ath = 0; for (let k = 0; k <= i; k++) if (B[k].h > ath) ath = B[k].h;
  const r = k => (i - k >= 0 ? c / B[i - k].c - 1 : null);
  let w200 = null; if (i >= 1399) { let s = 0; for (let k = i - 1399; k <= i; k++) s += B[k].c; w200 = c / (s / 1400) - 1; }
  const lastHalv = HALVINGS.filter(h => h < D).pop();
  return { ddATH: c / ath - 1, ret90p: r(90), ret180p: r(180), daysSinceHalving: lastHalv ? dayNum(D) - dayNum(lastHalv) : null, dist200w: w200 };
}

function outcome(B, idx, D, h) {
  const e = B[idx.get(add(D, -1))]; const end = idx.get(add(D, h - 1));
  if (!e || end == null) return null;
  const j0 = idx.get(D); let lo = Infinity; for (let k = j0; k <= end; k++) lo = Math.min(lo, B[k].l);
  return { ret: B[end].c / e.c - 1, maxDD: lo / e.c - 1 };
}

// rows: [{...features, ...slow, y: {ret30, ret60, ret90, ret180, dd90}}] restricted for horizon h
function loadLong(historyDir, featuresFile, h) {
  const B = bars(historyDir); const idx = new Map(B.map((b, i) => [b.d, i]));
  const last = add(CUT, -h);
  const feats = JSON.parse(fs.readFileSync(featuresFile, 'utf8')).filter(f => f.d >= START && f.d <= last);
  return feats.map(f => {
    const y = {}; for (const hh of [30, 60, 90, 180]) { if (hh <= h) { const o = outcome(B, idx, f.d, hh); y['ret' + hh] = o ? o.ret : null; if (hh === 90 && o) y.dd90 = o.maxDD; } }
    return { ...f, ...slow(B, idx, f.d), y };
  });
}

module.exports = { loadLong, START, CUT };
