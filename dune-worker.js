#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// dune-worker.js  —  BTC Morning Brief · Background Dune prefetcher
// ─────────────────────────────────────────────────────────────────────────────
// Runs the expensive Dune UTXO scan independently of the browser.
// Writes results to public/dune_cache.json, which Vite serves as a static
// file so the brief can read it instantly at load time (no polling, no wait).
//
// Usage:
//   node dune-worker.js            # run once, then exit
//   node dune-worker.js --watch    # run once, then refresh every 6 hours
//
// Tip: add to your shell profile so it auto-starts with the dev server:
//   npm run dune --watch &
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname }                                       from 'path';
import { fileURLToPath }                                       from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 10_000;   // 10s between status polls
const MAX_WAIT_MS      = 600_000;  // 10 minutes max wait per query
const REFRESH_HOURS    = 6;        // how often --watch re-runs
const CACHE_FILE       = join(__dirname, 'public', 'dune_cache.json');
const DUNE_BASE        = 'https://api.dune.com';

// ── Load .env (VITE_ prefix, no dotenv dependency needed) ────────────────────
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) throw new Error('.env not found — copy .env.example and fill in keys');
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

const ENV           = loadEnv();
const DUNE_API_KEY  = ENV.VITE_DUNE_API_KEY;
if (!DUNE_API_KEY) { console.error('[Worker] VITE_DUNE_API_KEY missing from .env'); process.exit(1); }

// ── Exchange Flow SQL ─────────────────────────────────────────────────────────
// Computes yesterday's BTC inflow + outflow via a hardcoded list of publicly-documented
// exchange cold/hot wallet addresses. Confirmed schema:
//   bitcoin.outputs: has 'address' column (nullable for coinbase/OP_RETURN outputs)
//   bitcoin.inputs:  has 'block_date' column
// NOTE: labels.addresses has 0 Bitcoin CEX entries (probed 2026-04-10) — do not use.
// Coverage: ~20 major addresses across Binance, Coinbase, Kraken, Bitfinex, OKX, Bybit.
// These are cold/custody wallets — captures large settlement flows. Hot deposit wallets
// rotate constantly and cannot be tracked without a paid labels provider.
// Gross flow will be lower than full-market 30K-200K BTC/day but directionally valid
// for detecting large institutional moves into/out of known custody addresses.
const EXCHANGE_FLOW_SQL = `WITH
  exchange_addrs(address, exchange) AS (
    VALUES
      -- Binance (largest BTC holder ~570K BTC)
      ('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',       'Binance'),
      ('bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h','Binance'),
      ('1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ',       'Binance'),
      ('3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6',       'Binance'),
      ('3LYJfcfHHeihJD2R9cFoHbDoNS5ScBEV3G',       'Binance'),
      ('bc1qd9algxdprz43rdj3fdlhsad94zsp8prk46x5n0','Binance'),
      -- Coinbase / Coinbase Prime (~900K BTC AUM)
      ('3FupZp77ySr7jwoLYEJ9Ro4rakoBZPDhBY',       'Coinbase'),
      ('3Cbq7aT1tY8kMxWLBkgmdar1Hz4HniFDz7',       'Coinbase'),
      ('17XBj6iFEsf8kzDMGQk5ghZewDa3zKKbT6',       'Coinbase'),
      ('1LPH7kHa1KAuyMKcRJKXnmNTSBXVFoGPMF',       'Coinbase'),
      -- Kraken (~80K BTC)
      ('3AfP9nFSMRNMk9MkgVsmKG9sL2PGYQ9Lfr',       'Kraken'),
      ('39YnSQwjhKBUEQ1FHXKqMYKETJhU4FZVRJ',       'Kraken'),
      ('3HMJz7S4WFQcmE6FHWy7LE1TzLn59pSG5z',       'Kraken'),
      -- Bitfinex (~100K BTC)
      ('3D2oetdNuZUqQHPJmcMDDHYoqkyNVsFk9r',       'Bitfinex'),
      ('1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx',       'Bitfinex'),
      -- OKX
      ('3LQUu4v9z6KNch71j7kbj8GPeAGUo1FW6a',       'OKX'),
      ('bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6','OKX'),
      -- Bybit
      ('bc1qek8tszgprq8tkwj7h2y3bvkl4jm9q2yfntrh0e','Bybit'),
      -- Gemini
      ('3BtxkGjCg37dBaLQc3P3M76bV5VFqyXyY4',       'Gemini'),
      -- Bitstamp
      ('3NAVjK57yugfiLaJPnZJTdVFNqiYUVEcVU',       'Bitstamp')
  ),
  yesterday AS (SELECT CURRENT_DATE - INTERVAL '1' DAY AS day),
  inflows AS (
    SELECT SUM(CAST(o.value AS DOUBLE)) AS inflow_btc
    FROM bitcoin.outputs o
    WHERE o.block_date = (SELECT day FROM yesterday)
      AND o.address IN (SELECT address FROM exchange_addrs)
  ),
  outflows AS (
    SELECT SUM(CAST(o.value AS DOUBLE)) AS outflow_btc
    FROM bitcoin.outputs o
    JOIN bitcoin.inputs i
      ON  i.spent_tx_id         = o.tx_id
      AND i.spent_output_number = o.index
    WHERE i.block_date = (SELECT day FROM yesterday)
      AND o.address IN (SELECT address FROM exchange_addrs)
  )
SELECT
  (SELECT day FROM yesterday)                                          AS day,
  (SELECT COUNT(*) FROM exchange_addrs)                                AS exchange_addr_count,
  COALESCE((SELECT inflow_btc  FROM inflows),  0)                      AS inflow_btc,
  COALESCE((SELECT outflow_btc FROM outflows), 0)                      AS outflow_btc,
  COALESCE((SELECT inflow_btc  FROM inflows),  0)
    - COALESCE((SELECT outflow_btc FROM outflows), 0)                  AS netflow_btc`;

