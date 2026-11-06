'use strict';
// FW1 forward-test harness on SYNTHETIC records only.
const test = require('node:test'); const assert = require('node:assert/strict');
const T = require('../fw1test.js'); const S = require('../stats.js');
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function synth(days, signal) {
  const r = S.mulberry32(5); const bars = []; const frozen = []; let p = 50000, s = 0;
  const scores = []; for (let i = 0; i < days + 20; i++) { s = Math.max(-10, Math.min(10, Math.round(0.9 * s + (r() - 0.5) * 6))); scores.push(s); }
  for (let i = -5; i < days + 10; i++) { const d = add('2026-11-20', i); const bias = signal && i >= 0 && i < days ? (scores[i] >= 3 ? 0.012 : -0.002) : 0; p *= 1 + (r() - 0.5) * 0.04 + bias; bars.push({ d, o: p, h: p * 1.01, l: p * 0.99, c: p }); }
  for (let i = 0; i < days; i++) frozen.push({ date: add('2026-11-20', i), missing: i % 37 === 5, engine: { families: { E1: { score: 0 } }, fw1: { entry: { score: scores[i], withheld: false }, tendency: { score: scores[i], withheld: false } } } });
  return { bars, frozen };
}
test('collecting before 12 months; nulls kept inside; extension only by episode count', () => {
  const { bars, frozen } = synth(200, false);
  assert.equal(T.fw1Status(frozen, bars, '2027-06-01').status, 'collecting');
  const s = T.series(frozen, bars); assert.ok(s.rows.some(r => r.entry == null)); assert.equal(s.first, '2026-11-20');
});
test('decides at 12 months; detects a planted effect; tendency only at 24', () => {
  const { bars, frozen } = synth(380, true);
  const st = T.fw1Status(frozen, bars, '2027-11-25');
  assert.equal(st.status, 'decided'); assert.equal(st.checkpoint, 12);
  assert.ok(st.entry.H1.stat > 0 && st.entry.H1.p < 0.05, JSON.stringify(st.entry.H1));
  assert.equal(st.tendency.status, 'decided at 24 months');
});
