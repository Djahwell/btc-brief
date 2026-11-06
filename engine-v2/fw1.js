'use strict';
// FW1 — forward candidate (declaration-fw1.json, FORWARD-FW1.md). Pure. Built on the frozen engine's
// families (same lags, freshness and point-in-time rules); adds a trend-led base and counted
// confirmations/warnings. Runs in Node and in the browser (page shows it labelled "untested").
(function (root) {
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.BriefEngine;
  const on = f => f && typeof f.score === 'number' && Number.isFinite(f.score);
  const clamp = (x, c) => Math.max(-c, Math.min(c, x));
  const band = (s, d) => d.bands.find(b => s >= b.min).name;

  // trend inputs computed from the engine's own bars window (closed bars before D).
  function trendFacts(bars, smaN, slopeN) {
    const closes = bars.map(b => b.c); const n = closes.length;
    const sma = (k, end) => (end + 1 >= k ? closes.slice(end + 1 - k, end + 1).reduce((a, b) => a + b, 0) / k : null);
    return { close: closes[n - 1], sma: sma(smaN, n - 1), smaPrev: sma(smaN, n - 1 - slopeN) };
  }

  // res = engine evaluate() result; bars = the same view bars (closed before D).
  function fw1(res, bars, d) {
    const F = res.families; const out = { name: 'FW1', entry: null, tendency: null };
    const B = (bars || []).filter(b => b.d < res.date);
    // ---- entry ----
    if (!on(F.E1)) out.entry = { withheld: true, reason: 'trend (E1) not active', score: null };
    else {
      const a = trendFacts(B, 20, 5), b = trendFacts(B, 50, 0);
      const up = a.close > a.sma && a.sma > b.sma && a.sma > a.smaPrev, dn = a.close < a.sma && a.sma < b.sma && a.sma < a.smaPrev;
      const base = up ? (F.E1.score >= 6 ? 6 : 4) : dn ? (F.E1.score <= -6 ? -6 : -4) : 0;
      const parts = [{ k: 'trend', label: up ? (base === 6 ? 'strong uptrend' : 'uptrend') : dn ? (base === -6 ? 'strong downtrend' : 'downtrend') : 'no clear trend', pts: base }];
      const st = on(F.E2) ? F.E2.state : null;
      if (st === 'IMBALANCE_UP' || st === 'FAILED_AUCTION_LOW') parts.push({ k: 'auctionUp', label: st === 'IMBALANCE_UP' ? 'accepted above value' : 'sellers rejected below value', pts: 2 });
      if (st === 'IMBALANCE_DOWN' || st === 'FAILED_AUCTION_HIGH') parts.push({ k: 'auctionDown', label: st === 'IMBALANCE_DOWN' ? 'accepted below value' : 'buyers rejected above value', pts: -2 });
      if (on(F.E5a) && F.E5a.score >= 3) parts.push({ k: 'usSpotBid', label: 'US spot buying', pts: 2 });
      if (on(F.E5a) && F.E5a.score <= -3) parts.push({ k: 'usSpotOffered', label: 'US spot selling', pts: -2 });
      if (on(F.E3a) && F.E3a.score <= -3) parts.push({ k: 'perpFroth', label: 'perps frothy', pts: -2 });
      const fng = F.E7 && on(F.E7) ? F.E7.raw : null;
      if (fng != null && fng >= 75) parts.push({ k: 'greed', label: 'extreme greed', pts: -2 });
      if (fng != null && fng <= 25 && st === 'FAILED_AUCTION_LOW') parts.push({ k: 'capitulationBounce', label: 'fear + failed auction low', pts: 2 });
      let s = clamp(parts.reduce((x, p) => x + p.pts, 0), 10);
      const vol = F.E6 && F.E6.topDecile === true;
      if (vol) s = E.roundHalfAway(s / 2) + 0;
      out.entry = { score: s, band: band(s, d), parts, volatilityHalved: vol, withheld: false };
    }
    // ---- tendency ----
    if (!on(F.T3)) out.tendency = { withheld: true, reason: '200-day trend (T3) not active', score: null };
    else {
      const t = trendFacts(B, 200, 20);
      const up = t.close > t.sma && t.sma > t.smaPrev, dn = t.close < t.sma && t.sma < t.smaPrev;
      const base = up ? (F.T3.score >= 6 ? 6 : 4) : dn ? (F.T3.score <= -6 ? -6 : -4) : 0;
      const parts = [{ k: 'trend200', label: up ? 'above a rising 200-day' : dn ? 'below a falling 200-day' : 'around the 200-day', pts: base }];
      if (on(F.T1) && F.T1.score >= 6) parts.push({ k: 'cheap', label: 'valuation cheap (MVRV)', pts: 2 });
      if (on(F.T1) && F.T1.score <= -6) parts.push({ k: 'rich', label: 'valuation rich (MVRV)', pts: -2 });
      if (on(F.T4) && F.T4.score >= 3) parts.push({ k: 'liquidityUp', label: 'stablecoin growth above usual', pts: 1 });
      if (on(F.T4) && F.T4.score <= -3) parts.push({ k: 'liquidityDown', label: 'stablecoin growth below usual', pts: -1 });
      const s = clamp(parts.reduce((x, p) => x + p.pts, 0), 10);
      out.tendency = { score: s, band: band(s, d), parts, withheld: false };
    }
    return out;
  }

  const api = { fw1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BriefFW1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