// ── MVRV SQL v3  (LEFT JOIN anti-join — no correlated subquery) ───────────────
// bitcoin.outputs has NO spent_tx_id column — it lives on bitcoin.inputs.
// A LEFT JOIN + WHERE i.spent_tx_id IS NULL is a hash anti-join in Trino (O(n+m)).
const MVRV_SQL = `WITH utxos AS (
  SELECT
    o.block_date                              AS creation_date,
    SUM(CAST(o.value AS DOUBLE))               AS btc_amount  -- value is already in BTC on Dune
  FROM bitcoin.outputs o
  LEFT JOIN bitcoin.inputs i
    ON  i.spent_tx_id        = o.tx_id
    AND i.spent_output_number = o.index    -- confirmed column name from bitcoin.inputs schema
  WHERE i.spent_tx_id IS NULL
  GROUP BY 1
),
btc_prices AS (
  SELECT
    CAST(DATE_TRUNC('day', minute) AS DATE) AS price_date,
    AVG(price)                              AS price_usd
  FROM prices.usd
  WHERE symbol = 'BTC'
    AND contract_address IS NULL
    AND blockchain IS NULL
  GROUP BY 1
),
realized AS (
  SELECT
    SUM(u.btc_amount)                                        AS total_btc,
    SUM(u.btc_amount * COALESCE(p.price_usd, 1.0))         AS realized_cap
  FROM utxos u
  LEFT JOIN btc_prices p ON u.creation_date = p.price_date
),
spot AS (
  SELECT price_usd AS price FROM btc_prices ORDER BY price_date DESC LIMIT 1
)
SELECT
  CURRENT_DATE                                                   AS date,
  s.price                                                        AS current_price_usd,
  r.total_btc                                                    AS circulating_btc,
  s.price * r.total_btc                                          AS market_cap_usd,
  r.realized_cap                                                 AS realized_cap_usd,
  r.realized_cap / NULLIF(r.total_btc, 0)                       AS realized_price_usd,
  (s.price * r.total_btc) / NULLIF(r.realized_cap, 0)          AS mvrv_ratio
FROM realized r, spot s`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const HEADERS = { 'x-dune-api-key': DUNE_API_KEY, 'Content-Type': 'application/json' };

async function duneGet(path) {
  const res = await fetch(DUNE_BASE + path, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} GET ${path}`);
  return res.json();
}
async function dunePost(path, body = {}) {
  const res = await fetch(DUNE_BASE + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} POST ${path}`);
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Query ID persistence (stored inside cache file to survive restarts) ───────
function loadCachedIds() {
  try {
    if (existsSync(CACHE_FILE)) {
      const c = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      return { mvrv: c.mvrv_query_id || null, exflow: c.exflow_query_id || null };
    }
  } catch (_) {}
  return { mvrv: null, exflow: null };
}

const _ids = loadCachedIds();
let _queryId   = _ids.mvrv;
let _exflowQid = _ids.exflow;

async function getOrCreateQueryId() {
  if (_queryId) { console.log(`[MVRV] Reusing query id ${_queryId}`); return _queryId; }
  console.log('[MVRV] Creating new Dune query...');
  const res = await dunePost('/api/v1/query', {
    name: 'BTC MVRV Ratio - Maison Toe v3',
    description: 'MVRV = Market Cap / Realized Cap via LEFT JOIN anti-join on bitcoin UTXOs',
    query_sql: MVRV_SQL,
    is_private: false,
    parameters: [],
  });
  if (!res.query_id) throw new Error('No query_id in create response: ' + JSON.stringify(res));
  _queryId = String(res.query_id);
  console.log(`[MVRV] Query created → id: ${_queryId}`);
  return _queryId;
}

async function getOrCreateExflowQueryId() {
  if (_exflowQid) { console.log(`[ExFlow] Reusing query id ${_exflowQid}`); return _exflowQid; }
  console.log('[ExFlow] Creating new Dune exchange flow query...');
  const res = await dunePost('/api/v1/query', {
    name: 'BTC Exchange Flows - Maison Toe v1',
    description: 'Daily BTC inflow/outflow for labeled exchange addresses via labels.addresses',
    query_sql: EXCHANGE_FLOW_SQL,
    is_private: false,
    parameters: [],
  });
  if (!res.query_id) throw new Error('No query_id in create response: ' + JSON.stringify(res));
  _exflowQid = String(res.query_id);
  console.log(`[ExFlow] Query created → id: ${_exflowQid}`);
  return _exflowQid;
}

// ── Poll execution to completion ──────────────────────────────────────────────
async function pollExecution(execId, label = 'MVRV', maxWait = MAX_WAIT_MS) {
  const deadline = Date.now() + maxWait;
  let attempt = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    attempt++;
    const elapsed = Math.round(attempt * POLL_INTERVAL_MS / 1000);
    const status  = await duneGet(`/api/v1/execution/${execId}/status`);
    const state   = status.state;
    console.log(`[${label}] Poll #${attempt} (${elapsed}s) → ${state}`);
    if (state === 'QUERY_STATE_COMPLETED') {
      return duneGet(`/api/v1/execution/${execId}/results`);
    }
    if (state === 'QUERY_STATE_FAILED' || state === 'QUERY_STATE_CANCELLED') {
      const errMsg = status.error?.message || status.error?.type
        || JSON.stringify(status.error || status.error_message || '(no error detail in response)');
      console.error(`[${label}] Dune error detail:`, errMsg);
      throw new Error(`Execution ${state} after ${elapsed}s: ${errMsg}`);
    }
  }
  throw new Error(`Timed out after ${maxWait / 60_000}min`);
}

