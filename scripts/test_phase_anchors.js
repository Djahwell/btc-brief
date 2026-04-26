#!/usr/bin/env node
// Synthetic smoke test for Phase 1 + Phase 2 phase-anchor wiring.
// Doesn't call Anthropic — just exercises buildSystemPrompt + buildAnchorsBlock
// against a fake all_data.json that has all the inputs Phase 1 expects.

import { writeFileSync, readFileSync, existsSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const CACHE = join(ROOT, 'public', 'all_data.json');
const BACKUP = join(ROOT, 'public', 'all_data.json.bak-test');

// Back up live cache so we don't clobber it.
if (existsSync(CACHE)) copyFileSync(CACHE, BACKUP);

// ── Fake an all_data.json with everything Phase 1 + Phase 2 need ─────────────
// Note: phaseAnchors here is what data-worker.js's computePhaseAnchors WOULD
// have written. We're testing Phase 2 (brief-worker consumption); Phase 1
// (the writer) is exercised in a separate inline test below.
const fake = {
  cachedAt: new Date().toISOString(),
  market: { price: 77000, marketCap: 1.5e12, volume24hUSD: 30e9 },
  tech: { sma200: 85000, sma50: 80000, sma20: 78000, candleCount: 200, cycleHigh: 126000 },
  coinMetrics: { realizedPrice: 45000, mvrv: 1.71, date: '2026-04-25' },
  phaseAnchors: {
    hardStop:    Math.round(45000 * 0.97),  // 43650
    phaseA_low:  45000,
    phaseA_high: 85000,
    phaseB_high: Math.round(85000 * 1.15),  // 97750
    phaseC_high: Math.round(126000 * 0.98), // 123480
    derivedFrom: { realized: 45000, sma200: 85000, cycleHigh: 126000, ath: 126000 },
    derivationStatus: 'NORMAL',
    regime:           'NORMAL',
    regimeReason:     'no regime triggers fired',
    computedAt:       new Date().toISOString(),
  },
  // Minimum fields buildUserMessage touches — most are gracefully optional.
  options: {}, macros: {}, cme: {},
  lthData: null, stablecoinSupply: null, etfFlow: null, mvrv: null, exchangeFlow: null, binanceLargeTrades: null,
};

writeFileSync(CACHE, JSON.stringify(fake, null, 2));

// Run brief-worker with a fake ANTHROPIC key to exercise the user-message build
// path. We don't actually want it to hit the Anthropic API — so set the key to
// something that will produce a request error, but NOT before the anchors log
// + buildSystemPrompt + user message construction have all run.
const env = { ...process.env, VITE_ANTHROPIC_API_KEY: 'sk-fake-test-key-DO-NOT-CALL' };
const r = spawnSync('node', ['brief-worker.js'], { env, cwd: ROOT, encoding: 'utf8', timeout: 30000 });

console.log('─── stdout ───');
console.log(r.stdout);
console.log('─── stderr ───');
console.log(r.stderr);
console.log(`─── exit ${r.status} ───`);

// Restore live cache.
if (existsSync(BACKUP)) copyFileSync(BACKUP, CACHE);

// Verify the expected phase-anchor log line was emitted (NORMAL path), and
// that the run reached Anthropic before failing (proving prompt construction
// succeeded). LEGACY_ANCHORS warning would mean Phase 1 wiring is broken.
const out = (r.stdout || '') + (r.stderr || '');
const expectations = [
  { needle: 'Phase anchors (deriv=NORMAL, regime=NORMAL)', label: 'Phase anchors log printed' },
  { needle: '$43,650',                label: 'hardStop ($43,650 = 45000*0.97) shown' },
  { needle: '$45,000',                label: 'phaseA_low ($45,000 = realized) shown' },
  { needle: '$85,000',                label: 'phaseA_high ($85,000 = sma200) shown' },
  { needle: '$97,750',                label: 'phaseB_high ($97,750 = sma200*1.15) shown' },
  { needle: '$123,480',               label: 'phaseC_high ($123,480 = ath*0.98) shown' },
  { needle: 'Calling Claude',         label: 'reached Anthropic call (prompt build OK)' },
];
let pass = 0, fail = 0;
for (const { needle, label } of expectations) {
  if (out.includes(needle)) { console.log(`  ✓ ${label}`); pass++; }
  else                       { console.log(`  ✗ ${label}  (missing: "${needle}")`); fail++; }
}
console.log(`\nPhase 2 (brief-worker consumption): ${pass}/${pass+fail} checks passed`);

// ── Phase 1 (data-worker.js computePhaseAnchors) inline test ────────────────
// Re-implement the function here verbatim for isolated testing. If you change
// the real one in data-worker.js, mirror those changes here.
function computePhaseAnchors(d, prevAnchors) {
  const realized = d?.coinMetrics?.realizedPrice ?? d?.mvrv?.realizedPrice ?? null;
  const sma200   = d?.tech?.sma200 ?? null;
  const cycleHigh = d?.tech?.cycleHigh ?? null;
  const prevAth  = prevAnchors?.derivedFrom?.ath ?? null;
  const ath = (cycleHigh != null || prevAth != null) ? Math.max(cycleHigh ?? 0, prevAth ?? 0) : null;
  const haveAll = realized != null && sma200 != null && ath != null;
  if (!haveAll) {
    if (prevAnchors) return { ...prevAnchors, derivationStatus: 'STALE_FALLBACK', derivationReason: 'missing inputs', computedAt: new Date().toISOString() };
    return null;
  }
  const floor = realized;
  const anchors = {
    hardStop:    Math.round(floor * 0.97),
    phaseA_low:  Math.round(floor),
    phaseA_high: Math.round(sma200),
    phaseB_high: Math.round(sma200 * 1.15),
    phaseC_high: Math.round(ath * 0.98),
  };
  const ordered = anchors.hardStop < anchors.phaseA_low
               && anchors.phaseA_low < anchors.phaseA_high
               && anchors.phaseA_high < anchors.phaseB_high
               && anchors.phaseB_high < anchors.phaseC_high;
  if (!ordered && prevAnchors) {
    return { ...prevAnchors, derivationStatus: 'INVERTED_FALLBACK', derivationReason: 'inverted', attempted: anchors, computedAt: new Date().toISOString() };
  }
  return { ...anchors, derivedFrom: { realized, sma200, cycleHigh, ath }, derivationStatus: ordered ? 'NORMAL' : 'INVERTED_NO_FALLBACK', computedAt: new Date().toISOString() };
}

console.log('\n─── Phase 1 (computePhaseAnchors) cases ───');
const cases = [
  {
    name: 'NORMAL — all inputs present',
    input: { coinMetrics: { realizedPrice: 45000 }, tech: { sma200: 85000, cycleHigh: 126000 } },
    prev: null,
    expect: { derivationStatus: 'NORMAL', hardStop: 43650, phaseA_low: 45000, phaseA_high: 85000, phaseB_high: 97750, phaseC_high: 123480 },
  },
  {
    name: 'STALE_FALLBACK — no realized, has prev',
    input: { tech: { sma200: 85000, cycleHigh: 126000 } },
    prev: { hardStop: 43650, phaseA_low: 45000, phaseA_high: 85000, phaseB_high: 97750, phaseC_high: 123480 },
    expect: { derivationStatus: 'STALE_FALLBACK', hardStop: 43650 },
  },
  {
    name: 'NULL — no inputs, no prev',
    input: {},
    prev: null,
    expect: null,
  },
  {
    name: 'Monotonic ATH — cycleHigh < prev.ath, prev.ath persists',
    input: { coinMetrics: { realizedPrice: 45000 }, tech: { sma200: 85000, cycleHigh: 100000 } },
    prev: { derivedFrom: { ath: 126000 } },
    expect: { derivationStatus: 'NORMAL', phaseC_high: 123480 }, // 126000 * 0.98, not 100000 * 0.98
  },
  {
    name: 'INVERTED_FALLBACK — sma200 < realized*0.97, prev kept',
    input: { coinMetrics: { realizedPrice: 100000 }, tech: { sma200: 50000, cycleHigh: 200000 } },
    prev: { hardStop: 43650, phaseA_low: 45000, phaseA_high: 85000, phaseB_high: 97750, phaseC_high: 123480 },
    expect: { derivationStatus: 'INVERTED_FALLBACK', hardStop: 43650 },
  },
];

let p1pass = 0, p1fail = 0;
for (const c of cases) {
  const got = computePhaseAnchors(c.input, c.prev);
  if (c.expect === null) {
    if (got === null) { console.log(`  ✓ ${c.name}`); p1pass++; }
    else              { console.log(`  ✗ ${c.name}  (expected null, got ${JSON.stringify(got)})`); p1fail++; }
    continue;
  }
  let ok = true; const mismatches = [];
  for (const [k, v] of Object.entries(c.expect)) {
    if (got?.[k] !== v) { ok = false; mismatches.push(`${k}: expected ${v}, got ${got?.[k]}`); }
  }
  if (ok) { console.log(`  ✓ ${c.name}`); p1pass++; }
  else    { console.log(`  ✗ ${c.name}\n    ${mismatches.join('\n    ')}`); p1fail++; }
}
console.log(`\nPhase 1 (computePhaseAnchors): ${p1pass}/${p1pass+p1fail} cases passed`);

const overallFail = fail + p1fail;
console.log(`\nOVERALL: ${pass + p1pass}/${pass + fail + p1pass + p1fail} checks passed`);
process.exit(overallFail === 0 ? 0 : 1);
