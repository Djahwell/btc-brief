'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CB = require('../cyclebottom.js');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cycle-bottoms.json'), 'utf8'));

test('reference band from close and CoinMetrics MVRV (21 Nov 2026)', () => {
  const o = CB.reference(60122.61, 1.12993, ref);
  assert.equal(o.realized, 53200);
  assert.equal(o.low, 42600);
  assert.equal(o.high, 47400);
  assert.equal(o.mid, 46300);
  assert.deepEqual(o.pastBottoms.map(b => b.year), ['2015', '2018', '2022']);
});

test('missing or bad inputs give no line, never a guess', () => {
  for (const [c, m] of [[null, 1.1], [60000, null], [60000, 0], [NaN, 1.1], [60000, -1]]) assert.equal(CB.reference(c, m, ref), null);
  assert.equal(CB.reference(60000, 1.1, null), null);
  assert.equal(CB.text(60000, undefined, ref), null);
});

test('text carries the descriptive label', () => {
  const t = CB.text(60122.61, 1.12993, ref);
  assert.match(t, /not a tested rating/);
  assert.match(t, /\$42,600–\$47,400/);
});

test('band is ordered and sits below MVRV 1', () => {
  assert.ok(ref.band.low < ref.band.mid && ref.band.mid < ref.band.high && ref.band.high < 1);
});

test('V2 page ships byte-identical cycle-bottom files', () => {
  for (const f of ['cyclebottom.js', 'cycle-bottoms.json']) {
    const a = fs.readFileSync(path.join(__dirname, '..', f)); const b = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'v2', 'engine', f));
    assert.ok(a.equals(b), `public/v2/engine/${f} differs — run: cp engine-v2/${f} public/v2/engine/`);
  }
});
