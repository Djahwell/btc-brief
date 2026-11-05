#!/usr/bin/env node
// BTC Brief V2 — scheduled event calendar (context panel, no score). Writes OUT/events.json and appends
// today's point-in-time flag to OUT/events-log.json (forward test, FORWARD-EVENTS.md).
// Sources, each fetched from the official publisher every run; a source that cannot be fetched or parsed
// is reported as unavailable (its events are not guessed):
//   FOMC        federalreserve.gov FOMC calendar        statement 14:00 America/New_York, 2nd meeting day
//   CPI         bls.gov CPI release schedule            08:30 America/New_York
//   Payrolls    bls.gov Employment Situation schedule   08:30 America/New_York
//   BTC options Deribit monthly expiry = last Friday of the month 08:00 UTC (quarterly in Mar/Jun/Sep/Dec);
//               rule published by Deribit, computed here.
import { readFileSync } from 'fs';
import { writeJSON } from './lib.mjs';

const OUT = process.env.OUT || 'out/v2';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Wall-clock time in America/New_York → UTC ISO (DST-correct via Intl).
export function nyToUtc(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess + (guess - shown)).toISOString();
}

async function text(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
  if (r.ok) return r.text();
  if (r.status !== 403) throw new Error(`HTTP ${r.status}`);
  // bls.gov refuses scripted clients (403): read the same official page in headless Chromium instead.
  let chromium; try { ({ chromium } = await import('playwright')); } catch { throw new Error('HTTP 403 (no browser available)'); }
  const b = await chromium.launch({ headless: true });
  try {
    const pg = await (await b.newContext({ userAgent: UA, locale: 'en-US' })).newPage();
    const resp = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || !resp.ok()) throw new Error(`HTTP ${resp ? resp.status() : 'none'} (browser)`);
    return await pg.content();
  } finally { await b.close(); }
}

// FOMC: "<h4>…2026 FOMC Meetings</h4>" panels; each meeting has fomc-meeting__month and fomc-meeting__date ("27-28", "28-29*").
export function parseFOMC(html) {
  const out = [];
  const panels = html.split(/<h4[^>]*>/i).slice(1);
  for (const p of panels) {
    const ym = p.match(/(\d{4})\s+FOMC Meetings/i); if (!ym) continue;
    const year = +ym[1];
    const re = /fomc-meeting__month[^>]*>\s*(?:<strong>)?\s*([A-Za-z/]+)\s*(?:<\/strong>)?[\s\S]*?fomc-meeting__date[^>]*>\s*([0-9]{1,2})(?:-([0-9]{1,2}))?(\*)?/g;
    let m;
    while ((m = re.exec(p))) {
      const monTxt = m[1].toLowerCase().split('/'); const dEnd = +(m[3] || m[2]);
      // "Apr/May" style meetings: the second day is in the second month when it is smaller than the first day
      let mi = MONTHS.findIndex(x => x.startsWith(monTxt[0].slice(0, 3)));
      if (monTxt.length > 1 && m[3] && +m[3] < +m[2]) mi = MONTHS.findIndex(x => x.startsWith(monTxt[1].slice(0, 3)));
      if (mi < 0) continue;
      out.push({ t: nyToUtc(year, mi + 1, dEnd, 14, 0), kind: 'FOMC', label: `FOMC decision${m[4] ? ' + projections' : ''}`, impact: 'high' });
    }
  }
  return out;
}

// BLS schedule tables: rows "<td>Month Year</td><td>Mon. DD, YYYY</td><td>08:30 AM</td>".
export function parseBLS(html, kind, label) {
  const out = []; const re = /<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*([A-Za-z]{3})[a-z.]*\s+(\d{1,2}),\s*(\d{4})\s*<\/td>\s*<td[^>]*>\s*(\d{1,2}):(\d{2})\s*([AP]M)/gi; let m;
  while ((m = re.exec(html))) {
    const mi = MONTHS.findIndex(x => x.startsWith(m[2].toLowerCase())); if (mi < 0) continue;
    let hh = +m[5] % 12; if (m[7].toUpperCase() === 'PM') hh += 12;
    out.push({ t: nyToUtc(+m[4], mi + 1, +m[3], hh, +m[6]), kind, label, impact: 'high', ref: m[1].replace(/<[^>]+>/g, '').trim() });
  }
  return out;
}

