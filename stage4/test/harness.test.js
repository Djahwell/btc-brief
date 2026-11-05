'use strict';
// Harness checks on SYNTHETIC data only (no real outcomes are touched before the "go").
const test = require('node:test'); const assert = require('node:assert/strict');
const S = require('../stats.js'); const H = require('../harness.js');

test('circular-shift p: planted signal is detected, pure noise is not', () => {
  const r = S.mulberry32(1); const N = 1500;
  const score = []; let s = 0; for (let i = 0; i < N; i++) { s = 0.97 * s + (r() - 0.5); score.push(s); }
  const sig = score.map(x => x * 0.01 + (r() - 0.5) * 0.05), noise = score.map(() => (r() - 0.5) * 0.05);
  const flags = arr => arr.map(x => x > 0);
  assert.ok(S.circularShiftP(N, k => S.diffMeans(flags(S.rotate(score, k)), sig)).p < 0.01);
  assert.ok(S.circularShiftP(N, k => S.diffMeans(flags(S.rotate(score, k)), noise)).p > 0.05);
});

test('Politis–White: longer blocks for more persistent series', () => {
  const r = S.mulberry32(2); const mk = phi => { const x = []; let v = 0; for (let i = 0; i < 2000; i++) { v = phi * v + (r() - 0.5); x.push(v); } return x; };
  const b1 = S.politisWhite(mk(0.2)), b2 = S.politisWhite(mk(0.95));
  assert.ok(b2 > b1 * 3, `${b1} vs ${b2}`);
});

test('bootstrap is deterministic with the declared seed', () => {
  const N = 300; const ys = Array.from({ length: N }, (_, i) => Math.sin(i));
  const f = idx => S.mean(idx.map(i => ys[i]));
  assert.deepEqual(S.circularBlockBootstrap(N, 20, 200, f, 20261105), S.circularBlockBootstrap(N, 20, 200, f, 20261105));
});

test('episodes, Holm, Spearman, exposure backtest', () => {
  assert.deepEqual(S.episodes(['a', 'a', null, 'a', 'b', 'b', 'a']), { a: 3, b: 1 });
  assert.deepEqual(S.holm([0.01, 0.04, 0.03, 0.005]), [true, false, false, true]);
  assert.ok(Math.abs(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12);
  const bt = S.exposureBacktest([1, 1, 0, 1], [0.1, -0.2, 0.5, 0.1], 0.001);
  assert.equal(bt.switches, 3); assert.ok(Math.abs(bt.totalLogReturn - (0.1 - 0.2 + 0.1 - 0.003)) < 1e-12);
});

test('outcomes use the Stage 4 definitions', () => {
  const bars = []; for (let i = 0; i < 12; i++) bars.push({ d: H.addDays('2026-01-01', i), c: 100 + i, l: 99 + i - (i === 4 ? 9 : 0) });
  const [o] = H.outcomesFor(['2026-01-03'], bars);
  assert.equal(o.ret7, 108 / 101 - 1); assert.equal(o.mae7, 94 / 101 - 1);
  assert.deepEqual(H.outcomesFor(['2026-01-10'], bars)[0], { ret7: null, mae7: null });
});

test('a never-long rule cannot pass a tendency segment', () => {
  const decl = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'engine-v2', 'declaration.json'), 'utf8'));
  const bars = []; let p = 10000; for (let d = '2018-01-01'; d <= '2026-11-04'; d = H.addDays(d, 1)) { p *= 0.999; bars.push({ d, c: p, l: p, h: p }); }   // falling market
  const evals = []; for (let d = '2019-01-01'; d <= '2026-10-31'; d = H.addDays(d, 1)) evals.push({ d, scores: { 'V-T1/T2+': 0 } });
  const t = H.tendencyTests(evals, bars, decl, 'V-T1/T2+');
  assert.equal(t.segments.S2.longShare, 0); assert.equal(t.segments.S2.beatsBoth, false); assert.equal(t.pass, false);
});

