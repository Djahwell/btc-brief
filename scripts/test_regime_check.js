#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/test_regime_check.js — Phase 3 unit tests for scripts/regime_check.js
// ─────────────────────────────────────────────────────────────────────────────
// Pure synthetic tests — no fs, no network, no fixtures on disk. Builds
// snapshot timeseries in memory and exercises classifyRaw, classifyRegime
// (hysteresis), and applyRegimeToAnchors.
//
// Run: node scripts/test_regime_check.js  →  exit 0 if all pass, 1 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { classifyRaw, classifyRegime, applyRegimeToAnchors } from './regime_check.js';

// ── Snapshot factory ─────────────────────────────────────────────────────────
// Build N synthetic snapshots in chronological order (oldest first). The
// generators accept the cycle index i (0-based) and return numbers (or null).
// snapshotKey is a sortable timestamp so classifyRaw's internal sort is a no-op.
function makeSnapshots(n, { price, realized, sma200 } = {}) {
  const out = [];
  // Anchor on a fixed start date so keys are sortable + deterministic.
  const start = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00Z
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  for (let i = 0; i < n; i++) {
    const t = new Date(start + i * SIX_HOURS);
    const Y = t.getUTCFullYear();
    const M = String(t.getUTCMonth() + 1).padStart(2, '0');
    const D = String(t.getUTCDate()).padStart(2, '0');
    const H = String(t.getUTCHours()).padStart(2, '0');
    const key = `${Y}-${M}-${D}-${H}`;
    const p  = typeof price    === 'function' ? price(i)    : price;
    const r  = typeof realized === 'function' ? realized(i) : realized;
    const sm = typeof sma200   === 'function' ? sma200(i)   : sma200;
    out.push({
      snapshotKey: key,
      market: { price: p },
      coinMetrics: { realizedPrice: r },
      tech: { sma200: sm },
    });
  }
  return out;
}

// ── Tiny test runner ─────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else      { console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); failures.push(label); fail++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyRaw
// ─────────────────────────────────────────────────────────────────────────────
console.log('─── classifyRaw ───');

// 1. Empty / tiny history → NORMAL with "insufficient history" reason
{
  const r = classifyRaw([]);
  check('empty snapshots → NORMAL',
    r.regime === 'NORMAL',
    `got regime=${r.regime} reason=${r.reason}`);
}
{
  const r = classifyRaw(makeSnapshots(10, { price: 70000, realized: 50000, sma200: 80000 }));
  check('10 snapshots → NORMAL (insufficient for any rule)',
    r.regime === 'NORMAL' && r.reason.includes('insufficient'),
    `got regime=${r.regime} reason=${r.reason}`);
}

// 2. Full history, nothing notable → NORMAL with "no regime triggers fired"
{
  // 240 cycles (60 days) so every rule is evaluable. Price hovers above
  // realized + sma200, realized flat → no NEW_ATH and no BEAR.
  const snaps = makeSnapshots(240, {
    price:    () => 80000 + (Math.random() - 0.5) * 200,  // ~80k flat
    realized: () => 50000,
    sma200:   () => 75000,
  });
  const r = classifyRaw(snaps);
  check('flat market w/ full history → NORMAL',
    r.regime === 'NORMAL' && r.reason === 'no regime triggers fired',
    `got regime=${r.regime} reason=${r.reason}`);
}

// 3. NEW_ATH_CYCLE — price at the 28d max AND realized rising > 2% over 30d
{
  // 240 cycles. Price climbs steadily, realized climbs ~5% over 30d.
  const snaps = makeSnapshots(240, {
    // Price ramps from 80k to 130k. The last cycle is the highest in the
    // 28-day (112-cycle) window, satisfying the ATH condition.
    price:    (i) => 80000 + (i / 239) * 50000,
    // Realized ramps from 48k to 51k over 240 cycles.
    // 30-day (120-cycle) window: first=cycle 120, last=cycle 239.
    // r(120)=48000+(120/239)*3000=49506, r(239)=51000.
    // Δ% = (51000-49506)/49506 = 3.02% > 2% threshold ✓
    realized: (i) => 48000 + (i / 239) * 3000,
    sma200:   () => 75000,
  });
  const r = classifyRaw(snaps);
  check('rising market at local high → NEW_ATH_CYCLE',
    r.regime === 'NEW_ATH_CYCLE',
    `got regime=${r.regime} reason=${r.reason}`);
}

