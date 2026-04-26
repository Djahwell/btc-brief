#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/regime_check.js — Phase 3 of PHASE_BOUNDARY_AUTOANCHOR.md
// ─────────────────────────────────────────────────────────────────────────────
// Detects three structural regimes from the public/history/ archive:
//
//   NEW_ATH_CYCLE     — current price >= rolling 28-day max AND realized price
//                        is rising (>+2% over ~30 trading days). Push the
//                        Phase C ceiling above current ATH so Phase D has room.
//   SUSTAINED_BEAR    — price < realizedPrice for 30+ consecutive UTC days
//                        OR price < sma200 for 60+ consecutive days. Pull the
//                        hard stop deeper, collapse Phase A → reaccumulation.
//   NORMAL            — otherwise. Anchors keep Phase 1's vanilla formulas.
//
// HYSTERESIS: a non-NORMAL classification doesn't take effect until 7
// consecutive cron cycles (~42 hours) all flag the same regime. One disagreeing
// cycle resets the pending count to zero. Stops a single weird snapshot from
// rewriting the strategy.
//
// GRACEFUL DEGRADE: with < 7 cycles of history, returns NORMAL with reason
// "insufficient history" so the worker keeps shipping. Each rule has its own
// minimum-history budget — we only evaluate rules we have enough data for.
//
// ─────────────────────────────────────────────────────────────────────────────
// Pure functions, no fs imports — easy to unit-test. The caller (data-worker)
// is responsible for loading the snapshots from disk.
// ─────────────────────────────────────────────────────────────────────────────

// Cron cadence: 4 snapshots/day (00, 06, 12, 18 UTC). Constants are expressed
// in cycles for clarity — 4 cycles = 1 day.
const CYCLES_PER_DAY  = 4;
const HYSTERESIS_N    = 7;   // consecutive cycles required to promote a regime

// Rule windows
const ATH_LOOKBACK_DAYS   = 28;       // "rolling local high" window
const REALIZED_TREND_DAYS = 30;       // realized-price trend window
const REALIZED_TREND_PCT  = 0.02;     // +2% rise threshold
const BEAR_REALIZED_DAYS  = 30;       // price < realized for N consecutive days
const BEAR_SMA_DAYS       = 60;       // price < sma200 for N consecutive days

// ── Helpers ──────────────────────────────────────────────────────────────────

// Extract a price/realized/sma200 timeseries from snapshots. Snapshots may have
// missing fields (older snapshots predate Phase 1, etc.) — caller filters.
function extractSeries(snapshots) {
  return snapshots.map(s => ({
    key:      s.snapshotKey ?? null,
    price:    s?.market?.price ?? null,
    realized: s?.coinMetrics?.realizedPrice ?? s?.mvrv?.realizedPrice ?? null,
    sma200:   s?.tech?.sma200 ?? null,
  }));
}

// Returns true if every snapshot in `slice` has price strictly less than
// the named field. Used for "consecutive N days" checks. False if any snapshot
// in the window has a null field — we don't want missing data to trigger
// SUSTAINED_BEAR by accident.
function allBelow(slice, field) {
  if (!slice.length) return false;
  for (const s of slice) {
    if (s.price == null || s[field] == null) return false;
    if (!(s.price < s[field])) return false;
  }
  return true;
}

// ── Raw classifier (no hysteresis) ───────────────────────────────────────────

