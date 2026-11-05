'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const E = require('../engine.js'); const V = require('../view.js'); const L = require('../live.js');
const { synthHistory, synthDecl } = require('./synth.js');

test('join: history wins, daily appends after the cut, overlap disagreement reported, duplicates rejected', () => {
  const issues = [];
  const h = [{ d: '2026-01-01', v: 1 }, { d: '2026-01-02', v: 2 }];
  const out = L.join('x', h, [{ d: '2026-01-02', v: 2.5 }, { d: '2026-01-03', v: 3 }], 0.01, issues);
  assert.deepEqual(out.map(r => r.v), [1, 2, 3]);
  assert.equal(issues.length, 1); assert.match(issues[0].issue, /overlap 2026-01-02/);
  const i2 = [];
  const out2 = L.join('x', h, [{ d: '2026-01-03', v: 3 }, { d: '2026-01-03', v: 4 }], 0.01, i2);
  assert.deepEqual(out2.map(r => r.v), [1, 2]); assert.match(i2[0].issue, /duplicate/);
});

test('live = backtest: a live view at D 00:00 scores exactly as the history view for D (synthetic)', () => {
  const decl = synthDecl(); const hist = synthHistory(); const P = V.prepare(hist);
  const D = '2019-06-01'; const hv = V.viewAt(P, D);
  // daily.json carrying the last 60 days again (overlap, identical) must change nothing
  const recent = P.bars.filter(b => b.d < D).slice(-60).map(b => ({ d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v_cb: b.v, v_bs: 0 }));
  const daily = { series: { daily_candles: { rows: recent }, fear_greed: { rows: P.fng.filter(r => r.d < D).slice(-30) } } };
  const { view, joinIssues } = L.liveView({ hist, P, daily, live: { nowMs: Date.parse(D + 'T00:00:00Z'), premium8hPct: hv.premium8h.current * 100, e5aZ: hv.e5aZ } });
  assert.deepEqual(joinIssues, []);
  const a = E.evaluate(hv, decl), b = E.evaluate(view, decl);
  assert.deepEqual(JSON.parse(JSON.stringify(b.families)), JSON.parse(JSON.stringify(a.families)));
  assert.deepEqual(b.scores, a.scores);
});

test('live = backtest on real history + daily.json', { skip: !process.env.V2_HISTORY_DIR }, () => {
  const dir = process.env.V2_HISTORY_DIR; const hist = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json.gz')) hist[f.slice(0, -8)] = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))));
  const dailyFile = path.join(dir, '..', 'daily.json');
  if (!fs.existsSync(dailyFile)) return;
  const daily = JSON.parse(fs.readFileSync(dailyFile, 'utf8'));
  const decl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'declaration.json'), 'utf8'));
  const P = V.prepare(hist);
  const D = '2026-10-20'; const hv = V.viewAt(P, D);
  const { view, joinIssues } = L.liveView({ hist, P, daily, live: { nowMs: Date.parse(D + 'T00:00:00Z'), premium8hPct: hv.premium8h.current * 100, e5aZ: hv.e5aZ } });
  const a = E.evaluate(hv, decl), b = E.evaluate(view, decl);
  assert.deepEqual(b.scores, a.scores, JSON.stringify(joinIssues));
});
