#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// data-worker.js  —  BTC Morning Brief · Background Data Aggregator
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for ALL non-Claude data fetching. Runs on a 6h cron
// (via .github/workflows/data-refresh.yml) and writes public/all_data.json.
//
// brief-worker.js consumes this file, builds the Claude prompt, and writes back
// only `brief` + `briefCachedAt`. Anthropic billing window stays minimal —
// every fetch in this file is FREE (no Anthropic call).
//
// Usage:
//   node data-worker.js            # run once, then exit
//   node data-worker.js --watch    # run once, then refresh every 6 hours
//   node data-worker.js --schema   # probe Dune table column names
//
// What lives here:
//   • Dune MVRV + Exchange flow (when quota allows)
//   • Farside ETF flows (Playwright)
//   • Bitcoin Magazine Pro LTH supply (Playwright)
//   • DefiLlama / CoinGecko stablecoin supply
//   • blockchain.info exchange-balance delta (Dune-free fallback)
//   • Binance 24h taker pressure (via Cloudflare Worker /whale)
//   • BTC price / F&G / funding / OI / gold / dominance (multi-source)
//   • SMA200/50/20 + 60d BTC-QQQ correlation on returns
//   • Deribit options skew
//   • DXY / VIX / 10Y yield (Yahoo → Stooq → Treasury XML / FRED)
//   • CME futures basis (Yahoo BTC=F → OKX quarterly)
//   • CoinMetrics community API (network health + MVRV fallback)
//
// Renamed from dune-worker.js on 2026-04-25 as part of the lean refactor.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname }                                                     from 'path';
import { fileURLToPath }                                                     from 'url';
import { classifyRegime, applyRegimeToAnchors }                              from './scripts/regime_check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 10_000;   // 10s between Dune status polls
const MAX_WAIT_MS      = 600_000;  // 10 minutes max wait per Dune query
const REFRESH_HOURS    = 6;        // how often --watch re-runs
const CACHE_FILE       = join(__dirname, 'public', 'all_data.json');
const DUNE_BASE        = 'https://api.dune.com';
const WORKER_URL       = 'https://btc-brief.joel-toe.workers.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WORKER_VERSION   = '3.0.0';  // Lean refactor — single all_data.json output

// ── Load .env (VITE_ prefix, no dotenv dependency needed) ────────────────────
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.warn('[Worker] .env not found — Dune calls will be skipped');
    return {};
  }
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

const ENV          = loadEnv();
const DUNE_API_KEY = ENV.VITE_DUNE_API_KEY;
if (!DUNE_API_KEY) console.warn('[Worker] VITE_DUNE_API_KEY missing — Dune-dependent fetches will be skipped');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Exchange Flow SQL ─────────────────────────────────────────────────────────
const EXCHANGE_FLOW_SQL = `WITH
  exchange_addrs(address, exchange) AS (
    VALUES
      ('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',       'Binance'),
      ('bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h','Binance'),
      ('1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ',       'Binance'),
      ('3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6',       'Binance'),
      ('3LYJfcfHHeihJD2R9cFoHbDoNS5ScBEV3G',       'Binance'),
      ('bc1qd9algxdprz43rdj3fdlhsad94zsp8prk46x5n0','Binance'),
      ('3FupZp77ySr7jwoLYEJ9Ro4rakoBZPDhBY',       'Coinbase'),
      ('3Cbq7aT1tY8kMxWLBkgmdar1Hz4HniFDz7',       'Coinbase'),
      ('17XBj6iFEsf8kzDMGQk5ghZewDa3zKKbT6',       'Coinbase'),
      ('1LPH7kHa1KAuyMKcRJKXnmNTSBXVFoGPMF',       'Coinbase'),
      ('3AfP9nFSMRNMk9MkgVsmKG9sL2PGYQ9Lfr',       'Kraken'),
      ('39YnSQwjhKBUEQ1FHXKqMYKETJhU4FZVRJ',       'Kraken'),
      ('3HMJz7S4WFQcmE6FHWy7LE1TzLn59pSG5z',       'Kraken'),
      ('3D2oetdNuZUqQHPJmcMDDHYoqkyNVsFk9r',       'Bitfinex'),
      ('1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx',       'Bitfinex'),
      ('3LQUu4v9z6KNch71j7kbj8GPeAGUo1FW6a',       'OKX'),
      ('bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6','OKX'),
      ('bc1qek8tszgprq8tkwj7h2y3bvkl4jm9q2yfntrh0e','Bybit'),
      ('3BtxkGjCg37dBaLQc3P3M76bV5VFqyXyY4',       'Gemini'),
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
const MVRV_SQL = `WITH utxos AS (
  SELECT
    o.block_date                              AS creation_date,
    SUM(CAST(o.value AS DOUBLE))               AS btc_amount
  FROM bitcoin.outputs o
  LEFT JOIN bitcoin.inputs i
    ON  i.spent_tx_id        = o.tx_id
    AND i.spent_output_number = o.index
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

// ── Dune HTTP helpers ─────────────────────────────────────────────────────────
const DUNE_HEADERS = DUNE_API_KEY
  ? { 'x-dune-api-key': DUNE_API_KEY, 'Content-Type': 'application/json' }
  : null;

async function duneGet(path) {
  if (!DUNE_HEADERS) throw new Error('DUNE_API_KEY missing');
  const res = await fetch(DUNE_BASE + path, { headers: DUNE_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} GET ${path}`);
  return res.json();
}
async function dunePost(path, body = {}) {
  if (!DUNE_HEADERS) throw new Error('DUNE_API_KEY missing');
  const res = await fetch(DUNE_BASE + path, { method: 'POST', headers: DUNE_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status} POST ${path}`);
  return res.json();
}

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

const _ids       = loadCachedIds();
let _queryId     = _ids.mvrv;
let _exflowQid   = _ids.exflow;

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
    description: 'Daily BTC inflow/outflow for labeled exchange addresses',
    query_sql: EXCHANGE_FLOW_SQL,
    is_private: false,
    parameters: [],
  });
  if (!res.query_id) throw new Error('No query_id in create response: ' + JSON.stringify(res));
  _exflowQid = String(res.query_id);
  console.log(`[ExFlow] Query created → id: ${_exflowQid}`);
  return _exflowQid;
}

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

// ── Schema probe (npm run data:schema / data:schema-exflow) ───────────────────
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
async function probeExflowSchema() {
  await runProbe('bitcoin.outputs.address check', 'SELECT address FROM bitcoin.outputs LIMIT 1');
  await runProbe('bitcoin.inputs.block_date check', 'SELECT block_date FROM bitcoin.inputs LIMIT 1');
  await runProbe('labels.addresses (bitcoin cex)', `
    SELECT COUNT(*) AS n_addrs, COUNT(DISTINCT address) AS n_unique
    FROM labels.addresses
    WHERE blockchain = 'bitcoin'
      AND (category IN ('cex', 'exchange', 'centralized exchange') OR label_type IN ('cex', 'exchange'))
  `);
}

// ── Parse Dune row helpers ────────────────────────────────────────────────────
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

function parseExchangeFlow(data) {
  const row = data?.result?.rows?.[0];
  if (!row) return null;
  const inflow  = row.inflow_btc  != null ? parseFloat(row.inflow_btc)  : null;
  const outflow = row.outflow_btc != null ? parseFloat(row.outflow_btc) : null;
  const netflow = row.netflow_btc != null ? parseFloat(row.netflow_btc) : null;
  const n_addrs = row.exchange_addr_count != null ? parseInt(row.exchange_addr_count) : null;
  const gross = (inflow || 0) + (outflow || 0);
  if (gross < 100 && n_addrs != null && n_addrs < 10) {
    console.warn(`[ExFlow] Very few labeled addresses (${n_addrs}) — coverage may be minimal`);
  }
  return { inflow_btc: inflow, outflow_btc: outflow, netflow_btc: netflow,
           exchange_addr_count: n_addrs, day: row.day || null };
}