export function classifyRaw(snapshots) {
  const series = extractSeries(snapshots);
  // Most-recent last — caller should pass them in chronological order. If the
  // caller passes them descending, sorted-by-key reversal handles it.
  series.sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));

  const reasons = []; // accumulate skip reasons for transparency

  // ── SUSTAINED_BEAR ────────────────────────────────────────────────────────
  // Two trigger paths — either fires the regime. We need the LAST N cycles
  // (most recent) to all be below the threshold.
  const bearRealizedCycles = BEAR_REALIZED_DAYS * CYCLES_PER_DAY; // 120
  const bearSmaCycles      = BEAR_SMA_DAYS      * CYCLES_PER_DAY; // 240

  let bearRealizedHit = null;
  if (series.length >= bearRealizedCycles) {
    const slice = series.slice(-bearRealizedCycles);
    if (allBelow(slice, 'realized')) {
      bearRealizedHit = `price < realizedPrice for ${BEAR_REALIZED_DAYS} consecutive days`;
    }
  } else {
    reasons.push(`bear-realized rule needs ${bearRealizedCycles} cycles, have ${series.length}`);
  }

  let bearSmaHit = null;
  if (series.length >= bearSmaCycles) {
    const slice = series.slice(-bearSmaCycles);
    if (allBelow(slice, 'sma200')) {
      bearSmaHit = `price < SMA200 for ${BEAR_SMA_DAYS} consecutive days`;
    }
  } else {
    reasons.push(`bear-sma rule needs ${bearSmaCycles} cycles, have ${series.length}`);
  }

  if (bearRealizedHit || bearSmaHit) {
    return { regime: 'SUSTAINED_BEAR', reason: bearRealizedHit || bearSmaHit };
  }

  // ── NEW_ATH_CYCLE ─────────────────────────────────────────────────────────
  // Two simultaneous conditions:
  //   1. Current price >= max(price) in trailing ATH_LOOKBACK_DAYS window
  //   2. Realized price has risen >+2% over trailing REALIZED_TREND_DAYS
  const athLookbackCycles  = ATH_LOOKBACK_DAYS   * CYCLES_PER_DAY; // 112
  const realizedLookbackCy = REALIZED_TREND_DAYS * CYCLES_PER_DAY; // 120

  let athHit = false, realizedHit = false;
  const last = series[series.length - 1];
  if (!last || last.price == null) {
    return { regime: 'NORMAL', reason: 'no current price in latest snapshot' };
  }

  if (series.length >= athLookbackCycles) {
    const window = series.slice(-athLookbackCycles).filter(s => s.price != null);
    if (window.length) {
      const maxP = Math.max(...window.map(s => s.price));
      // "At or near" the local high — within 1% to account for intra-cycle noise
      athHit = last.price >= maxP * 0.99;
    }
  } else {
    reasons.push(`ath-cycle rule needs ${athLookbackCycles} cycles, have ${series.length}`);
  }

  if (series.length >= realizedLookbackCy) {
    const window = series.slice(-realizedLookbackCy).filter(s => s.realized != null);
    if (window.length >= 2) {
      const first = window[0].realized;
      const recent = window[window.length - 1].realized;
      realizedHit = (recent - first) / first > REALIZED_TREND_PCT;
    }
  }

  if (athHit && realizedHit) {
    return {
      regime: 'NEW_ATH_CYCLE',
      reason: `price at/near ${ATH_LOOKBACK_DAYS}d high AND realized price rising >${REALIZED_TREND_PCT*100}% over ${REALIZED_TREND_DAYS}d`,
    };
  }

  return {
    regime: 'NORMAL',
    reason: reasons.length ? `insufficient history — ${reasons.join('; ')}` : 'no regime triggers fired',
  };
}

// ── Hysteresis wrapper ───────────────────────────────────────────────────────
// State machine across cron cycles:
//   prevState = { promoted: 'NORMAL', pending: null, pendingCount: 0 }
//   raw       = { regime, reason }   from classifyRaw
//
// Behavior:
//   • raw.regime === promoted        → keep promoted, clear pending
//   • raw.regime === NORMAL          → keep promoted, clear pending
//                                       (don't let one quiet day demote)
//                                       BUT if promoted !== NORMAL and we get
//                                       HYSTERESIS_N consecutive NORMALs, demote.
//   • raw.regime === non-NORMAL and matches pending → increment pendingCount.
//                                       Promote when pendingCount >= HYSTERESIS_N.
//   • raw.regime === non-NORMAL and ≠ pending → reset pending to raw.regime, count=1.

