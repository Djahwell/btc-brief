'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { mk } = require('./mockfetch');
const { Http } = require('../lib/http');
const { mergeBars, rollingMean, rebuildFunding, computeE3a } = require('../lib/premium');
const { computeDerivs } = require('../lib/derivs');
const { computeFromLegs } = require('../lib/cbpremium');
const { computeE4, readRows, parseTs } = require('../lib/liq');
const { sign } = require('../lib/push');
const quiet = { warn() {}, log() {} };
const NOW = Date.UTC(2026, 10, 5, 10, 7, 30);

test('premium bars: zeros and unfinished minutes dropped; coverage; funding rebuild = clamp formula', () => {
  const bars = mergeBars([], [{ t: NOW - 120000, c: 0.0001 }, { t: NOW - 60000, c: 0 }, { t: NOW - 30000, c: 0.0002 }], NOW);
  assert.equal(bars.length, 1);                                      // zero placeholder and open minute removed
  const full = []; for (let i = 1; i <= 600; i++) full.push({ t: Math.floor(NOW / 60000) * 60000 - i * 60000, c: -0.0004 });
  const rm = rollingMean(full, NOW, 8); assert.ok(rm.coverage >= 0.99); assert.ok(Math.abs(rm.value + 0.0004) < 1e-12);
  const T = Math.floor(NOW / 60000) * 60000;
  assert.ok(Math.abs(rebuildFunding(full, T, 8) - (-0.0004 + 0.0005)) < 1e-12);      // P=-0.04%: clamp hits +0.05% → 0.01%−… = 0.0001? check below
  assert.ok(Math.abs(rebuildFunding(full.map(b => ({ ...b, c: 0.0002 })), T, 8) - 0.0001) < 1e-12);   // inside dead band → 0.01%
});

test('E3a end to end (mock): scored series, check series matches funding prints, cross-checks OK / FAIL', async () => {
  const m = mk({ now: NOW }); const http = new Http({ fetchImpl: m.fetch, now: () => NOW, log: quiet });
  const state = {};
  const r = await computeE3a(http, state, NOW);
  assert.equal(r.scored.quality, 'OK'); assert.ok(r.scored.coverage >= 0.99);
  const errs = r.check.prints.filter(p => p.err_bp != null).map(p => Math.abs(p.err_bp));
  assert.ok(errs.length >= 1 && Math.max(...errs) < 0.01, `check series errors ${errs}`);
  assert.equal(r.crosscheck.status, 'OK');
  assert.ok(state.premiumBars.length > 600);
  // second cycle 15 min later fetches only new bars (small limit)
  const n0 = m.calls.length; await computeE3a(http, state, NOW + 15 * 60000);
  const k = m.calls.slice(n0).find(u => u.includes('premiumIndexKlines')); assert.ok(/limit=(1[0-9]|[1-9])&|limit=1[0-9]$/.test(k + '&'), k);
  const m2 = mk({ now: NOW, okxOffset: 0.001, bybitOffset: 0.001 }); const r2 = await computeE3a(new Http({ fetchImpl: m2.fetch, log: quiet }), {}, NOW);
  assert.equal(r2.crosscheck.status, 'CROSSCHECK_FAIL'); assert.equal(r2.scored.quality, 'CROSSCHECK_FAIL');
});

