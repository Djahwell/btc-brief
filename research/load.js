'use strict';
// Stage R sealed loader (STAGE-R-PLAN R0.2). Outcomes are returned ONLY for days whose whole outcome
// window (bars D … D+6) ends on or before the design cut-off 2024-06-30. Every other day's outcome is
// null, whatever the caller asks. Indicators (features) are returned for all days: they only use
// information before D, but rows after 2024-06-24 are not returned at all (Board change 2).
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const DESIGN = ['2021-06-01', '2024-06-30'];
const LAST_ROW = '2024-06-24';   // last day whose 7-day outcome ends inside the design period
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function outcomes(bars, D) {
  const byD = bars._byD || (bars._byD = new Map(bars.map(b => [b.d, b])));
  const e = byD.get(add(D, -1)); const w = []; for (let k = 0; k <= 6; k++) w.push(byD.get(add(D, k)));
  if (!e || w.some(x => !x)) return null;
  return {
    ret1: w[0].c / e.c - 1, ret3: w[2].c / e.c - 1, ret7: w[6].c / e.c - 1,
    mae7: Math.min(...w.map(b => b.l)) / e.c - 1,
    range7: (Math.max(...w.map(b => b.h)) - Math.min(...w.map(b => b.l))) / e.c,
  };
}

// Returns design-period rows: [{...features, y: {ret1, ret3, ret7, mae7, range7}}]
function loadDesign(historyDir, featuresFile) {
  const cb = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(historyDir, 'coinbase_daily.json.gz')))).rows
    .map(r => ({ d: new Date(r.t * 1000).toISOString().slice(0, 10), o: r.o, h: r.h, l: r.l, c: r.c }))
    .filter(b => b.d <= DESIGN[1]);                                   // bars after the cut-off are never loaded
  const feats = JSON.parse(fs.readFileSync(featuresFile, 'utf8'));
  // No row of any kind after LAST_ROW: indicators on hold-out days (past returns, drawdowns) are sealed too.
  return feats.filter(f => f.d >= DESIGN[0] && f.d <= LAST_ROW).map(f => ({ ...f, y: outcomes(cb, f.d) }));
}

module.exports = { loadDesign, DESIGN, LAST_ROW, outcomes };
