'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CB = require('../cyclebottom.js');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cycle-bottoms.json'), 'utf8'));
const r100 = x => Math.round(x / 100) * 100;
const T = ref.built; // a day on which the shipped band is fresh

// Fixed synthetic band, so these tests do not change when the monthly job rebuilds the real file.
const fx = { built: '2026-11-22', label: 'L.', band: { low: 0.8, mid: 0.87, high: 0.89 },
  bottoms: [{ cycle: '2011', date: '2011-10-19', mvrv: 0.39 }, { cycle: '2015', date: '2015-01-14', mvrv: 0.56 }, { cycle: '2018', date: '2018-12-15', mvrv: 0.69 }, { cycle: '2022', date: '2022-11-09', mvrv: 0.75 }] };

test('reference band from close and CoinMetrics MVRV (21 Nov 2026)', () => {
  const o = CB.reference(60122.61, 1.12993, fx, '2026-11-22');
  assert.equal(o.realized, 53200);
  assert.equal(o.low, 42600);
  assert.equal(o.high, 47400);
  assert.equal(o.mid, 46300);
  assert.deepEqual(o.pastBottoms.map(b => b.year), ['2015', '2018', '2022']);
});

test('shipped band converts at the realized price', () => {
  const o = CB.reference(60000, 1.2, ref, T);
  assert.equal(o.low, r100(ref.band.low * 50000));
  assert.equal(o.high, r100(ref.band.high * 50000));
});

test('missing or bad inputs give no line, never a guess', () => {
  for (const [c, m] of [[null, 1.1], [60000, null], [60000, 0], [NaN, 1.1], [60000, -1]]) assert.equal(CB.reference(c, m, fx, '2026-11-22'), null);
  assert.equal(CB.reference(60000, 1.1, null, '2026-11-22'), null);
  assert.equal(CB.text(60000, undefined, fx, '2026-11-22'), null);
});

test('a band older than the limit is not shown', () => {
  assert.ok(CB.reference(60000, 1.1, fx, '2027-01-23'));            // 62 days
  assert.equal(CB.reference(60000, 1.1, fx, '2027-01-24'), null);   // 63 days
  assert.equal(CB.reference(60000, 1.1, fx, undefined), null);
  assert.equal(CB.reference(60000, 1.1, { ...fx, built: undefined }, '2026-11-22'), null);
});

test('text carries the descriptive label and the build date', () => {
  const t = CB.text(60122.61, 1.12993, fx, '2026-11-22');
  assert.match(t, /\$42,600–\$47,400/);
  assert.match(t, /Band rebuilt 2026-11-22\./);
  assert.match(CB.text(60000, 1.2, ref, T), /not a tested rating/);
});

test('shipped band is ordered and sits below MVRV 1.5', () => {
  assert.ok(ref.band.low <= ref.band.mid && ref.band.mid <= ref.band.high && ref.band.high < 1.5 && ref.band.low > 0);
});

test('V2 page ships byte-identical cycle-bottom files', () => {
  for (const f of ['cyclebottom.js', 'cycle-bottoms.json']) {
    const a = fs.readFileSync(path.join(__dirname, '..', f)); const b = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'v2', 'engine', f));
    assert.ok(a.equals(b), `public/v2/engine/${f} differs — run: cp engine-v2/${f} public/v2/engine/`);
  }
});
