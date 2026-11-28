'use strict';
// BTC Brief V2: cycle-bottom reference line for the valuation row (cycle-bottoms.json CYCLE-BOTTOMS-1).
// Pure: same file in the browser (globalThis.BriefCycleBottom) and in tests.
// Display only: never feeds a score, a state or the condition tally.
// Realized price is taken as close / CoinMetrics MVRV, the same series the band was fitted on.
(function (root) {
  const fin = x => typeof x === 'number' && Number.isFinite(x) && x > 0;

  const MAX_BAND_AGE_DAYS = 62; // rebuilt monthly (v2-cycle-bottoms.yml); older than this → not shown

  // close: last completed daily close (USD); mvrv: CoinMetrics MVRV for that day; ref: cycle-bottoms.json;
  // today: 'YYYY-MM-DD'. Returns null when any input is missing or the band is stale, so the page shows
  // nothing rather than a guess.
  function bandFresh(ref, today) {
    if (!ref || typeof ref.built !== 'string' || typeof today !== 'string') return false;
    const age = (Date.parse(today + 'T00:00:00Z') - Date.parse(ref.built + 'T00:00:00Z')) / 864e5;
    return Number.isFinite(age) && age >= -1 && age <= MAX_BAND_AGE_DAYS;
  }
  function reference(close, mvrv, ref, today) {
    if (!fin(close) || !fin(mvrv) || !ref || !ref.band || !fin(ref.band.low) || !fin(ref.band.high)) return null;
    if (!bandFresh(ref, today)) return null;
    const realized = close / mvrv;
    const r = x => Math.round(x / 100) * 100;
    return {
      mvrv, realized: r(realized),
      low: r(ref.band.low * realized), high: r(ref.band.high * realized),
      mid: fin(ref.band.mid) ? r(ref.band.mid * realized) : null,
      pastBottoms: (ref.bottoms || []).filter(b => b.cycle !== '2011').map(b => ({ year: b.date.slice(0, 4), mvrv: b.mvrv })),
    };
  }

  function text(close, mvrv, ref, today) {
    const o = reference(close, mvrv, ref, today);
    if (!o) return null;
    const usd = x => '$' + x.toLocaleString('en-US');
    const past = o.pastBottoms.map(b => `${b.mvrv.toFixed(2)} (${b.year})`).join(', ');
    return `Past cycle bottoms, MVRV: ${past}. Size-adjusted reference for this cycle ${ref.band.low.toFixed(2)}–${ref.band.high.toFixed(2)}, ` +
      `about ${usd(o.low)}–${usd(o.high)} at today's realized price ${usd(o.realized)} (now ${o.mvrv.toFixed(2)}). ` +
      `${ref.label} Band rebuilt ${ref.built}.`;
  }

  const api = { reference, text, bandFresh, MAX_BAND_AGE_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BriefCycleBottom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