// ── Schema probe: inspect column names on a Dune table ────────────────────────
// Run with: npm run dune:schema
async function runProbe(label, sql) {
  console.log(`\n[Schema] Probing ${label}...`);
  const cr = await dunePost('/api/v1/query', {
    name: `Schema probe — ${label}`, query_sql: sql, is_private: false, parameters: [],
  });
  if (!cr.query_id) throw new Error('No query_id: ' + JSON.stringify(cr));
  const qid = String(cr.query_id);
  console.log(`[Schema] Query id: ${qid} — triggering...`);
  const er = await dunePost(`/api/v1/query/${qid}/execute`, {});
  if (!er.execution_id) throw new Error('No execution_id: ' + JSON.stringify(er));
  const deadline = Date.now() + 120_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    await sleep(8000);
    attempt++;
    const s = await duneGet(`/api/v1/execution/${er.execution_id}/status`);
    console.log(`[Schema] Poll #${attempt} → ${s.state}`);
    if (s.state === 'QUERY_STATE_COMPLETED') {
      const res = await duneGet(`/api/v1/execution/${er.execution_id}/results`);
      const row = res?.result?.rows?.[0];
      if (row) {
        console.log(`\n[Schema] ${label} columns:`);
        Object.keys(row).forEach(k => console.log(`  ${k}: ${JSON.stringify(row[k])?.slice(0, 80)}`));
      } else { console.log(`[Schema] No rows for ${label}`); }
      return;
    }
    if (s.state === 'QUERY_STATE_FAILED' || s.state === 'QUERY_STATE_CANCELLED') {
      const errMsg = s.error?.message || s.error?.type || JSON.stringify(s.error || '(no detail)');
      console.error(`[Schema] ${label} FAILED:`, errMsg);
      console.error('[Schema] Full status:', JSON.stringify(s, null, 2));
      return;
    }
  }
  console.error(`[Schema] ${label} timed out`);
}

async function probeSchema() {
  await runProbe('bitcoin.outputs', 'SELECT * FROM bitcoin.outputs LIMIT 1');
  await runProbe('bitcoin.inputs',  'SELECT * FROM bitcoin.inputs  LIMIT 1');
}

// Extended probe for exchange flow schema requirements
async function probeExflowSchema() {
  // Check if bitcoin.outputs has an 'address' column
  await runProbe('bitcoin.outputs.address check', 'SELECT address FROM bitcoin.outputs LIMIT 1');
  // Check if bitcoin.inputs has a block_date column
  await runProbe('bitcoin.inputs.block_date check', 'SELECT block_date FROM bitcoin.inputs LIMIT 1');
  // Check how many Bitcoin exchange addresses are in labels
  await runProbe('labels.addresses (bitcoin cex)', `
    SELECT COUNT(*) AS n_addrs, COUNT(DISTINCT address) AS n_unique
    FROM labels.addresses
    WHERE blockchain = 'bitcoin'
      AND (category IN ('cex', 'exchange', 'centralized exchange') OR label_type IN ('cex', 'exchange'))
  `);
}

// ── Parse MVRV row ────────────────────────────────────────────────────────────
function parseMvrv(data) {
  const row = data?.result?.rows?.[0];
  if (!row) return null;
  const mvrv = row.mvrv_ratio         != null ? parseFloat(row.mvrv_ratio)         : null;
  const rp   = row.realized_price_usd != null ? parseFloat(row.realized_price_usd) : null;
  const mc   = row.market_cap_usd     != null ? parseFloat(row.market_cap_usd)     : null;
  const rc   = row.realized_cap_usd   != null ? parseFloat(row.realized_cap_usd)   : null;
  if (!mvrv || mvrv <= 0 || mvrv >= 50) { console.warn('[MVRV] Implausible value:', mvrv); return null; }
  return { mvrv, realizedPrice: rp, marketCap: mc, realizedCap: rc, date: row.date || null };
}

// ── Parse exchange flow row ───────────────────────────────────────────────────
function parseExchangeFlow(data) {
  const row = data?.result?.rows?.[0];
  if (!row) return null;
  const inflow  = row.inflow_btc  != null ? parseFloat(row.inflow_btc)  : null;
  const outflow = row.outflow_btc != null ? parseFloat(row.outflow_btc) : null;
  const netflow = row.netflow_btc != null ? parseFloat(row.netflow_btc) : null;
  const n_addrs = row.exchange_addr_count != null ? parseInt(row.exchange_addr_count) : null;
  // Plausibility: we expect at least 1,000 BTC gross if labels coverage is decent
  const gross = (inflow || 0) + (outflow || 0);
  if (gross < 100 && n_addrs != null && n_addrs < 10) {
    console.warn(`[ExFlow] Very few labeled addresses (${n_addrs}) — coverage may be minimal`);
  }
  return { inflow_btc: inflow, outflow_btc: outflow, netflow_btc: netflow,
           exchange_addr_count: n_addrs, day: row.day || null };
}

