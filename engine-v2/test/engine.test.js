'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const E = require('../engine.js');
const V = require('../view.js');
const { synthHistory, synthDecl } = require('./synth.js');

const decl = synthDecl();
const P = V.prepare(synthHistory());
const GOLD_DATES = ['2018-03-01', '2018-09-15', '2019-02-01', '2019-08-20', '2021-08-01'];

test('percentile: mid-rank ties, mapping endpoints, rounding half away from zero', () => {
  assert.equal(E.pctRank([1, 2, 3, 4], 2.5), 50);
  assert.equal(E.pctRank([1, 2, 2, 3], 2), 50);
  const m = decl.percentileMap;
  assert.equal(E.mapPct(50, m), 0); assert.equal(E.mapPct(75, m), 0); assert.equal(E.mapPct(25, m), 0);
  assert.equal(E.mapPct(99, m), 10); assert.equal(E.mapPct(100, m), 10);
  assert.equal(E.mapPct(1, m), -10); assert.equal(E.mapPct(0, m), -10);
  assert.equal(E.mapPct(87, m), 5);
  assert.equal(E.roundHalfAway(2.5), 3); assert.equal(E.roundHalfAway(-2.5), -3);
  assert.ok(Object.is(E.roundHalfAway(-0.2), 0));
});

test('E2 profile is V1 scripts/amt.js buildProfile, number for number', async () => {
  const { buildProfile } = await import('../../scripts/amt.js');
  const bars = P.bars.slice(400, 430);
  const v1 = buildProfile(bars.map(b => b.h), bars.map(b => b.l), bars.map(b => b.v));
  const v2 = E.profile(bars, decl.e2.bins, decl.e2.valueAreaPct);
  assert.deepEqual({ poc: v2.poc, vah: v2.vah, val: v2.val }, { poc: v1.poc, vah: v1.vah, val: v1.val });
});

test('E2 states and scores', () => {
  const c = decl.e2; const K = 500;                                        // BTC-like price scale (VAH/VAL are whole dollars)
  const bar = (i, h, l, cl) => ({ d: `x${i}`, o: 100 * K, h: h * K, l: l * K, c: cl * K, v: 10 });
  const base = Array.from({ length: 30 }, (_, i) => (i < 25 ? bar(i, 101, 99, 100) : bar(i, 100.1, 99.9, 100)));
  assert.equal(E.familyE2(base, c).state, 'BALANCE'); assert.equal(E.familyE2(base, c).score, 0);
  const up = base.map((b, i) => (i >= 28 ? bar(i, 130, 100, 125) : b));
  let r = E.familyE2(up, c); assert.equal(r.state, 'IMBALANCE_UP'); assert.equal(r.score, 6);
  const up3 = base.map((b, i) => (i >= 27 ? bar(i, 130, 100, 125) : b));
  r = E.familyE2(up3, c); assert.equal(r.state, 'IMBALANCE_UP'); assert.equal(r.score, 7);   // +1 per extra accepting close
  const dn = base.map((b, i) => (i >= 28 ? bar(i, 100, 70, 75) : b));
  r = E.familyE2(dn, c); assert.equal(r.state, 'IMBALANCE_DOWN'); assert.equal(r.score, -6);
  const probeLow = base.map((b, i) => (i === 27 ? bar(i, 100.1, 80, 100) : b));
  r = E.familyE2(probeLow, c); assert.equal(r.state, 'FAILED_AUCTION_LOW'); assert.equal(r.score, 4);
  const probeHigh = base.map((b, i) => (i === 27 ? bar(i, 120, 99.9, 100) : b));
  r = E.familyE2(probeHigh, c); assert.equal(r.state, 'FAILED_AUCTION_HIGH'); assert.equal(r.score, -4);
  const testing = base.map((b, i) => (i === 29 ? bar(i, 130, 100, 125) : b));
  r = E.familyE2(testing, c); assert.equal(r.state, 'TESTING_VAH'); assert.equal(r.score, 0);
});

test('publish lags: values dated after D − lag are never used', () => {
  const D = '2019-06-01';
  const v = V.viewAt(P, D);
  const poisoned = { ...v,
    fng: v.fng.map(r => (r.d >= '2019-06-01' ? { ...r, v: 0 } : r)),          // lag 1 → D−1 usable, D not
    mvrv: v.mvrv.map(r => (r.d >= '2019-05-31' ? { ...r, v: 1e9 } : r)),     // lag 2 → D−2 usable, D−1 not
    bars: [...v.bars, { d: D, o: 1, h: 1e9, l: 1, c: 1e9, v: 1 }] };          // bar D is not closed at D 00:00
  const a = E.evaluate(v, decl), b = E.evaluate(poisoned, decl);
  assert.deepEqual(b.families.E7, a.families.E7);
  assert.deepEqual(b.families.T1, a.families.T1);
  assert.deepEqual(b.families.E1, a.families.E1);
  assert.equal(a.families.E7.asOf, '2019-05-31');
  assert.equal(a.families.T1.asOf, '2019-05-30');
});

