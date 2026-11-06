'use strict';
// BTC Brief V2 market-condition read (STAGE-C-PLAN, condition-declaration.json COND-1).
// Pure: same file in the browser (globalThis.BriefCondition), on the VPS and in research.
// Describes conditions, never forecasts. Missing readings give state null ("no data") and are never neutral.
(function (root) {
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const median = a => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  // Point-in-time percentile series from daily bars [{d,h,c}] in date order. Value at bar d uses bars <= d
  // (so a reading for day D uses the entry for D-1). Mid-rank among all values so far; warm-up 365 values.
  function barSeries(bars) {
    const out = new Map(); const sATH = [], sW = []; let ath = 0, sum = 0;
    const pct = (arr, v) => {
      let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
      let eq = lo; while (eq < arr.length && arr[eq] === v) eq++;
      arr.splice(lo, 0, v); return arr.length >= 365 ? (100 * (lo + (eq - lo + 1) / 2)) / arr.length : null;
    };
    bars.forEach((b, i) => {
      ath = Math.max(ath, b.h); sum += b.c; if (i >= 1400) sum -= bars[i - 1400].c;
      const near = b.c / ath - 1;                                  // 0 at the high, negative below: high = expensive
      const w = i >= 1399 ? b.c / (sum / 1400) - 1 : null;          // vs 200-week (1400-day) average
      out.set(b.d, { pctNearATH: pct(sATH, near), pctW200: w == null ? null : pct(sW, w), nearATH: near, w200: w, close: b.c });
    });
    return out;
  }

  const band5 = (p, B) => (p < B.low ? 'cheap' : p < B.belowAvg ? 'belowAvg' : p <= B.aboveAvg ? 'fair' : p <= B.high ? 'rich' : 'stretched');

  // readings: { mvrvPct, pctW200, pctNearATH, dist200, slope200, fw1Base, e2State, premPct, oiChg7d, funding,
  //             cbZ, stableX, lth30, fng, rvPct, atrPct, liq: {long_btc, short_btc, pctLong, pctShort} }
  function states(R, decl) {
    const B = decl.pctBands, out = {};
    const vals = [R.mvrvPct, R.pctW200, R.pctNearATH].filter(fin);
    out.value = vals.length >= 2 ? { state: band5(median(vals), B), pct: median(vals), parts: { mvrvPct: R.mvrvPct, pctW200: R.pctW200, pctNearATH: R.pctNearATH } } : { state: null };
    out.trend200 = fin(R.dist200) && fin(R.slope200) ? { state: R.dist200 > 0 && R.slope200 > 0 ? 'up' : R.dist200 < 0 && R.slope200 < 0 ? 'down' : 'transition' } : { state: null };
    out.structure = fin(R.fw1Base) ? { state: R.fw1Base > 0 ? 'up' : R.fw1Base < 0 ? 'down' : 'mixed', auction: R.e2State || null } : { state: null, auction: R.e2State || null };
    if (fin(R.premPct)) {
      const L = decl.leverage, oiUp = fin(R.oiChg7d) ? R.oiChg7d > 0 : null;
      out.leverage = { state: R.premPct > L.crowdedPct ? (oiUp === true ? 'crowdedLong' : 'highPremium') : R.premPct < L.shortPct ? (oiUp === true ? 'shortCrowded' : 'lowPremium') : 'normal', pct: R.premPct, oiChg7d: fin(R.oiChg7d) ? R.oiChg7d : null, funding: R.funding ?? null };
    } else out.leverage = { state: null };
    out.spot = fin(R.cbZ) ? { state: R.cbZ >= decl.cbZBands.up ? 'payingUp' : R.cbZ <= decl.cbZBands.down ? 'discount' : 'normal', z: R.cbZ } : { state: null };
    const F = decl.flatBands;
    out.liquidity = fin(R.stableX) ? { state: R.stableX > F.stableX ? 'growing' : R.stableX < -F.stableX ? 'shrinking' : 'flat', x: R.stableX } : { state: null };
    out.holders = fin(R.lth30) ? { state: R.lth30 > F.lth30 ? 'adding' : R.lth30 < -F.lth30 ? 'distributing' : 'flat', x: R.lth30 } : { state: null };
    const G = decl.fngBands;
    out.sentiment = fin(R.fng) ? { state: R.fng <= G.extremeFear ? 'extremeFear' : R.fng < G.fear ? 'fear' : R.fng <= G.greed ? 'neutral' : R.fng < G.extremeGreed ? 'greed' : 'extremeGreed', x: R.fng } : { state: null };
    out.volatility = fin(R.rvPct) ? { state: R.rvPct < B.low ? 'calm' : R.rvPct > B.high ? 'elevated' : 'normal', pct: R.rvPct, atrPct: fin(R.atrPct) ? R.atrPct : null } : { state: null };
    out.liquidations = R.liq ? { state: null, context: R.liq } : { state: null };
    for (const [k, o] of Object.entries(out)) {
      const def = decl.rows[k].states[o.state];
      o.label = def ? def.label : null; o.convention = def ? def.convention : null; o.meaning = def ? def.meaning : null;
    }
    return out;
  }

  // Fixed one-line read, grouped Value · Trend · Positioning · Flows · Sentiment; words only, no count.
  function summary(S, decl) {
    const L = k => (S[k] && S[k].label ? S[k].label.toLowerCase() : 'no data');
    const auc = S.structure && S.structure.auction ? decl.rows.structure.auction[S.structure.auction] : null;
    return [
      `Value: ${L('value')}${S.value && fin(S.value.pct) ? ` (${Math.round(S.value.pct)}th percentile of its history)` : ''}.`,
      `Trend: long-term ${L('trend200')}, medium-term ${L('structure')}${auc ? `, ${auc}` : ''}.`,
      `Positioning: leverage ${L('leverage')}.`,
      `Flows: US spot demand ${L('spot')}, stablecoin liquidity ${L('liquidity')}, long-term holders ${L('holders')}.`,
      `Sentiment: ${L('sentiment')}. Volatility: ${L('volatility')}.`,
      'This describes conditions, not the next move.',
    ];
  }

  // Readings from an engine result's families (+ bar series entry for D-1 + live extras).
  function readingsFromFamilies(fam, barEntry, extra = {}) {
    const g = (k, f) => (fam[k] && fam[k].score != null ? f(fam[k]) : null);
    return {
      mvrvPct: g('T1', f => f.pct), pctW200: barEntry ? barEntry.pctW200 : null, pctNearATH: barEntry ? barEntry.pctNearATH : null,
      dist200: g('T3', f => f.parts && f.parts.dist200 && f.parts.dist200.raw), slope200: g('T3', f => f.parts && f.parts.slope200 && f.parts.slope200.raw),
      fw1Base: extra.fw1Base ?? null, e2State: g('E2', f => f.state),
      premPct: g('E3a', f => f.pct), oiChg7d: extra.oiChg7d ?? null, funding: extra.funding ?? null,
      cbZ: g('E5a', f => f.raw), stableX: g('T4', f => f.raw), lth30: g('T2+', f => f.raw), fng: g('E7', f => f.raw),
      rvPct: fam.E6 && fin(fam.E6.pct) ? fam.E6.pct : null, atrPct: extra.atrPct ?? null, liq: extra.liq ?? null,
    };
  }

  // Financial condition score (declaration "score"): one vote per group, so trend counts once.
  function score(S, decl) {
    const v = k => (S[k] && S[k].state != null ? (S[k].convention === 'supportive' ? 1 : S[k].convention === 'headwind' ? -1 : 0) : null);
    const avg = ks => { const a = ks.map(v).filter(x => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
    const groups = { Value: v('value'), Trend: avg(['trend200', 'structure']), Flows: avg(['spot', 'liquidity']), Sentiment: v('sentiment') };   // leverage not scored (no OI history)
    const have = Object.values(groups).filter(x => x != null);
    if (have.length < 3) return { withheld: true, reason: `only ${have.length} of 4 groups have data`, groups };
    const sc = Math.round(have.reduce((x, y) => x + y, 0) * 2.5 * 10) / 10;
    const band = sc >= 5 ? 'Strong bull' : sc >= 2 ? 'Bull' : sc > -2 ? 'Neutral' : sc > -5 ? 'Bear' : 'Strong bear';
    return { withheld: false, score: sc, band, groups, of: have.length };
  }

  const api = { barSeries, states, summary, score, readingsFromFamilies, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BriefCondition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
