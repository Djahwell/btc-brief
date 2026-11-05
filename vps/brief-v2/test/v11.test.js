'use strict';
// v1.1 (Stage 3): history pull + acceptance, shared engine in the cycle, frozen daily snapshot.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const { acceptance } = require('../lib/history');
const { freezeDaily, frozenRecord } = require('../lib/store');
const { engineDir, codeHash } = require('../lib/score');

function sandbox() {
  const src = path.join(__dirname, '..'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bv2-11-'));
  for (const f of ['cycle.js', 'config.json', 'package.json']) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
  fs.cpSync(path.join(src, 'lib'), path.join(tmp, 'lib'), { recursive: true }); fs.cpSync(path.join(src, 'test'), path.join(tmp, 'test'), { recursive: true });
  const ed = engineDir(); fs.mkdirSync(path.join(tmp, 'engine', 'test'), { recursive: true });
  for (const f of ['engine.js', 'view.js', 'live.js', 'summary.js', 'declaration.json']) fs.copyFileSync(path.join(ed, f), path.join(tmp, 'engine', f));
  fs.copyFileSync(path.join(ed, 'test', 'synth.js'), path.join(tmp, 'engine', 'test', 'synth.js'));
  const liq = path.join(tmp, 'liq'); fs.mkdirSync(liq); fs.writeFileSync(path.join(liq, 'status.json'), '{}');
  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'))); Object.assign(cfg, { liqDir: liq, liqUnit: 'brief-v2-test-no-such-unit', diskFloorGB: 0.1, diskFloorPct: 1, liqStatusFile: path.join(liq, 'status.json') });
  fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));
  return tmp;
}
function runDry(tmp, mockOpts = {}) {
  const pre = path.join(tmp, 'test', 'preload.js');
  fs.writeFileSync(pre, `globalThis.fetch = require('./mockfetch.js').mk(${JSON.stringify(mockOpts)}).fetch;`);
  const out = execFileSync(process.execPath, ['-r', pre, 'cycle.js', '--dry-run'], { cwd: tmp, encoding: 'utf8' });
  const day = fs.readdirSync(path.join(tmp, 'dry', 'snapshots')).filter(f => f.endsWith('.jsonl')).sort().pop();
  const snap = JSON.parse(fs.readFileSync(path.join(tmp, 'dry', 'snapshots', day), 'utf8').trim().split('\n').pop()).snapshot;
  return { out, snap };
}