// ── Farside ETF flows via Playwright ──────────────────────────────────────────
async function fetchFarsidePlaywright() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (_) { throw new Error('playwright not installed — run: npm install && npx playwright install chromium'); }

  console.log('[Farside] Launching headless Chrome via Playwright...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ headless: true }));

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    console.log('[Farside] Navigating to farside.co.uk/btc/ ...');
    await page.goto('https://farside.co.uk/btc/', { waitUntil: 'domcontentloaded', timeout: 45000 });

    await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 30000 })
      .catch(() => console.warn('[Farside] Cloudflare title-wait timed out'));
    await page.waitForSelector('table', { timeout: 20000 })
      .catch(() => console.warn('[Farside] No <table> found within 20s'));
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log(`[Farside] Page title: "${title}"`);
    if (title.includes('Just a moment') || title.includes('Attention Required')) {
      throw new Error('Cloudflare challenge not resolved — try: npx playwright install chrome');
    }

    const etfData = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      for (const table of tables) {
        const headerRow = table.querySelector('tr');
        if (!headerRow) continue;
        const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
        const totalIdx = headerCells.findIndex(el => el.textContent.trim().toUpperCase() === 'TOTAL');
        if (totalIdx < 0) continue;
        const rows = Array.from(table.querySelectorAll('tr'));
        const SKIP = ['total', 'average', 'maximum', 'minimum', 'fee', 'ytd'];
        for (let i = rows.length - 1; i >= 1; i--) {
          const cells = Array.from(rows[i].querySelectorAll('td'));
          if (cells.length <= totalIdx) continue;
          const dateText = cells[0]?.textContent.trim();
          if (!dateText || dateText.length < 3) continue;
          if (SKIP.includes(dateText.toLowerCase())) continue;
          if (!/\d/.test(dateText)) continue;
          const totalText = cells[totalIdx]?.textContent.trim();
          if (!totalText || totalText === '-' || totalText === '') continue;
          const cleaned = totalText.replace(/,/g, '').replace(/\s/g, '').replace(/\(([^)]+)\)/, '-$1');
          const parsed = parseFloat(cleaned);
          if (!isNaN(parsed)) {
            if (parsed === 0) continue;
            return { total_million_usd: parsed, date: dateText };
          }
        }
      }
      return {
        _debug: true,
        tableCount: tables.length,
        firstTableHeaders: tables[0]
          ? Array.from(tables[0].querySelectorAll('th, tr:first-child td')).map(el => el.textContent.trim()).slice(0, 10)
          : [],
      };
    });

    if (!etfData) { console.warn('[Farside] page.evaluate returned null'); return null; }
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
async function fetchBMPLTHData() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (_) { throw new Error('playwright not installed — run: npm install && npx playwright install chromium'); }

  console.log('[BMP] Launching headless Chrome via Playwright...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ headless: true }));

  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'America/New_York' });
    const page = await context.newPage();
    console.log('[BMP] Navigating to long-term-holder-supply chart...');
    await page.goto('https://www.bitcoinmagazinepro.com/charts/long-term-holder-supply/', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });

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
      const lthTrace = traces.find(t => t.name && t.name.toLowerCase().includes('long term holder'))
        || traces.find(t => t.yaxis === 'y2') || traces[1];
      if (!lthTrace) return { _err: 'LTH trace not found', traceNames: traces.map(t => t.name) };
      const xs = lthTrace.x;
      const ys = lthTrace.y;
      if (!xs || !ys || xs.length < 2) return { _err: 'insufficient data points' };
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
        lth_net_btc:     netChange,
        date:            todayDate.slice(0, 10),
        prev_date:       prevDate.slice(0, 10),
        source_url:      'https://www.bitcoinmagazinepro.com/charts/long-term-holder-supply/',
      };
    });

    if (result._err) { console.warn('[BMP] Extraction failed:', result._err, result); return null; }
    return result;
  } finally {
    await browser.close();
  }
}

// ── Exchange Flow via blockchain.info (Dune-quota-free) ──────────────────────
const EXCHANGE_ADDRS_LEGACY = [
  '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
  '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ',
  '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6',
  '3LYJfcfHHeihJD2R9cFoHbDoNS5ScBEV3G',
  '3FupZp77ySr7jwoLYEJ9Ro4rakoBZPDhBY',
  '3Cbq7aT1tY8kMxWLBkgmdar1Hz4HniFDz7',
  '17XBj6iFEsf8kzDMGQk5ghZewDa3zKKbT6',
  '1LPH7kHa1KAuyMKcRJKXnmNTSBXVFoGPMF',
  '3AfP9nFSMRNMk9MkgVsmKG9sL2PGYQ9Lfr',
  '39YnSQwjhKBUEQ1FHXKqMYKETJhU4FZVRJ',
  '3HMJz7S4WFQcmE6FHWy7LE1TzLn59pSG5z',
  '3D2oetdNuZUqQHPJmcMDDHYoqkyNVsFk9r',
  '1HQ3Go3ggs8pFnXuHVHRytPCq5fGG8Hbhx',
  '3LQUu4v9z6KNch71j7kbj8GPeAGUo1FW6a',
  '3BtxkGjCg37dBaLQc3P3M76bV5VFqyXyY4',
  '3NAVjK57yugfiLaJPnZJTdVFNqiYUVEcVU',
];

async function fetchExchangeFlowBlockchain() {
  let prevBalances = {}, prevCachedAt = null;
  try {
    if (existsSync(CACHE_FILE)) {
      const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      prevBalances = prev._exchangeAddressBalances || {};
      prevCachedAt = prev.cachedAt || null;
    }
  } catch (_) {}

  const url = `https://blockchain.info/balance?active=${EXCHANGE_ADDRS_LEGACY.join('|')}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`blockchain.info HTTP ${r.status}`);
  const data = await r.json();

  let currentBalances = {}, totalBTC = 0, prevTotalBTC = 0, addrCount = 0;
  for (const addr of EXCHANGE_ADDRS_LEGACY) {
    const sat = data[addr]?.final_balance;
    if (sat == null) continue;
    const btc = sat / 1e8;
    currentBalances[addr] = btc;
    totalBTC += btc;
    prevTotalBTC += prevBalances[addr] ?? btc;
    addrCount++;
  }

  const netflowBTC = parseFloat((totalBTC - prevTotalBTC).toFixed(4));
  const elapsedH = prevCachedAt
    ? Math.round((Date.now() - new Date(prevCachedAt).getTime()) / 3_600_000)
    : null;

  console.log(`[ExFlow/blockchain] Net: ${netflowBTC >= 0 ? '+' : ''}${netflowBTC.toFixed(2)} BTC | Total on-exchange: ${totalBTC.toFixed(0)} BTC | Addrs: ${addrCount} | Δ window: ${elapsedH ?? '?'}h`);

  return {
    netflow_btc:         netflowBTC,
    inflow_btc:          netflowBTC > 0 ? netflowBTC : 0,
    outflow_btc:         netflowBTC < 0 ? Math.abs(netflowBTC) : 0,
    total_exchange_btc:  parseFloat(totalBTC.toFixed(2)),
    exchange_addr_count: addrCount,
    elapsed_hours:       elapsedH,
    source:              'blockchain.info balance delta (16 legacy exchange addresses)',
    date:                new Date().toISOString().slice(0, 10),
    _currentBalances:    currentBalances,
  };
}

// ── Binance large block trades (local fallback only — Worker /whale preferred) ─
async function fetchBinanceLargeTrades() {
  const WHALE_THRESHOLD_BTC = 2;
  const url = 'https://api.binance.com/api/v3/aggTrades?symbol=BTCUSDT&limit=1000';
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Binance aggTrades HTTP ${r.status}`);
  const trades = await r.json();
  if (!Array.isArray(trades) || trades.length === 0) throw new Error('Empty aggTrades response');

  let whaleBuyBTC = 0, whaleSellBTC = 0, whaleBuys = 0, whaleSells = 0;
  let totalBTC = 0, totalTrades = trades.length;
  let firstTs = trades[0]?.T, lastTs = trades[trades.length - 1]?.T;

  for (const t of trades) {
    const qty  = parseFloat(t.q);
    const sell = t.m;
    totalBTC  += qty;
    if (qty >= WHALE_THRESHOLD_BTC) {
      if (sell) { whaleSells++; whaleSellBTC += qty; }
      else      { whaleBuys++;  whaleBuyBTC  += qty; }
    }
  }

  const netWhaleBTC = whaleBuyBTC - whaleSellBTC;
  const spanMinutes = firstTs && lastTs ? Math.round((lastTs - firstTs) / 60000) : null;
  const whaleRatio  = (whaleBuys + whaleSells) > 0
    ? parseFloat((whaleBuyBTC / (whaleBuyBTC + whaleSellBTC)).toFixed(3))
    : null;

  console.log(`[Binance/Whales] Buy: +${whaleBuyBTC.toFixed(1)} BTC (${whaleBuys}) | Sell: -${whaleSellBTC.toFixed(1)} BTC (${whaleSells}) | Net: ${netWhaleBTC >= 0 ? '+' : ''}${netWhaleBTC.toFixed(1)} BTC | span: ~${spanMinutes}min`);

  return {
    threshold_btc:    WHALE_THRESHOLD_BTC,
    whale_buy_btc:    parseFloat(whaleBuyBTC.toFixed(2)),
    whale_sell_btc:   parseFloat(whaleSellBTC.toFixed(2)),
    net_whale_btc:    parseFloat(netWhaleBTC.toFixed(2)),
    whale_buy_count:  whaleBuys,
    whale_sell_count: whaleSells,
    whale_buy_ratio:  whaleRatio,
    span_minutes:     spanMinutes,
    pressure:         netWhaleBTC > 50 ? 'BUY' : netWhaleBTC < -50 ? 'SELL' : 'NEUTRAL',
    source:           'Binance aggTrades (BTCUSDT, last 1000 trades)',
    date:             new Date().toISOString().slice(0, 10),
  };
}

