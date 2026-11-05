import test from 'node:test';
import assert from 'node:assert/strict';
import { alignTrace } from '../lthalign.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const day = i => new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10);

test('recovers dates through missing days, with small price noise', () => {
  const r = rng(11); let p = 10000;
  const closes = Array.from({ length: 400 }, (_, i) => ({ d: day(i), c: (p *= 1 + (r() - 0.5) * 0.06) }));
  const missing = new Set([50, 51, 120, 300, 301, 302, 303]);
  const truth = []; for (let i = 20; i < 400; i++) if (!missing.has(i)) truth.push(i);
  const prices = truth.map(i => closes[i].c * (1 + (r() - 0.5) * 0.002));   // ±0.1% source difference
  const a = alignTrace(prices, closes);
  assert.deepEqual(a.map(x => x.d), truth.map(i => closes[i].d));
  assert.ok(Math.max(...a.map(x => x.err)) < 0.0015);
});

test('lastDate pins the final point', () => {
  const closes = Array.from({ length: 30 }, (_, i) => ({ d: day(i), c: 100 + i }));
  const a = alignTrace([110, 111, 112], closes, { lastDate: day(12) });
  assert.deepEqual(a.map(x => x.d), [day(10), day(11), day(12)]);
  assert.equal(alignTrace([1, 2], closes, { lastDate: '1999-01-01' }), null);
});
