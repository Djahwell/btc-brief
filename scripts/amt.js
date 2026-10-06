// scripts/amt.js — Auction Market Theory (AMT) market-balance classifier.
//
// Builds a composite volume profile from DAILY OHLCV candles and classifies the
// auction as balanced (rotational, two-sided trade inside value) or imbalanced
// (one side has taken control and price is being ACCEPTED outside value).
//
// Method (Dalton, "Mind Over Markets" / "Markets in Profile"):
//   • Profile: each day's volume is spread evenly across the price bins its
//     [low, high] range touches. With daily bars this approximates a TPO/volume
//     profile — coarse, but stable and free.
//   • POC = bin with the most volume. Value Area = POC expanded toward the
//     heavier neighbour until it holds 70% of volume → VAL..VAH.
//   • Acceptance = ≥2 of the last 3 COMPLETED daily closes outside value on the
//     same side, with spot still on that side.
//   • Failed auction = a probe beyond VAH/VAL in the last 5 completed days that
//     was rejected (spot back inside value, no acceptance) → rotation to the
//     other side of value is the high-probability path.
//   • Value migration = 7d POC vs 30d POC (is value being built higher/lower?).
//
// Pure function, no I/O. Used by data-worker.js; also runnable in tests.

const VALUE_AREA_PCT = 0.70;
const NUM_BINS       = 80;

export function buildProfile(highs, lows, vols) {
  const lo = Math.min(...lows), hi = Math.max(...highs);
  if (!(hi > lo)) return null;
  const step = (hi - lo) / NUM_BINS;
  const bins = new Array(NUM_BINS).fill(0);
  let total = 0;
  for (let i = 0; i < highs.length; i++) {
    const v = vols[i] > 0 ? vols[i] : 0;
    if (!v) continue;
    const b0 = Math.max(0, Math.min(NUM_BINS - 1, Math.floor((lows[i]  - lo) / step)));
    const b1 = Math.max(0, Math.min(NUM_BINS - 1, Math.floor((highs[i] - lo) / step)));
    const per = v / (b1 - b0 + 1);
    for (let b = b0; b <= b1; b++) bins[b] += per;
    total += v;
  }
  if (!total) return null;

  let poc = 0;
  for (let b = 1; b < NUM_BINS; b++) if (bins[b] > bins[poc]) poc = b;

  let lb = poc, ub = poc, acc = bins[poc];
  while (acc < total * VALUE_AREA_PCT && (lb > 0 || ub < NUM_BINS - 1)) {
    const below = lb > 0 ? bins[lb - 1] : -1;
    const above = ub < NUM_BINS - 1 ? bins[ub + 1] : -1;
    if (above >= below) { ub++; acc += bins[ub]; } else { lb--; acc += bins[lb]; }
  }
  const mid = b => lo + (b + 0.5) * step;
  return {
    poc: Math.round(mid(poc)),
    vah: Math.round(lo + (ub + 1) * step),
    val: Math.round(lo + lb * step),
    rangeHigh: Math.round(hi),
    rangeLow:  Math.round(lo),
  };
}