// 4. NEW_ATH conditions don't both fire → NORMAL
{
  // Price at high, realized FLAT (no rise >2%).
  const snaps = makeSnapshots(240, {
    price:    (i) => 80000 + (i / 239) * 50000,
    realized: () => 50000,
    sma200:   () => 75000,
  });
  const r = classifyRaw(snaps);
  check('price-at-high but realized flat → NORMAL',
    r.regime === 'NORMAL',
    `got regime=${r.regime} reason=${r.reason}`);
}

// 5. SUSTAINED_BEAR — price < realized for 120 consecutive cycles (30 days)
{
  // 130 cycles, price below realized for the last 120.
  const snaps = makeSnapshots(130, {
    price:    () => 40000,
    realized: () => 50000,
    sma200:   () => 80000,
  });
  const r = classifyRaw(snaps);
  check('price < realized for 120+ cycles → SUSTAINED_BEAR (realized path)',
    r.regime === 'SUSTAINED_BEAR' && r.reason.includes('realizedPrice'),
    `got regime=${r.regime} reason=${r.reason}`);
}

// 6. SUSTAINED_BEAR via SMA200 — price < sma200 for 240 cycles, but NOT below realized
{
  const snaps = makeSnapshots(240, {
    price:    () => 60000,    // above realized → NOT bear-realized…
    realized: () => 50000,
    sma200:   () => 80000,    // …but below sma200 for all 240 cycles → bear-sma
  });
  const r = classifyRaw(snaps);
  check('price < sma200 for 240+ cycles → SUSTAINED_BEAR (sma path)',
    r.regime === 'SUSTAINED_BEAR' && r.reason.includes('SMA200'),
    `got regime=${r.regime} reason=${r.reason}`);
}

// 7. allBelow guard — one null in the bear window prevents trigger
{
  const snaps = makeSnapshots(130, {
    price:    () => 40000,
    realized: (i) => (i === 50 ? null : 50000),  // one null in the window
    sma200:   () => 80000,
  });
  const r = classifyRaw(snaps);
  check('null realized in bear window does NOT trigger SUSTAINED_BEAR',
    r.regime === 'NORMAL',
    `got regime=${r.regime} reason=${r.reason}`);
}