test('fail closed: stale inputs drop the family, below quorum withholds the score', () => {
  const D = '2019-06-01';
  const v = V.viewAt(P, D);
  const ok = E.evaluate(v, decl);
  assert.equal(ok.scores['V-E1/E6a'].withheld, false);
  const stale = E.evaluate({ ...v, fng: v.fng.filter(r => r.d < '2019-05-20'), e5aZ: null }, decl);
  assert.equal(stale.families.E7.score, null);
  assert.equal(stale.families.E5a.score, null);
  assert.equal(stale.scores['V-E1/E6a'].withheld, true);
  assert.equal(stale.scores['V-E1/E6a'].score, null);
  const noBars = E.evaluate({ ...v, bars: v.bars.slice(0, -5) }, decl);
  for (const f of ['E1', 'E2', 'T3']) assert.equal(noBars.families[f].score, null, f);
  const nan = E.evaluate({ ...v, e5aZ: NaN, premium8h: { ...v.premium8h, current: undefined } }, decl);
  assert.equal(nan.families.E5a.score, null); assert.equal(nan.families.E3a.score, null);
});

test('warm-up: fewer than 365 reference days → no score', () => {
  const r = E.evaluate(V.viewAt(P, '2017-10-01'), decl);
  assert.equal(r.families.E1.score, null);
  assert.match(r.families.E1.reason, /warm-up/);
});

test('scorecard modifiers: E6b halves after rounding, V-E2 caps at +2 when E1 < 0, bands', () => {
  const f = (e1, rest, extra = {}) => ({ E1: { score: e1 }, E2: { score: rest }, E3a: { score: rest }, E5a: { score: rest }, E7: { score: rest },
    T1: { score: null }, 'T2+': { score: null }, 'T2-': { score: null }, T3: { score: null }, T4: { score: null }, ...extra });
  let s = E.scorecards(f(-1, 8), { e6TopDecile: true }, decl);          // mean 6.2 → 6
  assert.equal(s['V-E1/E6a'].score, 6); assert.equal(s['V-E1/E6a'].band, 'Strong bull');
  assert.equal(s['V-E1/E6b'].score, 3); assert.equal(s['V-E1/E6b'].band, 'Bull');
  assert.equal(s['V-E2/E6a'].score, 2); assert.equal(s['V-E2/E6a'].band, 'Neutral');
  assert.equal(s['V-E2/E6b'].score, 1);
  s = E.scorecards(f(2, -5), { e6TopDecile: false }, decl);            // mean −3.6 → −4
  assert.equal(s['V-E1/E6a'].score, -4); assert.equal(s['V-E1/E6a'].band, 'Bear');
  assert.equal(s['V-E1/E6b'].score, -4);
  s = E.scorecards(f(-10, -10), {}, decl); assert.equal(s['V-E1/E6a'].band, 'Strong bear');
  s = E.scorecards(f(2, 3, { E7: { score: null }, E5a: { score: null } }), {}, decl);
  assert.equal(s['V-E1/E6a'].withheld, true); assert.equal(s['V-E1/E6a'].reason, 'quorum 3/5');
  s = E.scorecards(f(0, 0, { T1: { score: 6 }, T3: { score: 4 }, T4: { score: -1 } }), {}, decl);
  assert.equal(s['V-T1/T2+'].score, 3); assert.equal(s['V-T1/T2+'].active, 3);
});

test('E5a: view.js matches the VPS computeFromLegs (parity)', () => {
  const { computeFromLegs } = require('../../vps/brief-v2/lib/cbpremium.js');
  const h = synthHistory(120, 3);
  const endSec = h.coinbase_premium_legs_1h.rows[100 * 24].t;
  const rows = h.coinbase_premium_legs_1h.rows.filter(r => r.t < endSec && r.t >= endSec - 31 * 86400);
  const cb = new Map(rows.map(r => [r.t, r.cb])), usdt = new Map(rows.map(r => [r.t, r.usdt])), bn = new Map(rows.map(r => [r.t, r.bn]));
  const vps = computeFromLegs(cb, usdt, bn, endSec);
  const mine = V.e5aFromAdj(rows.map(r => ({ t: r.t, adj: (r.cb / (r.bn * r.usdt) - 1) * 100 })), endSec);
  assert.ok(Math.abs(vps.z - mine.z) < 1e-12); assert.ok(Math.abs(vps.value - mine.value) < 1e-12);
});

