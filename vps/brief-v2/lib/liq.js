'use strict';
// E4 liquidations, 24 h (forward-only). STAGE2-PLAN §8.5, §8.9.
// Reads the existing recorder's files READ-ONLY (never written, never locked):
//   <dir>/YYYY-MM-DD.csv  columns ts,venue,inst,liq(L/S),price,btc,usd,raw
// - A last line with no newline is ignored (the recorder may be mid-write).
// - Day files for UTC and Paris naming around the window are all read; rows are filtered by timestamp,
//   so the result does not depend on which timezone the recorder uses to rotate files.
// - Heartbeat: liq-status.json must have changed within 5 min AND the service must be active;
//   otherwise STALE ("no liquidations" is never inferred from a silent recorder).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function parseTs(s) {
  if (s == null || s === '') return null;
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return n > 1e12 ? n : n * 1000; }
  const t = Date.parse(s); return Number.isFinite(t) ? t : null;
}

// Columns are located by the header row (not assumed by position). Required: ts, venue, inst, liq, btc.
const REQUIRED = ['ts', 'venue', 'inst', 'liq', 'btc'];
function readRows(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return { rows: [], exists: false }; }
  const complete = txt.endsWith('\n') ? txt : txt.slice(0, txt.lastIndexOf('\n') + 1);
  const lines = complete.split('\n').filter(Boolean);
  if (!lines.length) return { rows: [], exists: true, bad: 0, header: null };       // freshly created empty file is normal
  const header = lines[0].split(',').map(x => x.trim());
  const col = Object.fromEntries(REQUIRED.map(k => [k, header.indexOf(k)]));
  if (REQUIRED.some(k => col[k] < 0)) return { rows: [], exists: true, bad: lines.length, header: header.join(','), headerError: `missing column(s): ${REQUIRED.filter(k => col[k] < 0).join(', ')}` };
  const rows = []; let bad = 0;
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const t = parseTs(f[col.ts]); const side = f[col.liq]; const btc = Number(f[col.btc]);
    if (t == null || (side !== 'L' && side !== 'S') || !Number.isFinite(btc)) { bad++; continue; }
    rows.push({ t, venue: f[col.venue], inst: f[col.inst], side, btc });
  }
  return { rows, exists: true, bad, header: header.join(',') };
}

function dayNames(nowMs) {
  const names = new Set();
  for (let h = -50; h <= 26; h += 1) {
    const t = nowMs + h * 3600 * 1000;
    names.add(new Date(t).toISOString().slice(0, 10));
    names.add(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(t)));
  }
  return [...names];
}

function isActive(unit) {
  return new Promise(res => execFile('systemctl', ['is-active', unit], { timeout: 5000 }, (err, out) => res(String(out || '').trim())));
}

async function computeE4({ dir, statusFile, unit = 'maisontoe-liq' }, nowMs, totalOiBtc, isActiveImpl = isActive) {
  const from = nowMs - 24 * 3600 * 1000;
  const seen = new Set(); let long = 0, short = 0, n = 0, bad = 0, files = 0, parsed = 0; const headerErrors = [];
  const byVenue = {};
  for (const d of dayNames(nowMs)) {
    const r = readRows(path.join(dir, `${d}.csv`));
    if (!r.exists) continue; files++; bad += r.bad || 0; parsed += r.rows.length; if (r.headerError) headerErrors.push(`${d}: ${r.headerError}`);
    for (const x of r.rows) {
      if (x.t < from || x.t > nowMs) continue;
      const key = `${x.t}|${x.venue}|${x.inst}|${x.side}|${x.btc}`; if (seen.has(key)) continue; seen.add(key);
      n++; if (x.side === 'L') long += x.btc; else short += x.btc;
      const v = byVenue[x.venue] || (byVenue[x.venue] = { long_btc: 0, short_btc: 0 }); if (x.side === 'L') v.long_btc += x.btc; else v.short_btc += x.btc;
    }
  }
  let statusAgeSec = null;
  try { statusAgeSec = Math.round((nowMs - fs.statSync(statusFile).mtimeMs) / 1000); } catch { /* missing */ }
  const active = await isActiveImpl(unit);
  const alive = active === 'active' && statusAgeSec != null && statusAgeSec <= 300;
  // A parse problem must never read as "no liquidations": bad rows with no good rows → MISSING.
  const unreadable = headerErrors.length > 0 || (bad > 0 && parsed === 0);
  if (unreadable) return { value: null, pct_of_oi: null, byVenue: null, unit: 'BTC', window: '24h', asOf: null,
    scope: 'liquidation files unreadable', quality: 'MISSING', heartbeat: { service: active || 'unknown', statusAgeSec, filesRead: files, badRows: bad, headerErrors } };
  return {
    value: alive ? { long_btc: long, short_btc: short, count: n } : null,
    pct_of_oi: alive && totalOiBtc ? { long: long / totalOiBtc * 100, short: short / totalOiBtc * 100 } : null,
    byVenue: alive ? byVenue : null,
    unit: 'BTC', window: '24h', asOf: alive ? new Date(nowMs).toISOString() : null,
    scope: 'Binance, Bybit, OKX perps via maisontoe-liq — LOWER BOUND (Binance publishes one liquidation per symbol per second)',
    quality: alive ? 'OK' : 'STALE', heartbeat: { service: active || 'unknown', statusAgeSec, filesRead: files, badRows: bad },
    note: 'identical rows (same ts, venue, inst, side, size) are counted once',
  };
}

module.exports = { computeE4, readRows, parseTs, dayNames };