function gateCopy() {
  const fs = require('fs'), os = require('os'), path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's4-')); const src = path.join(__dirname, '..', '..');
  fs.cpSync(path.join(src, 'engine-v2'), path.join(root, 'engine-v2'), { recursive: true });
  fs.cpSync(path.join(src, 'stage4'), path.join(root, 'stage4'), { recursive: true });
  const fz = JSON.parse(fs.readFileSync(path.join(root, 'stage4', 'frozen.json')));
  fs.writeFileSync(path.join(root, 'stage4', 'GO'), fz.declarationHash);
  return { root, fz };
}
const runGate = (root, hist) => { const { execFileSync } = require('child_process'); const path = require('path'); try { execFileSync(process.execPath, [path.join(root, 'stage4', 'run.js'), hist, path.join(root, 'out')], { stdio: 'pipe' }); return 'RAN'; } catch (e) { return String(e.stderr); } };

test('runner gate: a changed code file is refused', () => {
  const fs = require('fs'), path = require('path'); const { root } = gateCopy();
  fs.appendFileSync(path.join(root, 'stage4', 'stats.js'), '\n// edit');
  assert.match(runGate(root, '/nonexistent'), /stage4\/stats.js changed since the freeze/);
});

test('runner gate: a history file that is not the frozen set is refused', () => {
  const fs = require('fs'), path = require('path'), zlib = require('zlib'); const { root, fz } = gateCopy();
  const hd = path.join(root, 'hist'); fs.mkdirSync(hd);
  for (const k of Object.keys(fz.history)) fs.writeFileSync(path.join(hd, `${k}.json.gz`), zlib.gzipSync('{"rows":[]}'));
  assert.match(runGate(root, hd), /is not the frozen set/);
});

test('runner refuses without GO and without the frozen history', () => {
  const { execFileSync } = require('child_process'); const path = require('path');
  let msg = ''; try { execFileSync(process.execPath, [path.join(__dirname, '..', 'run.js'), '/nonexistent', '/tmp/x'], { stdio: 'pipe' }); } catch (e) { msg = String(e.stderr); }
  assert.match(msg, /REFUSED/);
});

test('analyze() runs end to end on fabricated evaluations (pipeline check, synthetic)', () => {
  const decl = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'engine-v2', 'declaration.json'), 'utf8'));
  const r = S.mulberry32(9); const bars = []; const evals = []; let p = 10000, s = 0;
  for (let d = '2018-01-01'; d <= '2026-11-04'; d = H.addDays(d, 1)) { p *= 1 + (r() - 0.49) * 0.04; bars.push({ d, o: p, h: p * 1.01, l: p * 0.99, c: p }); }
  for (let d = '2019-01-01'; d <= '2026-10-31'; d = H.addDays(d, 1)) {
    s = Math.max(-10, Math.min(10, Math.round(0.95 * s + (r() - 0.5) * 4)));
    const sc = {}; for (const k of ['V-E1/E6a', 'V-E1/E6b', 'V-E2/E6a', 'V-E2/E6b', 'V-T1/T2+', 'V-T1/T2-', 'T-noT2 (sensitivity)', 'E1-alone (baseline)', 'R-E1E2E7 (robustness 2019–2021)']) sc[k] = r() < 0.02 ? null : s;
    evals.push({ d, scores: sc, famScores: {} });
  }
  H.CONST.reps = 200;   // speed for the pipeline check only
  const out = H.analyze({ evals, evalsLag: evals, bars, decl });
  assert.equal(out.entry.length, 4); assert.equal(out.tendency.length, 2);
  assert.ok(Number.isFinite(out.entry[0].H1.p) && out.entry[0].C3.block >= 20);
  assert.ok(['consistent', 'unstable'].includes(out.sensitivities.robustness.label));
  assert.deepEqual(Object.keys(out.sensitivities.tendencyNoT2_S2S3.segments), ['S2', 'S3']);
});