export function classifyRegime(snapshots, prevState) {
  const raw = classifyRaw(snapshots);
  const state = {
    promoted:      prevState?.promoted     ?? 'NORMAL',
    pending:       prevState?.pending      ?? null,
    pendingCount:  prevState?.pendingCount ?? 0,
    normalCount:   prevState?.normalCount  ?? 0,
  };

  if (raw.regime === state.promoted) {
    state.pending = null;
    state.pendingCount = 0;
    state.normalCount = (raw.regime === 'NORMAL') ? state.normalCount + 1 : 0;
  } else if (raw.regime === 'NORMAL') {
    // We're on a non-NORMAL promoted regime but classifier says NORMAL.
    // Track NORMAL streak — demote back to NORMAL after HYSTERESIS_N agreement.
    state.normalCount += 1;
    state.pending = null;
    state.pendingCount = 0;
    if (state.normalCount >= HYSTERESIS_N && state.promoted !== 'NORMAL') {
      state.promoted = 'NORMAL';
      state.normalCount = 0;
    }
  } else if (raw.regime === state.pending) {
    state.pendingCount += 1;
    state.normalCount = 0;
    if (state.pendingCount >= HYSTERESIS_N) {
      state.promoted = state.pending;
      state.pending = null;
      state.pendingCount = 0;
    }
  } else {
    // New non-NORMAL classification disagreeing with current pending.
    state.pending = raw.regime;
    state.pendingCount = 1;
    state.normalCount = 0;
  }

  return {
    regime:       state.promoted,
    regimeReason: state.promoted === raw.regime
      ? raw.reason
      : `${raw.reason} (raw=${raw.regime}; promoted=${state.promoted}; pending=${state.pending ?? 'none'} count=${state.pendingCount})`,
    raw:          raw.regime,
    rawReason:    raw.reason,
    regimeState:  state,
  };
}

// ── Apply regime to anchors (modulation) ─────────────────────────────────────

export function applyRegimeToAnchors(anchors, regime) {
  if (!anchors) return anchors;
  const out = { ...anchors };

  if (regime === 'NEW_ATH_CYCLE') {
    // Push Phase C ceiling above current ATH so Phase D has runway.
    const ath = out.derivedFrom?.ath;
    if (ath) out.phaseC_high = Math.round(ath * 1.05);
    out.regimeModulation = 'NEW_ATH_CYCLE: phaseC_high lifted to ath*1.05';
  } else if (regime === 'SUSTAINED_BEAR') {
    // Pull hard stop deeper, collapse Phase A → reaccumulation mode.
    const realized = out.derivedFrom?.realized ?? out.phaseA_low;
    if (realized) {
      out.hardStop    = Math.round(realized * 0.90);
      out.phaseA_high = Math.round(realized * 1.05);
      // Re-order check — if our adjustment scrambles Phase B/C, leave them.
      if (out.phaseA_high >= out.phaseB_high) out.phaseA_high = Math.round(out.phaseB_high * 0.99);
    }
    out.regimeModulation = 'SUSTAINED_BEAR: hardStop=realized*0.90, phaseA_high=realized*1.05';
  }
  // NORMAL: no modulation

  return out;
}

// ── For CLI smoke testing ────────────────────────────────────────────────────
// Usage: node scripts/regime_check.js  → reads public/history/, classifies,
// prints result. Useful sanity-check before wiring into data-worker.
// Compare resolved paths since process.argv[1] may be relative.
async function _isCliEntry() {
  const { realpathSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
}
if (await _isCliEntry()) {
  const { readFileSync, readdirSync, existsSync } = await import('fs');
  const { join, dirname }                          = await import('path');
  const { fileURLToPath }                          = await import('url');
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const HIST = join(ROOT, 'public', 'history');

  if (!existsSync(HIST)) {
    console.error(`[regime] No history dir at ${HIST} — nothing to classify`);
    process.exit(0);
  }
  const files = readdirSync(HIST)
    .filter(f => /^\d{4}-\d{2}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  console.log(`[regime] Found ${files.length} snapshots`);
  const snapshots = files.map(f => {
    try { return JSON.parse(readFileSync(join(HIST, f), 'utf8')); }
    catch { return null; }
  }).filter(Boolean);
  const result = classifyRegime(snapshots, null);
  console.log(JSON.stringify(result, null, 2));
}
