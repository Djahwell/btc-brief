import { inflateRawSync } from 'zlib';
// BTC Brief V2 — shared helpers for the GitHub-side jobs (daily.mjs, history.mjs).
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

export const UA = 'btc-brief-v2 (personal, non-commercial)';
export const CODE_VERSION = 'v2-daily/1.0.0';

export async function getJSON(url, { timeout = 30000, tries = 3, init = {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(timeout) });
      if (r.status === 429 || r.status === 418) throw Object.assign(new Error(`HTTP ${r.status}`), { noRetry: true });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      if (e.noRetry) break;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw last;
}

export async function getBuffer(url, { timeout = 60000 } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return Buffer.from(await r.arrayBuffer());
}

export const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function writeJSON(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 1));
}
export function writeGz(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = gzipSync(Buffer.from(JSON.stringify(obj)));
  writeFileSync(path, buf);
  return createHash('sha256').update(buf).digest('hex');
}

// One input record, charter rule 3. value null = missing (never 0).
export function input({ value, unit, asOf, source, scope, quality, staleAfterSec, window = null, extra = {} }) {
  return { value: value ?? null, unit, window, asOf: asOf ?? null, fetchedAt: new Date().toISOString(), source, scope, quality: value == null && quality === 'OK' ? 'MISSING' : quality, staleAfterSec, ...extra };
}

// Coinbase candles (max 300 per call), [time, low, high, open, close, volume] newest first.
export async function coinbaseCandles(product, granularity, startSec, endSec) {
  const out = new Map();
  const step = 300 * granularity;
  for (let s = startSec; s < endSec; s += step) {
    const e = Math.min(s + step, endSec);
    const rows = await getJSON(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`);
    for (const r of rows) if (r[0] >= startSec && r[0] < endSec) out.set(r[0], { t: r[0], o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] });  // end is exclusive: never an unfinished candle
    await sleep(350);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

export async function bitstampDaily(startSec, endSec) {
  const out = new Map();
  let s = startSec;
  while (s < endSec) {
    const d = await getJSON(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${s}`);
    const rows = d?.data?.ohlc || [];
    if (!rows.length) break;
    for (const r of rows) { const t = Number(r.timestamp); if (t < endSec) out.set(t, { t, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume }); }
    const lastT = Number(rows[rows.length - 1].timestamp);
    if (lastT + 86400 <= s) break;
    s = lastT + 86400;
    await sleep(400);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

// data.binance.vision monthly zip (one CSV) → text. Reads the central directory (authoritative sizes,
// handles data descriptors), refuses ZIP64 and encrypted entries rather than guessing.
export function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip: no end-of-central-directory');
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff) throw new Error('zip: ZIP64 not supported');
  if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error('zip: bad central directory');
  const flags = buf.readUInt16LE(cdOff + 8), method = buf.readUInt16LE(cdOff + 10);
  const csize = buf.readUInt32LE(cdOff + 20), lho = buf.readUInt32LE(cdOff + 42);
  if (flags & 1) throw new Error('zip: encrypted entry');
  if (csize === 0xffffffff || lho === 0xffffffff) throw new Error('zip: ZIP64 entry');
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('zip: bad local header');
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return inflateRawSync(data).toString('utf8');
  throw new Error(`zip: method ${method}`);
}
// Binance archive timestamps: ms today; µs in some newer datasets. Normalise to seconds by magnitude.
export const tsSec = v => { const n = Number(v); return n > 1e14 ? Math.floor(n / 1e6) : n > 1e11 ? Math.floor(n / 1000) : n; };   // µs → s, ms → s, s → s
