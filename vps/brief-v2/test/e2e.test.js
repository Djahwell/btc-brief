'use strict';
// End-to-end dry cycle on a temporary copy, all network mocked. Checks the snapshot contract.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
test('dry cycle writes only under dry/, builds a complete snapshot, pushes nothing', () => {
  const src = path.join(__dirname, '..'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bv2-'));
  for (const f of ['cycle.js', 'config.json', 'package.json']) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
  fs.cpSync(path.join(src, 'lib'), path.join(tmp, 'lib'), { recursive: true }); fs.cpSync(path.join(src, 'test'), path.join(tmp, 'test'), { recursive: true });
  const liq = path.join(tmp, 'liq'); fs.mkdirSync(liq); fs.writeFileSync(path.join(liq, 'status.json'), '{}');
  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'))); cfg.liqDir = liq; cfg.diskFloorGB = 0.1; cfg.diskFloorPct = 1; cfg.liqStatusFile = path.join(liq, 'status.json'); fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));
  const out = execFileSync(process.execPath, ['-r', './test/mockfetch.js', 'cycle.js', '--dry-run'], { cwd: tmp, env: { ...process.env, BRIEF_V2_MOCK: '1' }, encoding: 'utf8' });
  const top = fs.readdirSync(tmp).sort(); assert.deepEqual(top, ['config.json', 'cycle.js', 'dry', 'lib', 'liq', 'package.json', 'test']);
  const st = JSON.parse(fs.readFileSync(path.join(tmp, 'dry', 'status.json')));
  assert.equal(st.push.skipped, 'dry-run');
  const day = fs.readdirSync(path.join(tmp, 'dry', 'snapshots')).find(f => f.endsWith('.jsonl'));
  const snap = JSON.parse(fs.readFileSync(path.join(tmp, 'dry', 'snapshots', day), 'utf8').trim().split('\n').pop()).snapshot;
  assert.equal(snap.schema, 'brief-v2/1'); assert.equal(snap.seq, 1);
  for (const [k, v] of Object.entries(snap.inputs)) for (const f of ['value', 'unit', 'window', 'asOf', 'fetchedAt', 'source', 'scope', 'quality', 'staleAfterSec']) assert.ok(f in v, `${k}.${f}`);
  assert.equal(snap.inputs.perp_premium_binance_8h.quality, 'OK');
  assert.equal(snap.inputs.oi_btc_total.quality, 'OK');
  assert.equal(snap.inputs.coinbase_premium_adj.quality, 'OK');
  assert.equal(snap.inputs.liquidations_24h.quality, 'STALE');      // systemctl reports the test host has no maisontoe-liq → never "0 liquidations"
  assert.ok(snap.daily.inputs.fear_greed);
  assert.match(out, /push: \{"ok":false,"status":null,"skipped":"dry-run"\}/);
});
