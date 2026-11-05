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

const OUT = process.env.OUT || 'out/v2';
const WORKER = process.env.WORKER_URL || 'https://btc-brief.joel-toe.workers.dev';
const DAY = 86400;
const BANDS = ['Strong bull', 'Bull', 'Neutral', 'Bear', 'Strong bear'];

export function outcomes(frozen, bars) {
  const byD = new Map(bars.map(b => [b.d, b]));
  const add = (d, n) => isoDay(Date.parse(d + 'T00:00:00Z') + n * DAY * 1000);
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
  const byBand = {};
  for (const b of BANDS) {
    const r = rows.filter(x => x.status === 'scored' && x.band === b); if (!r.length) continue;
    const done = r.filter(x => x.closed);
    const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    byBand[b] = { days: r.length, done: done.length, meanRet7d: mean(done.map(x => x.ret7d)), meanMae7d: mean(done.map(x => x.mae7d)) };
  }
  const split = flag => { const d = rows.filter(x => x.status === 'scored' && x.closed && x.bullPlus === flag); return { n: d.length, meanRet7d: d.length ? d.reduce((s, x) => s + x.ret7d, 0) / d.length : null }; };
  return {
    rows,
    entry: { byBand, bullPlus: split(true), nonBullPlus: split(false), withheldDays: rows.filter(x => x.status === 'withheld').length, missingDays: rows.filter(x => x.status === 'missing').length },
  };
}

async function main() {
  const fr = await getJSON(`${WORKER}/v2/frozen?since=2026-01-01`);
  // Coinbase daily bars from the first frozen day − 2 to now (completed days only).
  const first = fr.rows.length ? Date.parse(fr.rows[0].date + 'T00:00:00Z') / 1000 - 3 * DAY : Math.floor(Date.now() / 1000 / DAY) * DAY - 10 * DAY;
  const end = Math.floor(Date.now() / 1000 / DAY) * DAY;
  const bars = (await coinbaseCandles('BTC-USD', DAY, first, end)).map(r => ({ d: isoDay(r.t * 1000), o: r.o, h: r.h, l: r.l, c: r.c }));
  const o = outcomes(fr.rows, bars);
  writeJSON(`${OUT}/track.json`, { schema: 'brief-v2-track/1', generatedAt: new Date().toISOString(), label: 'live (frozen daily snapshots)', definitions: 'STAGE4-PLAN §4', ...o, tendency: { note: 'tendency outcomes start after 180 days of records' } });
  console.log(`[v2-track] ${fr.rows.length} frozen days, ${o.rows.filter(r => r.closed).length} closed`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('[v2-track] failed:', e.message); process.exitCode = 1; });