// 8. SUSTAINED_BEAR takes priority over NEW_ATH_CYCLE if both could fire
{
  // Hard to construct simultaneously (price-below-realized + price-at-high)
  // since they conflict, but smoke-test that the bear branch returns first.
  // We just verify the order by hitting the bear branch directly with a
  // price-at-realized-low scenario.
  const snaps = makeSnapshots(240, {
    price:    () => 40000,
    realized: () => 50000,
    sma200:   () => 80000,
  });
  const r = classifyRaw(snaps);
  check('bear path checked before ATH path',
    r.regime === 'SUSTAINED_BEAR',
    `got regime=${r.regime}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyRegime — hysteresis state machine
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n─── classifyRegime (hysteresis) ───');

// Helper: stub the raw-classifier output for a deterministic state-machine test.
// We replay the public classifyRegime with hand-built snapshots that we know
// trigger a particular raw regime. To avoid coupling to internal magic numbers,
// we build canned snapshot sets and reuse them.

// Canned series builders that produce a specific raw classification:
const SNAPS_NORMAL = makeSnapshots(240, {
  price: 80000, realized: 50000, sma200: 75000,
});
const SNAPS_BEAR = makeSnapshots(130, {
  price: 40000, realized: 50000, sma200: 80000,
});
const SNAPS_ATH = makeSnapshots(240, {
  price:    (i) => 80000 + (i / 239) * 50000,
  realized: (i) => 48000 + (i / 239) * 3000,
  sma200:   () => 75000,
});

// Sanity: confirm what those canned sets actually classify as raw
{
  const a = classifyRaw(SNAPS_NORMAL).regime;
  const b = classifyRaw(SNAPS_BEAR).regime;
  const c = classifyRaw(SNAPS_ATH).regime;
  check('canned sets resolve to expected raw regimes',
    a === 'NORMAL' && b === 'SUSTAINED_BEAR' && c === 'NEW_ATH_CYCLE',
    `NORMAL=${a} BEAR=${b} ATH=${c}`);
}

// 1. Cold start, raw=NORMAL → promoted=NORMAL
{
  const r = classifyRegime(SNAPS_NORMAL, null);
  check('cold start + raw NORMAL → promoted NORMAL',
    r.regime === 'NORMAL' && r.regimeState.pending === null,
    `got promoted=${r.regime} pending=${r.regimeState.pending}`);
}

// 2. From NORMAL, 6 consecutive ATH classifications → still pending, not promoted
{
  let state = null;
  let result;
  for (let i = 0; i < 6; i++) {
    result = classifyRegime(SNAPS_ATH, state);
    state = result.regimeState;
  }
  check('6× raw NEW_ATH_CYCLE without promotion (pendingCount=6)',
    result.regime === 'NORMAL' &&
    state.pending === 'NEW_ATH_CYCLE' &&
    state.pendingCount === 6,
    `promoted=${result.regime} pending=${state.pending} count=${state.pendingCount}`);
}

// 3. 7 consecutive → promoted to NEW_ATH_CYCLE
{
  let state = null;
  let result;
  for (let i = 0; i < 7; i++) {
    result = classifyRegime(SNAPS_ATH, state);
    state = result.regimeState;
  }
  check('7× raw NEW_ATH_CYCLE → promoted to NEW_ATH_CYCLE',
    result.regime === 'NEW_ATH_CYCLE' &&
    state.pending === null &&
    state.pendingCount === 0,
    `promoted=${result.regime} pending=${state.pending} count=${state.pendingCount}`);
}

// 4. Pending streak interrupted by NORMAL → pending cleared
{
  let state = null;
  // 5× ATH (pending count = 5)
  for (let i = 0; i < 5; i++) state = classifyRegime(SNAPS_ATH, state).regimeState;
  // 1× NORMAL (should clear pending)
  const after = classifyRegime(SNAPS_NORMAL, state);
  check('NORMAL during pending streak clears pending',
    after.regimeState.pending === null && after.regimeState.pendingCount === 0,
    `pending=${after.regimeState.pending} count=${after.regimeState.pendingCount}`);
}

// 5. Pending streak interrupted by DIFFERENT non-NORMAL → pending switches to new regime, count=1
{
  let state = null;
  // 4× ATH
  for (let i = 0; i < 4; i++) state = classifyRegime(SNAPS_ATH, state).regimeState;
  // 1× BEAR — pending should switch to SUSTAINED_BEAR with count=1
  const after = classifyRegime(SNAPS_BEAR, state);
  check('different non-NORMAL switches pending, resets count to 1',
    after.regimeState.pending === 'SUSTAINED_BEAR' &&
    after.regimeState.pendingCount === 1,
    `pending=${after.regimeState.pending} count=${after.regimeState.pendingCount}`);
}

// 6. Once promoted, raw=NORMAL for <7 cycles → stays promoted (no demote)
{
  let state = null;
  // Promote to NEW_ATH_CYCLE
  for (let i = 0; i < 7; i++) state = classifyRegime(SNAPS_ATH, state).regimeState;
  // 6× NORMAL — should NOT demote yet
  let result;
  for (let i = 0; i < 6; i++) {
    result = classifyRegime(SNAPS_NORMAL, state);
    state = result.regimeState;
  }
  check('6× NORMAL after promotion does NOT demote',
    result.regime === 'NEW_ATH_CYCLE' && state.normalCount === 6,
    `promoted=${result.regime} normalCount=${state.normalCount}`);
}

// 7. Once promoted, raw=NORMAL for 7 cycles → demoted to NORMAL
{
  let state = null;
  for (let i = 0; i < 7; i++) state = classifyRegime(SNAPS_ATH, state).regimeState;
  let result;
  for (let i = 0; i < 7; i++) {
    result = classifyRegime(SNAPS_NORMAL, state);
    state = result.regimeState;
  }
  check('7× NORMAL after promotion → demoted to NORMAL',
    result.regime === 'NORMAL' && state.normalCount === 0,
    `promoted=${result.regime} normalCount=${state.normalCount}`);
}

// 8. Reason field reflects pending status when raw ≠ promoted
{
  let state = null;
  for (let i = 0; i < 3; i++) state = classifyRegime(SNAPS_ATH, state).regimeState;
  const r = classifyRegime(SNAPS_ATH, state);
  check('reason annotates pending state during promotion ramp',
    /pending=NEW_ATH_CYCLE count=4/.test(r.regimeReason),
    `regimeReason="${r.regimeReason}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// applyRegimeToAnchors
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n─── applyRegimeToAnchors ───');

const baseAnchors = {
  hardStop:    43650,
  phaseA_low:  45000,
  phaseA_high: 85000,
  phaseB_high: 97750,
  phaseC_high: 123480,
  derivedFrom: { realized: 45000, sma200: 85000, cycleHigh: 126000, ath: 126000 },
};

// 1. NORMAL → no change (other than possibly absent regimeModulation)
{
  const a = applyRegimeToAnchors(baseAnchors, 'NORMAL');
  check('NORMAL → anchors unchanged',
    a.hardStop === 43650 &&
    a.phaseA_low === 45000 &&
    a.phaseA_high === 85000 &&
    a.phaseB_high === 97750 &&
    a.phaseC_high === 123480 &&
    a.regimeModulation === undefined,
    JSON.stringify(a));
}

// 2. NEW_ATH_CYCLE → phaseC_high lifted to ath*1.05
{
  const a = applyRegimeToAnchors(baseAnchors, 'NEW_ATH_CYCLE');
  const expected = Math.round(126000 * 1.05); // 132300
  check('NEW_ATH_CYCLE → phaseC_high = ath*1.05',
    a.phaseC_high === expected && /lifted to ath\*1\.05/.test(a.regimeModulation),
    `got phaseC_high=${a.phaseC_high} (expected ${expected}); modulation="${a.regimeModulation}"`);
}

// 3. SUSTAINED_BEAR → hardStop=realized*0.9, phaseA_high=realized*1.05
{
  const a = applyRegimeToAnchors(baseAnchors, 'SUSTAINED_BEAR');
  const expectedStop = Math.round(45000 * 0.90); // 40500
  const expectedAhi  = Math.round(45000 * 1.05); // 47250
  check('SUSTAINED_BEAR → hardStop=realized*0.9, phaseA_high=realized*1.05',
    a.hardStop === expectedStop &&
    a.phaseA_high === expectedAhi &&
    /SUSTAINED_BEAR/.test(a.regimeModulation),
    `got hardStop=${a.hardStop} (exp ${expectedStop}), phaseA_high=${a.phaseA_high} (exp ${expectedAhi}); mod="${a.regimeModulation}"`);
}

// 4. SUSTAINED_BEAR with phaseA_high collision — clipped below phaseB_high
{
  // Construct a case where realized*1.05 > phaseB_high so the clip fires.
  const tight = {
    hardStop:    9700,
    phaseA_low:  10000,
    phaseA_high: 11000,
    phaseB_high: 12000,
    phaseC_high: 15000,
    derivedFrom: { realized: 100000, sma200: 11000, cycleHigh: 15000, ath: 15000 },
  };
  const a = applyRegimeToAnchors(tight, 'SUSTAINED_BEAR');
  // realized*1.05 = 105000, but that's >= phaseB_high (12000), so should clip
  // to phaseB_high*0.99 = 11880
  check('SUSTAINED_BEAR with phaseA_high collision → clipped to phaseB_high*0.99',
    a.phaseA_high === Math.round(12000 * 0.99),
    `phaseA_high=${a.phaseA_high} (expected ${Math.round(12000 * 0.99)})`);
}

// 5. null/undefined anchors → returned unchanged
{
  check('null anchors returned as-is', applyRegimeToAnchors(null, 'NEW_ATH_CYCLE') === null);
  check('undefined anchors returned as-is', applyRegimeToAnchors(undefined, 'SUSTAINED_BEAR') === undefined);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nOVERALL: ${pass}/${pass + fail} checks passed`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  • ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