// ── Stablecoin Supply — DefiLlama primary, CoinGecko fallback ────────────────
async function fetchStablecoinSupply() {
  const headers = { 'User-Agent': UA, 'Accept': 'application/json' };
  const today   = new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true',
      { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`DefiLlama HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.peggedAssets)) throw new Error('peggedAssets missing');

    const usdt = data.peggedAssets.find(a => a.symbol?.toUpperCase() === 'USDT');
    const usdc = data.peggedAssets.find(a => a.symbol?.toUpperCase() === 'USDC');
    if (!usdt || !usdc) throw new Error('USDT or USDC not found in peggedAssets');

    const usdtNow  = usdt.circulating?.peggedUSD         || 0;
    const usdcNow  = usdc.circulating?.peggedUSD         || 0;
    const usdtPrev = usdt.circulatingPrevWeek?.peggedUSD ?? null;
    const usdcPrev = usdc.circulatingPrevWeek?.peggedUSD ?? null;

    const totalNow  = usdtNow + usdcNow;
    const totalPrev = (usdtPrev != null && usdcPrev != null) ? usdtPrev + usdcPrev : null;
    const delta7d   = totalPrev != null ? totalNow - totalPrev : null;
    const delta7dPct = (delta7d != null && totalPrev > 0)
      ? parseFloat((delta7d / totalPrev * 100).toFixed(3))
      : null;

    const regime = delta7d == null ? 'STABLE'
                 : delta7d >  5e9  ? 'EXPANDING'
                 : delta7d < -5e9  ? 'CONTRACTING'
                 : 'STABLE';

    console.log(`[Stable] ✓ DefiLlama — USDT: $${(usdtNow/1e9).toFixed(1)}B | USDC: $${(usdcNow/1e9).toFixed(1)}B | 7d Δ: ${delta7d != null ? (delta7d >= 0 ? '+' : '') + (delta7d/1e9).toFixed(1) + 'B' : 'N/A'} | ${regime}`);

    return {
      usdt_supply_usd: usdtNow,
      usdc_supply_usd: usdcNow,
      total_usd:       totalNow,
      delta_7d_usd:    delta7d,
      delta_7d_pct:    delta7dPct,
      regime,
      date:            today,
      source:          'DefiLlama',
    };
  } catch (llamaErr) {
    console.warn(`[Stable] DefiLlama failed (${llamaErr.message}) — falling back to CoinGecko...`);
  }

  try {
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

    let prev7dTotal = null;
    try {
      if (existsSync(CACHE_FILE)) {
        const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
        if (prev.stablecoinSupply?.total_usd && prev.stablecoinSupply?.date) {
          const ageDays = (Date.now() - new Date(prev.stablecoinSupply.date).getTime()) / 86400000;
          if (ageDays >= 0.5 && ageDays <= 30) prev7dTotal = prev.stablecoinSupply.total_usd;
        }
      }
    } catch (_) {}

    const delta7d    = prev7dTotal != null ? totalUSD - prev7dTotal : null;
    const delta7dPct = (delta7d != null && prev7dTotal > 0)
      ? parseFloat((delta7d / prev7dTotal * 100).toFixed(3))
      : null;
    const regime = delta7d == null ? 'STABLE'
                 : delta7d >  5e9  ? 'EXPANDING'
                 : delta7d < -5e9  ? 'CONTRACTING'
                 : 'STABLE';

    console.log(`[Stable] ✓ CoinGecko (fallback) — USDT+USDC: $${(totalUSD/1e9).toFixed(1)}B | ${regime}`);

    return {
      usdt_supply_usd: usdtSupply,
      usdc_supply_usd: usdcSupply,
      total_usd:       totalUSD,
      delta_7d_usd:    delta7d,
      delta_7d_pct:    delta7dPct,
      regime,
      date:            today,
      source:          'CoinGecko',
    };
  } catch (cgErr) {
    console.warn(`[Stable] CoinGecko fallback also failed: ${cgErr.message}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Market data fetchers — transplanted from former brief-worker.js so every
// fetch happens BEFORE the Anthropic-billable window. The brief-worker now
// only loads all_data.json, builds the prompt, and calls Claude.
// ────────────────────────────────────────────────────────────────────────────

// ── Yahoo Finance helper ───────────────────────────────────────────────────────
async function yfetch(ticker, range = '5d') {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr;
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`Yahoo ${ticker} (${host}): HTTP ${res.status}`);
      return res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ── Stooq.com helper ───────────────────────────────────────────────────────────
async function stooqFetch(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&e=csv`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Stooq ${symbol}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error(`Stooq ${symbol}: no data rows`);
  const parts = lines[1].split(',');
  const close = parseFloat(parts[6]);
  const open  = parseFloat(parts[3]);
  if (!close || isNaN(close) || close <= 0) throw new Error(`Stooq ${symbol}: invalid price ${close}`);
  const change = (open > 0) ? parseFloat(((close - open) / open * 100).toFixed(2)) : null;
  return { price: close, change };
}

// ── Stooq historical CSV (for QQQ correlation) ─────────────────────────────────
async function stooqHistory(symbol, days = 90) {
  const to   = new Date(); const from = new Date(Date.now() - days * 86400000);
  const fmt  = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const url  = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${fmt(from)}&d2=${fmt(to)}&i=d`;
  const res  = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Stooq history ${symbol}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n').slice(1);
  const out = [];
  const dates = [];
  for (const l of lines) {
    const parts = l.split(',');
    const date  = (parts[0] || '').trim();
    const close = parseFloat(parts[4]);
    if (date && close > 0) { out.push(close); dates.push(date); }
  }
  out.dates = dates;
  return out;
}

function yfExtract(json) {
  const meta   = json?.chart?.result?.[0]?.meta;
  const qdata  = json?.chart?.result?.[0]?.indicators?.quote?.[0];
  const closes = (qdata?.close || []).filter(v => v != null);
  const price  = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
  const prev   = closes.length >= 2 ? closes[closes.length - 2] : null;
  const change = (price && prev && prev !== 0)
    ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : null;
  return { price, change, meta, closes };
}

// ── Live BTC market snapshot ─────────────────────────────────────────────────
async function fetchMarketSnapshot() {
  const out = {};

  const priceSources = [
    async () => {
      const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = await r.json();
      return { price: parseFloat(s.lastPrice), change24h: parseFloat(s.priceChangePercent),
               volume24hUSD: parseFloat(s.quoteVolume) * 2.6, marketCap: parseFloat(s.lastPrice) * 20000000, priceSource: 'Binance' };
    },
    async () => {
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const t = d.result?.XXBTZUSD;
      const price = parseFloat(t?.c?.[0]);
      if (!price) throw new Error('no price');
      const open24h    = parseFloat(t?.o);
      const vol24hBTC  = parseFloat(t?.v?.[1]);
      const change24h  = (open24h > 0) ? parseFloat(((price - open24h) / open24h * 100).toFixed(2)) : null;
      const volume24hUSD = (vol24hBTC > 0) ? vol24hBTC * price : null;
      return { price, change24h, volume24hUSD, marketCap: price * 20000000, priceSource: 'Kraken' };
    },
    async () => {
      const r = await fetch('https://api.coincap.io/v2/assets/bitcoin', { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const price = parseFloat(d.data?.priceUsd);
      if (!price) throw new Error('no price');
      return { price, change24h: parseFloat(d.data?.changePercent24Hr), volume24hUSD: parseFloat(d.data?.volumeUsd24Hr),
               marketCap: parseFloat(d.data?.marketCapUsd), priceSource: 'CoinCap' };
    },
    async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true', { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return { price: d.bitcoin.usd, change24h: d.bitcoin.usd_24h_change,
               volume24hUSD: d.bitcoin.usd_24h_vol, marketCap: d.bitcoin.usd_market_cap, priceSource: 'CoinGecko' };
    },
  ];
  for (const src of priceSources) {
    try {
      const result = await src();
      if (!result.price || isNaN(result.price) || result.price <= 0) {
        console.warn(`[Market] ${result.priceSource} returned invalid price (${result.price}) — trying next source`);
        continue;
      }
      Object.assign(out, result);
      console.log(`[Market] BTC: $${out.price.toLocaleString()} via ${out.priceSource} (${out.change24h != null ? (out.change24h > 0 ? '+' : '') + out.change24h.toFixed(2) + '% 24h' : 'change n/a'})`);
      break;
    } catch (e) { console.warn(`[Market] ${e.message} — trying next source`); }
  }
  if (!out.price) console.warn('[Market] All price sources failed');

  // Fear & Greed
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=7', { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    out.fearGreedValue = parseInt(d.data[0].value, 10);
    out.fearGreedLabel = d.data[0].value_classification;
    out.fearGreed7d    = d.data.map(x => parseInt(x.value, 10));
    console.log(`[Market] Fear & Greed: ${out.fearGreedValue} (${out.fearGreedLabel})`);
  } catch (e) { console.warn('[Market] F&G failed:', e.message); }

  // Funding rate (Binance fapi → Bybit → OKX)
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8',
      { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    out.fundingRate = parseFloat(d[d.length - 1].fundingRate);
    out.fundingSource = 'Binance';
    console.log(`[Market] Funding: ${(out.fundingRate * 100).toFixed(4)}% per 8h`);
  } catch (e) {
    console.warn('[Market] Binance funding failed:', e.message);
    try {
      const r2 = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      const t = d2?.result?.list?.[0];
      if (t?.fundingRate) { out.fundingRate = parseFloat(t.fundingRate); out.fundingSource = 'Bybit'; console.log(`[Market] Funding (Bybit): ${(out.fundingRate*100).toFixed(4)}%`); }
      const bybitOI = parseFloat(t?.openInterest);
      if (bybitOI > 0 && !out.openInterest) {
        out.openInterest    = bybitOI;
        out.openInterestUSD = bybitOI * (out.price || 80000);
        console.log(`[Market] OI (Bybit): ${bybitOI.toFixed(0)} BTC`);
      }
    } catch (e2) {
      try {
        const r3 = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', { signal: AbortSignal.timeout(8000) });
        const d3 = await r3.json();
        const fr = d3?.data?.[0]?.fundingRate;
        if (fr) { out.fundingRate = parseFloat(fr); out.fundingSource = 'OKX'; console.log(`[Market] Funding (OKX): ${(out.fundingRate*100).toFixed(4)}%`); }
      } catch (e3) { console.warn('[Market] All funding sources failed'); }
    }
  }

  // Open Interest
  const OI_MIN = 5_000, OI_MAX = 500_000;
  const validateOI = (v) => v && isFinite(v) && v >= OI_MIN && v <= OI_MAX;
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const oi = parseFloat(d.openInterest);
    if (!validateOI(oi)) throw new Error(`Binance OI out of range: ${oi}`);
    out.openInterest    = oi;
    out.openInterestUSD = oi * (out.price || 80000);
    console.log(`[Market] OI (Binance): ${oi.toFixed(0)} BTC`);
  } catch (e) {
    console.warn('[Market] Binance OI failed:', e.message);
    try {
      const r2 = await fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=1',
        { signal: AbortSignal.timeout(8000) });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      const d2 = await r2.json();
      const oi = parseFloat(d2?.result?.list?.[0]?.openInterest);
      if (!validateOI(oi)) throw new Error(`Bybit OI out of range: ${oi}`);
      out.openInterest    = oi;
      out.openInterestUSD = oi * (out.price || 80000);
      console.log(`[Market] OI (Bybit): ${oi.toFixed(0)} BTC`);
    } catch (e2) {
      console.warn('[Market] Bybit OI failed:', e2.message);
      const okxAttempts = [
        { url: 'https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP', label: 'OKX instId USDT' },
        { url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', label: 'OKX SWAP+USDT' },
        { url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&uly=BTC-USDT', label: 'OKX uly BTC-USDT' },
        { url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USD-SWAP', label: 'OKX SWAP+USD' },
      ];
      let okxSet = false;
      for (const attempt of okxAttempts) {
        if (okxSet) break;
        try {
          const r3 = await fetch(attempt.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
          if (!r3.ok) throw new Error(`HTTP ${r3.status}`);
          const d3 = await r3.json();
          const row = d3?.data?.[0];
          if (!row) throw new Error('empty data array');
          let oi = row.oiCcy ? parseFloat(row.oiCcy) : null;
          if (!validateOI(oi) && row.oi) {
            const oiContracts = parseFloat(row.oi);
            const oiVia01 = oiContracts * 0.01;
            if (validateOI(oiVia01)) {
              oi = oiVia01;
              console.log(`[Market] OI (${attempt.label}) via oi×0.01: ${oi.toFixed(0)} BTC`);
            }
          }
          if (!validateOI(oi)) throw new Error(`OI out of range: oiCcy=${row.oiCcy} oi=${row.oi}`);
          out.openInterest    = oi;
          out.openInterestUSD = oi * (out.price || 80000);
          console.log(`[Market] OI (${attempt.label}): ${oi.toFixed(0)} BTC`);
          okxSet = true;
        } catch (e3) {
          console.warn(`[Market] OI ${attempt.label} failed:`, e3.message);
        }
      }
      if (!okxSet) console.warn('[Market] All OI sources failed — openInterest will be null');
    }
  }

  // Gold — CoinGecko PAXG → Kraken XAU/USD → Binance PAXG
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const gp = d?.['pax-gold']?.usd;
    if (gp && gp > 0) {
      out.goldPrice     = gp;
      out.goldChange24h = d?.['pax-gold']?.usd_24h_change ?? null;
      if (out.price) out.btcGoldRatio = parseFloat((out.price / gp).toFixed(2));
      console.log(`[Market] Gold (CoinGecko PAXG): $${gp.toLocaleString()}`);
    } else throw new Error('no price');
  } catch (e) {
    console.warn('[Market] Gold (CoinGecko) failed:', e.message);
    try {
      const r2 = await fetch('https://api.kraken.com/0/public/Ticker?pair=XAUUSD', { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      const t2 = d2.result?.XXAUZUSD || d2.result?.XAUUSD || Object.values(d2.result || {}).find(v => typeof v === 'object' && v?.c);
      const gp = t2 ? parseFloat(t2.c?.[0]) : NaN;
      if (gp > 0) {
        const gOpen = parseFloat(t2?.o);
        out.goldPrice     = gp;
        out.goldChange24h = gOpen > 0 ? parseFloat(((gp - gOpen) / gOpen * 100).toFixed(2)) : null;
        if (out.price) out.btcGoldRatio = parseFloat((out.price / gp).toFixed(2));
        console.log(`[Market] Gold (Kraken XAU/USD): $${gp.toLocaleString()}`);
      } else throw new Error(`invalid price: ${gp}`);
    } catch (e2) {
      console.warn('[Market] Gold (Kraken) failed:', e2.message);
      try {
        const r3 = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', { signal: AbortSignal.timeout(8000) });
        const d3 = await r3.json();
        const gp3 = parseFloat(d3.lastPrice);
        if (gp3 > 0) {
          out.goldPrice     = gp3;
          out.goldChange24h = parseFloat(d3.priceChangePercent);
          if (out.price) out.btcGoldRatio = parseFloat((out.price / gp3).toFixed(2));
          console.log(`[Market] Gold (Binance PAXG): $${gp3.toLocaleString()}`);
        }
      } catch (e3) { console.warn('[Market] Gold all sources failed'); }
    }
  }

  // BTC dominance
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const pct = d?.data?.market_cap_percentage?.btc;
    if (pct) out.btcDominance = parseFloat(pct.toFixed(1));
  } catch (e) { console.warn('[Market] Dominance failed:', e.message); }

  return out;
}

// ── 200-day candles → SMAs + QQQ correlation ──────────────────────────────────
async function fetchTechnicalData() {
  let closes = null, volumes = null;
  let btcDates = [];
  const tsToDate = ms => new Date(ms).toISOString().slice(0, 10);

  try {
    const since = Math.floor((Date.now() - 210 * 86400 * 1000) / 1000);
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=${since}`,
      { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error && d.error.length) throw new Error(`Kraken error: ${d.error[0]}`);
    const rows = d.result?.XXBTZUSD || d.result?.XBTZUSD || [];
    if (!rows.length) throw new Error('empty candle array');
    closes = []; volumes = []; btcDates = [];
    for (const row of rows) {
      const c = parseFloat(row[4]); const v = parseFloat(row[6]);
      if (!(c > 0)) continue;
      closes.push(c);
      volumes.push(v >= 0 ? v : 0);
      btcDates.push(tsToDate(parseInt(row[0], 10) * 1000));
    }
    console.log(`[Tech] Kraken candles: ${closes.length} days (last date: ${btcDates[btcDates.length - 1]})`);
  } catch (e) {
    console.warn('[Tech] Kraken candles failed:', e.message);
    try {
      const r2 = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200',
        { signal: AbortSignal.timeout(12000) });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      const d2 = await r2.json();
      closes = []; volumes = []; btcDates = [];
      for (const row of d2) {
        const c = parseFloat(row[4]); const v = parseFloat(row[5]);
        if (!(c > 0)) continue;
        closes.push(c);
        volumes.push(v >= 0 ? v : 0);
        btcDates.push(tsToDate(parseInt(row[0], 10)));
      }
      console.log(`[Tech] Binance candles: ${closes.length} days (last date: ${btcDates[btcDates.length - 1]})`);
    } catch (e2) {
      console.warn('[Tech] Binance candles failed:', e2.message);
      return null;
    }
  }
  if (!closes || closes.length < 20) { console.warn('[Tech] Not enough candles'); return null; }

  const sma = (arr, n) => { const sl = arr.slice(-n); return sl.length < n ? null : sl.reduce((a,b) => a+b, 0)/n; };
  const sma200 = sma(closes, 200), sma50 = sma(closes, 50), sma20 = sma(closes, 20);

  // QQQ correlation on RETURNS (not levels) over 60 trading days
  let btcQqqCorr = null, corrWindow = 0;
  const btcByDate = {};
  for (let i = 0; i < btcDates.length; i++) btcByDate[btcDates[i]] = closes[i];

  const correlateOnReturns = (qqqDates, qqqCloseArr, sourceLabel) => {
    const paired = [];
    for (let i = 0; i < qqqDates.length; i++) {
      const dt = qqqDates[i]; const qc = qqqCloseArr[i];
      const bc = btcByDate[dt];
      if (dt && qc != null && !isNaN(qc) && bc != null) paired.push({ dt, bc, qc });
    }
    paired.sort((a, b) => a.dt < b.dt ? -1 : a.dt > b.dt ? 1 : 0);
    const WINDOW_RETURNS = 60;
    const window = paired.slice(-(WINDOW_RETURNS + 1));
    if (window.length < 21) return { corr: null, n: 0 };
    const btcRet = [], qqqRet = [];
    for (let i = 1; i < window.length; i++) {
      btcRet.push((window[i].bc - window[i - 1].bc) / window[i - 1].bc);
      qqqRet.push((window[i].qc - window[i - 1].qc) / window[i - 1].qc);
    }
    const n = btcRet.length;
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const mB = mean(btcRet), mQ = mean(qqqRet);
    let num = 0, dB = 0, dQ = 0;
    for (let i = 0; i < n; i++) {
      const db = btcRet[i] - mB, dq = qqqRet[i] - mQ;
      num += db * dq; dB += db * db; dQ += dq * dq;
    }
    const corr = (dB > 0 && dQ > 0) ? parseFloat((num / Math.sqrt(dB * dQ)).toFixed(2)) : null;
    const firstDt = window[0].dt, lastDt = window[window.length - 1].dt;
    console.log(`[Tech] BTC-QQQ corr (${sourceLabel}, returns, ${n} trading days, ${firstDt}→${lastDt}): ${corr}`);
    return { corr, n };
  };

  try {
    const qqqRes = await yfetch('QQQ', '120d');
    const result0 = qqqRes?.chart?.result?.[0];
    const timestamps = result0?.timestamp || [];
    const closeArr   = result0?.indicators?.quote?.[0]?.close || [];
    const qqqDates   = timestamps.map(t => tsToDate(t * 1000));
    const { corr, n } = correlateOnReturns(qqqDates, closeArr, 'Yahoo');
    btcQqqCorr = corr; corrWindow = n;
  } catch (e) {
    console.warn('[Tech] QQQ corr (Yahoo) failed:', e.message);
    try {
      const qqqCloses = await stooqHistory('qqq.us', 120);
      const { corr, n } = correlateOnReturns(qqqCloses.dates || [], qqqCloses, 'Stooq');
      btcQqqCorr = corr; corrWindow = n;
    } catch (e2) { console.warn('[Tech] QQQ corr (Stooq) failed:', e2.message); }
  }

  const avgVol5d  = volumes.slice(-5).reduce((a,b)  => a+b, 0) / 5;
  const avgVol20d = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
  const volTrendRatio = avgVol20d > 0 ? avgVol5d / avgVol20d : null;
  const volTrend = !volTrendRatio ? 'UNKNOWN' : volTrendRatio > 1.2 ? 'RISING' : volTrendRatio < 0.8 ? 'FALLING' : 'STABLE';

  // High in the available candle window. Used by the phase-anchor logic in
  // writeCache — combined with a monotonic "rolling ATH" carried across runs
  // via prev.phaseAnchors.derivedFrom.ath, this gives Phase D a sensible
  // upper-bound source even though we don't have a true ATH feed.
  const cycleHigh = closes.length ? Math.round(Math.max(...closes)) : null;

  console.log(`[Tech] 200d SMA: $${sma200 ? Math.round(sma200).toLocaleString() : 'n/a'} | BTC-QQQ: ${btcQqqCorr} | VolTrend: ${volTrend} | cycleHigh: $${cycleHigh ? cycleHigh.toLocaleString() : 'n/a'}`);
  return {
    sma200: sma200 ? Math.round(sma200) : null,
    sma50:  sma50  ? Math.round(sma50)  : null,
    sma20:  sma20  ? Math.round(sma20)  : null,
    candleCount: closes.length,
    cycleHigh,                                     // max close in window (~200d)
    avgVol5d: Math.round(avgVol5d), avgVol20d: Math.round(avgVol20d),
    volTrendRatio: volTrendRatio ? parseFloat(volTrendRatio.toFixed(2)) : null,
    volTrend, btcQqqCorr, corrWindow,
  };
}

// ── Options skew (Deribit) ─────────────────────────────────────────────────────
async function fetchOptionsSkew(spotPrice) {
  try {
    const r = await fetch('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
      { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    if (!d?.result?.length) throw new Error('no options data');
    const now = Date.now(), spot = spotPrice || 80000;
    let near = d.result.filter(o => { const t = o.expiration_timestamp - now; return t > 3*24*3600*1000 && t < 30*24*3600*1000 && o.volume > 0 && o.mark_iv > 0; });
    if (near.length < 4) near = d.result.filter(o => { const t = o.expiration_timestamp - now; return t > 0 && t < 7*24*3600*1000 && o.volume > 0 && o.mark_iv > 0; });
    if (!near.length) near = d.result.filter(o => o.volume > 0 && o.mark_iv > 0).slice(0, 30);
    const gs = name => { const p = name?.split('-') || []; return p.length >= 3 ? parseFloat(p[2]) : null; };
    const puts  = near.filter(o => o.instrument_name.slice(-1) === 'P' && (s => s && s >= spot*0.80 && s <= spot*0.95)(gs(o.instrument_name)));
    const calls = near.filter(o => o.instrument_name.slice(-1) === 'C' && (s => s && s >= spot*1.05 && s <= spot*1.20)(gs(o.instrument_name)));
    const pF = puts.length >= 2 ? puts : near.filter(o => o.instrument_name.slice(-1) === 'P');
    const cF = calls.length >= 2 ? calls : near.filter(o => o.instrument_name.slice(-1) === 'C');
    if (!pF.length || !cF.length) throw new Error('insufficient options');
    const wAvg = arr => { const w = arr.reduce((s,o) => s+(o.volume||1),0); return arr.reduce((s,o) => s+o.mark_iv*(o.volume||1),0)/w; };
    const pIV = wAvg(pF), cIV = wAvg(cF);
    const skew = parseFloat((pIV - cIV).toFixed(1));
    console.log(`[Options] Skew: ${skew} | PutIV: ${Math.round(pIV)} | CallIV: ${Math.round(cIV)}`);
    return { optionsSkew: skew, optionsPCRatio: parseFloat((pF.length/Math.max(cF.length,1)).toFixed(2)), optionsPutIV: Math.round(pIV), optionsCallIV: Math.round(cIV) };
  } catch (e) { console.warn('[Options] Failed:', e.message); return null; }
}

// ── Macro data (DXY, VIX, TNX) — Yahoo → Stooq → official ──────────────────────
async function fetchMacros() {
  const out = { dxy: null, dxyChange: null, vix: null, vixChange: null, tnxYield: null, tnxChange: null };

  const fredFetch = async (series) => {
    const fr = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!fr.ok) throw new Error(`FRED ${series}: HTTP ${fr.status}`);
    const ft = await fr.text();
    const fl = ft.trim().split('\n').filter(l => !l.startsWith('DATE') && l.split(',')[1]?.trim() !== '.');
    if (!fl.length) throw new Error(`FRED ${series}: no valid rows`);
    const lastVal = fl[fl.length - 1]?.split(',')[1]?.trim();
    const v = parseFloat(lastVal);
    if (!lastVal || isNaN(v)) throw new Error(`FRED ${series}: unparseable value "${lastVal}"`);
    return v;
  };

  const fetchDXYFromFX = async () => {
    const r = await fetch('https://open.er-api.com/v6/latest/USD',
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`FX API: HTTP ${r.status}`);
    const d = await r.json();
    if (!d?.rates?.EUR) throw new Error('no EUR rate');
    const eurusd = 1 / d.rates.EUR;
    const usdjpy = d.rates.JPY || 142;
    const gbpusd = d.rates.GBP ? 1/d.rates.GBP : 1.26;
    const usdcad = d.rates.CAD || 1.36;
    const usdsek = d.rates.SEK || 10.4;
    const usdchf = d.rates.CHF || 0.89;
    const dxy = 50.14348112
      * Math.pow(eurusd, -0.576)
      * Math.pow(usdjpy,  0.136)
      * Math.pow(gbpusd, -0.119)
      * Math.pow(usdcad, -0.091)
      * Math.pow(usdsek, -0.042)
      * Math.pow(usdchf, -0.036);
    if (dxy < 75 || dxy > 130) throw new Error(`DXY out of plausible range: ${dxy.toFixed(2)}`);
    return parseFloat(dxy.toFixed(2));
  };

  // DXY
  try {
    const d = yfExtract(await yfetch('DX-Y.NYB'));
    if (d.price) { out.dxy = parseFloat(d.price.toFixed(2)); out.dxyChange = d.change; console.log(`[Macro] DXY (Yahoo): ${out.dxy}`); }
  } catch (e) {
    console.warn('[Macro] DXY (Yahoo) failed:', e.message);
    for (const sym of ['$dxy', 'dx.f']) {
      try {
        const s = await stooqFetch(sym);
        if (s.price && s.price > 80 && s.price < 130) {
          out.dxy = parseFloat(s.price.toFixed(2)); out.dxyChange = s.change;
          console.log(`[Macro] DXY (Stooq ${sym}): ${out.dxy}`); break;
        }
      } catch (_) {}
    }
    if (out.dxy == null) {
      try {
        out.dxy = await fetchDXYFromFX();
        console.log(`[Macro] DXY (FX approx from EUR/USD): ${out.dxy}`);
      } catch (e2) {
        console.warn('[Macro] DXY (FX approx) failed:', e2.message);
        try {
          out.dxy = parseFloat((await fredFetch('DTWEXBGS')).toFixed(2));
          console.log(`[Macro] DXY (FRED DTWEXBGS proxy): ${out.dxy}`);
        } catch (e3) { console.warn('[Macro] DXY (FRED) failed:', e3.message); }
      }
    }
  }

  await sleep(300);

  // VIX
  try {
    const d = yfExtract(await yfetch('%5EVIX'));
    if (d.price) { out.vix = parseFloat(d.price.toFixed(1)); out.vixChange = d.change; console.log(`[Macro] VIX (Yahoo): ${out.vix}`); }
  } catch (e) {
    console.warn('[Macro] VIX (Yahoo) failed:', e.message);
    try {
      const cboe = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      if (!cboe.ok) throw new Error(`CBOE VIX: HTTP ${cboe.status}`);
      const txt = await cboe.text();
      const lines = txt.trim().split('\n').filter(l => !l.toUpperCase().startsWith('DATE'));
      const last = lines[lines.length - 1]?.split(',');
      const close = last ? parseFloat(last[4]) : NaN;
      if (close > 0 && close < 200) {
        out.vix = parseFloat(close.toFixed(1));
        console.log(`[Macro] VIX (CBOE official): ${out.vix}`);
      } else throw new Error(`invalid VIX ${close}`);
    } catch (e2) {
      console.warn('[Macro] VIX (CBOE) failed:', e2.message);
      try {
        const s = await stooqFetch('^vix');
        if (s.price && s.price > 0) { out.vix = parseFloat(s.price.toFixed(1)); out.vixChange = s.change; console.log(`[Macro] VIX (Stooq): ${out.vix}`); }
      } catch (e3) {
        console.warn('[Macro] VIX (Stooq) failed:', e3.message);
        try {
          out.vix = parseFloat((await fredFetch('VIXCLS')).toFixed(1));
          console.log(`[Macro] VIX (FRED VIXCLS): ${out.vix}`);
        } catch (e4) { console.warn('[Macro] VIX (FRED) failed:', e4.message); }
      }
    }
  }

  await sleep(300);

  const fetchTNXFromTreasury = async () => {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${ym}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`Treasury XML: HTTP ${r.status}`);
    const xml = await r.text();
    const matches = xml.match(/<d:BC_10YEAR[^>]*>([0-9.]+)<\/d:BC_10YEAR>/g) || [];
    if (!matches.length) throw new Error('no BC_10YEAR entries in XML');
    const lastEntry = matches[matches.length - 1];
    const yield10y = parseFloat(lastEntry.replace(/<[^>]+>/g, ''));
    if (!yield10y || yield10y < 0 || yield10y > 20) throw new Error(`implausible yield: ${yield10y}`);
    return yield10y;
  };

  // TNX
  try {
    const d = yfExtract(await yfetch('%5ETNX'));
    if (d.price) { out.tnxYield = parseFloat((d.price > 20 ? d.price/10 : d.price).toFixed(2)); out.tnxChange = d.change; console.log(`[Macro] TNX (Yahoo): ${out.tnxYield}%`); }
  } catch (e) {
    console.warn('[Macro] TNX (Yahoo) failed:', e.message);
    try {
      out.tnxYield = parseFloat((await fetchTNXFromTreasury()).toFixed(2));
      console.log(`[Macro] TNX (Treasury XML): ${out.tnxYield}%`);
    } catch (e2) {
      console.warn('[Macro] TNX (Treasury) failed:', e2.message);
      try {
        const s = await stooqFetch('^tnx');
        const raw = s.price;
        if (raw > 0) { out.tnxYield = parseFloat((raw > 20 ? raw/10 : raw).toFixed(2)); out.tnxChange = s.change; console.log(`[Macro] TNX (Stooq): ${out.tnxYield}%`); }
      } catch (e3) {
        console.warn('[Macro] TNX (Stooq) failed:', e3.message);
        try {
          out.tnxYield = parseFloat((await fredFetch('DGS10')).toFixed(2));
          console.log(`[Macro] TNX (FRED DGS10): ${out.tnxYield}%`);
        } catch (e4) { console.warn('[Macro] TNX (FRED) failed:', e4.message); }
      }
    }
  }

  return out;
}

// ── CME futures basis ─────────────────────────────────────────────────────────
async function fetchCME() {
  const dow = new Date().getDay();
  if (dow === 0 || dow === 6) {
    console.log('[CME] Weekend — CME closed, skipping basis calculation');
    return null;
  }
  try {
    await sleep(300);
    const [futJson, spotJson] = await Promise.all([yfetch('BTC%3DF', '5d'), yfetch('BTC-USD', '1d')]);
    const futMeta = futJson?.chart?.result?.[0]?.meta, spotMeta = spotJson?.chart?.result?.[0]?.meta;
    const futPrice = futMeta?.regularMarketPrice ?? futMeta?.previousClose ?? null;
    const spotPrice = spotMeta?.regularMarketPrice ?? spotMeta?.previousClose ?? null;
    if (!futPrice || !spotPrice || spotPrice <= 0) throw new Error('price data missing');
    const expireTs = futMeta?.expireDate;
    const daysToExp = expireTs ? Math.max(1, Math.round((expireTs*1000-Date.now())/86400000)) : 30;
    const annualized = parseFloat(((futPrice-spotPrice)/spotPrice*100*(365/daysToExp)).toFixed(2));
    console.log(`[CME] Basis (Yahoo): ${annualized > 0 ? '+' : ''}${annualized}% ann | ${daysToExp}d to expiry`);
    return { cmeBasisPct: annualized, cmeDaysToExpiry: daysToExp, cmeNearExpiry: daysToExp < 14,
             cmeBasisSource: `Yahoo Finance BTC=F (${daysToExp}d to expiry, annualized)` };
  } catch (e) {
    console.warn('[CME] Yahoo BTC=F failed:', e.message);
    try {
      const instrRes = await fetch('https://www.okx.com/api/v5/public/instruments?instType=FUTURES&uly=BTC-USD',
        { signal: AbortSignal.timeout(10000) });
      const instrData = await instrRes.json();
      const instruments = instrData?.data || [];
      const now = Date.now();
      const nearest = instruments
        .map(i => ({ id: i.instId, expMs: parseInt(i.expTime) }))
        .filter(i => i.expMs > now)
        .sort((a, b) => a.expMs - b.expMs)[0];
      if (!nearest) throw new Error('no OKX futures found');
      const tickRes = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${nearest.id}`,
        { signal: AbortSignal.timeout(8000) });
      const tickData = await tickRes.json();
      const futPrice = parseFloat(tickData?.data?.[0]?.last);
      const spotRes = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USD-SWAP',
        { signal: AbortSignal.timeout(8000) });
      const spotData = await spotRes.json();
      const spotPrice = parseFloat(spotData?.data?.[0]?.last);
      if (!futPrice || !spotPrice || spotPrice <= 0) throw new Error('OKX price missing');
      const daysToExp = Math.max(1, Math.round((nearest.expMs - now) / 86400000));
      const annualized = parseFloat(((futPrice - spotPrice) / spotPrice * 100 * (365 / daysToExp)).toFixed(2));
      console.log(`[CME] Basis (OKX ${nearest.id}): ${annualized > 0 ? '+' : ''}${annualized}% ann | ${daysToExp}d to expiry`);
      return { cmeBasisPct: annualized, cmeDaysToExpiry: daysToExp, cmeNearExpiry: daysToExp < 14,
               cmeBasisSource: `OKX ${nearest.id} futures basis (annualized, proxy for CME)` };
    } catch (e2) { console.warn('[CME] OKX futures fallback failed:', e2.message); return null; }
  }
}

