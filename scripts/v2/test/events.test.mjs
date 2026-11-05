import test from 'node:test'; import assert from 'node:assert/strict';
import { nyToUtc, parseFOMC, parseBLS, deribitExpiries, flagFor } from '../events.mjs';
test('New York → UTC across DST', () => {
  assert.equal(nyToUtc(2026, 1, 28, 14, 0), '2026-01-28T19:00:00.000Z');   // EST
  assert.equal(nyToUtc(2026, 7, 29, 14, 0), '2026-07-29T18:00:00.000Z');   // EDT
  assert.equal(nyToUtc(2026, 3, 11, 8, 30), '2026-03-11T12:30:00.000Z');   // after US DST start (8 Mar)
});
test('FOMC and BLS parsers on representative markup', () => {
  const f = '<h4><a>2026 FOMC Meetings</a></h4><div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">27-28</div><div class="fomc-meeting__month"><strong>March</strong></div><div class="fomc-meeting__date">17-18*</div><div class="fomc-meeting__month"><strong>Apr/May</strong></div><div class="fomc-meeting__date">28-1</div>';
  const ev = parseFOMC(f);
  assert.deepEqual(ev.map(e => e.t), ['2026-01-28T19:00:00.000Z', '2026-03-18T18:00:00.000Z', '2026-05-01T18:00:00.000Z']);
  assert.match(ev[1].label, /projections/);
  const b = '<table><tr><td>December 2026</td><td>Jan. 13, 2027</td><td>08:30 AM</td></tr></table>';
  assert.equal(parseBLS(b, 'CPI', 'US CPI')[0].t, '2027-01-13T13:30:00.000Z');
});
test('Deribit last-Friday expiries and the 48 h flag', () => {
  const e = deribitExpiries(Date.UTC(2026, 10, 5), 2);
  assert.deepEqual(e.map(x => x.t), ['2026-11-27T08:00:00.000Z', '2026-12-25T08:00:00.000Z']);
  assert.equal(e[1].impact, 'high');
  assert.equal(flagFor(e, '2026-12-24').within48h, true); assert.equal(flagFor(e, '2026-12-26').within48h, false);
});
