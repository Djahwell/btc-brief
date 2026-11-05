// Date a BMP chart trace by its BTC price line (STAGE1 A1: BMP date labels are unreliable;
// the full trace also has missing days, so a fixed offset does not work).
// Monotonic alignment (dynamic programming): point i → calendar day j, days strictly increasing,
// each step skips at most MAX_STEP−1 days, cost = |ln(price_i / close_j)| + SKIP × skipped days.
// Pure function; tested in scripts/v2/test/lthalign.test.mjs.
const MAX_STEP = 7, SKIP = 0.0005;

export function alignTrace(prices, closes /* [{d:'YYYY-MM-DD', c}] oldest→newest, contiguous */, { lastDate = null } = {}) {
  const n = prices.length, m = closes.length;
  if (!n || !m) return null;
  const lc = closes.map(r => Math.log(r.c));
  const INF = 1e18;
  let prev = new Float64Array(m).fill(INF);
  const back = new Array(n);
  for (let j = 0; j < m; j++) prev[j] = Math.abs(Math.log(prices[0]) - lc[j]);
  back[0] = null;
  for (let i = 1; i < n; i++) {
    const cur = new Float64Array(m).fill(INF); const bk = new Int32Array(m).fill(-1);
    const lp = Math.log(prices[i]);
    for (let j = 1; j < m; j++) {
      let best = INF, arg = -1;
      for (let s = 1; s <= MAX_STEP && j - s >= 0; s++) {
        const v = prev[j - s] + SKIP * (s - 1);
        if (v < best) { best = v; arg = j - s; }
      }
      if (arg >= 0) { cur[j] = best + Math.abs(lp - lc[j]); bk[j] = arg; }
    }
    back[i] = bk; prev = cur;
  }
  let end;
  if (lastDate) { end = closes.findIndex(r => r.d === lastDate); if (end < 0) return null; }
  else { end = 0; for (let j = 1; j < m; j++) if (prev[j] < prev[end]) end = j; }
  const idx = new Array(n); idx[n - 1] = end;
  for (let i = n - 1; i > 0; i--) { idx[i - 1] = back[i][idx[i]]; if (idx[i - 1] < 0) return null; }
  return idx.map((j, i) => ({ d: closes[j].d, err: Math.abs(prices[i] / closes[j].c - 1) }));
}

// Full BMP trace → dated rows. Shared by history.mjs (monthly file) and daily.mjs (daily refresh),
// so live and backtest use one definition. Throws (fail closed) when the dating is not trustworthy.
export function buildLTHRows(raw, closes, endDaySec) {
  if (!raw || !raw.btcY || !raw.lthY) throw new Error('BMP extraction failed');
  const pts = raw.lthY.map((l, i) => ({ l, p: raw.btcY[i] })).filter(r => r.l > 0 && r.p > 0).slice(-(closes.length - 60));
  const al = alignTrace(pts.map(r => r.p), closes);
  if (!al) throw new Error('alignment failed');
  const errs = al.map(a => a.err).sort((a, b) => a - b), med = errs[errs.length >> 1];
  const tail = al.slice(-60).map(a => a.err).sort((a, b) => a - b), medTail = tail[tail.length >> 1];
  const last = al[al.length - 1].d;
  if (med > 0.005) throw new Error(`median price error ${(med * 100).toFixed(2)}% > 0.5%`);
  if (medTail > 0.005) throw new Error(`last-60-point median price error ${(medTail * 100).toFixed(2)}% > 0.5%`);
  if ((endDaySec - Date.parse(last + 'T00:00:00Z') / 1000) / 86400 > 3) throw new Error(`last aligned day ${last} is stale`);
  const rows = al.map((a, i) => ({ t: Date.parse(a.d + 'T00:00:00Z') / 1000, v: Math.round(pts[i].l), errPct: Math.round(a.err * 1e5) / 1e3 }))
    .filter(r => r.errPct <= 2);   // a point whose price does not match within 2% has an uncertain date → dropped
  // Date uncertainty (Board build review #15): share of points whose price also matches the PREVIOUS
  // calendar day within 0.1 percentage point of the chosen match — those could be dated one day late
  // or (worse for look-ahead) the chosen date could be a day early. Reported, and covered by the
  // Stage 4 lag+1 sensitivity run.
  const cIdx = new Map(closes.map((r, i) => [r.d, i]));
  let amb = 0;
  al.forEach((a, i) => { const j = cIdx.get(a.d); if (j > 0) { const e2 = Math.abs(pts[i].p / closes[j - 1].c - 1); if (e2 <= a.err + 0.001) amb++; } if (j < closes.length - 1) { const e3 = Math.abs(pts[i].p / closes[j + 1].c - 1); if (e3 <= a.err + 0.001) amb++; } });
  return { rows, medianAlignErrPct: Math.round(med * 1e5) / 1e3, last, ambiguousDatePct: Math.round(amb / al.length * 1000) / 10 };
}

// 30-day net LTH change in BTC/day on the calendar (gaps allowed): (v(d) − v(d')) / days(d − d'),
// d' = latest row on or before d − 30 days, and d − d' ≤ 35 days. Mirrors engine-v2/view.js lthNet30.
export function lthNet30(rows /* [{t, v}] sorted */) {
  const out = []; let k = 0;
  for (let i = 0; i < rows.length; i++) {
    const target = rows[i].t - 30 * 86400;
    while (k + 1 < rows.length && rows[k + 1].t <= target) k++;
    if (rows[k].t > target) continue;
    const span = (rows[i].t - rows[k].t) / 86400;
    if (span > 35) continue;
    out.push({ t: rows[i].t, v: (rows[i].v - rows[k].v) / span });
  }
  return out;
}