// Deribit BTC options: monthly expiry last Friday 08:00 UTC; quarterly months flagged high impact.
export function deribitExpiries(fromMs, months = 14) {
  const out = []; const d0 = new Date(fromMs);
  for (let k = 0; k < months; k++) {
    const y = d0.getUTCFullYear() + Math.floor((d0.getUTCMonth() + k) / 12), mo = (d0.getUTCMonth() + k) % 12;
    const last = new Date(Date.UTC(y, mo + 1, 0)); const back = (last.getUTCDay() - 5 + 7) % 7;
    const day = last.getUTCDate() - back; const q = [2, 5, 8, 11].includes(mo);
    out.push({ t: new Date(Date.UTC(y, mo, day, 8)).toISOString(), kind: 'OPTIONS', label: q ? 'Quarterly BTC options expiry (Deribit)' : 'Monthly BTC options expiry (Deribit)', impact: q ? 'high' : 'medium' });
  }
  return out;
}

// Point-in-time flag for the forward test: any HIGH-impact event in [D 00:00, D+2 00:00).
export function flagFor(events, dayIso) {
  const a = Date.parse(dayIso + 'T00:00:00Z'), b = a + 2 * 86400000;
  const hits = events.filter(e => e.impact === 'high' && Date.parse(e.t) >= a && Date.parse(e.t) < b);
  return { date: dayIso, within48h: hits.length > 0, events: hits.map(e => `${e.kind} ${e.t}`) };
}

async function main() {
  const now = Date.now(); const sources = {}; let events = [];
  const src = async (name, url, parse) => {
    try { const ev = parse(await text(url)); if (!ev.length) throw new Error('no dates parsed'); events.push(...ev); sources[name] = { ok: true, url, count: ev.length, fetchedAt: new Date().toISOString() }; }
    catch (e) { sources[name] = { ok: false, url, error: String(e.message).slice(0, 120) }; }
  };
  await src('fomc', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', parseFOMC);
  await src('cpi', 'https://www.bls.gov/schedule/news_release/cpi.htm', h => parseBLS(h, 'CPI', 'US CPI'));
  await src('payrolls', 'https://www.bls.gov/schedule/news_release/empsit.htm', h => parseBLS(h, 'NFP', 'US payrolls (Employment Situation)'));
  events.push(...deribitExpiries(now)); sources.options = { ok: true, rule: 'last Friday 08:00 UTC (Deribit)', computedAt: new Date().toISOString() };
  events = events.filter(e => Date.parse(e.t) >= now - 7 * 86400000).sort((a, b) => (a.t < b.t ? -1 : 1));
  const seen = new Set(); events = events.filter(e => { const k = e.kind + e.t; if (seen.has(k)) return false; seen.add(k); return true; });
  writeJSON(`${OUT}/events.json`, { schema: 'brief-v2-events/1', generatedAt: new Date().toISOString(), sources, events: events.slice(0, 120) });
  // Append today's flag once (first run of the UTC day), with the sources' state as of now.
  const today = new Date(now).toISOString().slice(0, 10); let log = { rows: [] };
  try { log = JSON.parse(readFileSync(`${OUT}/events-log.json`, 'utf8')); } catch { /* new */ }
  if (!log.rows.some(r => r.date === today)) {
    const allOk = sources.fomc.ok && sources.cpi.ok && sources.payrolls.ok;
    log.rows.push({ ...flagFor(events, today), recordedAt: new Date().toISOString(), sourcesOk: allOk });
    writeJSON(`${OUT}/events-log.json`, { schema: 'brief-v2-events-log/1', ...log });
  }
  console.log('[v2-events]', JSON.stringify(sources));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exitCode = 1; });
