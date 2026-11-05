// node --test worker/test/v2.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import { handleV2, scheduledV2, sign, V2_KEY } from '../v2.js';
import worker from '../worker.js';
const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { m.set(k, v); } }; };
const SECRET = 's3cret';
const snap = (seq, gen) => JSON.stringify({ schema: 'brief-v2/1', seq, generatedAt: new Date(gen).toISOString(), inputs: {} });
const post = async (env, body, ts, sigOverride) => {
  const sig = sigOverride ?? await sign(SECRET, String(ts), '/v2/snapshot', body);
  return handleV2(new Request('https://w.dev/v2/snapshot', { method: 'POST', body, headers: { 'X-Timestamp': String(ts), 'X-Signature': sig } }), env, ts);
};
test('valid push stored under v2: prefix, then served with ageSec', async () => {
  const env = { BRIEF_KV: kv(), V2_PUSH_SECRET: SECRET }; const t = Date.UTC(2026, 10, 5, 10);
  const r = await post(env, snap(1, t), t); assert.equal(r.status, 200);
  assert.deepEqual([...env.BRIEF_KV.m.keys()], [V2_KEY]);
  const g = await handleV2(new Request('https://w.dev/v2/snapshot'), env, t + 90000);
  const j = await g.json(); assert.equal(j.ageSec, 90); assert.equal(j.snapshot.seq, 1);
});
test('bad signature, future/old timestamp, replayed seq, bad schema, oversize rejected', async () => {
  const env = { BRIEF_KV: kv(), V2_PUSH_SECRET: SECRET }; const t = Date.UTC(2026, 10, 5, 10);
  assert.equal((await post(env, snap(1, t), t, 'ab'.repeat(32))).status, 401);
  const fut = t + 5 * 60000; const body = snap(1, t);
  const sigF = await sign(SECRET, String(fut), '/v2/snapshot', body);
  assert.equal((await handleV2(new Request('https://w.dev/v2/snapshot', { method: 'POST', body, headers: { 'X-Timestamp': String(fut), 'X-Signature': sigF } }), env, t)).status, 400);
  const old = t - 11 * 60000; const sigO = await sign(SECRET, String(old), '/v2/snapshot', body);
  assert.equal((await handleV2(new Request('https://w.dev/v2/snapshot', { method: 'POST', body, headers: { 'X-Timestamp': String(old), 'X-Signature': sigO } }), env, t)).status, 400);
  assert.equal((await post(env, snap(5, t), t)).status, 200);
  assert.equal((await post(env, snap(5, t), t + 1000)).status, 409);
  assert.equal((await post(env, snap(4, t), t + 2000)).status, 409);
  assert.equal((await post(env, JSON.stringify({ schema: 'x', seq: 9, generatedAt: 'x' }), t + 3000)).status, 400);
  assert.equal((await post(env, 'x'.repeat(300 * 1024), t + 4000)).status, 413);
  // signature bound to path: same body signed for another path fails
  const sigP = await sign(SECRET, String(t + 5000), '/v2/other', snap(6, t));
  assert.equal((await post(env, snap(6, t), t + 5000, sigP)).status, 401);
});
test('no secret configured → 503; GET before any push → 404', async () => {
  const env = { BRIEF_KV: kv() }; const t = Date.now();
  assert.equal((await post(env, snap(1, t), t)).status, 503);
  assert.equal((await handleV2(new Request('https://w.dev/v2/snapshot'), env, t)).status, 404);
});
test('stale alert fires once, recovers once', async () => {
  const env = { BRIEF_KV: kv(), V2_PUSH_SECRET: SECRET, NTFY_TOPIC: 'topic' }; const sent = [];
  const f = async (u, o) => { sent.push(o.headers.Title); return new Response('ok'); };
  const t = Date.UTC(2026, 10, 5, 10);
  assert.equal(await scheduledV2(env, t, f), 'waiting for first snapshot');
  await post(env, snap(1, t), t);
  assert.equal(await scheduledV2(env, t + 10 * 60000, f), 'ok');
  assert.equal(await scheduledV2(env, t + 50 * 60000, f), 'alerted');
  assert.equal(await scheduledV2(env, t + 65 * 60000, f), 'still stale');
  await post(env, snap(2, t + 70 * 60000), t + 70 * 60000);
  assert.equal(await scheduledV2(env, t + 75 * 60000, f), 'recovered');
  assert.deepEqual(sent, ['BTC Brief V2: data stale', 'BTC Brief V2: recovered']);
});
test('V1 routing unchanged: unknown path 404, /v2 routed', async () => {
  const env = { BRIEF_KV: kv() };
  assert.equal((await worker.fetch(new Request('https://w.dev/nope'), env, {})).status, 404);
  assert.equal((await worker.fetch(new Request('https://w.dev/v2/health'), env, {})).status, 200);
  assert.equal(typeof worker.scheduled, 'function');
});

test('no snapshot ever → alert after 1 h; failed ntfy is retried; public GET hides run details', async () => {
  const env = { BRIEF_KV: kv(), V2_PUSH_SECRET: SECRET, NTFY_TOPIC: 'topic' }; const t = Date.UTC(2026, 10, 5, 10); const sent = [];
  let up = false; const f = async (u, o) => { if (!up) throw new Error('ntfy down'); sent.push(o.headers.Title); return new Response('ok'); };
  assert.equal(await scheduledV2(env, t, f), 'waiting for first snapshot');
  assert.equal(await scheduledV2(env, t + 61 * 60000, f), 'alert send failed (will retry)');
  up = true;
  assert.equal(await scheduledV2(env, t + 76 * 60000, f), 'alerted');
  assert.deepEqual(sent, ['BTC Brief V2: data stale']);
  const body = JSON.stringify({ schema: 'brief-v2/1', seq: 7, generatedAt: new Date(t).toISOString(), inputs: {}, runs: { durationMs: 900, errors: ['x: secret path /home/u'], disk: { freeGB: 9 } } });
  await post(env, body, t);
  const j = await (await handleV2(new Request('https://w.dev/v2/snapshot'), env, t + 1000)).json();
  assert.deepEqual(j.snapshot.runs, { durationMs: 900, errorCount: 1 });
});
