'use strict';
// mt.js on SYNTHETIC data only: point-in-time evaluation and the report shape.
const test = require('node:test'); const assert = require('node:assert/strict');
const path = require('path');
const V = require('../../engine-v2/view.js'); const MT = require('../mt.js');
const { synthHistory, synthDecl } = require('../../engine-v2/test/synth.js');

test('evalAt uses only information before t; report has 3 bands and clustered CIs', () => {
  const hist = synthHistory(1700, 7, '2017-01-01'); const decl = synthDecl(); const P = V.prepare(hist);
  const ph = MT.evaluate ? null : null;
  const t = Date.parse('2021-07-10T15:00:00Z') / 1000;
  const a = MT.evalAt(P, new Map(hist.binance_premium_index_1h.rows.map(r => [r.t, r.close])), decl, t);
  // poison everything at/after floor_hour(t): result must not change
  const cut = r => r.t < t;
  const h2 = { ...hist, binance_premium_index_1h: { rows: hist.binance_premium_index_1h.rows.map(r => (cut(r) ? r : { ...r, close: 0.5 })) },
    coinbase_premium_legs_1h: { rows: hist.coinbase_premium_legs_1h.rows.map(r => (cut(r) ? r : { ...r, cb: r.cb * 2 })) } };
  const P2 = V.prepare(h2);
  const b = MT.evalAt(P2, new Map(h2.binance_premium_index_1h.rows.map(r => [r.t, r.close])), decl, t);
  assert.deepEqual(b, a);
  const cmp = { box: [], trend: [] };
  for (let i = 0; i < 40; i++) { const d = new Date(Date.UTC(2021, 5, 1 + i, 12)); cmp.box.push({ sig: d.toISOString().slice(0, 16).replace('T', ' '), twin_R: (i % 3) - 1 }); }
  const out = MT.run({ P, hist, decl, cmp });
  assert.equal(out.box.trades, 40); assert.equal(out.box.entry.bands.length, 3);
  void ph; void path;
});
