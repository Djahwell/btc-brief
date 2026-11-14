'use strict';
// Code-written commentary (STAGE3-PLAN §5, D-6 = C): fixed sentence templates filled with the
// snapshot's values. Free, regenerated at every refresh. A withheld family is never mentioned;
// a withheld scorecard gets "withheld" and its reason, never a number.
// Runs in Node (VPS, tests) and in the browser (V2 page re-applies view-time withholding).
(function (root) {
  const sgn = n => (n > 0 ? '+' + n : String(n));
  const live = f => f && f.score != null;

  function phrase(key, f) {
    if (!live(f)) return null;
    const s = f.score;
    switch (key) {
      case 'E1': return s >= 6 ? 'trend strong' : s >= 3 ? 'trend up' : s <= -6 ? 'trend weak' : s <= -3 ? 'trend down' : 'trend flat';
      case 'E2': return ({
        IMBALANCE_UP: 'price accepted above value', TESTING_VAH: 'testing above value', FAILED_AUCTION_LOW: 'sellers rejected below value',
        BALANCE: 'inside value', FAILED_AUCTION_HIGH: 'buyers rejected above value', TESTING_VAL: 'testing below value', IMBALANCE_DOWN: 'price accepted below value',
      })[f.state] || 'value area';
      case 'E3a': return f.pct > 75 ? 'perps at a premium (froth)' : f.pct < 25 ? (f.trigger ? 'perps at a discount, lows holding' : 'perps at a discount, no trigger yet') : 'perp premium normal';
      case 'E5a': return s >= 3 ? 'US spot buying (Coinbase premium)' : s <= -3 ? 'US spot selling (Coinbase discount)' : s > 0 ? 'Coinbase premium slightly positive' : s < 0 ? 'Coinbase premium slightly negative' : 'Coinbase premium normal';
      case 'E7': return f.raw <= 25 ? 'extreme fear' : f.raw >= 75 ? 'extreme greed' : 'sentiment neutral';
      case 'T1': return s > 0 ? 'valuation cheap (MVRV low)' : s < 0 ? 'valuation rich (MVRV high)' : 'valuation mid-range';
      case 'T2+': case 'T2-': return f.raw > 0 ? 'long-term holders accumulating' : f.raw < 0 ? 'long-term holders distributing' : 'long-term holders flat';
      case 'T3': return s >= 3 ? 'above a rising 200-day' : s <= -3 ? 'below a falling 200-day' : 'near the 200-day';
      case 'T4': return s > 0 ? 'stablecoin supply growing faster than usual' : s < 0 ? 'stablecoin supply growing slower than usual' : 'stablecoin growth normal';
      default: return null;
    }
  }

  function card(label, c, keys, fam) {
    if (!c || c.withheld || c.score == null) return `${label} withheld${c && c.reason ? ` (${c.reason})` : ''}.`;
    const parts = keys.filter(k => live(fam[k])).map(k => `${phrase(k, fam[k])} (${sgn(fam[k].score)})`);
    return `${label} ${sgn(c.score)} (${c.band}): ${parts.join(', ')}; ${c.active}/${c.of} fresh.`;
  }

  // engine: { families, scores, primary } (already filtered for view-time freshness by the caller).
  function summarize(engine, decl) {
    const fam = engine.families || {}; const sc = engine.scores || {};
    const entryKeys = decl.scorecards.entry.families;
    const tKey = (engine.primary && engine.primary.tendency) || 'V-T1/T2+';
    const tendKeys = ['T1', tKey.endsWith('T2-') ? 'T2-' : 'T2+', 'T3', 'T4'];
    const entry = card('Entry (1–7 days)', sc[engine.primary.entry], entryKeys, fam);
    const tendency = card('Tendency (3–9 months)', sc[tKey], tendKeys, fam);
    const why = entryKeys.filter(k => live(fam[k]) && fam[k].score !== 0)
      .sort((a, b) => Math.abs(fam[b].score) - Math.abs(fam[a].score) || a.localeCompare(b))
      .slice(0, 3).map(k => `${phrase(k, fam[k])} (${sgn(fam[k].score)})`);
    const notes = [];
    if (fam.E6 && fam.E6.topDecile) notes.push('30-day volatility is in its top decile: expect wider swings.');
    if (String(engine.primary.entry).startsWith('V-E2') && live(fam.E1) && fam.E1.score < 0) notes.push(`Trend is negative: entry is capped at +${decl.scorecards.e2CapWhenTrendNegative}.`);
    return { entry, tendency, why, notes };
  }

  const api = { summarize, phrase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BriefSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
