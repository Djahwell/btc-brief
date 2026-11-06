'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const C = require('../condition.js');
const decl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'condition-declaration.json'), 'utf8'));
const base = { mvrvPct: 50, pctW200: 50, pctNearATH: 50, dist200: 1, slope200: 1, fw1Base: 4, e2State: 'BALANCE', premPct: 50, oiChg7d: null, cbZ: 0, stableX: 0, lth30: 0, fng: 50, rvPct: 50 };

test('every state named in the declaration has label, convention key and meaning', () => {
  for (const [k, r] of Object.entries(decl.rows)) for (const [s, d] of Object.entries(r.states)) {
    assert.ok(d.label && d.meaning, `${k}.${s}`); assert.ok(['supportive', 'headwind', 'neutral', null].includes(d.convention), `${k}.${s}`);
  }
  assert.strictEqual(decl.rows.holders.states.distributing.convention, null);      // Board: LTH not coloured
  assert.strictEqual(decl.rows.leverage.states.shortCrowded.convention, null);
});

test('missing readings give no data, never neutral', () => {
  const S = C.states({}, decl);
  for (const [k, o] of Object.entries(S)) { assert.strictEqual(o.state, null, k); assert.strictEqual(o.convention, null, k); }
  const one = C.states({ mvrvPct: 10 }, decl); assert.strictEqual(one.value.state, null);    // needs 2 of 3
});

test('valuation bands use the median of the three percentiles', () => {
  assert.strictEqual(C.states({ ...base, mvrvPct: 5, pctW200: 15, pctNearATH: 90 }, decl).value.state, 'cheap');
  assert.strictEqual(C.states({ ...base, mvrvPct: 85, pctW200: 90, pctNearATH: 10 }, decl).value.state, 'stretched');
  assert.strictEqual(C.states(base, decl).value.state, 'fair');
});

test('crowded long needs high premium AND rising open interest', () => {
  assert.strictEqual(C.states({ ...base, premPct: 90, oiChg7d: 3 }, decl).leverage.state, 'crowdedLong');
  assert.strictEqual(C.states({ ...base, premPct: 90, oiChg7d: -1 }, decl).leverage.state, 'highPremium');
  assert.strictEqual(C.states({ ...base, premPct: 90 }, decl).leverage.state, 'highPremium');
  assert.strictEqual(C.states({ ...base, premPct: 10, oiChg7d: 2 }, decl).leverage.state, 'shortCrowded');
});

test('trend, flows and sentiment thresholds', () => {
  const S = C.states({ ...base, dist200: -1, slope200: 1, fw1Base: -4, cbZ: -1.2, stableX: 0.01, lth30: -2000, fng: 20, rvPct: 85 }, decl);
  assert.deepStrictEqual([S.trend200.state, S.structure.state, S.spot.state, S.liquidity.state, S.holders.state, S.sentiment.state, S.volatility.state],
    ['transition', 'down', 'discount', 'growing', 'distributing', 'extremeFear', 'elevated']);
});

test('summary has no count and ends with the not-a-forecast line', () => {
  const lines = C.summary(C.states(base, decl), decl);
  assert.match(lines.at(-1), /not the next move/); assert.ok(!lines.join(' ').match(/\d+ supportive|\d+ headwind/));
});

test('barSeries: point-in-time percentiles, 200-week from bar 1400', () => {
  const bars = []; for (let i = 0; i < 1800; i++) bars.push({ d: C.addDays('2015-01-01', i), h: 100 + i, c: 100 + i });
  const s = C.barSeries(bars);
  assert.strictEqual(s.get(bars[1398].d).pctW200, null); assert.ok(Number.isFinite(s.get(bars[1799].d).pctW200));
  assert.strictEqual(s.get(bars[300].d).pctNearATH, null);            // warm-up 365
  const sh = C.barSeries(bars.slice(0, 1000)); assert.strictEqual(sh.get(bars[999].d).pctNearATH, s.get(bars[999].d).pctNearATH);   // no look-ahead
});

test('evidence file covers every state and suppresses below 4 windows', () => {
  const ev = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'condition-evidence.json'), 'utf8'));
  for (const [k, r] of Object.entries(decl.rows)) for (const s of Object.keys(r.states)) {
    const e = ev.rows[k][s]; assert.ok(e, `${k}.${s}`); if (e.windows < 4) assert.ok(e.suppressed, `${k}.${s}`); else assert.ok(Number.isFinite(e.medianRet));
  }
});

test('condition score: one vote per group, trend counted once, quorum 4 of 5', () => {
  const S = C.states({ ...base, mvrvPct: 10, pctW200: 10, pctNearATH: 10, cbZ: 2, stableX: 0.05, fng: 20 }, decl);
  const r = C.score(S, decl);
  // Value +1, Trend (up,up) +1, Flows (+1,+1) +1, Sentiment +1 → 4 × 2.5 = 10; leverage never scored
  assert.deepStrictEqual([r.score, r.band, r.of], [10, 'Strong bull', 4]);
  assert.ok(!('Positioning' in r.groups));
  const T = C.score(C.states({ ...base, dist200: -1, slope200: -1 }, decl), decl);          // trend split: (−1 + +1)/2 = 0
  assert.strictEqual(T.groups.Trend, 0);
  assert.ok(C.score(C.states({ mvrvPct: 50, pctW200: 50, dist200: 1, slope200: 1 }, decl), decl).withheld);   // 2 of 4
});