// candles: [{ date, open, high, low, close, volume }] oldest → newest.
// The LAST candle is assumed to be the in-progress UTC day (Kraken/Binance
// both return it); it is excluded from the profile and the acceptance count.
// spot: live price (falls back to the in-progress candle's close).
export function computeAMT(candles, spot, { lookback = 30, shortLookback = 7 } = {}) {
  if (!Array.isArray(candles) || candles.length < lookback + 2) return null;
  const done  = candles.slice(0, -1);                 // completed days only
  const price = spot || candles[candles.length - 1].close;
  const win   = done.slice(-lookback);
  const sWin  = done.slice(-shortLookback);

  const p30 = buildProfile(win.map(c => c.high),  win.map(c => c.low),  win.map(c => c.volume));
  const p7  = buildProfile(sWin.map(c => c.high), sWin.map(c => c.low), sWin.map(c => c.volume));
  if (!p30 || !p7) return null;
  const { poc, vah, val } = p30;

  const last3 = done.slice(-3).map(c => c.close);
  const last5 = done.slice(-5);
  const closesAbove = last3.filter(c => c > vah).length;
  const closesBelow = last3.filter(c => c < val).length;
  const inside      = price >= val && price <= vah;
  const probedHigh  = last5.some(c => c.high > vah);
  const probedLow   = last5.some(c => c.low  < val);

  // Value migration: where is the market building value this week vs the month?
  const vaWidth = Math.max(1, vah - val);
  const pocShiftPct = (p7.poc - poc) / poc * 100;
  const migration = p7.val > poc ? 'HIGHER'
                  : p7.vah < poc ? 'LOWER'
                  : Math.abs(p7.poc - poc) / vaWidth > 0.25 ? (p7.poc > poc ? 'HIGHER_OVERLAPPING' : 'LOWER_OVERLAPPING')
                  : 'OVERLAPPING';
  const coiling = (p7.vah - p7.val) < 0.5 * vaWidth && p7.vah <= vah && p7.val >= val;

  let state, reason;
  if (price > vah && closesAbove >= 2) {
    state = 'IMBALANCE_UP';
    reason = `${closesAbove}/3 daily closes above 30d VAH — buyers accepted higher prices; value being re-priced up`;
  } else if (price < val && closesBelow >= 2) {
    state = 'IMBALANCE_DOWN';
    reason = `${closesBelow}/3 daily closes below 30d VAL — sellers accepted lower prices; value being re-priced down`;
  } else if (price > vah) {
    state = 'TESTING_VAH';
    reason = 'spot above VAH but not yet accepted (needs 2 daily closes) — initiative buying probe, unconfirmed';
  } else if (price < val) {
    state = 'TESTING_VAL';
    reason = 'spot below VAL but not yet accepted (needs 2 daily closes) — initiative selling probe, unconfirmed';
  } else if (probedHigh && !probedLow) {
    state = 'FAILED_AUCTION_HIGH';
    reason = 'probe above VAH in last 5d rejected back into value — buyers exhausted; rotation toward POC/VAL favoured';
  } else if (probedLow && !probedHigh) {
    state = 'FAILED_AUCTION_LOW';
    reason = 'probe below VAL in last 5d rejected back into value — sellers exhausted; rotation toward POC/VAH favoured';
  } else {
    state = 'BALANCE';
    reason = coiling
      ? '7d value nested inside 30d value and <50% as wide — balance is compressing; expect a directional break'
      : 'two-sided rotational trade inside 30d value — responsive trade: fade the edges, no directional edge';
  }

  // Deterministic suggested score for the ±1 marketBalance axis.
  const up   = migration.startsWith('HIGHER');
  const down = migration.startsWith('LOWER');
  let suggestedScore = 0;
  if (state === 'IMBALANCE_UP'   && !down) suggestedScore = 1;
  if (state === 'IMBALANCE_DOWN' && !up)   suggestedScore = -1;
  if (state === 'FAILED_AUCTION_LOW')      suggestedScore = 1;
  if (state === 'FAILED_AUCTION_HIGH')     suggestedScore = -1;

  const posInValue = Math.round((price - val) / vaWidth * 100); // 0 = VAL, 100 = VAH
  const location = price > vah ? 'ABOVE_VALUE' : price < val ? 'BELOW_VALUE'
                 : posInValue >= 80 ? 'UPPER_EDGE' : posInValue <= 20 ? 'LOWER_EDGE' : 'MID_VALUE';

  return {
    state, reason, suggestedScore, location,
    price: Math.round(price),
    poc, vah, val,
    vaWidthPct: parseFloat((vaWidth / poc * 100).toFixed(1)),
    posInValuePct: posInValue,
    short: { poc: p7.poc, vah: p7.vah, val: p7.val,
             location: price > p7.vah ? 'ABOVE_7D_VALUE' : price < p7.val ? 'BELOW_7D_VALUE' : 'INSIDE_7D_VALUE' },
    migration, pocShiftPct: parseFloat(pocShiftPct.toFixed(1)), coiling,
    closesAboveVAH: closesAbove, closesBelowVAL: closesBelow,
    lookbackDays: lookback, shortLookbackDays: shortLookback,
    asOf: done[done.length - 1].date,
  };
}

// ── Prompt block shared by brief-worker.js and the JSX live path ─────────────
// Keeps the AMT wording/scoring rule in ONE place so both briefs score alike.
export function buildAMTPromptBlock(amt) {
  if (!amt || amt.poc == null) {
    return '\n\nAMT MARKET BALANCE: Unavailable (no daily candles). Set scoreDecomposition.marketBalance.score = 0 and auctionState.state = "UNAVAILABLE".';
  }
  const $ = n => '$' + Math.round(n).toLocaleString('en-US');
  const s = amt.short || {};
  return `\n\nAMT MARKET BALANCE (Auction Market Theory — ${amt.lookbackDays}d composite volume profile from daily bars, as of ${amt.asOf}):
  State:            ${amt.state} — ${amt.reason}
  30d POC:          ${$(amt.poc)}
  30d Value Area:   ${$(amt.val)} (VAL) – ${$(amt.vah)} (VAH)  [width ${amt.vaWidthPct}% of POC]
  Spot location:    ${amt.location} (${amt.posInValuePct}% through value; 0 = VAL, 100 = VAH)
  ${amt.shortLookbackDays}d value:         POC ${$(s.poc)} | VA ${$(s.val)} – ${$(s.vah)} → spot ${s.location || 'n/a'}
  Value migration:  ${amt.migration} (7d POC ${amt.pocShiftPct >= 0 ? '+' : ''}${amt.pocShiftPct}% vs 30d POC)${amt.coiling ? ' | COILING (7d value nested + compressed)' : ''}
  Acceptance:       ${amt.closesAboveVAH}/3 closes > VAH, ${amt.closesBelowVAL}/3 closes < VAL
  Suggested score:  ${amt.suggestedScore > 0 ? '+' : ''}${amt.suggestedScore}
  INSTRUCTION (scoreDecomposition.marketBalance, max ±1):
    IMBALANCE_UP with value migrating higher/overlapping = +1 | IMBALANCE_DOWN with value lower/overlapping = -1
    FAILED_AUCTION_LOW = +1 (sellers rejected) | FAILED_AUCTION_HIGH = -1 (buyers rejected)
    BALANCE / TESTING_VAH / TESTING_VAL = 0 (no accepted directional edge yet)
    Use the suggested score unless another LIVE signal gives a concrete reason to differ — say why in the signal text.
  HOW TO READ THE OTHER SIGNALS THROUGH AMT:
    In BALANCE: flows/derivatives that push price to VAH are likely to be FADED back to POC; at VAL they are likely to be bought. Favour responsive trade: ADD near VAL, do not chase at VAH.
    In IMBALANCE: trust the direction — flows confirming the move are initiative and should be followed; old VAH (up) / VAL (down) becomes the line in the sand.
    TESTING_*: a break needs 2 daily closes outside value to be accepted — make that the trigger.
  Populate auctionState and reference POC/VAH/VAL in todayAction.trigger and dynamicStop where relevant.`;
}