test('Binance budget guard: weight above 20% stops further Binance calls; 429 never retried', async () => {
  const m = mk({ now: NOW, weight: 900 }); const http = new Http({ fetchImpl: m.fetch, log: quiet });
  await http.json('a', 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
  assert.equal(http.binanceStopped, true);
  await assert.rejects(http.json('b', 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'), /budget guard/);
  assert.equal(m.calls.length, 1);
  const m2 = mk({ now: NOW, fail: u => u.includes('fapi'), failStatus: 429 }); const h2 = new Http({ fetchImpl: m2.fetch, log: quiet });
  await assert.rejects(h2.json('c', 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'), /not retried/);
  assert.equal(m2.calls.length, 1); assert.equal(h2.binanceStopped, true);
});

test('OI in BTC from live specs; a spec change fails that venue and no partial total is shown as the market', async () => {
  const m = mk({ now: NOW }); const state = {};
  const d = await computeDerivs(new Http({ fetchImpl: m.fetch, log: quiet }), state, NOW);
  assert.deepEqual(d.errors, []);
  const exp = 85000.123 + 900000 * 100 / 80380.5 + 52000.5 + 560000000 / 80390 + 33564.1080000001191 + 8165000.59999999913 * 100 / 80434;   // OKX inverse via mark price (§8.7)
  assert.ok(Math.abs(d.total_btc - exp) < 1e-6, `${d.total_btc} vs ${exp}`);
  const bad = await computeDerivs(new Http({ fetchImpl: mk({ now: NOW, binanceContractSize: 10 }).fetch, log: quiet }), {}, NOW);
  assert.equal(bad.venues.binance, null); assert.equal(bad.total_btc, null); assert.ok(bad.partial_total_btc > 0);
  assert.match(bad.errors[0], /contractSize 10/);
  const bad2 = await computeDerivs(new Http({ fetchImpl: mk({ now: NOW, bybitContractType: 'InverseFutures' }).fetch, log: quiet }), {}, NOW);
  assert.equal(bad2.venues.bybit, null);
});

test('OI change uses hourly samples kept in state', async () => {
  const { oiChanges } = require('../lib/derivs'); const st = {}; const H = 3.6e6;
  for (let h = 0; h <= 7 * 24; h++) oiChanges(st, 100000 + h * 10, NOW - (7 * 24 - h) * H);
  const c = oiChanges(st, 101700, NOW + 60000);
  assert.ok(Math.abs(c.chg24h_pct - (101700 / (100000 + (7 * 24 - 24) * 10) - 1) * 100) < 0.01);
  assert.ok(c.chg7d_pct != null);
});

test('E5a: completed hours only; z-score vs 30 prior daily medians', () => {
  const H = 3600; const end = Math.floor(NOW / 1000 / H) * H; const cb = new Map(), u = new Map(), b = new Map();
  for (let t = end - 31 * 24 * H; t < end; t += H) { const usdt = 1; u.set(t, usdt); b.set(t, 80000); const dayIdx = Math.floor(t / 86400) % 2; cb.set(t, 80000 * (1 + (dayIdx ? 0.0002 : -0.0002))); }
  // last 24 h strongly positive
  for (let t = end - 24 * H; t < end; t += H) cb.set(t, 80000 * 1.001);
  const r = computeFromLegs(cb, u, b, end);
  assert.equal(r.hours24, 24); assert.ok(Math.abs(r.value - 0.1) < 1e-9); assert.ok(r.days >= 25); assert.ok(r.z > 3, `z=${r.z}`);
  assert.ok(r.lastHour < end);
});

test('liquidations: partial last line ignored, both day files read, ts formats, dedupe, heartbeat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liq-')); const status = path.join(dir, 'status.json');
  const T = Date.UTC(2026, 10, 5, 0, 30);                  // 00:30 UTC: window crosses midnight
  fs.writeFileSync(path.join(dir, '2026-11-04.csv'), `ts,venue,inst,liq,price,btc,usd,raw\n${T - 2 * 3.6e6},binance,BTCUSDT,L,80000,1.5,120000,x\n${new Date(T - 25 * 3.6e6).toISOString()},okx,BTC-USDT-SWAP,S,80000,9,1,x\n`);
  fs.writeFileSync(path.join(dir, '2026-11-05.csv'), `ts,venue,inst,liq,price,btc,usd,raw\n${Math.floor((T - 600000) / 1000)},bybit,BTCUSDT,S,80000,0.5,40000,x\n${T - 300000},okx,BTC-USD-SWAP,L,80000,2,1,x\n${T - 100000},binance,BTCUSDT,L,80000,7`);   // last line incomplete
  fs.writeFileSync(status, '{}');
  const r = await computeE4({ dir, statusFile: status }, T, 100000, async () => 'active');
  assert.equal(r.quality, 'OK'); assert.deepEqual(r.value, { long_btc: 3.5, short_btc: 0.5, count: 3 });
  assert.ok(Math.abs(r.pct_of_oi.long - 0.0035) < 1e-9);
  const dead = await computeE4({ dir, statusFile: status }, T, 100000, async () => 'inactive');
  assert.equal(dead.quality, 'STALE'); assert.equal(dead.value, null);
  fs.utimesSync(status, new Date(T - 600000), new Date(T - 600000));
  const old = await computeE4({ dir, statusFile: status }, T, 100000, async () => 'active');
  assert.equal(old.quality, 'STALE');
  assert.equal(parseTs('1793868848000'), 1793868848000); assert.equal(parseTs('1793868848'), 1793868848000); assert.equal(parseTs('2026-11-05T00:00:00Z'), Date.UTC(2026, 10, 5));
});

test('push signature is identical to the Worker verifier (worker/v2.js)', async () => {
  const w = await import(path.join(__dirname, '../../../worker/v2.js'));
  const a = sign('k', '123', '/v2/snapshot', '{"x":1}'); const b = await w.sign('k', '123', '/v2/snapshot', '{"x":1}');
  assert.equal(a, b);
});

test('liquidations: unknown header or all-bad rows → MISSING, never zero', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liq2-')); const status = path.join(dir, 's.json'); fs.writeFileSync(status, '{}');
  const T = Date.UTC(2026, 10, 5, 12);
  fs.writeFileSync(path.join(dir, '2026-11-05.csv'), `time,exchange,symbol,side,qty\n${T - 1000},binance,BTCUSDT,SELL,1\n`);
  const r = await computeE4({ dir, statusFile: status }, T, 1e5, async () => 'active');
  assert.equal(r.quality, 'MISSING'); assert.equal(r.value, null); assert.match(r.heartbeat.headerErrors[0], /missing column/);
  fs.writeFileSync(path.join(dir, '2026-11-05.csv'), `ts,venue,inst,liq,price,btc,usd,raw\n${T - 1000},binance,BTCUSDT,SELL,1,x,1,x\n`);
  const r2 = await computeE4({ dir, statusFile: status }, T, 1e5, async () => 'active');
  assert.equal(r2.quality, 'MISSING');
});
test('cycle deadline: requests stop near the deadline instead of being killed by systemd', async () => {
  const m = mk({ now: NOW }); const http = new Http({ fetchImpl: m.fetch, log: quiet, deadline: Date.now() + 1500 });
  await assert.rejects(http.json('x', 'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), /deadline/);
  assert.equal(http.deadlineHit, true); assert.equal(m.calls.length, 0);
});
test('funding check: time-weighted and plain-mean rebuilds both reported', async () => {
  const m = mk({ now: NOW }); const r = await computeE3a(new Http({ fetchImpl: m.fetch, log: quiet }), {}, NOW);
  const p = r.check.prints.find(x => x.err_bp != null); assert.ok(p && 'err_bp_plain_mean' in p && 'rebuilt_weighted' in p);
});
