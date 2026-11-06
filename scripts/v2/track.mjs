#!/usr/bin/env node
// BTC Brief V2 — live track record (STAGE3-PLAN §6). Reads the frozen daily records from the Worker,
// fills outcomes with the Stage 4 definitions (STAGE4-PLAN §4) and writes OUT/track.json.
//   entry price  = Coinbase close of bar D−1 (time D 00:00 UTC)
//   7-day return = close of bar D+6 ÷ entry − 1          (closed once bar D+6 is complete)
//   7-day MAE    = lowest low of bars D…D+6 ÷ entry − 1
// Withheld and missing days are recorded explicitly, never skipped. Live rows only (Stage 4 rows are
// reported separately). Tendency outcomes start after 180 days of records.
import { readFileSync } from 'fs';
import { getJSON, writeJSON, coinbaseCandles, isoDay } from './lib.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S = require('../../stage4/stats.js');
const { fw1Status } = require('../../stage4/fw1test.js');

const OUT = process.env.OUT || 'out/v2';
const WORKER = process.env.WORKER_URL || 'https://btc-brief.joel-toe.workers.dev';
const DAY = 86400;
const BANDS = ['Strong bull', 'Bull', 'Neutral', 'Bear', 'Strong bear'];

export function outcomes(frozenIn, bars, { lastDay = null } = {}) {
  const byD = new Map(bars.map(b => [b.d, b]));
  const add = (d, n) => isoDay(Date.parse(d + 'T00:00:00Z') + n * DAY * 1000);
  // Every calendar day from the first record to lastDay is listed: a day with no record at all
  // (VPS down all night) is 'missing', never silently absent (Board build review #11).
  const have = new Map(frozenIn.map(f => [f.date, f]));
  const frozen = [];
  if (frozenIn.length) {
    const first = [...have.keys()].sort()[0]; const last = lastDay || [...have.keys()].sort().pop();
    for (let d = first; d <= last; d = add(d, 1)) frozen.push(have.get(d) || { date: d, missing: true, reason: 'no frozen record (no VPS cycle reached the Worker)' });
  }
  const rows = frozen.map(f => {
    const base = { date: f.date };
    if (f.missing) return { ...base, status: 'missing', reason: f.reason || null };
    const c = f.engine && f.engine.primary && f.engine.scores && f.engine.scores[f.engine.primary.entry];
    if (!c || c.withheld || c.score == null) return { ...base, status: 'withheld', reason: (c && c.reason) || f.engine?.reason || null };
    const entry = byD.get(add(f.date, -1));
    const row = { ...base, status: 'scored', score: c.score, band: c.band, bullPlus: c.score >= 3, declarationHash: f.engine.declarationHash, entry: entry ? entry.c : null };
    const win = []; for (let k = 0; k <= 6; k++) win.push(byD.get(add(f.date, k)));
    if (entry && win.every(Boolean)) { row.ret7d = win[6].c / entry.c - 1; row.mae7d = Math.min(...win.map(b => b.l)) / entry.c - 1; row.closed = true; }
    else row.closed = false;
    const t = f.engine.scores[f.engine.primary.tendency];
    row.tendency = t && !t.withheld ? { score: t.score, band: t.band } : { withheld: true };
    return row;
  });
  // Rows scored under different declarations are never pooled: stats per declaration hash; the
  // headline block is the latest hash.
  const stats = rs => {
  const byBand = {};
  for (const b of BANDS) {
    const r = rs.filter(x => x.status === 'scored' && x.band === b); if (!r.length) continue;
    const done = r.filter(x => x.closed);
    const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    byBand[b] = { days: r.length, done: done.length, meanRet7d: mean(done.map(x => x.ret7d)), meanMae7d: mean(done.map(x => x.mae7d)) };
  }
  const split = flag => { const d = rs.filter(x => x.status === 'scored' && x.closed && x.bullPlus === flag); return { n: d.length, meanRet7d: d.length ? d.reduce((s, x) => s + x.ret7d, 0) / d.length : null }; };
  return { byBand, bullPlus: split(true), nonBullPlus: split(false) };
  };
  const hashes = [...new Set(rows.filter(r => r.status === 'scored').map(r => r.declarationHash))];
  const latest = rows.filter(r => r.status === 'scored').map(r => r.declarationHash).pop() || null;
  const byHash = Object.fromEntries(hashes.map(h => [h, stats(rows.filter(r => r.declarationHash === h))]));
  return {
    rows,
    entry: { declarationHash: latest, ...(latest ? byHash[latest] : stats([])), otherDeclarations: hashes.filter(h => h !== latest).length, byHash,
      withheldDays: rows.filter(x => x.status === 'withheld').length, missingDays: rows.filter(x => x.status === 'missing').length },
  };
}