// ── CoinMetrics community API ──────────────────────────────────────────────────
async function fetchCoinMetrics() {
  const base = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics`;

  let out = null;
  try {
    const metrics = 'AdrActCnt,TxCnt,HashRate,FeeTotNtv,PriceUSD,TxTfrValAdjUSD';
    const url = `${base}?assets=btc&metrics=${metrics}&frequency=1d&limit_per_asset=90&sort=time`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.json();
    const rows = raw?.data;
    if (!rows?.length) throw new Error('no data');
    const latest = rows[rows.length - 1];
    const n = k => latest[k] != null ? parseFloat(latest[k]) : null;
    const txVolumeArr90d = rows
      .map(r => r.TxTfrValAdjUSD != null ? parseFloat(r.TxTfrValAdjUSD) : null)
      .filter(v => v != null && v > 0);
    out = { date: latest.time?.slice(0,10) ?? null, activeAddresses: n('AdrActCnt'),
            txCount: n('TxCnt'), hashRate: n('HashRate'), totalFeesBTC: n('FeeTotNtv'),
            refPrice: n('PriceUSD'), txVolumeUSD: n('TxTfrValAdjUSD'),
            txVolumeArr90d: txVolumeArr90d,
            mvrv: null, realizedPrice: null,
            source: 'CoinMetrics Community API' };
    console.log(`[CoinMetrics] ActiveAddr: ${Math.round(out.activeAddresses||0).toLocaleString()}`);
  } catch (e) { console.warn('[CoinMetrics] Base fetch failed:', e.message); return null; }

  try {
    const capMetrics = 'CapRealUSD,CapMrktCurUSD';
    const url2 = `${base}?assets=btc&metrics=${capMetrics}&frequency=1d&limit_per_asset=1&sort=time`;
    const r2 = await fetch(url2, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
    const raw2 = await r2.json();
    const row2 = raw2?.data?.[0];
    if (row2) {
      const capReal = row2.CapRealUSD  != null ? parseFloat(row2.CapRealUSD)  : null;
      const capMrkt = row2.CapMrktCurUSD != null ? parseFloat(row2.CapMrktCurUSD) : null;
      const price   = out.refPrice;
      const mvrv = (capReal && capMrkt && capReal > 0) ? parseFloat((capMrkt / capReal).toFixed(3)) : null;
      const circSupply = (capMrkt && price && price > 0) ? capMrkt / price : null;
      const realizedPrice = (capReal && circSupply) ? Math.round(capReal / circSupply) : null;
      out.mvrv = mvrv;
      out.realizedPrice = realizedPrice;
      out.capRealUSD = capReal;
      out.capMrktUSD = capMrkt;
      if (mvrv != null) console.log(`[CoinMetrics] MVRV: ${mvrv} | Realized: $${(realizedPrice||0).toLocaleString()}`);
    }
  } catch (e) { console.warn('[CoinMetrics] Cap metrics unavailable (community tier?):', e.message); }

  return out;
}

// ── Regulatory news fetch (NewsAPI) ──────────────────────────────────────────
// Fetches fresh regulatory & legislative news about Bitcoin, crypto regulation,
// Clarity Act, SEC actions, CFTC updates, etc. so the Catalyst Watch in the
// brief has current information instead of stale training knowledge.
// Returns an array of recent news articles with title, source, date, and summary.
// If NEWS_API_KEY is missing or the fetch fails, returns empty array (non-fatal).
const NEWS_API_KEY = ENV.VITE_NEWS_API_KEY;

async function fetchRegulatoryNews() {
  if (!NEWS_API_KEY) {
    console.log('[RegulatoryNews] VITE_NEWS_API_KEY missing — skipping news fetch');
    return [];
  }

  try {
    const queries = [
      'Bitcoin Clarity Act',
      'Bitcoin SEC regulatory',
      'CFTC Bitcoin commodity',
      'cryptocurrency legislation',
    ];

    const articles = [];
    const seenTitles = new Set();

    for (const q of queries) {
      try {
        // Get articles from the past 7 days
        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fromDate = sevenDaysAgo.toISOString().split('T')[0];

        const url = new URL('https://newsapi.org/v2/everything');
        url.searchParams.set('q', q);
        url.searchParams.set('from', fromDate);
        url.searchParams.set('sortBy', 'publishedAt');
        url.searchParams.set('apiKey', NEWS_API_KEY);
        url.searchParams.set('pageSize', '5');
        url.searchParams.set('language', 'en');

        const r = await fetch(url.toString(), {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(10000),
        });

        if (!r.ok) {
          if (r.status === 401) throw new Error('Invalid NewsAPI key');
          if (r.status === 429) throw new Error('NewsAPI rate limited');
          throw new Error(`HTTP ${r.status}`);
        }

        const data = await r.json();
        if (data.articles) {
          for (const article of data.articles) {
            // Deduplicate by title
            if (seenTitles.has(article.title)) continue;
            seenTitles.add(article.title);

            articles.push({
              title: article.title,
              source: article.source?.name || 'Unknown',
              date: article.publishedAt?.split('T')[0] || null,
              url: article.url,
              description: article.description || '',
              content: article.content ? article.content.slice(0, 200) : '',
            });
          }
        }
      } catch (e) {
        console.warn(`[RegulatoryNews] Query "${q}" failed:`, e.message);
      }
    }

    // Sort by date descending, keep last 10 unique articles
    articles.sort((a, b) => {
      const aDate = a.date ? new Date(a.date).getTime() : 0;
      const bDate = b.date ? new Date(b.date).getTime() : 0;
      return bDate - aDate;
    });

    const topArticles = articles.slice(0, 10);
    console.log(`[RegulatoryNews] ✓ Fetched ${topArticles.length} articles from past 7 days`);
    return topArticles;
  } catch (e) {
    console.error('[RegulatoryNews] ✗ (non-fatal):', e.message);
    return [];
  }
}

// ── Cache write — preserves brief + briefCachedAt across cron cycles ──────────
// Reads existing all_data.json (so brief-worker output survives), overlays the
// new fetched fields, and writes back. brief and briefCachedAt are NEVER written
// here — only by brief-worker.js. This means an interrupted data-worker run
// won't clobber the most recent Claude brief.
// ── Phase-boundary auto-anchor (Phase 1 of PHASE_BOUNDARY_AUTOANCHOR.md) ────
// Derives the five phase anchor prices from indicators already in the cache:
//   floor      = realizedPrice (only floor source we currently have)
//   trend line = tech.sma200
//   peak       = monotonic ATH (max of cycleHigh and prev anchor's ath)
//
// Falls back to prev anchors when:
//   • required inputs missing (first run won't have a stable derivation)
//   • computed anchors invert (post-rally SMA200 below realized — rare but
//     would scramble phase order if we let it ship)
//
// The output is a self-describing object: `regime` says NORMAL or which
// fallback path was taken; `derivedFrom` shows the raw inputs so brief-worker
// (Phase 2) and a human can sanity-check why levels moved.
function computePhaseAnchors(d, prevAnchors) {
  let   realized  = d?.coinMetrics?.realizedPrice ?? d?.mvrv?.realizedPrice ?? null;
  const sma200    = d?.tech?.sma200 ?? null;
  const cycleHigh = d?.tech?.cycleHigh ?? null;
  const prevAth   = prevAnchors?.derivedFrom?.ath ?? null;
  const price     = d?.market?.price ?? null;

  // Monotonic ATH — never decrease across runs. If neither source has a value
  // yet, return null (caller will reuse prev anchors entirely).
  const ath = (cycleHigh != null || prevAth != null)
    ? Math.max(cycleHigh ?? 0, prevAth ?? 0)
    : null;

  // ── Heuristic realizedPrice fallback ───────────────────────────────────────
  // When neither Dune (HTTP 402 / quota) nor CoinMetrics (community tier
  // doesn't expose CapRealUSD) returns realizedPrice, derive a proxy floor
  // from price + sma200. Historical realizedPrice/sma200 ≈ 0.65 mid-cycle.
  // Clamp to min(price, sma200) so the heuristic floor never sits above
  // current price (which would make hardStop nonsensical post-drawdown).
  // Stamps HEURISTIC_FLOOR so the brief can flag the proxy in analystNote.
  let realizedSource = 'realizedPrice';
  if (realized == null && sma200 != null && price != null) {
    realized = Math.round(Math.min(price, sma200) * 0.65);
    realizedSource = 'heuristic_min(price,sma200)*0.65';
  }

  const haveAll = realized != null && sma200 != null && ath != null;
  if (!haveAll) {
    if (prevAnchors) {
      return {
        ...prevAnchors,
        derivationStatus: 'STALE_FALLBACK',
        derivationReason: `missing inputs (realized=${realized}, sma200=${sma200}, ath=${ath}) — reused previous anchors`,
        computedAt:       new Date().toISOString(),
      };
    }
    return null;
  }

  const floor = realized;
  const anchors = {
    hardStop:    Math.round(floor * 0.97),
    phaseA_low:  Math.round(floor),
    phaseA_high: Math.round(sma200),
    phaseB_high: Math.round(sma200 * 1.15),
    phaseC_high: Math.round(ath * 0.98),
  };

  // Sanity: anchors must be strictly ascending. After a sharp rally SMA200
  // can sit below realized; post-bear ath*0.98 can sit below sma200*1.15.
  // Either case scrambles phase order — keep prev anchors instead.
  const ordered = anchors.hardStop    < anchors.phaseA_low
               && anchors.phaseA_low  < anchors.phaseA_high
               && anchors.phaseA_high < anchors.phaseB_high
               && anchors.phaseB_high < anchors.phaseC_high;

  if (!ordered && prevAnchors) {
    return {
      ...prevAnchors,
      derivationStatus: 'INVERTED_FALLBACK',
      derivationReason: `Computed anchors out of order (floor=$${anchors.phaseA_low} sma200=$${anchors.phaseA_high} ath*0.98=$${anchors.phaseC_high}) — reused previous anchors`,
      attempted:        anchors,
      computedAt:       new Date().toISOString(),
    };
  }

  // Heuristic floor takes precedence over NORMAL/INVERTED_NO_FALLBACK in the
  // status, so the brief flags the proxy in analystNote even when ordering OK.
  const statusFromFloor = realizedSource.startsWith('heuristic') ? 'HEURISTIC_FLOOR' : null;
  const orderingStatus  = ordered ? 'NORMAL' : 'INVERTED_NO_FALLBACK';
  const finalStatus     = statusFromFloor || orderingStatus;

  return {
    ...anchors,
    derivedFrom:      { realized, sma200, cycleHigh, ath, realizedSource },
    derivationStatus: finalStatus,
    ...(statusFromFloor
      ? { derivationReason: `realizedPrice unavailable from Dune & CoinMetrics — using ${realizedSource}` }
      : {}),
    computedAt:       new Date().toISOString(),
  };
}

function writeCache(payload) {
  let prev = {};
  try {
    if (existsSync(CACHE_FILE)) prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch (_) {}

  // Preserve fields that brief-worker owns
  const preservedBrief        = prev.brief;
  const preservedBriefCachedAt = prev.briefCachedAt;
  const preservedBriefError    = prev.brief_error;

  const out = {
    ...prev,
    ...payload,
    mvrv_query_id:   _queryId    || prev.mvrv_query_id   || null,
    exflow_query_id: _exflowQid  || prev.exflow_query_id || null,
    cachedAt:        new Date().toISOString(),
  };

  // Re-apply preserved brief fields (in case payload accidentally included nulls)
  if (preservedBrief !== undefined)        out.brief          = preservedBrief;
  if (preservedBriefCachedAt !== undefined) out.briefCachedAt = preservedBriefCachedAt;
  if (preservedBriefError !== undefined)   out.brief_error    = preservedBriefError;

  // ── Phase anchors (computed AFTER merge so we see fresh tech + coinMetrics) ─
  // Re-runs every writeCache, including the early write at line ~1485 — that's
  // fine: the early write may produce a stale-fallback object (no fresh
  // tech/coinMetrics yet); the late write at line ~1610 will overwrite it
  // with NORMAL anchors derived from the fresh data.
  let newAnchors = computePhaseAnchors(out, prev.phaseAnchors);

  // ── Phase 3: regime detection from history archive ──────────────────────────
  // Reads prior snapshots, classifies regime with hysteresis, modulates anchors.
  // History is seeded into public/history/ in CI (data-refresh.yml's "Seed
  // public/ from gh-pages" step) BEFORE data-worker runs — so snapshots 1..N-1
  // are visible here when classifying cycle N. Locally there's no archive,
  // so this gracefully degrades to NORMAL.
  if (newAnchors) {
    const histDir = join(__dirname, 'public', 'history');
    let snapshots = [];
    if (existsSync(histDir)) {
      try {
        const files = readdirSync(histDir)
          .filter(f => /^\d{4}-\d{2}-\d{2}-\d{2}\.json$/.test(f))
          .sort();
        for (const f of files) {
          try { snapshots.push(JSON.parse(readFileSync(join(histDir, f), 'utf8'))); }
          catch { /* skip corrupted snapshot */ }
        }
      } catch (e) {
        console.warn(`[Regime] Could not enumerate ${histDir}: ${e.message}`);
      }
    }
    const prevRegimeState = prev.phaseAnchors?.regimeState ?? null;
    const regimeResult = classifyRegime(snapshots, prevRegimeState);
    newAnchors = {
      ...applyRegimeToAnchors(newAnchors, regimeResult.regime),
      regime:       regimeResult.regime,
      regimeReason: regimeResult.regimeReason,
      rawRegime:    regimeResult.raw,
      regimeState:  regimeResult.regimeState,
      historyCycles: snapshots.length,
    };
    console.log(`[Regime] ${regimeResult.regime} (raw=${regimeResult.raw}, history=${snapshots.length} cycles): ${regimeResult.regimeReason}`);
  }

  if (newAnchors) out.phaseAnchors = newAnchors;

  mkdirSync(join(__dirname, 'public'), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(out, null, 2));
  console.log(`[Worker] ✓ Cache written → ${CACHE_FILE}`);
  if (newAnchors) {
    console.log(`[Worker]   PhaseAnchors (deriv=${newAnchors.derivationStatus}, regime=${newAnchors.regime || 'NORMAL'}): stop=$${newAnchors.hardStop?.toLocaleString()} A=[$${newAnchors.phaseA_low?.toLocaleString()}-$${newAnchors.phaseA_high?.toLocaleString()}] B<$${newAnchors.phaseB_high?.toLocaleString()} C<$${newAnchors.phaseC_high?.toLocaleString()}${newAnchors.regimeModulation ? ' | '+newAnchors.regimeModulation : ''}`);
  }
  if (payload.mvrv) console.log(`[Worker]   MVRV: ${payload.mvrv.mvrv?.toFixed(3)}  |  cachedAt: ${out.cachedAt}`);
  if (payload.exchangeFlow) {
    const ef = payload.exchangeFlow;
    console.log(`[Worker]   ExFlow: Net ${(ef.netflow_btc || 0).toFixed(0)} BTC  |  In: ${(ef.inflow_btc || 0).toFixed(0)}  |  Out: ${(ef.outflow_btc || 0).toFixed(0)}  |  Addrs: ${ef.exchange_addr_count ?? '?'}`);
  }
  if (preservedBrief) console.log(`[Worker]   Brief preserved from ${preservedBriefCachedAt || '?'}`);
}

// ── Main run ──────────────────────────────────────────────────────────────────
async function runFetch() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[Worker] data-worker v${WORKER_VERSION} run started — ${new Date().toISOString()}`);
  const payload = {};

  // ── Farside ETF Flows — fast, ~15s ────────────────────────────────────────
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

  // ── Cloudflare Worker /etf fallback — SoSoValue via Worker edge IPs ─────────
  if (!payload.etfFlow) {
    try {
      const r = await fetch(`${WORKER_URL}/etf`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const etf = await r.json();
        if (etf && etf.total_million_usd != null) {
          payload.etfFlow = { total_million_usd: etf.total_million_usd, date: etf.date, source: etf.source || 'SoSoValue' };
          const sign = etf.total_million_usd >= 0 ? '+' : '';
          console.log(`[ETF] Worker /etf ✓  ETF net flow: ${sign}${etf.total_million_usd.toFixed(0)}M USD  (${etf.date})`);
        } else if (etf && etf.ibit_volume_usd != null) {
          payload.etfFlow = { total_million_usd: null, ibit_volume_usd: etf.ibit_volume_usd, date: etf.date, source: etf.source };
          console.log(`[ETF] Worker /etf ✓ (volume proxy)  IBIT vol: $${(etf.ibit_volume_usd/1e6).toFixed(0)}M  (${etf.date})`);
        } else {
          console.warn('[ETF] Worker /etf returned no usable data:', JSON.stringify(etf).slice(0, 100));
        }
      } else {
        console.warn(`[ETF] Worker /etf HTTP ${r.status}`);
      }
    } catch (e) {
      console.warn('[ETF] Worker /etf fallback failed:', e.message);
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

  // ── Stablecoin Supply ─────────────────────────────────────────────────────
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

  // Early write so dashboard sees ETF/LTH/Stablecoin without waiting for MVRV.
  writeCache(payload);

  // ── MVRV (Dune) ───────────────────────────────────────────────────────────
  if (DUNE_API_KEY) {
    try {
      const queryId = await getOrCreateQueryId();
      console.log(`[MVRV] Triggering execution on query ${queryId}...`);
      const exec = await dunePost(`/api/v1/query/${queryId}/execute`, {});
      if (!exec.execution_id) throw new Error('No execution_id: ' + JSON.stringify(exec));
      console.log(`[MVRV] Execution: ${exec.execution_id}  (polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_WAIT_MS / 60_000}min)`);
      const data = await pollExecution(exec.execution_id, 'MVRV');
      const mvrv = parseMvrv(data);
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
  } else {
    console.log('[MVRV] Skipped — DUNE_API_KEY missing (CoinMetrics will provide MVRV fallback)');
  }

  // ── Exchange Flows — blockchain.info primary, Dune fallback ──────────────
  try {
    const ef = await fetchExchangeFlowBlockchain();
    payload.exchangeFlow = ef;
    payload._exchangeAddressBalances = ef._currentBalances;
    delete payload.exchangeFlow._currentBalances;
  } catch (e) {
    console.error('[ExFlow/blockchain] ✗:', e.message, '— falling back to Dune');
    if (DUNE_API_KEY) {
      try {
        const exQid = await getOrCreateExflowQueryId();
        const exec2 = await dunePost(`/api/v1/query/${exQid}/execute`, {});
        if (!exec2.execution_id) throw new Error('No execution_id');
        const data2 = await pollExecution(exec2.execution_id, 'ExFlow', 300_000);
        const ef2   = parseExchangeFlow(data2);
        if (ef2) {
          payload.exchangeFlow = ef2;
          console.log(`[ExFlow/Dune] ✓  Net: ${(ef2.netflow_btc || 0).toFixed(0)} BTC`);
        }
      } catch (e2) {
        console.error('[ExFlow/Dune] ✗ (non-fatal):', e2.message);
        if (e2.message.includes('402')) console.error('[ExFlow] Dune quota exceeded — no exchange flow this cycle.');
        try {
          const prev = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
          if (prev.exchangeFlow?.netflow_btc != null) {
            payload.exchangeFlow = { ...prev.exchangeFlow, stale: true };
            console.warn(`[ExFlow] Using stale cache: Net ${prev.exchangeFlow.netflow_btc?.toFixed(0)} BTC`);
          }
        } catch (_) {}
      }
    }
  }

  // ── Binance 24h taker pressure — Worker /whale primary, direct fallback ──
  try {
    const wr = await fetch(`${WORKER_URL}/whale`, { signal: AbortSignal.timeout(12000) });
    if (!wr.ok) throw new Error(`Worker /whale HTTP ${wr.status}`);
    const wt = await wr.json();
    if (wt.error) throw new Error(`Worker /whale error: ${wt.error}`);
    payload.binanceLargeTrades = wt;
    console.log(`[Binance/Whales] ✓ (via Worker)  Net: ${wt.net_taker_btc >= 0 ? '+' : ''}${wt.net_taker_btc} BTC | Pressure: ${wt.pressure}`);
  } catch (e) {
    console.warn('[Binance/Whales] Worker /whale failed:', e.message, '— trying direct Binance');
    try {
      const wt = await fetchBinanceLargeTrades();
      payload.binanceLargeTrades = wt;
      console.log(`[Binance/Whales] ✓ (direct)  Net: ${wt.net_whale_btc >= 0 ? '+' : ''}${wt.net_whale_btc} BTC | Pressure: ${wt.pressure}`);
    } catch (e2) {
      console.error('[Binance/Whales] ✗ (non-fatal):', e2.message);
    }
  }

  // ── Market snapshot (BTC price, F&G, funding, OI, gold, dominance) ───────
  console.log('[Worker] Fetching market snapshot...');
  payload.market = await fetchMarketSnapshot();

  // ── Technical data (SMAs + QQQ correlation) ──────────────────────────────
  console.log('[Worker] Fetching technical data (SMAs + QQQ)...');
  payload.tech = await fetchTechnicalData();

  // ── Options skew (Deribit) ───────────────────────────────────────────────
  console.log('[Worker] Fetching options skew (Deribit)...');
  payload.options = await fetchOptionsSkew(payload.market?.price);

  // ── Macros (DXY/VIX/TNX) ─────────────────────────────────────────────────
  console.log('[Worker] Fetching macro (DXY/VIX/TNX)...');
  payload.macros = await fetchMacros();

  // ── CME basis ────────────────────────────────────────────────────────────
  console.log('[Worker] Fetching CME basis...');
  payload.cme = await fetchCME();

  // ── CoinMetrics network health + MVRV fallback ───────────────────────────
  console.log('[Worker] Fetching CoinMetrics...');
  payload.coinMetrics = await fetchCoinMetrics();

  // ── Regulatory news (for Catalyst Watch freshness) ────────────────────────
  console.log('[Worker] Fetching regulatory news...');
  payload.catalystNews = await fetchRegulatoryNews();

  // If Dune MVRV missing/failed but CoinMetrics has it, inject so brief uses it.
  // CoinMetrics CapRealUSD/CapMrktCurUSD is the same calculation Dune runs.
  if (payload.coinMetrics?.mvrv != null && !payload.mvrv?.mvrv) {
    payload.mvrv = {
      mvrv:          payload.coinMetrics.mvrv,
      realizedPrice: payload.coinMetrics.realizedPrice,
      source:        'CoinMetrics (CapMrktCurUSD / CapRealUSD)',
      date:          payload.coinMetrics.date,
      stale:         false,
    };
    console.log(`[Worker] MVRV injected from CoinMetrics: ${payload.coinMetrics.mvrv}`);
  }

  writeCache(payload);
}

// ── Entry ─────────────────────────────────────────────────────────────────────
const watchMode    = process.argv.includes('--watch');
const schemaMode   = process.argv.includes('--schema');
const schemaExflow = process.argv.includes('--schema-exflow');

if (schemaMode) {
  probeSchema()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[Schema] Fatal:', e.message); process.exit(1); });
} else if (schemaExflow) {
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
