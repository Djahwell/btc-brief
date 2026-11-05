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

// ---- Stage 3: frozen daily records and the commentary endpoint ------------------------------
import { buildPayload, checkText } from '../v2commentary.js';
const kvL = () => { const k = kv(); k.list = async ({ prefix }) => ({ keys: [...k.m.keys()].filter(x => x.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }); return k; };
const engSnap = (seq, gen, extra = {}) => ({ schema: 'brief-v2/2', seq, generatedAt: new Date(gen).toISOString(),
  inputs: { perp_premium_binance_8h: { value: -0.0159, quality: 'OK' }, coinbase_premium_adj: { value: 0.001, z30: 0.65, quality: 'OK' }, oi_btc_total: { value: 236214.4, quality: 'OK' } },
  daily: { inputs: { fear_greed: { value: 50 }, mvrv: { value: 1.4901 } } },
  engine: { status: 'CANDIDATE', declarationHash: 'abc', primary: { entry: 'V-E1/E6a', tendency: 'V-T1/T2+' },
    scores: { 'V-E1/E6a': { score: 1, band: 'Neutral', active: 5, of: 5, withheld: false }, 'V-T1/T2+': { score: -2, band: 'Neutral', active: 4, of: 4, withheld: false } },
    families: { E1: { score: -1, levels: { close: 80428.31, sma50: 81989.6 } }, E2: { score: 4, vah: 84756, poc: 81635, val: 79069 }, E7: { score: 0 }, T3: { score: 0, levels: { sma200: 73179.1 } }, E6: { score: null, pct: 10.9 } } },
  ...extra });

test('frozen record stored once per date (never overwritten), stripped from the live snapshot, listed', async () => {
  const env = { BRIEF_KV: kvL(), V2_PUSH_SECRET: SECRET }; const t = Date.UTC(2026, 10, 20, 0, 22);
  let r = await post(env, JSON.stringify(engSnap(1, t, { frozen: { date: '2026-11-20', missing: false, seq: 1 } })), t);
  assert.equal((await r.json()).frozen, 'stored');
  r = await post(env, JSON.stringify(engSnap(2, t, { frozen: { date: '2026-11-20', missing: false, seq: 2 } })), t + 1000);
  assert.equal((await r.json()).frozen, 'kept existing');
  const live = JSON.parse(env.BRIEF_KV.m.get(V2_KEY)); assert.equal(live.snapshot.frozen, undefined);
  const g = await (await handleV2(new Request('https://w.dev/v2/frozen?since=2026-11-01'), env, t)).json();
  assert.equal(g.count, 1); assert.equal(g.rows[0].seq, 1);
});

test('commentary payload is numbers and band labels only', () => {
  const p = buildPayload(engSnap(1, Date.now()));
  const strings = []; const walk = x => { if (typeof x === 'string') strings.push(x); else if (x && typeof x === 'object') Object.values(x).forEach(walk); }; walk(p);
  assert.deepEqual([...new Set(strings)].sort(), ['Neutral']);
  assert.equal(p.readings.last_daily_close_usd, 80428);
});

test('commentary checks: numbers must come from the snapshot, no number words, direction words match scores', () => {
  const p = buildPayload(engSnap(1, Date.now()));
  const good = 'These are untested candidate scores. The entry reading for the next 1 to 7 days is +1, Neutral, and the 3 to 9 month tendency is -2, Neutral. Price sits near the value area low of $79,069, with the point of control at $81,635 and Fear & Greed at 50.';
  assert.deepEqual(checkText(good, p), []);
  assert.match(checkText(good.replace('$81,635', '$82,000'), p).join(), /not in the snapshot: \$82,000/);
  assert.match(checkText(good + ' Two families lean positive.', p).join(), /word: "Two"/);
  assert.match(checkText(good + ' The picture is bullish.', p).join(), /bullish wording/);
  assert.match(checkText(good + ' Price will rally to the high.', p).join(), /prediction/);
  assert.deepEqual(checkText(good.replace('$79,069', '$79k'), p), []);
  const pb = JSON.parse(JSON.stringify(p)); pb.tendency_3_to_9_months = { score: 4, band: 'Bull', active: 4, of: 4 };
  assert.match(checkText('These are untested candidate scores. The entry reading is bullish today.', pb).join(), /bullish wording/);     // only the tendency is Bull
  assert.deepEqual(checkText('These are untested candidate scores. The tendency reading is +4, Bull, a bullish backdrop.', pb), []);
  assert.deepEqual(checkText('These are untested candidate scores; the entry reading is not bearish.', p), []);
  assert.match(checkText('These are untested candidate scores; the entry is not bearish yet, but bearish.', p).join(), /bearish wording/);
});

test('commentary endpoint: auth, once a day, failed checks never published', async () => {
  const t = Date.UTC(2026, 10, 20, 9); const env = { BRIEF_KV: kvL(), V2_PUSH_SECRET: SECRET, V2_COMMENTARY_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k' };
  await post(env, JSON.stringify(engSnap(1, t)), t);
  const call = (auth) => worker.fetch(new Request('https://w.dev/v2/commentary', { method: 'POST', headers: auth ? { Authorization: auth } : {} }), env);
  // the module handler is exercised directly so the model call can be mocked
  const { handleCommentary } = await import('../v2commentary.js');
  const out = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  const model = text => async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
  const req = a => new Request('https://w.dev/v2/commentary', { method: 'POST', headers: a ? { Authorization: a } : {} });
  assert.equal((await handleCommentary(req('Bearer nope'), env, t + 60000, model('x'), out)).status, 401);
  const bad = await handleCommentary(req('Bearer tok'), env, t + 60000, model('These are untested candidate scores and the entry is +5, a strong reading with Fear & Greed at 50 today.'), out);
  assert.equal(bad.status, 422); assert.equal(await env.BRIEF_KV.get('v2:commentary:2026-11-20'), null);
  const ok = await handleCommentary(req('Bearer tok'), env, t + 60000, model('These are untested candidate scores: entry +1 (Neutral) for 1 to 7 days and tendency -2 (Neutral) for 3 to 9 months, with Fear & Greed at 50.'), out);
  assert.equal(ok.status, 200); assert.equal((await ok.json()).seq, 1);
  assert.equal((await handleCommentary(req('Bearer tok'), env, t + 120000, model('x'), out)).status, 409);
  const g = await handleCommentary(new Request('https://w.dev/v2/commentary'), env, t + 120000, model('x'), out);
  assert.equal(g.status, 200);
  const pre = await worker.fetch(new Request('https://w.dev/v2/commentary', { method: 'OPTIONS' }), env);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  void call;
});