// Forward test of the event flag (FORWARD-EVENTS.md). Flag recorded point-in-time at the 00:10 run of day D
// (any high-impact event in [D 00:00, D+2 00:00)); outcome = (max high − min low of bars D and D+1) ÷ close D−1.
// Runs only when ≥ 40 flagged and ≥ 40 unflagged days with all sources OK exist. Never touches any score.
export function eventFlagTest(log, bars, minEach = 40) {
  const byD = new Map(bars.map(b => [b.d, b]));
  const add = (d, n) => isoDay(Date.parse(d + 'T00:00:00Z') + n * DAY * 1000);
  const rows = log.filter(r => r.sourcesOk).map(r => {
    const p = byD.get(add(r.date, -1)), a = byD.get(r.date), b = byD.get(add(r.date, 1));
    return { date: r.date, flag: r.within48h, range48: p && a && b ? (Math.max(a.h, b.h) - Math.min(a.l, b.l)) / p.c : null };
  }).filter(r => r.range48 != null);
  const nF = rows.filter(r => r.flag).length, nU = rows.length - nF;
  const out = { definition: 'FORWARD-EVENTS.md', days: rows.length, flagged: nF, unflagged: nU, minEach, status: nF >= minEach && nU >= minEach ? 'tested' : 'collecting' };
  if (out.status === 'tested') {
    const fl = rows.map(r => r.flag), y = rows.map(r => r.range48);
    const t = S.circularShiftP(rows.length, k => S.diffMeans(S.rotate(fl, k), y), 60);
    Object.assign(out, { diff: t.observed, p: t.p, pass: t.observed > 0 && t.p < 0.05 });
  }
  return out;
}

async function main() {
  let fr = { rows: [] }; try { fr = await getJSON(`${WORKER}/v2/frozen?since=2026-01-01`); } catch (e) { console.warn('[v2-track] frozen records unavailable:', e.message); }
  // Coinbase daily bars from the first frozen day − 2 to now (completed days only).
  let evlog = []; try { evlog = JSON.parse(readFileSync(`${OUT}/events-log.json`, 'utf8')).rows || []; } catch { /* none yet */ }
  const starts = [fr.rows[0]?.date, evlog[0]?.date].filter(Boolean).sort();
  const first = starts.length ? Date.parse(starts[0] + 'T00:00:00Z') / 1000 - 3 * DAY : Math.floor(Date.now() / 1000 / DAY) * DAY - 10 * DAY;
  const end = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const bars = (await coinbaseCandles('BTC-USD', DAY, first, end)).map(r => ({ d: isoDay(r.t * 1000), o: r.o, h: r.h, l: r.l, c: r.c }));
  const o = outcomes(fr.rows, bars, { lastDay: isoDay(Date.now()) });
  const events = eventFlagTest(evlog, bars);
  writeJSON(`${OUT}/track.json`, { schema: 'brief-v2-track/1', generatedAt: new Date().toISOString(), label: 'live (frozen daily snapshots)', definitions: 'STAGE4-PLAN §4', ...o, tendency: { note: 'tendency outcomes start after 180 days of records' }, eventFlag: events, fw1: fw1Status(fr.rows, bars, new Date().toISOString()) });
  console.log(`[v2-track] ${fr.rows.length} frozen days, ${o.rows.filter(r => r.closed).length} closed`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('[v2-track] failed:', e.message); process.exitCode = 1; });