// ── Farside HTML parser (regex, no deps) ─────────────────────────────────────
// Table format: Date | IBIT | FBTC | … | Total (last col), values in $M USD
// Negative flows shown as (123.4) parenthetical = -123.4
function parseFarsideHTML(html) {
  const rowMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
  for (let i = rowMatches.length - 1; i >= 0; i--) {
    const cells = rowMatches[i].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
    if (cells.length < 5) continue;
    const dateText = cells[0].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    // Accept: "11 Apr 2025", "11/04/2025", "Apr 11", "2025-04-11", "04/11/2025"
    const hasDate = /\d{1,2}[\s\/\-]\w{2,9}[\s\/\-]\d{2,4}/.test(dateText)
                 || /\d{2}[\/-]\d{2}[\/-]\d{2,4}/.test(dateText)
                 || /\d{4}-\d{2}-\d{2}/.test(dateText)
                 || /[A-Za-z]{3,9}\s+\d{1,2}/.test(dateText);
    if (!hasDate) continue;
    const totalRaw = cells[cells.length - 1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
    if (!totalRaw || totalRaw === '-') continue;
    const parsed = parseFloat(totalRaw.replace(/,/g, '').replace(/\(([^)]+)\)/, '-$1'));
    if (!isNaN(parsed)) {
      // Skip $0 rows — Farside posts 0 as a placeholder while the trading day
      // is still in progress (or on weekends/holidays when markets are closed).
      // Genuine net-zero ETF flow days are essentially impossible with 11+ active ETFs.
      if (parsed === 0) {
        console.log(`[Farside] Skipping zero-flow row: "${dateText}" — likely placeholder or non-trading day`);
        continue;
      }
      console.log(`[Farside] Row found: date="${dateText}" total=${parsed}M`);
      return { total_million_usd: parsed, date: dateText };
    }
  }
  console.warn('[Farside] No valid row in HTML — possible layout change');
  return null;
}

// ── Fetch Farside via Playwright headless Chrome ───────────────────────────────
// Playwright runs a real Chrome engine that executes JavaScript, so Cloudflare's
// IUAM challenge passes exactly as it would in a real browser session.
// Uses system Chrome (channel:'chrome') if installed — best fingerprint.
// Falls back to Playwright's bundled Chromium automatically.
async function fetchFarsidePlaywright() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (_) {
    throw new Error('playwright not installed — run: npm install && npx playwright install chromium');
  }

  console.log('[Farside] Launching headless Chrome via Playwright...');
  const browser = await chromium.launch({
    channel: 'chrome',   // use system Chrome for best Cloudflare fingerprint
    headless: true,
  }).catch(() =>
    // system Chrome not found — fall back to Playwright's bundled Chromium
    chromium.launch({ headless: true })
  );

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    console.log('[Farside] Navigating to farside.co.uk/btc/ ...');
    await page.goto('https://farside.co.uk/btc/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Wait for Cloudflare challenge to clear
    await page.waitForFunction(
      () => !document.title.includes('Just a moment'),
      { timeout: 30000 }
    ).catch(() => console.warn('[Farside] Cloudflare title-wait timed out'));

    // Wait for the actual data table to be rendered by JavaScript
    await page.waitForSelector('table', { timeout: 20000 })
      .catch(() => console.warn('[Farside] No <table> found within 20s'));

    // Let any remaining JS finish populating cells
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log(`[Farside] Page title: "${title}"`);
    if (title.includes('Just a moment') || title.includes('Attention Required')) {
      throw new Error('Cloudflare challenge not resolved — try: npx playwright install chrome');
    }

    // Use browser DOM API directly — no HTML regex needed.
    // Find the table that has a "Total" header column, walk rows bottom-to-top
    // for the most recent row with a real date + Total value.
    const etfData = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      for (const table of tables) {
        // Find header row and locate "Total" column index
        const headerRow = table.querySelector('tr');
        if (!headerRow) continue;
        const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
        const totalIdx = headerCells.findIndex(
          el => el.textContent.trim().toUpperCase() === 'TOTAL'
        );
        if (totalIdx < 0) continue;

        // Walk data rows bottom-to-top for most recent valid weekday entry
        const rows = Array.from(table.querySelectorAll('tr'));
        const SKIP = ['total', 'average', 'maximum', 'minimum', 'fee', 'ytd'];
        for (let i = rows.length - 1; i >= 1; i--) {
          const cells = Array.from(rows[i].querySelectorAll('td'));
          if (cells.length <= totalIdx) continue;
          const dateText = cells[0]?.textContent.trim();
          if (!dateText || dateText.length < 3) continue;
          // Skip summary rows (Total, Average, Maximum, Minimum) — they have no digit in the date cell
          if (SKIP.includes(dateText.toLowerCase())) continue;
          if (!/\d/.test(dateText)) continue;  // real dates always contain a digit
              const totalText = cells[totalIdx]?.textContent.trim();
          if (!totalText || totalText === '-' || totalText === '') continue;
          // Convert (123.4) → -123.4, strip commas/spaces
          const cleaned = totalText.replace(/,/g, '').replace(/\s/g, '').replace(/\(([^)]+)\)/, '-$1');
          const parsed = parseFloat(cleaned);
          if (!isNaN(parsed)) {
            // Skip $0 rows — Farside posts 0 as a placeholder while the trading
            // day is still open, or on weekends/holidays. Skip and walk back further.
            if (parsed === 0) continue;
            return { total_million_usd: parsed, date: dateText };
          }
        }
      }
      // Debug: return table count and first table headers to diagnose misses
      return {
        _debug: true,
        tableCount: tables.length,
        firstTableHeaders: tables[0]
          ? Array.from(tables[0].querySelectorAll('th, tr:first-child td')).map(el => el.textContent.trim()).slice(0, 10)
          : [],
      };
    });

    if (!etfData) {
      console.warn('[Farside] page.evaluate returned null');
      return null;
    }
    if (etfData._debug) {
      console.warn(`[Farside] No "Total" column found. Tables: ${etfData.tableCount}, first headers: ${JSON.stringify(etfData.firstTableHeaders)}`);
      return null;
    }
    return etfData;
  } finally {
    await browser.close();
  }
}