test('cycle runs the engine on accepted history: scores present, labelled CANDIDATE, hashes embedded', () => {
  const tmp = sandbox(); const { out, snap } = runDry(tmp);
  const e = snap.engine;
  assert.match(e.status, /^CANDIDATE/);
  assert.equal(e.withheld, false);
  assert.equal(e.historyPull.status, 'updated');
  assert.equal(e.engineCodeHash, codeHash(path.join(tmp, 'engine')));
  const E = require(path.join(tmp, 'engine', 'engine.js'));
  assert.equal(e.declarationHash, E.declarationHash(JSON.parse(fs.readFileSync(path.join(tmp, 'engine', 'declaration.json'), 'utf8'))));
  for (const k of ['V-E1/E6a', 'V-T1/T2+']) assert.ok(k in e.scores, k);
  assert.ok(e.families.E1.score != null, 'E1 scored from fresh synthetic bars');
  assert.ok(e.families.E3a.score != null, 'E3a uses the live 8 h premium');
  assert.ok(e.families.E5a.score != null, 'E5a uses the live z');
  assert.ok(Buffer.byteLength(JSON.stringify(snap)) < 200 * 1024, 'snapshot well under the Worker 256 KB cap');
  assert.match(out, /engine \(CANDIDATE/);
  assert.match(e.summary.entry, /^Entry \(1–7 days\) /);
  // second run the same day: history is not downloaded again
  const r2 = runDry(tmp); assert.equal(r2.snap.engine.historyPull.status, 'cached');
});

test('fail closed: corrupt history file → refused, engine withheld, inputs snapshot still complete', () => {
  const tmp = sandbox(); const { snap } = runDry(tmp, { corrupt: 'coinbase_daily' });
  assert.equal(snap.engine.withheld, true);
  assert.equal(snap.engine.scores, null);
  assert.equal(snap.engine.historyPull.status, 'refused-no-history');
  assert.match(snap.engine.historyPull.issues.join(' '), /sha256 mismatch/);
  assert.equal(snap.inputs.oi_btc_total.quality, 'OK');
});

test('fail closed: history unreachable → withheld with the reason', () => {
  const tmp = sandbox(); const { snap } = runDry(tmp, { history: false });
  assert.equal(snap.engine.withheld, true);
  assert.match(snap.engine.reason, /no accepted history/);
  assert.equal(snap.engine.historyPull.status, 'pull-failed-no-history');
});

test('history acceptance rules', () => {
  const prev = { files: { a: { rows: 1000, last: '2026-10-31T00:00:00.000Z' }, b: { rows: 10, last: '2026-10-31' } } };
  assert.deepEqual(acceptance({ schema: 'brief-v2-history/1', files: { a: { rows: 1030, last: '2026-11-30T00:00:00.000Z' }, b: { rows: 10, last: '2026-10-31' } } }, prev), []);
  const bad = acceptance({ schema: 'brief-v2-history/1', errors: [{}], files: { a: { rows: 900, last: '2026-10-01T00:00:00.000Z' } } }, prev);
  assert.equal(bad.length, 4);   // build error, a shrank, a backwards, b disappeared
  assert.equal(acceptance({ schema: 'x', files: {} }, null).length, 1);
});

test('frozen daily snapshot: first cycle reading the day\'s daily.json before 02:07, else missing; never overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv2-frz-'));
  const at = (h, m) => Date.UTC(2026, 10, 20, h, m);
  assert.equal(freezeDaily(dir, { a: 1 }, { dailyGeneratedAt: '2026-11-19T06:10:00Z' }, at(0, 7)), null);   // yesterday's daily: wait
  assert.equal(freezeDaily(dir, { a: 2 }, { dailyGeneratedAt: '2026-11-20T00:12:00Z' }, at(0, 22)), 'frozen');
  assert.equal(freezeDaily(dir, { a: 3 }, { dailyGeneratedAt: '2026-11-20T00:12:00Z' }, at(0, 37)), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'frozen', '2026-11-20.json'))).snapshot.a, 2);
  const at2 = (h, m) => Date.UTC(2026, 10, 21, h, m);
  assert.equal(freezeDaily(dir, { a: 4 }, { dailyGeneratedAt: '2026-11-20T06:10:00Z' }, at2(1, 52)), null);
  assert.equal(freezeDaily(dir, { a: 5 }, { dailyGeneratedAt: '2026-11-20T06:10:00Z' }, at2(2, 7)), 'missing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'frozen', '2026-11-21.json'))).missing, true);
  assert.deepEqual(frozenRecord(dir, '2026-11-21'), { date: '2026-11-21', missing: true, reason: "no cycle read that day's daily.json before 02:07 UTC" });
  assert.equal(frozenRecord(dir, '2026-11-20').missing, false);
  assert.equal(frozenRecord(dir, '2026-11-22'), null);
});

test('package parity: shipped engine files are byte-identical to engine/MANIFEST (packaged copy only)', { skip: !fs.existsSync(path.join(__dirname, '..', 'engine', 'MANIFEST')) }, () => {
  const crypto = require('crypto'); const dir = path.join(__dirname, '..', 'engine');
  for (const line of fs.readFileSync(path.join(dir, 'MANIFEST'), 'utf8').trim().split('\n')) {
    const [h, f] = line.split(/\s+/); assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'), h, f);
  }
});
