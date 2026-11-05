import test from 'node:test'; import assert from 'node:assert/strict';
import { outcomes } from '../track.mjs';
const bars = []; for (let i = 0; i < 20; i++) { const d = new Date(Date.UTC(2026, 10, 18 + i)).toISOString().slice(0, 10); bars.push({ d, o: 100 + i, h: 101 + i, l: 99 + i - (i === 5 ? 10 : 0), c: 100 + i }); }
const fz = (date, score, band) => ({ date, missing: false, engine: { primary: { entry: 'E', tendency: 'T' }, declarationHash: 'h', scores: { E: { score, band, withheld: false }, T: { withheld: true } } } });
test('Stage 4 outcome definitions; withheld and missing recorded', () => {
  const o = outcomes([fz('2026-11-20', 4, 'Bull'), { date: '2026-11-21', missing: true, reason: 'x' },
    { date: '2026-11-22', missing: false, engine: { primary: { entry: 'E', tendency: 'T' }, scores: { E: { withheld: true, reason: 'quorum 3/5' } } } }, fz('2026-12-04', 0, 'Neutral')], bars);
  const r = o.rows[0];
  assert.equal(r.entry, 101);                        // close of bar D−1 (11-19)
  assert.equal(r.ret7d, 108 / 101 - 1);              // close of bar D+6 (11-26)
  assert.equal(r.mae7d, (99 + 5 - 10) / 101 - 1);    // lowest low of D…D+6 (11-23 dip)
  assert.equal(o.rows[1].status, 'missing'); assert.equal(o.rows[2].status, 'withheld');
  assert.equal(o.rows.length, 15);                                   // 11-20 … 12-04, gaps listed as missing
  assert.equal(o.rows[3].status, 'missing'); assert.equal(o.rows[14].closed, false);
  assert.equal(o.entry.byHash.h.byBand.Bull.done, 1); assert.equal(o.entry.withheldDays, 1); assert.equal(o.entry.missingDays, 12);
});

test('rows under different declarations are never pooled', () => {
  const a = fz('2026-11-20', 4, 'Bull'); const b = { ...fz('2026-11-21', 4, 'Bull') }; b.engine = { ...b.engine, declarationHash: 'h2' };
  const o = outcomes([a, b], bars);
  assert.equal(o.entry.declarationHash, 'h2'); assert.equal(o.entry.byBand.Bull.days, 1); assert.equal(o.entry.otherDeclarations, 1);
});