// ── Bitcoin Magazine Pro — LTH Supply → Daily Net Position Change ─────────────
// Navigates to bitcoinmagazinepro.com/charts/long-term-holder-supply/
// Chart is a Plotly React app. Data is embedded in the DOM on the .js-plotly-plot
// element after render. Trace 1 = "Long Term Holder Supply" in BTC.
// We compute the 1-day change (today - yesterday) as the net position change.
async function fetchBMPLTHData() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (_) {
    throw new Error('playwright not installed — run: npm install && npx playwright install chromium');
  }

  console.log('[BMP] Launching headless Chrome via Playwright...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  }).catch(() => chromium.launch({ headless: true }));

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();

    console.log('[BMP] Navigating to long-term-holder-supply chart...');
    await page.goto('https://www.bitcoinmagazinepro.com/charts/long-term-holder-supply/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Wait for Plotly to render — the .js-plotly-plot div gets _fullData set by React
    await page.waitForFunction(() => {
      const gd = document.querySelector('.js-plotly-plot');
      return gd && (gd._fullData || gd._data || gd.data) &&
             (gd._fullData || gd._data || gd.data).length > 0 &&
             (gd._fullData || gd._data || gd.data)[0].x?.length > 100;
    }, { timeout: 20000 }).catch(() => console.warn('[BMP] Plotly render wait timed out — trying anyway'));

    const title = await page.title();
    console.log(`[BMP] Page title: "${title}"`);

    const result = await page.evaluate(() => {
      const gd = document.querySelector('.js-plotly-plot');
      if (!gd) return { _err: 'no .js-plotly-plot found' };

      const traces = gd._fullData || gd._data || gd.data;
      if (!traces || !traces.length) return { _err: 'no traces on gd' };

      // Find the "Long Term Holder Supply" trace (yaxis y2)
      const lthTrace = traces.find(t =>
        t.name && t.name.toLowerCase().includes('long term holder')
      ) || traces.find(t => t.yaxis === 'y2') || traces[1];

      if (!lthTrace) return { _err: 'LTH trace not found', traceNames: traces.map(t => t.name) };

      const xs = lthTrace.x;
      const ys = lthTrace.y;
      if (!xs || !ys || xs.length < 2) return { _err: 'insufficient data points' };

      // Walk back from the end to find the last two non-null real data points
      let i = xs.length - 1;
      while (i > 0 && (ys[i] === null || ys[i] === undefined)) i--;
      const todayDate = xs[i];
      const todayVal  = ys[i];

      let j = i - 1;
      while (j > 0 && (ys[j] === null || ys[j] === undefined)) j--;
      const prevDate = xs[j];
      const prevVal  = ys[j];

      const netChange = Math.round(todayVal - prevVal);

      return {
        lth_supply_btc:  Math.round(todayVal),
        lth_net_btc:     netChange,   // positive = accumulating, negative = distributing
        date:            todayDate.slice(0, 10),
        prev_date:       prevDate.slice(0, 10),
        source_url:      'https://www.bitcoinmagazinepro.com/charts/long-term-holder-supply/',
      };
    });

    if (result._err) {
      console.warn('[BMP] Extraction failed:', result._err, result);
      return null;
    }

    return result;
  } finally {
    await browser.close();
  }
}