test('T2: view.js lthNet30 matches scripts/v2/lthalign.mjs (parity), gaps handled', async () => {
  const { lthNet30 } = await import('../../scripts/v2/lthalign.mjs');
  const rows = []; let v = 1e7;
  for (let i = 0; i < 200; i++) { if ([40, 41, 90, 91, 92, 93, 94].includes(i)) continue; rows.push({ t: 1.6e9 + i * 86400, v: (v += (i % 7) * 100 - 250) }); }
  assert.deepEqual(V.lthNet30(rows), lthNet30(rows));
  const r = V.lthNet30(rows); assert.ok(r.length > 150 && r.every(x => Number.isFinite(x.v)));
});

test('summary: fixed templates, withheld families never mentioned, withheld card has no number', () => {
  const S = require('../summary.js');
  const r = E.evaluate(V.viewAt(P, '2019-06-01'), decl);
  const s = S.summarize(r, decl);
  assert.match(s.entry, /^Entry \(1–7 days\) [+-]?\d+ \((Strong bull|Bull|Neutral|Bear|Strong bear)\): .*; \d\/5 fresh\.$/);
  assert.ok(s.why.length <= 3);
  const fam = JSON.parse(JSON.stringify(r.families)); fam.E7 = { score: null, reason: 'stale' }; fam.E5a = { score: null };
  const sc = E.scorecards(fam, r.warnings, decl);
  const s2 = S.summarize({ families: fam, scores: sc, primary: r.primary }, decl);
  assert.match(s2.entry, /^Entry \(1–7 days\) withheld \(quorum 3\/5\)\.$/);
  assert.ok(!/fear|greed|sentiment|Coinbase/.test(s2.why.join(' ')));
});

test('determinism: same view → identical output, hash embedded', () => {
  const v = V.viewAt(P, '2019-06-01');
  assert.equal(JSON.stringify(E.evaluate(v, decl)), JSON.stringify(E.evaluate(v, decl)));
  assert.equal(E.evaluate(v, decl).declarationHash, E.declarationHash(decl));
  const d2 = JSON.parse(JSON.stringify(decl)); d2.e1.atr = 15;
  assert.notEqual(E.declarationHash(d2), E.declarationHash(decl));
});

test('golden file (synthetic history)', () => {
  const file = path.join(__dirname, '..', 'golden', 'synthetic.json');
  const out = GOLD_DATES.map(D => { const r = E.evaluate(V.viewAt(P, D), decl); delete r.declarationHash; return r; });
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  assert.deepEqual(JSON.parse(JSON.stringify(out)), JSON.parse(fs.readFileSync(file, 'utf8')));
});

// Real-history golden: runs when V2_HISTORY_DIR points at a v2-data checkout (CI does this).
// Pinned to the history files' sha256 (manifest). A monthly rebuild changes the inputs, so the
// comparison then skips with a notice and the golden is regenerated deliberately (UPDATE_GOLDEN=1).
test('golden file (real v2-data history)', { skip: !process.env.V2_HISTORY_DIR }, (t) => {
  const dir = process.env.V2_HISTORY_DIR; const hist = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json.gz')) hist[f.slice(0, -8)] = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const inputs = Object.fromEntries(Object.keys(hist).sort().map(k => [k, manifest.files[k] ? manifest.files[k].sha256 : null]));
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'declaration.json'), 'utf8'));
  const RP = V.prepare(hist);
  const file = path.join(__dirname, '..', 'golden', 'real.json');
  const dates = ['2021-11-10', '2022-06-20', '2022-11-25', '2024-03-14', '2025-04-08'];
  const out = { inputs, results: dates.map(D => { const r = E.evaluate(V.viewAt(RP, D), real); delete r.declarationHash; return r; }) };
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  const gold = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (JSON.stringify(gold.inputs) !== JSON.stringify(inputs)) { t.skip('history files differ from the golden inputs — regenerate with UPDATE_GOLDEN=1 after review'); return; }
  assert.deepEqual(JSON.parse(JSON.stringify(out.results)), gold.results);
});

test('V2 page ships byte-identical engine files (public/v2/engine)', () => {
  for (const f of ['engine.js', 'summary.js', 'declaration.json']) {
    const a = fs.readFileSync(path.join(__dirname, '..', f)); const b = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'v2', 'engine', f));
    assert.ok(a.equals(b), `public/v2/engine/${f} differs from engine-v2/${f} — run: cp engine-v2/{engine.js,summary.js,declaration.json} public/v2/engine/`);
  }
});
