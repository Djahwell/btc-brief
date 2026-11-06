// Daily bar-based readings for the condition read (STAGE-C-PLAN): 200-week stretch and nearness-to-ATH
// percentiles (point-in-time, from completed Coinbase daily bars) + realized price. Writes OUT/condition-base.json.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../engine-v2/condition.js');
const OUT = process.env.OUT || '_data/v2'; const HIST = process.env.HIST || path.join(OUT, 'history');
const load = f => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(HIST, f))));
const today = new Date().toISOString().slice(0, 10);
// Monthly history files + the last ~420 days from today's daily.json (same Coinbase source), completed days only.
const byDay = new Map(load('coinbase_daily.json.gz').rows.map(r => { const d = new Date(r.t * 1000).toISOString().slice(0, 10); return [d, { d, h: r.h, c: r.c }]; }));
try { for (const r of JSON.parse(fs.readFileSync(path.join(OUT, 'daily.json'), 'utf8')).series.daily_candles.rows) byDay.set(r.d, { d: r.d, h: r.h, c: r.c }); } catch (_) { /* history only */ }
const bars = [...byDay.values()].filter(b => b.d < today).sort((a, b) => (a.d < b.d ? -1 : 1));
for (let i = 1; i < bars.length; i++) if (C.addDays(bars[i - 1].d, 1) !== bars[i].d) throw new Error(`bar gap before ${bars[i].d}`);
const s = C.barSeries(bars); const last = bars.at(-1); const e = s.get(last.d);
let realized = null; try { const r = load('bgeometrics_realized.json.gz').rows.at(-1); realized = { v: r.v, d: new Date(r.t * 1000).toISOString().slice(0, 10) }; } catch (_) { /* optional */ }
const out = { generatedAt: new Date().toISOString(), barDate: last.d, close: last.c, ...e, realized };
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'condition-base.json'), JSON.stringify(out, null, 1) + '\n');
console.log('condition-base', JSON.stringify(out));