// ── Dead code: previous Node.js ETF fetch attempts (all gated/rate-limited) ──
async function fetchETFFlowData_DISABLED() {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // ── 1. SoSoValue — direct (not via Vite proxy) ──────────────────────────────
  const sosoPatterns = [
    { url: 'https://sosovalue.com/api/etf/us-btc-spot/fund-flow?type=total',        label: 'fund-flow'   },
    { url: 'https://sosovalue.com/api/etf/us-btc-spot/net-asset?type=total',        label: 'net-asset'   },
    { url: 'https://sosovalue.com/api/index/indexDailyHistory?code=US-BTC-SPOT-ETF&range=1', label: 'indexHistory' },
  ];
  for (const { url, label } of sosoPatterns) {
    try {
      console.log(`[ETF] SoSoValue ${label} — trying ${url}`);
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': UA,
                   'Referer': 'https://sosovalue.com/', 'Origin': 'https://sosovalue.com' },
      });
      if (!res.ok) { console.warn(`[ETF] SoSoValue ${label} → HTTP ${res.status}`); continue; }
      const data = await res.json();
      const ssvData = data?.data;
      if (!ssvData) continue;
      const row = Array.isArray(ssvData) ? ssvData[ssvData.length - 1] : ssvData;
      const netM = row?.totalNetInflow ?? row?.netInflow ?? row?.net_inflow ?? row?.totalFlow ?? null;
      if (netM == null) continue;
      const netUSD = Math.abs(netM) > 1e6 ? netM : netM * 1e6;
      const dateStr = row?.date || row?.time || new Date().toISOString().slice(0, 10);
      console.log(`[ETF] SoSoValue ✓ (${label}) — net: $${(netUSD / 1e6).toFixed(0)}M | date: ${dateStr}`);
      return { total_million_usd: netUSD / 1e6, date: dateStr, source: `SoSoValue (${label})` };
    } catch (e) {
      console.warn(`[ETF] SoSoValue ${label} error:`, e.message);
    }
  }

  // ── 2. CoinGlass open API — ETF flow ────────────────────────────────────────
  const cgPatterns = [
    'https://open-api.coinglass.com/public/v2/indicator/bitcoin_etf_flow',
    'https://open-api.coinglass.com/public/v2/indicator/btc_etf',
    'https://open-api.coinglass.com/api/etf/btc-spot-etf-flow',
  ];
  for (const url of cgPatterns) {
    try {
      console.log(`[ETF] CoinGlass — trying ${url}`);
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': UA },
      });
      if (!res.ok) { console.warn(`[ETF] CoinGlass → HTTP ${res.status}`); continue; }
      const data = await res.json();
      // CoinGlass shapes: { data: [ { netFlow, date } ] } or { data: { netFlow } }
      const row = Array.isArray(data?.data) ? data.data[data.data.length - 1] : data?.data;
      if (!row) continue;
      const netM = row?.netFlow ?? row?.net_flow ?? row?.netInflow ?? row?.totalNetInflow ?? null;
      if (netM == null) continue;
      const netUSD = Math.abs(netM) > 1e6 ? netM : netM * 1e6;
      const dateStr = row?.date || row?.time || new Date().toISOString().slice(0, 10);
      console.log(`[ETF] CoinGlass ✓ — net: $${(netUSD / 1e6).toFixed(0)}M | date: ${dateStr}`);
      return { total_million_usd: netUSD / 1e6, date: dateStr, source: 'CoinGlass ETF flow' };
    } catch (e) {
      console.warn(`[ETF] CoinGlass error (${url}):`, e.message);
    }
  }

  // ── 3. Yahoo Finance AUM-delta (price-adjusted, crumb-authenticated) ─────────
  // Yahoo's quoteSummary endpoint requires a session crumb to avoid 429.
  // We fetch the crumb from Yahoo's consent endpoint first, then use it.
  // Tracks IBIT + FBTC (≈80% of BTC ETF AUM) day-over-day with BTC price adjustment.
  try {
    // Step A: get a Yahoo Finance session crumb
    let crumb = null;
    let cookieHeader = '';
    try {
      const consentRes = await fetch('https://fc.yahoo.com/', {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        redirect: 'follow',
      });
      // Collect Set-Cookie values (Node.js fetch returns them as raw string)
      const rawCookies = consentRes.headers.getSetCookie?.() || [];
      cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

      const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, 'Cookie': cookieHeader, 'Accept': '*/*' },
      });
      if (crumbRes.ok) {
        crumb = (await crumbRes.text()).trim();
        console.log(`[ETF] Yahoo crumb: ${crumb.slice(0, 8)}...`);
      } else {
        console.warn(`[ETF] Crumb fetch → HTTP ${crumbRes.status}`);
      }
    } catch (ce) {
      console.warn('[ETF] Crumb fetch failed:', ce.message);
    }

    // Step B: fetch AUM for IBIT and FBTC (≈80% of total BTC ETF AUM)
    const ETF_TICKERS = ['IBIT', 'FBTC'];
    const aumMap = {};
    const yahooHeaders = {
      'Accept': 'application/json',
      'User-Agent': UA,
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    };

    for (const ticker of ETF_TICKERS) {
      await sleep(800); // respect rate limit
      try {
        const crumbParam = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';
        const r = await fetch(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,price${crumbParam}`,
          { headers: yahooHeaders }
        );
        if (!r.ok) { console.warn(`[ETF] Yahoo ${ticker} → HTTP ${r.status}`); continue; }
        const d = await r.json();
        const aum = d?.quoteSummary?.result?.[0]?.summaryDetail?.totalAssets?.raw;
        const nav = d?.quoteSummary?.result?.[0]?.price?.regularMarketPrice?.raw;
        if (aum && aum > 1e8) {
          aumMap[ticker] = { aum, nav };
          console.log(`[ETF] Yahoo ${ticker}: AUM=$${(aum / 1e9).toFixed(2)}B  NAV=$${(nav || 0).toFixed(2)}`);
        }
      } catch (te) {
        console.warn(`[ETF] Yahoo ${ticker} error:`, te.message);
      }
    }

    // Step C: also fetch BTC price via chart API (no crumb needed)
    let btcPrice = null;
    try {
      await sleep(400);
      const btcRes = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=1d',
        { headers: yahooHeaders }
      );
      if (btcRes.ok) {
        const btcJson = await btcRes.json();
        btcPrice = btcJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (btcPrice) console.log(`[ETF] BTC price: $${Math.round(btcPrice).toLocaleString()}`);
      }
    } catch (_bp) {}

    const totalAUM = Object.values(aumMap).reduce((s, v) => s + v.aum, 0);
    if (totalAUM < 1e9) throw new Error(`AUM total implausibly low: $${(totalAUM / 1e9).toFixed(2)}B`);

    // Step D: load previous snapshot from cache, compute price-adjusted flow
    let prevAUM = null, prevBTC = null, prevDate = null;
    try {
      if (existsSync(CACHE_FILE)) {
        const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
        if (prev.etfAUM?.totalAUM) {
          prevAUM  = prev.etfAUM.totalAUM;
          prevBTC  = prev.etfAUM.btcPrice;
          prevDate = prev.etfAUM.date;
        }
      }
    } catch (_) {}

    let flowResult = null;
    if (prevAUM && prevBTC && btcPrice) {
      const btcReturn   = (btcPrice - prevBTC) / prevBTC;
      const expectedAUM = prevAUM * (1 + btcReturn);
      const flowUSD     = totalAUM - expectedAUM;
      const today       = new Date().toISOString().slice(0, 10);
      const sign        = flowUSD >= 0 ? '+' : '';
      console.log(`[ETF] AUM delta: $${(totalAUM/1e9).toFixed(2)}B vs prev $${(prevAUM/1e9).toFixed(2)}B | BTC ret ${(btcReturn*100).toFixed(2)}% → flow ${sign}$${(flowUSD/1e6).toFixed(0)}M`);
      flowResult = {
        total_million_usd: flowUSD / 1e6,
        date:   today,
        source: `Yahoo Finance AUM-delta (IBIT+FBTC, price-adj, prev=${prevDate || '?'})`,
        approx: true,
      };
    } else {
      console.log('[ETF] AUM baseline stored ($' + (totalAUM/1e9).toFixed(2) + 'B) — price-adj flow available on next run');
    }

    return { _aumSnapshot: { totalAUM, btcPrice, date: new Date().toISOString().slice(0, 10), tickers: aumMap }, flowResult };
  } catch (ey) {
    console.warn('[ETF] Yahoo AUM approach failed:', ey.message);
  }

  console.warn('[ETF] All ETF sources failed — no flow data cached');
  return null;
}

// ── Stablecoin Supply — CoinGecko free API (no key required) ─────────────────
// Fetches USDT + USDC circulating supply. Computes 7-day change by diffing
// against the previous cached value. Positive delta = dry powder expanding = bullish.
async function fetchStablecoinSupply() {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const headers = { 'User-Agent': UA, 'Accept': 'application/json' };

  const fetchCoin = async (id) => {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      { headers, signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`CoinGecko ${id}: HTTP ${res.status}`);
    const j = await res.json();
    return j?.market_data?.circulating_supply ?? null;
  };

  const [usdtSupply, usdcSupply] = await Promise.all([
    fetchCoin('tether').catch(() => null),
    fetchCoin('usd-coin').catch(() => null),
  ]);

  if (usdtSupply == null && usdcSupply == null) return null;

  const totalUSD = (usdtSupply || 0) + (usdcSupply || 0);
  const today    = new Date().toISOString().slice(0, 10);

  // Load previous snapshot from cache to compute 7d delta
  let prev7dTotal = null;
  let prevDate    = null;
  try {
    if (existsSync(CACHE_FILE)) {
      const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      if (prev.stablecoinSupply?.total_usd && prev.stablecoinSupply?.date) {
        const ageDays = (Date.now() - new Date(prev.stablecoinSupply.date).getTime()) / 86400000;
        if (ageDays >= 6 && ageDays <= 10) {
          // snapshot is ~7 days old — use as baseline
          prev7dTotal = prev.stablecoinSupply.total_usd;
          prevDate    = prev.stablecoinSupply.date;
        }
      }
    }
  } catch (_) {}

  const delta7d    = prev7dTotal != null ? totalUSD - prev7dTotal : null;
  const delta7dPct = prev7dTotal != null ? ((delta7d / prev7dTotal) * 100).toFixed(2) : null;
  const regime     = delta7d == null ? 'STABLE'       // no prior snapshot yet — default neutral
                   : delta7d >  5e9  ? 'EXPANDING'    // >$5B inflow = bullish dry powder
                   : delta7d < -5e9  ? 'CONTRACTING'  // >$5B outflow = liquidity draining
                   : 'STABLE';

  return {
    usdt_supply_usd: usdtSupply,
    usdc_supply_usd: usdcSupply,
    total_usd:       totalUSD,
    delta_7d_usd:    delta7d,
    delta_7d_pct:    delta7dPct != null ? parseFloat(delta7dPct) : null,
    regime,
    date:            today,
    prev_date:       prevDate,
  };
}

// ── Write cache to public/dune_cache.json ─────────────────────────────────────
function writeCache(payload) {
  mkdirSync(join(__dirname, 'public'), { recursive: true });
  const out = {
    ...payload,
    mvrv_query_id:   _queryId,
    exflow_query_id: _exflowQid,
    cachedAt: new Date().toISOString(),
  };
  writeFileSync(CACHE_FILE, JSON.stringify(out, null, 2));
  console.log(`[Worker] ✓ Cache written → ${CACHE_FILE}`);
  if (payload.mvrv) console.log(`[Worker]   MVRV: ${payload.mvrv.mvrv?.toFixed(3)}  |  cachedAt: ${out.cachedAt}`);
  if (payload.exchangeFlow) {
    const ef = payload.exchangeFlow;
    console.log(`[Worker]   ExFlow: Net ${(ef.netflow_btc || 0).toFixed(0)} BTC  |  In: ${(ef.inflow_btc || 0).toFixed(0)}  |  Out: ${(ef.outflow_btc || 0).toFixed(0)}  |  Addrs: ${ef.exchange_addr_count ?? '?'}`);
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────
async function runFetch() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[Worker] Run started — ${new Date().toISOString()}`);
  const payload = {};

  // ── Farside ETF Flows — FIRST (fast, ~15s, instant feedback) ─────────────
  // Run before Dune queries so you see the result immediately without waiting
  // for MVRV (which can take 2–10min). Non-fatal if Playwright not installed.
  try {
    const etfData = await fetchFarsidePlaywright();
    if (etfData) {
      payload.etfFlow = etfData;
      const sign = etfData.total_million_usd >= 0 ? '+' : '';
      console.log(`[Farside] ✓  ETF net flow: ${sign}${etfData.total_million_usd}M USD  (${etfData.date})`);
    }
  } catch (e) {
    console.error('[Farside] ✗ (non-fatal):', e.message);
    if (e.message.includes('not installed')) {
      console.error('[Farside] Fix: cd "BTC Brief Mac" && npm install && npx playwright install chromium');
    }
  }

  // ── BMP LTH Net Position Change ───────────────────────────────────────────
  try {
    const lthData = await fetchBMPLTHData();
    if (lthData) {
      payload.lthData = lthData;
      const sign = lthData.lth_net_btc >= 0 ? '+' : '';
      console.log(`[BMP] ✓  LTH net position: ${sign}${lthData.lth_net_btc.toLocaleString()} BTC  (${lthData.date})`);
    }
  } catch (e) {
    console.error('[BMP] ✗ (non-fatal):', e.message);
  }

  // ── Stablecoin Supply (CoinGecko free — ~2s) ─────────────────────────────
  try {
    const stableData = await fetchStablecoinSupply();
    if (stableData) {
      payload.stablecoinSupply = stableData;
      const totalB = (stableData.total_usd / 1e9).toFixed(1);
      const delta  = stableData.delta_7d_usd != null
        ? ` | 7d: ${stableData.delta_7d_usd >= 0 ? '+' : ''}${(stableData.delta_7d_usd / 1e9).toFixed(1)}B`
        : ' | 7d: first snapshot';
      console.log(`[Stable] ✓  USDT+USDC: $${totalB}B  |  Regime: ${stableData.regime}${delta}`);
    }
  } catch (e) {
    console.error('[Stable] ✗ (non-fatal):', e.message);
  }

  // Write cache now so Farside + BMP + Stablecoin data is available immediately,
  // without waiting for MVRV (which can take 2–10 min).
  writeCache(payload);

  // ── MVRV ──────────────────────────────────────────────────────────────────
  try {
    const queryId = await getOrCreateQueryId();
    console.log(`[MVRV] Triggering execution on query ${queryId}...`);
    const exec = await dunePost(`/api/v1/query/${queryId}/execute`, {});
    if (!exec.execution_id) throw new Error('No execution_id: ' + JSON.stringify(exec));
    console.log(`[MVRV] Execution: ${exec.execution_id}  (polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_WAIT_MS / 60_000}min)`);
    const data  = await pollExecution(exec.execution_id, 'MVRV');
    const mvrv  = parseMvrv(data);
    if (mvrv) {
      payload.mvrv = mvrv;
      console.log(`[MVRV] ✓  ratio: ${mvrv.mvrv.toFixed(3)}  |  realized: $${Math.round(mvrv.realizedPrice || 0).toLocaleString()}`);
    } else {
      console.warn('[MVRV] Execution completed but result parse returned null');
      payload.mvrv_error = 'Execution succeeded but no valid row returned';
    }
  } catch (e) {
    console.error('[MVRV] ✗', e.message);
    payload.mvrv_error = e.message;
    // On timeout: carry forward the last cached MVRV so the brief still has a value
    try {
      if (existsSync(CACHE_FILE)) {
        const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
        if (prev.mvrv?.mvrv) {
          payload.mvrv = { ...prev.mvrv, stale: true };
          console.warn(`[MVRV] Using cached value from ${prev.cachedAt}: ${prev.mvrv.mvrv.toFixed(3)} (stale)`);
        }
      }
    } catch (_) {}
  }

  // ── Exchange Flows ─────────────────────────────────────────────────────────
  try {
    const exQid = await getOrCreateExflowQueryId();
    console.log(`[ExFlow] Triggering execution on query ${exQid}...`);
    const exec2 = await dunePost(`/api/v1/query/${exQid}/execute`, {});
    if (!exec2.execution_id) throw new Error('No execution_id: ' + JSON.stringify(exec2));
    console.log(`[ExFlow] Execution: ${exec2.execution_id}  (max 5min)`);
    const data2 = await pollExecution(exec2.execution_id, 'ExFlow', 300_000);
    const ef    = parseExchangeFlow(data2);
    if (ef) {
      payload.exchangeFlow = ef;
      console.log(`[ExFlow] ✓  Net: ${(ef.netflow_btc || 0).toFixed(0)} BTC | In: ${(ef.inflow_btc || 0).toFixed(0)} | Out: ${(ef.outflow_btc || 0).toFixed(0)} | Addrs: ${ef.exchange_addr_count ?? '?'}`);
    } else {
      console.warn('[ExFlow] No valid row returned');
    }
  } catch (e) {
    console.error('[ExFlow] ✗ (non-fatal):', e.message);
    if (e.message.includes('address')) {
      console.error('[ExFlow] Likely cause: bitcoin.outputs has no "address" column on this Dune plan.');
    }
  }

  writeCache(payload);
}

// ── Entry ─────────────────────────────────────────────────────────────────────
const watchMode      = process.argv.includes('--watch');
const schemaMode     = process.argv.includes('--schema');
const schemaExflow   = process.argv.includes('--schema-exflow');

if (schemaMode) {
  // npm run dune:schema  →  probe bitcoin.outputs/inputs column names
  probeSchema()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[Schema] Fatal:', e.message); process.exit(1); });
} else if (schemaExflow) {
  // npm run dune:schema-exflow  →  probe columns needed for exchange flow query
  probeExflowSchema()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[Schema] Fatal:', e.message); process.exit(1); });
} else if (watchMode) {
  console.log(`[Worker] Watch mode — refresh every ${REFRESH_HOURS}h`);
  runFetch();
  setInterval(runFetch, REFRESH_HOURS * 3_600_000);
} else {
  runFetch()
    .then(() => { console.log('[Worker] Done.'); process.exit(0); })
    .catch((e) => { console.error('[Worker] Fatal:', e.message); process.exit(1); });
}
