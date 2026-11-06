'use strict';
// v1.2 (STAGE-C-PLAN): condition read COND-1 in the live snapshot and in the frozen daily record.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const { engineDir } = require('../lib/score');
const { freezeDaily, frozenRecord } = require('../lib/store');

function sandbox() {
  const src = path.join(__dirname, '..'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bv2-12-'));
  for (const f of ['cycle.js', 'config.json', 'package.json']) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
  fs.cpSync(path.join(src, 'lib'), path.join(tmp, 'lib'), { recursive: true }); fs.cpSync(path.join(src, 'test'), path.join(tmp, 'test'), { recursive: true });
  const ed = engineDir(); fs.mkdirSync(path.join(tmp, 'engine', 'test'), { recursive: true });
  for (const f of ['engine.js', 'view.js', 'live.js', 'summary.js', 'fw1.js', 'declaration.json', 'declaration-fw1.json', 'condition.js', 'condition-declaration.json']) fs.copyFileSync(path.join(ed, f), path.join(tmp, 'engine', f));
  fs.copyFileSync(path.join(ed, 'test', 'synth.js'), path.join(tmp, 'engine', 'test', 'synth.js'));
  const liq = path.join(tmp, 'liq'); fs.mkdirSync(liq); fs.writeFileSync(path.join(liq, 'status.json'), '{}');
  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'))); Object.assign(cfg, { liqDir: liq, liqUnit: 'brief-v2-test-no-such-unit', diskFloorGB: 0.1, diskFloorPct: 1, liqStatusFile: path.join(liq, 'status.json') });
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));
  return tmp;
}

test('dry cycle: snapshot carries the condition read with declaration hash, states, score and summary', () => {
  const tmp = sandbox(); const pre = path.join(tmp, 'test', 'preload.js');
  fs.writeFileSync(pre, `globalThis.fetch = require('./mockfetch.js').mk({}).fetch;`);
  const out = execFileSync(process.execPath, ['-r', pre, 'cycle.js', '--dry-run'], { cwd: tmp, encoding: 'utf8' });
  assert.match(out, /\[cycle\] condition COND-1/);
  const day = fs.readdirSync(path.join(tmp, 'dry', 'snapshots')).filter(f => f.endsWith('.jsonl')).sort().pop();
  const snap = JSON.parse(fs.readFileSync(path.join(tmp, 'dry', 'snapshots', day), 'utf8').trim().split('\n').pop()).snapshot;
  const c = snap.engine.condition;
  assert.ok(c && !c.error, c && c.error);
  assert.equal(c.id, 'COND-1');
  const txt = fs.readFileSync(path.join(tmp, 'engine', 'condition-declaration.json')); assert.equal(c.declarationHash, require('crypto').createHash('sha256').update(txt).digest('hex'));
  for (const k of ['value', 'trend200', 'structure', 'leverage', 'spot', 'liquidity', 'holders', 'sentiment', 'volatility', 'liquidations']) assert.ok(k in c.states, k);
  assert.ok(!('Positioning' in (c.score.groups || {})), 'leverage is never scored');
  assert.match(c.summary.at(-1), /not the next move/);
  assert.equal(snap.codeVersion, 'brief-v2-vps/1.2.0');
});

test('frozen record keeps the condition block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv2-12f-')); fs.mkdirSync(path.join(dir, 'frozen'), { recursive: true });
  const condition = { id: 'COND-1', declarationHash: 'abc', conditionCodeHash: 'def', barDate: '2026-11-06', states: { value: { state: 'fair', label: 'Fair', convention: 'neutral' } }, score: { withheld: false, score: 0, band: 'Neutral' }, readings: { mvrvPct: 50 } };
  fs.writeFileSync(path.join(dir, 'frozen', '2026-11-07.json'), JSON.stringify({ frozenAt: 'x', snapshot: { seq: 1, generatedAt: 'y', engine: {} }, frozenEngine: { status: 'S', withheld: false, condition } }));
  const r = frozenRecord(dir, '2026-11-07');
  assert.deepEqual(r.engine.condition, condition);
});
