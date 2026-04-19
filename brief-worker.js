#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// brief-worker.js  —  BTC Morning Brief · Market Data + Claude Brief Generator
// ─────────────────────────────────────────────────────────────────────────────
// Runs AFTER dune-worker.js has written public/dune_cache.json.
// Fetches: BTC market data, macro (DXY/VIX/TNX), CME basis, CoinMetrics,
//          options skew, QQQ correlation, SMAs.
// Calls Anthropic Claude to synthesise the morning brief.
// Writes: public/all_data.json  (dune_cache.json + new fields + brief)
//
// Usage:
//   node brief-worker.js
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname }                                       from 'path';
import { fileURLToPath }                                       from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const DUNE_CACHE_FILE  = join(__dirname, 'public', 'dune_cache.json');
const ALL_DATA_FILE    = join(__dirname, 'public', 'all_data.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WORKER_VERSION = '2.4.0'; // OKX OI multi-attempt, stablecoin delta fix

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (!existsSync(envPath)) return {};
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
const ANTHROPIC_KEY = ENV.VITE_ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('[Brief] VITE_ANTHROPIC_API_KEY missing — Claude brief will not be generated');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Load existing dune_cache.json ─────────────────────────────────────────────
function loadDuneCache() {
  try {
    if (existsSync(DUNE_CACHE_FILE)) {
      return JSON.parse(readFileSync(DUNE_CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[Brief] Could not load dune_cache.json:', e.message);
  }
  return {};
}

// ── Yahoo Finance helper ───────────────────────────────────────────────────────
async function yfetch(ticker, range = '5d') {
  // query1 is sometimes blocked on GitHub Actions IPs — try query2 as fallback.
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

// ── Stooq.com helper — free CSV price feed, works from GitHub Actions IPs ─────
// Returns { price, prevClose, change } for a given Stooq symbol.
// Single-row endpoint: https://stooq.com/q/l/?s=SYMBOL&f=sd2t2ohlcv&e=csv
// CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
async function stooqFetch(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&e=csv`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Stooq ${symbol}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error(`Stooq ${symbol}: no data rows`);
  const parts = lines[1].split(',');
  // cols: Symbol, Date, Time, Open, High, Low, Close, Volume
  const close = parseFloat(parts[6]);
  const open  = parseFloat(parts[3]);
  if (!close || isNaN(close) || close <= 0) throw new Error(`Stooq ${symbol}: invalid price ${close}`);
  const change = (open > 0) ? parseFloat(((close - open) / open * 100).toFixed(2)) : null;
  return { price: close, change };
}

// ── Stooq historical CSV (for QQQ correlation) ─────────────────────────────────
// Returns array of daily closes (ascending), up to 90 days.
// Also attaches a parallel `.dates` array (YYYY-MM-DD) for date-aligned correlation.
async function stooqHistory(symbol, days = 90) {
  const to   = new Date(); const from = new Date(Date.now() - days * 86400000);
  const fmt  = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const url  = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${fmt(from)}&d2=${fmt(to)}&i=d`;
  const res  = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Stooq history ${symbol}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n').slice(1); // skip header
  // Stooq CSV: Date,Open,High,Low,Close,Volume  (date already ISO YYYY-MM-DD)
  const out = [];
  const dates = [];
  for (const l of lines) {
    const parts = l.split(',');
    const date  = (parts[0] || '').trim();
    const close = parseFloat(parts[4]);
    if (date && close > 0) { out.push(close); dates.push(date); }
  }
  out.dates = dates; // parallel sidecar: out[i] is the close on dates[i]
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

// ── Fetch live BTC market snapshot ───────────────────────────────────────────
async function fetchMarketSnapshot() {
  const out = {};

  // BTC price — try 4 sources in sequence until one succeeds.
  // GitHub Actions IPs are sometimes blocked by Binance/CoinGecko, so we cast a wide net.
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
      const open24h    = parseFloat(t?.o);   // today's opening price (UTC midnight)
      const vol24hBTC  = parseFloat(t?.v?.[1]); // 24h volume in BTC
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
      // Validate price is a real positive number — Binance can return HTTP 200
      // with null/undefined lastPrice on rate-limit or geo-block, giving NaN.
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

  // Fear & Greed (Alternative.me)
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=7', { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    out.fearGreedValue = parseInt(d.data[0].value, 10);
    out.fearGreedLabel = d.data[0].value_classification;
    out.fearGreed7d    = d.data.map(x => parseInt(x.value, 10));
    console.log(`[Market] Fear & Greed: ${out.fearGreedValue} (${out.fearGreedLabel})`);
  } catch (e) { console.warn('[Market] F&G failed:', e.message); }

  // Funding rate (Binance fapi)
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8',
      { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    out.fundingRate = parseFloat(d[d.length - 1].fundingRate);
    out.fundingSource = 'Binance';
    console.log(`[Market] Funding: ${(out.fundingRate * 100).toFixed(4)}% per 8h`);
  } catch (e) {
    console.warn('[Market] Binance funding failed:', e.message);
    // Bybit fallback — also extract OI from the same response (two for one)
    try {
      const r2 = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      const t = d2?.result?.list?.[0];
      if (t?.fundingRate) { out.fundingRate = parseFloat(t.fundingRate); out.fundingSource = 'Bybit'; console.log(`[Market] Funding (Bybit): ${(out.fundingRate*100).toFixed(4)}%`); }
      // openInterest is in base coin (BTC) for Bybit linear contracts
      const bybitOI = parseFloat(t?.openInterest);
      if (bybitOI > 0 && !out.openInterest) {
        out.openInterest    = bybitOI;
        out.openInterestUSD = bybitOI * (out.price || 80000);
        console.log(`[Market] OI (Bybit): ${bybitOI.toFixed(0)} BTC`);
      }
    } catch (e2) {
      // OKX fallback
      try {
        const r3 = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', { signal: AbortSignal.timeout(8000) });
        const d3 = await r3.json();
        const fr = d3?.data?.[0]?.fundingRate;
        if (fr) { out.fundingRate = parseFloat(fr); out.fundingSource = 'OKX'; console.log(`[Market] Funding (OKX): ${(out.fundingRate*100).toFixed(4)}%`); }
      } catch (e3) { console.warn('[Market] All funding sources failed'); }
    }
  }

  // Open Interest (Binance fapi → Bybit → OKX multi-attempt)
  // OKX notes:
  //  BTC-USDT-SWAP: oi=contracts (1 contract=0.01 BTC), oiCcy=BTC value
  //  BTC-USD-SWAP : oi=contracts (1 contract=100 USD), oiCcy=BTC value (more reliable)
  //  Valid BTC OI range: 5,000 – 500,000 BTC
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
    // Bybit
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
      // OKX — try multiple endpoint variants
      const okxAttempts = [
        // 1: instId only (no instType) for USDT-margined
        { url: 'https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP', label: 'OKX instId USDT' },
        // 2: instType+instId for USDT-margined
        { url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', label: 'OKX SWAP+USDT' },
        // 3: aggregate all BTC USDT swaps via uly
        { url: 'https://www.okx.com/api/v5/public/open-interest?instType=SWAP&uly=BTC-USDT', label: 'OKX uly BTC-USDT' },
        // 4: coin-margined BTC-USD-SWAP (oiCcy definitively in BTC)
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
          // oiCcy = BTC value (preferred); oi = raw contract count
          let oi = row.oiCcy ? parseFloat(row.oiCcy) : null;
          // For USDT-margined contracts, each contract = 0.01 BTC
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

  // Gold — CoinGecko PAXG (primary, works from GitHub Actions) → Kraken XAU/USD → Binance PAXG
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
    // Fallback 1: Kraken XAU/USD
    try {
      const r2 = await fetch('https://api.kraken.com/0/public/Ticker?pair=XAUUSD', { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      // Kraken XAU/USD result key is XXAUZUSD
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
      // Fallback 2: Binance PAXG
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

  // BTC dominance (CoinGecko)
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const pct = d?.data?.market_cap_percentage?.btc;
    if (pct) out.btcDominance = parseFloat(pct.toFixed(1));
  } catch (e) { console.warn('[Market] Dominance failed:', e.message); }

  return out;
}

// ── Fetch 200-day candles → SMAs + QQQ correlation ────────────────────────────
async function fetchTechnicalData() {
  let closes = null, volumes = null;
  // Parallel date sidecar — closesByDate[i] corresponds to btcDates[i] (YYYY-MM-DD, UTC).
  // Used for date-aligned BTC-vs-QQQ correlation; SMA math continues to use `closes` directly.
  let btcDates = [];
  const tsToDate = ms => new Date(ms).toISOString().slice(0, 10);

  // Primary: Kraken OHLC (confirmed works from GitHub Actions; Binance is often IP-blocked)
  try {
    const since = Math.floor((Date.now() - 210 * 86400 * 1000) / 1000); // 210 days back in seconds
    const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=${since}`,
      { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error && d.error.length) throw new Error(`Kraken error: ${d.error[0]}`);
    const rows = d.result?.XXBTZUSD || d.result?.XBTZUSD || [];
    if (!rows.length) throw new Error('empty candle array');
    // Kraken row: [time(s), open, high, low, close, vwap, volume, count]
    closes  = []; volumes = []; btcDates = [];
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
    // Fallback: Binance klines — [openTime(ms), open, high, low, close, volume, ...]
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

  // ── QQQ correlation ─────────────────────────────────────────────────────────
  // Correct methodology:
  //   1) Align BTC and QQQ by trading date (intersection of dates, sorted).
  //      QQQ only trades ~5 days/week, so pairing raw index-by-index slices
  //      offsets BTC by ~20–25 calendar days and destroys the signal.
  //   2) Compute correlation on daily pct RETURNS, not price levels. Two trending
  //      series can be strongly dependent via their common trend and still look
  //      weakly correlated on returns (or vice-versa); returns is the right stat.
  // Window: last 60 common trading days (≈12 weeks), matches "60d" label.
  let btcQqqCorr = null, corrWindow = 0;
  const btcByDate = {};
  for (let i = 0; i < btcDates.length; i++) btcByDate[btcDates[i]] = closes[i];

  const correlateOnReturns = (qqqDates, qqqCloseArr, sourceLabel) => {
    // Build intersection of dates (QQQ drives the set — fewer points).
    const paired = [];
    for (let i = 0; i < qqqDates.length; i++) {
      const dt = qqqDates[i]; const qc = qqqCloseArr[i];
      const bc = btcByDate[dt];
      if (dt && qc != null && !isNaN(qc) && bc != null) paired.push({ dt, bc, qc });
    }
    paired.sort((a, b) => a.dt < b.dt ? -1 : a.dt > b.dt ? 1 : 0);
    // Need 61 points for 60 returns.
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
    const qqqRes = await yfetch('QQQ', '120d'); // 120d so we reliably get 60+ trading days
    const result0 = qqqRes?.chart?.result?.[0];
    const timestamps = result0?.timestamp || [];
    const closeArr   = result0?.indicators?.quote?.[0]?.close || [];
    const qqqDates   = timestamps.map(t => tsToDate(t * 1000));
    const { corr, n } = correlateOnReturns(qqqDates, closeArr, 'Yahoo');
    btcQqqCorr = corr; corrWindow = n;
  } catch (e) {
    console.warn('[Tech] QQQ corr (Yahoo) failed:', e.message);
    // Fallback: Stooq qqq.us historical CSV
    try {
      const qqqCloses = await stooqHistory('qqq.us', 120);
      const { corr, n } = correlateOnReturns(qqqCloses.dates || [], qqqCloses, 'Stooq');
      btcQqqCorr = corr; corrWindow = n;
    } catch (e2) { console.warn('[Tech] QQQ corr (Stooq) failed:', e2.message); }
  }

  // Volume trend
  const avgVol5d  = volumes.slice(-5).reduce((a,b)  => a+b, 0) / 5;
  const avgVol20d = volumes.slice(-20).reduce((a,b) => a+b, 0) / 20;
  const volTrendRatio = avgVol20d > 0 ? avgVol5d / avgVol20d : null;
  const volTrend = !volTrendRatio ? 'UNKNOWN' : volTrendRatio > 1.2 ? 'RISING' : volTrendRatio < 0.8 ? 'FALLING' : 'STABLE';

  console.log(`[Tech] 200d SMA: $${sma200 ? Math.round(sma200).toLocaleString() : 'n/a'} | BTC-QQQ: ${btcQqqCorr} | VolTrend: ${volTrend}`);
  return {
    sma200: sma200 ? Math.round(sma200) : null,
    sma50:  sma50  ? Math.round(sma50)  : null,
    sma20:  sma20  ? Math.round(sma20)  : null,
    candleCount: closes.length,
    avgVol5d: Math.round(avgVol5d), avgVol20d: Math.round(avgVol20d),
    volTrendRatio: volTrendRatio ? parseFloat(volTrendRatio.toFixed(2)) : null,
    volTrend, btcQqqCorr, corrWindow,
  };
}

// ── Fetch options skew (Deribit) ───────────────────────────────────────────────
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

// ── Fetch macro data (DXY, VIX, TNX) — Yahoo → Stooq fallback ────────────────
async function fetchMacros() {
  const out = { dxy: null, dxyChange: null, vix: null, vixChange: null, tnxYield: null, tnxChange: null };

  // ── Helper: fetch FRED CSV with proper ok-check ─────────────────────────────
  const fredFetch = async (series) => {
    const fr = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!fr.ok) throw new Error(`FRED ${series}: HTTP ${fr.status}`);
    const ft = await fr.text();
    // Filter out header row AND dots (missing values common at tail of FRED series)
    const fl = ft.trim().split('\n').filter(l => !l.startsWith('DATE') && l.split(',')[1]?.trim() !== '.');
    if (!fl.length) throw new Error(`FRED ${series}: no valid rows`);
    const lastVal = fl[fl.length - 1]?.split(',')[1]?.trim();
    const v = parseFloat(lastVal);
    if (!lastVal || isNaN(v)) throw new Error(`FRED ${series}: unparseable value "${lastVal}"`);
    return v;
  };

  // ── DXY approximation from free FX rates ─────────────────────────────────────
  // open.er-api.com is completely free, no API key, works from GitHub Actions.
  // DXY = 50.14 × EUR/USD^(-0.576) × USD/JPY^(0.136) × GBP/USD^(-0.119) × …
  // We approximate using EUR/USD dominance (57.6% weight) calibrated at EUR/USD=1.07→DXY=100.
  // Sanity check: compare against Stooq/Yahoo if available and take closest to known range.
  const fetchDXYFromFX = async () => {
    const r = await fetch('https://open.er-api.com/v6/latest/USD',
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`FX API: HTTP ${r.status}`);
    const d = await r.json();
    if (!d?.rates?.EUR) throw new Error('no EUR rate');
    const eurusd = 1 / d.rates.EUR;    // price of 1 EUR in USD
    const usdjpy = d.rates.JPY || 142;  // JPY per USD
    const gbpusd = d.rates.GBP ? 1/d.rates.GBP : 1.26; // price of 1 GBP in USD
    const usdcad = d.rates.CAD || 1.36;
    const usdsek = d.rates.SEK || 10.4;
    const usdchf = d.rates.CHF || 0.89;
    // Official ICE DXY formula (EUR/USD^-0.576 dominates)
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
    // Stooq: try common DXY symbols
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
      // open.er-api.com — free FX rates, compute DXY from EUR/USD (no auth needed)
      try {
        out.dxy = await fetchDXYFromFX();
        console.log(`[Macro] DXY (FX approx from EUR/USD): ${out.dxy}`);
      } catch (e2) {
        console.warn('[Macro] DXY (FX approx) failed:', e2.message);
        // Last resort: FRED DTWEXBGS broad dollar index
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
    // CBOE official VIX history CSV — authoritative source, no auth needed
    try {
      const cboe = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      if (!cboe.ok) throw new Error(`CBOE VIX: HTTP ${cboe.status}`);
      const txt = await cboe.text();
      // Format: DATE,OPEN,HIGH,LOW,CLOSE  (header on line 1)
      const lines = txt.trim().split('\n').filter(l => !l.toUpperCase().startsWith('DATE'));
      const last = lines[lines.length - 1]?.split(',');
      const close = last ? parseFloat(last[4]) : NaN; // CLOSE = index 4
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
        // FRED VIXCLS — 1-day lag, no auth required
        try {
          out.vix = parseFloat((await fredFetch('VIXCLS')).toFixed(1));
          console.log(`[Macro] VIX (FRED VIXCLS): ${out.vix}`);
        } catch (e4) { console.warn('[Macro] VIX (FRED) failed:', e4.message); }
      }
    }
  }

  await sleep(300);

  // TNX (10Y Treasury yield) — US Treasury XML is the primary free programmatic source
  const fetchTNXFromTreasury = async () => {
    // US Treasury publishes a daily XML yield curve.
    // Format: https://home.treasury.gov/.../xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM
    const ym = new Date().toISOString().slice(0, 7).replace('-', ''); // e.g. "202604"
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${ym}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`Treasury XML: HTTP ${r.status}`);
    const xml = await r.text();
    // Matches entries like: <d:BC_10YEAR>4.23</d:BC_10YEAR>
    const matches = xml.match(/<d:BC_10YEAR[^>]*>([0-9.]+)<\/d:BC_10YEAR>/g) || [];
    if (!matches.length) throw new Error('no BC_10YEAR entries in XML');
    const lastEntry = matches[matches.length - 1];
    const yield10y = parseFloat(lastEntry.replace(/<[^>]+>/g, ''));
    if (!yield10y || yield10y < 0 || yield10y > 20) throw new Error(`implausible yield: ${yield10y}`);
    return yield10y;
  };

  // TNX (10Y Treasury yield)
  try {
    const d = yfExtract(await yfetch('%5ETNX'));
    if (d.price) { out.tnxYield = parseFloat((d.price > 20 ? d.price/10 : d.price).toFixed(2)); out.tnxChange = d.change; console.log(`[Macro] TNX (Yahoo): ${out.tnxYield}%`); }
  } catch (e) {
    console.warn('[Macro] TNX (Yahoo) failed:', e.message);
    // US Treasury XML — official source, public endpoint, no auth
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
        // FRED DGS10 — last resort
        try {
          out.tnxYield = parseFloat((await fredFetch('DGS10')).toFixed(2));
          console.log(`[Macro] TNX (FRED DGS10): ${out.tnxYield}%`);
        } catch (e4) { console.warn('[Macro] TNX (FRED) failed:', e4.message); }
      }
    }
  }

  return out;
}

// ── Fetch CME futures basis ───────────────────────────────────────────────────
async function fetchCME() {
  // CME is closed Saturday and Sunday — BTC=F returns a stale Friday close while
  // BTC-USD is live, producing a meaningless basis. Skip on weekends.
  const dow = new Date().getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    console.log('[CME] Weekend — CME closed, skipping basis calculation');
    return null;
  }
  // Primary: Yahoo Finance BTC=F
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
    // Fallback: OKX quarterly futures (nearest expiry BTC-USD-YYMMDD contract)
    // Find nearest quarterly expiry by listing OKX BTC-USD futures instruments
    try {
      const instrRes = await fetch('https://www.okx.com/api/v5/public/instruments?instType=FUTURES&uly=BTC-USD',
        { signal: AbortSignal.timeout(10000) });
      const instrData = await instrRes.json();
      const instruments = instrData?.data || [];
      const now = Date.now();
      // Find nearest expiry that's > 0 days away
      const nearest = instruments
        .map(i => ({ id: i.instId, expMs: parseInt(i.expTime) }))
        .filter(i => i.expMs > now)
        .sort((a, b) => a.expMs - b.expMs)[0];
      if (!nearest) throw new Error('no OKX futures found');
      const tickRes = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${nearest.id}`,
        { signal: AbortSignal.timeout(8000) });
      const tickData = await tickRes.json();
      const futPrice = parseFloat(tickData?.data?.[0]?.last);
      // Get OKX BTC spot for comparison
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

// ── Fetch CoinMetrics community API ───────────────────────────────────────────
// Base metrics are always in the community tier. Cap metrics (CapRealUSD/CapMrktCurUSD)
// are fetched in a SEPARATE request — if they fail the base data is preserved.
// This avoids a 400/404 from a paid-tier metric killing the whole fetch.
async function fetchCoinMetrics() {
  const base = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics`;

  // Step 1: fetch community-tier base metrics (always free)
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
    // Build 90-day adjusted tx volume array for NVT Signal MA
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

  // Step 2: try MVRV metrics in a separate request — these may be community or paid tier
  // If they fail, we still return the base data above (don't throw).
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

// ── Trading phase ─────────────────────────────────────────────────────────────
const PHASES = [
  { id: 'A', label: 'ACCUMULATION', low: 60000, high: 68000 },
  { id: 'B', label: 'BREAKOUT',     low: 68000, high: 79000 },
  { id: 'C', label: 'MOMENTUM',     low: 79000, high: 98000 },
  { id: 'D', label: 'BULL RUN',     low: 98000, high: 200000 },
];
function computePhase(price) {
  if (!price) return null;
  if (price < 58500) return { id: 'STOP', label: 'STOP TRIGGERED', action: 'Hard stop — exit per mandate', pctToNext: null, progress: 0 };
  for (const ph of PHASES) {
    if (price >= ph.low && price < ph.high) {
      const progress = ((price - ph.low) / (ph.high - ph.low)) * 100;
      const pctToNext = ((ph.high - price) / price * 100).toFixed(1);
      return { ...ph, progress, pctToNext, nextPhaseAt: ph.high };
    }
  }
  return { id: 'D+', label: 'EXTENDED BULL RUN', progress: 100, pctToNext: null };
}

// ── Build Claude user message ──────────────────────────────────────────────────
function buildUserMessage(d) {
  const { market, tech, coinMetrics, macros, cme, duneCache, options } = d;
  const p = market?.price;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const LIQUID = 4_200_000, CIRC = 20_000_000;
  const vol24hUSD = market?.volume24hUSD, mcap = market?.marketCap;
  const volBTC = (p && vol24hUSD) ? Math.round(vol24hUSD / p) : null;
  const fmt = (n, dec = 2) => n != null ? n.toFixed(dec) : 'N/A';
  const fundingAnn = market?.fundingRate != null ? `${(market.fundingRate*3*365*100).toFixed(1)}% annualized` : 'unavailable';
  const normRef = (p && mcap && volBTC) ? `\nNORMALIZATION REFERENCE:\n  1,000 BTC = ${(1000/LIQUID*100).toFixed(3)}% of liquid supply\n  1,000 BTC = ${(1000/volBTC*100).toFixed(3)}% of volume\n  Liquid: ${LIQUID.toLocaleString()} BTC | Daily vol: ~${volBTC.toLocaleString()} BTC` : '';

  const marketBlock = `TODAY: ${today}
BTC Price:      ${p ? '$'+p.toLocaleString()+' ('+fmt(market.change24h)+'% 24h)' : 'unavailable'}
Market Cap:     ${mcap ? '$'+(mcap/1e12).toFixed(2)+'T' : 'unavailable'}
24h Volume:     ${vol24hUSD ? '$'+(vol24hUSD/1e9).toFixed(1)+'B (~'+volBTC?.toLocaleString()+' BTC)' : 'unavailable'}
Fear & Greed:   ${market?.fearGreedValue != null ? market.fearGreedValue+'/100 ('+market.fearGreedLabel+')' : 'unavailable'}
Funding Rate:   ${market?.fundingRate != null ? (market.fundingRate*100).toFixed(4)+'% per 8h | '+fundingAnn : 'unavailable'}
Open Interest:  ${market?.openInterest ? market.openInterest.toFixed(0)+' BTC (~$'+(market.openInterestUSD/1e9).toFixed(1)+'B)' : 'unavailable'}
Gold (XAU):     ${market?.goldPrice ? '$'+market.goldPrice.toLocaleString()+' ('+fmt(market.goldChange24h)+'% 24h)' : 'unavailable'}
BTC/Gold ratio: ${market?.btcGoldRatio ? market.btcGoldRatio.toFixed(2) : 'unavailable'}
BTC Dominance:  ${market?.btcDominance != null ? market.btcDominance+'%' : 'unavailable'}
Options Skew:   ${options?.optionsSkew != null ? options.optionsSkew+' (put IV '+options.optionsPutIV+'% vs call IV '+options.optionsCallIV+'%)' : 'unavailable'}
${normRef}`;

  const phase = computePhase(p);
  const phaseBlock = phase ? `\n\nLIVE PHASE STATUS:\n  Active Phase: ${phase.id} - ${phase.label}${phase.pctToNext ? '\n  Distance to next phase ($'+phase.nextPhaseAt?.toLocaleString()+'): +'+phase.pctToNext+'%' : ''}\n  Phase progress: ${phase.progress.toFixed(0)}% through range` : '';

  const corrStr = tech?.btcQqqCorr != null ? `\n  BTC-QQQ Correlation (${tech.corrWindow}d Pearson): ${tech.btcQqqCorr} → ${Math.abs(tech.btcQqqCorr)>0.7?'HIGH — macro regime dominant':Math.abs(tech.btcQqqCorr)>0.4?'MODERATE — mixed signals':'LOW — on-chain signals dominate'}` : '\n  BTC-QQQ Correlation: unavailable';
  const smaBlock = tech ? `\n\nLIVE TECHNICAL LEVELS (Binance ${tech.candleCount}-day):\n  200d SMA: $${tech.sma200?.toLocaleString()||'n/a'}${p?` (${((p-tech.sma200)/tech.sma200*100).toFixed(1)}% from price)`:''}\n  50d SMA:  $${tech.sma50?.toLocaleString()||'n/a'}\n  20d SMA:  $${tech.sma20?.toLocaleString()||'n/a'}${corrStr}\n  OVERRIDE: Use these live values. Ignore Section 2 hardcoded figures.` : '\n\nTECHNICAL LEVELS: Unavailable.';

  // ── NVT Signal computation (matches JSX live path) ───────────────────────────
  let nvtRatio = null, nvtSignal = null, nvtZone = null, nvtDataPts = null;
  if (coinMetrics && coinMetrics.txVolumeUSD && coinMetrics.txVolumeUSD > 0 && mcap && mcap > 0) {
    nvtRatio = mcap / coinMetrics.txVolumeUSD;
    const arr90 = coinMetrics.txVolumeArr90d;
    if (arr90 && arr90.length >= 14) {
      const ma90 = arr90.reduce((s, v) => s + v, 0) / arr90.length;
      if (ma90 > 0) {
        nvtSignal = mcap / ma90;
        nvtZone   = nvtSignal < 25  ? 'DEEPLY_UNDERVALUED'
                  : nvtSignal < 50  ? 'UNDERVALUED'
                  : nvtSignal < 100 ? 'FAIR'
                  : nvtSignal < 150 ? 'OVERVALUED'
                  : 'BUBBLE';
        nvtDataPts = arr90.length;
      }
    }
  }
  const cmBlock = coinMetrics ? (() => {
    const txVolStr  = coinMetrics.txVolumeUSD != null ? `$${(coinMetrics.txVolumeUSD/1e9).toFixed(2)}B` : 'n/a';
    const nvtRStr   = nvtRatio   != null ? nvtRatio.toFixed(1)   : 'n/a';
    const nvtSStr   = nvtSignal  != null ? nvtSignal.toFixed(1)  : 'n/a';
    const nvtZStr   = nvtZone    != null ? nvtZone               : 'n/a';
    const nvtPStr   = nvtDataPts != null ? `${nvtDataPts}d window` : 'insufficient data';
    return `\n\nCOINMETRICS NETWORK HEALTH (${coinMetrics.date||'recent'}):\n  Active Addresses: ${coinMetrics.activeAddresses!=null?Math.round(coinMetrics.activeAddresses).toLocaleString():'n/a'}\n  Tx Count (24h):   ${coinMetrics.txCount!=null?Math.round(coinMetrics.txCount).toLocaleString():'n/a'}\n  Hash Rate:        ${coinMetrics.hashRate!=null?(coinMetrics.hashRate>1e15?(coinMetrics.hashRate/1e18).toFixed(1):(coinMetrics.hashRate/1e6).toFixed(1))+' EH/s':'n/a'}\n  On-Chain Tx Vol:  ${txVolStr} (adjusted, TxTfrValAdjUSD)\n  NVT Ratio (daily): ${nvtRStr} (MC / today's tx vol — noisy)\n  NVT Signal (90dMA): ${nvtSStr} → ${nvtZStr} (${nvtPStr})\n  INSTRUCTION: Use active addresses, tx count, and NVT Signal as network adoption/valuation signals.`;
  })() : '\n\nCOINMETRICS: Unavailable.';

  const macroBlock = (macros?.dxy!=null||macros?.vix!=null||macros?.tnxYield!=null) ? (() => {
    let b = '\n\nLIVE MACRO DATA (Yahoo Finance — overrides training estimates):';
    if (macros.dxy!=null) b+=`\n  DXY: ${macros.dxy}${macros.dxyChange!=null?' ('+(macros.dxyChange>0?'+':'')+macros.dxyChange+'% 1d)':''} → ${macros.dxy>104?'BEARISH for BTC':macros.dxy<100?'BULLISH for BTC':'NEUTRAL'}`;
    if (macros.vix!=null) b+=`\n  VIX: ${macros.vix}${macros.vixChange!=null?' ('+(macros.vixChange>0?'+':'')+macros.vixChange+'% 1d)':''} → ${macros.vix>30?'HIGH FEAR':macros.vix>20?'ELEVATED':'NORMAL'}`;
    if (macros.tnxYield!=null) b+=`\n  10Y Yield: ${macros.tnxYield}%${macros.tnxChange!=null?' ('+(macros.tnxChange>0?'+':'')+macros.tnxChange+'% 1d)':''} → ${macros.tnxYield>4.5?'BEARISH for BTC':macros.tnxYield<3.5?'BULLISH for BTC':'NEUTRAL'}`;
    b+='\n  INSTRUCTION: LIVE readings — override training-knowledge estimates.';
    return b;
  })() : '\n\nLIVE MACRO DATA: Unavailable — use training knowledge.';

  const dc = duneCache;
  let duneBlock = '';
  if (dc?.mvrv || dc?.exchangeFlow) {
    duneBlock = '\n\nDUNE ANALYTICS — BTC ON-CHAIN DATA:';
    const ef = dc.exchangeFlow;
    if (ef?.netflow_btc!=null) {
      duneBlock+=`\n  Exchange Netflow: ${ef.netflow_btc.toFixed(0)} BTC\n  Exchange Inflow:  ${(ef.inflow_btc||0).toFixed(0)} BTC\n  Exchange Outflow: ${(ef.outflow_btc||0).toFixed(0)} BTC`;
      const gross = (ef.inflow_btc||0)+(ef.outflow_btc||0);
      duneBlock += gross < 5000 ? '\n  ⚠ PARTIAL DATA: cold/custody wallets only.' : '\n  INSTRUCTION: Negative = BTC leaving exchanges (accumulation). Apply quad-normalization.';
    }
    if (dc?.mvrv?.mvrv) {
      const mv = dc.mvrv;
      const zone = mv.mvrv<1?'UNDERVALUED (<1)':mv.mvrv<2?'FAIR VALUE (1-2)':mv.mvrv<3.5?'FAIR-HIGH (2-3.5)':mv.mvrv<5?'OVERVALUED (3.5-5)':'EXTREME (>5)';
      duneBlock+=`\n\n  LIVE MVRV: ${mv.mvrv.toFixed(3)} → ${zone}${mv.realizedPrice?'\n  Realized Price: $'+Math.round(mv.realizedPrice).toLocaleString():''}\n  INSTRUCTION: LIVE MVRV — overrides training-knowledge estimates.`;
    }
  } else { duneBlock = '\n\nDUNE ANALYTICS: Unavailable. Use training knowledge.'; }

  const cmeBlock = cme?.cmeBasisPct!=null ? `\n\nCME FUTURES BASIS:\n  Basis (annualized): ${cme.cmeBasisPct>0?'+':''}${cme.cmeBasisPct}% → ${cme.cmeBasisPct>15?'STRONG CONTANGO':cme.cmeBasisPct>5?'HEALTHY CONTANGO':cme.cmeBasisPct>-5?'FLAT':'BACKWARDATION'}\n  Days to expiry: ${cme.cmeDaysToExpiry}d${cme.cmeNearExpiry?' ⚠ NEAR EXPIRY':''}\n  INSTRUCTION: CME basis is UNCORRELATED from perp funding — score independently.` : '\n\nCME FUTURES BASIS: Unavailable.';

  const etf = dc?.etfFlow;
  const etfBlock = etf?.total_million_usd!=null ? (() => {
    const net = etf.total_million_usd*1e6, netBTC = p?Math.round(net/p):null, pctLiq = netBTC?((netBTC/LIQUID)*100).toFixed(3):null;
    return `\n\nLIVE ETF FLOWS (Farside — ${etf.date||'today'}):\n  Total Net: ${net>=0?'+':''}$${(net/1e6).toFixed(0)}M${netBTC?'\n  Net BTC: '+(netBTC>=0?'+':'')+netBTC.toLocaleString()+' BTC':''}\n  % Liquid: ${pctLiq?(netBTC>=0?'+':'')+pctLiq+'%':'n/a'}\n  INSTRUCTION: LIVE ETF data — use as primary ETF signal.`;
  })() : '\n\nETF FLOWS: Unavailable. Do not report an ETF figure.';

  const lth = dc?.lthData;
  const lthBlock = lth?.lth_net_btc!=null ? `\n\nLIVE LTH NET POSITION (Bitcoin Magazine Pro — ${lth.date}):\n  LTH Net: ${lth.lth_net_btc>=0?'+':''}${lth.lth_net_btc.toLocaleString()} BTC/day\n  % Liquid: ${((lth.lth_net_btc/LIQUID)*100).toFixed(3)}%\n  Regime: ${lth.lth_net_btc>=5000?'ACCUMULATING':lth.lth_net_btc<=-5000?'DISTRIBUTING':'NEUTRAL'}\n  INSTRUCTION: LIVE data — populate lthSellingBTC field.` : '\n\nLTH NET POSITION: Unavailable. Set lthSellingBTC = \'N/A\'.';

  const st = dc?.stablecoinSupply;
  const stableBlock = st?.total_usd!=null ? `\n\nLIVE STABLECOIN SUPPLY (${st.source||'DefiLlama'} — ${st.date}):\n  USDT+USDC: $${(st.total_usd/1e9).toFixed(1)}B\n  7d delta: ${st.delta_7d_usd!=null?(st.delta_7d_usd>=0?'+':'')+( st.delta_7d_usd/1e9).toFixed(1)+'B':'N/A'}\n  Regime: ${st.regime||'STABLE'}\n  INSTRUCTION: EXPANDING = +1 stablecoin score. CONTRACTING = -1.` : '\n\nSTABLECOIN SUPPLY: Unavailable.';

  const volBlock = tech?.volTrend&&tech.volTrend!=='UNKNOWN' ? `\n\nLIVE VOLUME TREND:\n  5d/20d ratio: ${tech.volTrendRatio} → ${tech.volTrend}\n  INSTRUCTION: Use for volumeTrend field.` : '';

  // ── Binance large block trades (whale buy/sell pressure) ───────────────────
  const wt = dc?.binanceLargeTrades;
  // wt now contains 24h taker pressure from Binance klines (not last-1000 aggTrades)
  // Fields: taker_buy_btc, taker_sell_btc, net_taker_btc, total_volume_btc, buy_ratio, span_hours
  const binanceWhaleBlock = wt?.net_taker_btc != null ? (() => {
    const net   = wt.net_taker_btc;
    const sign  = net >= 0 ? '+' : '';
    const buyPct = wt.buy_ratio != null ? `${(wt.buy_ratio * 100).toFixed(1)}%` : 'n/a';
    const pctLiq = p ? `${Math.abs(net / 4200000 * 100).toFixed(3)}% of liquid supply` : 'n/a';
    return `\n\nBINANCE 24H TAKER PRESSURE (BTCUSDT spot, last 24h klines — LIVE data):\n  Taker Buy Volume:   +${wt.taker_buy_btc.toFixed(0)} BTC\n  Taker Sell Volume:  -${wt.taker_sell_btc.toFixed(0)} BTC\n  Net Taker Flow:     ${sign}${net.toFixed(0)} BTC → ${wt.pressure}\n  Buy Ratio (24h):    ${buyPct} of volume were taker buys\n  Total Volume (24h): ${wt.total_volume_btc.toFixed(0)} BTC (${wt.trade_count?.toLocaleString()} trades)\n  Quad-norm net:      ${pctLiq}\n  INSTRUCTION: This is LIVE 24h data. Populate binancePressure with dataQuality LIVE. Net taker buy > 50% = buy-side dominance (bullish). Apply quad-normalization. Use as order-flow confirmation of on-chain signals.`;
  })() : '';

  const qualitySummary = `\n\nDATA SOURCE QUALITY:\n- LIVE: price, funding, OI, F&G, options skew, gold, dominance, SMAs, CME basis${macros?.dxy!=null?', DXY':''}${macros?.vix!=null?', VIX':''}${macros?.tnxYield!=null?', 10Y yield':''}${tech?.btcQqqCorr!=null?', BTC-QQQ corr':''}${dc?.mvrv?.mvrv!=null?', MVRV':''}${etf?.total_million_usd!=null?', ETF flows':''}${lth?.lth_net_btc!=null?', LTH position':''}${st?.total_usd!=null?', stablecoin supply':''}${dc?.exchangeFlow?.netflow_btc!=null?', exchange netflow ('+( dc.exchangeFlow.source||'blockchain.info')+')':''}${wt?.net_taker_btc!=null?', Binance 24h taker pressure':''}\n- ESTIMATED: STH SOPR${dc?.mvrv?.mvrv==null?', MVRV (use ~1.5 est.)':''}${etf?.total_million_usd==null?', ETF flows':''}${dc?.exchangeFlow?.netflow_btc==null?', exchange netflow':''}\n\nGenerate the full morning brief JSON now. Apply quad-normalization to all flows. Score each axis INDEPENDENTLY per Section F — do NOT double-count funding + F&G. Return ONLY valid JSON. No markdown. No preamble.`;

  return marketBlock + phaseBlock + smaBlock + cmBlock + macroBlock + duneBlock + cmeBlock + etfBlock + lthBlock + stableBlock + volBlock + binanceWhaleBlock + qualitySummary;
}

// ── Call Anthropic Claude ─────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage) {
  if (!ANTHROPIC_KEY) throw new Error('No ANTHROPIC_API_KEY');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 7000, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`Anthropic HTTP ${r.status}: ${e.slice(0,200)}`); }
  const data = await r.json();
  if (data.error) throw new Error(`Anthropic: ${data.error.type} — ${data.error.message}`);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

function parseClaudeJSON(raw) {
  const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim();
  const repair = s => {
    s = s.replace(/,\s*([\}\]])/g, '$1');
    let br = 0, bk = 0, inS = false, esc = false;
    for (const c of s) {
      if (esc) { esc=false; continue; } if (c==='\\'&&inS) { esc=true; continue; }
      if (c==='"'&&!esc) { inS=!inS; continue; } if (inS) continue;
      if (c==='{') br++; else if (c==='}') br--; else if (c==='[') bk++; else if (c===']') bk--;
    }
    if (inS) s+='"'; while(bk-->0) s+=']'; while(br-->0) s+='}';
    return s;
  };
  try { return JSON.parse(cleaned); } catch (_) {}
  const match = cleaned.match(/\{[\s\S]*/);
  if (!match) throw new Error('no JSON in Claude response');
  return JSON.parse(repair(match[0]));
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior Bitcoin strategist at Maison Toé's Digital Assets Division.
Every morning you produce the definitive institutional daily intelligence brief for a firm with a 1-2 year BTC horizon.
You reason with precision. You cite numbers. You are contrarian when data warrants it.

SECTION 1 - PORTFOLIO MANDATE
Allocation: 50% IBIT/FBTC ETFs | 20% COIN + BTC infrastructure equities | 20% cash/stables DCA reserve | 10% put options hedge
Phase system:
  Phase A ACCUMULATION: $60K-$68K - max conviction buy zone
  Phase B BREAKOUT: $68K-$79K - add 25% on confirmed daily close + ETF >$500M/day
  Phase C MOMENTUM: $79K-$98K - hold 55%, take 15% off at $95K
  Phase D BULL RUN: $98K+ - scale out 10% every $15K above $100K
Hard stop: daily close below $58,500

SECTION 2 - BACKGROUND CONTEXT (as of April 2026)
NOTE: Live data in user message ALWAYS overrides this.
- BTC ATH: $126,073 (Oct 2025) | Bear phase: Oct 2025–Feb 2026 | Recovery: Mar–Apr 2026
- ETF AUM: IBIT ~$115B+ | Combined ~$130B+ | Baseline inflow: ~$264M/day
- Realized Price: ~$45K | STH cost basis: ~$75K | LTH cost basis: ~$30K
- CLARITY Act: BTC classified as commodity under CFTC - Senate vote pending

SECTION 3 - QUAD-NORMALIZED SIGNAL KNOWLEDGE BASE
METHODOLOGY: Four normalization axes required.
  AXIS 1 - % Liquid Supply  = BTC_flow / 4,200,000 x 100  [PRIMARY]
  AXIS 2 - % Daily Volume   = BTC_flow / daily_vol_BTC x 100
  AXIS 3 - % Market Cap     = (BTC x price) / mcap x 100
  AXIS 4 - % Circ Supply    = BTC_flow / 20,000,000 x 100

F. COMPOSITE SIGNAL SCORING (-10 to +10):
  WHALE NETFLOW DATA SOURCES (use whichever is LIVE — do NOT estimate if live data present):
    PRIMARY:   Exchange netflow from blockchain.info balance delta (labeled in data block above).
               Negative = BTC leaving exchanges (accumulation/bullish). Positive = inflows (bearish).
    SECONDARY: Binance large block trades (labeled BINANCE WHALE BLOCK TRADES above).
               Use to CONFIRM or CONTRADICT on-chain direction. Not a substitute for netflow.
    FALLBACK:  Only estimate from training knowledge if BOTH are UNAVAILABLE.
  Populate whaleSignal.netflowBTC from the blockchain.info figure.
  Populate binancePressure fields from the BINANCE 24H TAKER PRESSURE block above (24h klines data).

  onChain (whale netflow + MVRV + LTH):  max ±3 points
  etfInstitutional (ETF flows vs baseline): max ±2 points
  derivatives (funding OR F&G — stronger only, NOT both): max ±1 point
  cmeBasis (institutional demand — uncorrelated with perp): max ±1 point
  macro (DXY / real yields / VIX): max ±1 point
  sentiment (Fear&Greed if not already used): max ±1 point
  stablecoin (USDT+USDC supply growth): max ±1 point

  CRITICAL: Funding rate and Fear/Greed are CORRELATED. Score on SHARED "derivatives" axis (max ±1 total).
  CME basis is INDEPENDENT — always score separately.
  SCORE TRANSPARENCY: Populate scoreDecomposition in output JSON.

SECTION 4 - OUTPUT RULES
Return ONLY valid JSON. No markdown fences. No preamble.

{
  "date": "Day, Month DD YYYY",
  "compositeScore": 0,
  "scoreDecomposition": {
    "onChain": { "score": 0, "signal": "" },
    "etfInstitutional": { "score": 0, "signal": "" },
    "derivatives": { "score": 0, "signal": "" },
    "cmeBasis": { "score": 0, "signal": "" },
    "macro": { "score": 0, "signal": "" },
    "sentiment": { "score": 0, "signal": "" },
    "stablecoin": { "score": 0, "signal": "" },
    "scaleNote": "Range -10 to +10."
  },
  "overallBias": "STRONG BUY | BUY | NEUTRAL | CAUTION | SELL",
  "biasReason": "<=20 words",
  "headline": "<=15 words",
  "marketStatus": "ACCUMULATION PHASE | BREAKOUT WATCH | MOMENTUM | BULL RUN | DISTRIBUTION | DANGER ZONE",
  "correlationRegime": { "btcQqqCorrelation": "", "regime": "HIGH | MODERATE | LOW", "implication": "" },
  "priceAnalysis": { "trend": "", "keyLevel": "", "realizedPriceContext": "", "signal": "BULLISH | BEARISH | NEUTRAL | MIXED" },
  "whaleSignal": { "status": "ACCUMULATING | DISTRIBUTING | NEUTRAL | MIXED", "netflowBTC": "use LIVE blockchain.info netflow if provided", "netflowUSD": "", "netflowPctLiquid": "", "netflowPctVolume": "", "netflowPctMcap": "", "historicalContext": "", "detail": "", "actionable": "", "dataQuality": "LIVE | ESTIMATED" },
  "binancePressure": { "netTakerBTC": "e.g. +4,200 BTC (net 24h taker buys minus sells)", "buyVolumeBTC": "e.g. 32,100 BTC", "sellVolumeBTC": "e.g. 27,900 BTC", "buyRatioPct": "e.g. 53.5% taker buys", "totalVolumeBTC": "e.g. 60,000 BTC", "pressure": "BUY | SELL | NEUTRAL", "span": "24h", "confluence": "1 sentence confirming/contradicting on-chain netflow direction", "dataQuality": "LIVE | UNAVAILABLE" },
  "fundingRates": { "rate8h": "", "annualized": "", "regime": "CAPITULATION | BEARISH | NEUTRAL | ELEVATED | EXTREME_LONG", "signal": "", "detail": "", "squeeze_risk": "LOW | MEDIUM | HIGH" },
  "openInterest": { "trend": "RISING | FALLING | STABLE", "regime": "", "detail": "", "leverageRisk": "LOW | MEDIUM | HIGH" },
  "mvrvSignal": { "estimatedZone": "", "implication": "", "cycleContext": "" },
  "etfFlows": { "status": "INFLOW | OUTFLOW | NEUTRAL", "totalNetUSD": "", "totalNetBTC": "", "totalNetPctLiquid": "", "ibitFlow": "", "streakDays": "", "vsBaseline": "", "detail": "", "trend": "IMPROVING | DETERIORATING | STABLE" },
  "stablecoinSignal": { "status": "INFLOW | OUTFLOW | NEUTRAL", "detail": "", "signal": "" },
  "macroContext": { "riskLevel": "HIGH | MEDIUM | LOW", "dxy": "", "dxySignal": "", "realYield": "", "realYieldSignal": "", "gold": "", "fedWatch": "", "detail": "" },
  "todayAction": { "recommendation": "ACCUMULATE | ADD | HOLD | REDUCE | HEDGE | WAIT", "size": "", "trigger": "", "stopAlert": "ACTIVE | MONITORING | CLEAR", "dynamicStop": "", "scoreJustification": "" },
  "cmeBasis": { "basisPct": "", "regime": "STRONG CONTANGO | HEALTHY | FLAT | BACKWARDATION", "signal": "", "detail": "", "cmeOIvsPerp": "" },
  "catalystWatch": [{"event": "", "timing": "", "impact": "BULLISH | BEARISH | BINARY", "note": ""}],
  "analystNote": "4-5 sentences.",
  "riskWarning": "the ONE risk that could invalidate today thesis",
  "normalization": { "currentPrice": "", "marketCap": "", "dailyVolumeBTC": "", "volumeTrend": "", "lthSellingBTC": "N/A or live value", "lthSellingPctLiquid": null }
}`;

// ── Main run ──────────────────────────────────────────────────────────────────
async function runBriefWorker() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[Brief] Run started v${WORKER_VERSION} — ${new Date().toISOString()}`);

  const duneCache = loadDuneCache();
  console.log(`[Brief] Dune cache loaded — cachedAt: ${duneCache.cachedAt || 'unknown'}`);

  console.log('[Brief] Fetching market snapshot...');
  const market = await fetchMarketSnapshot();

  console.log('[Brief] Fetching technical data (SMAs + QQQ)...');
  const tech = await fetchTechnicalData();

  console.log('[Brief] Fetching options skew (Deribit)...');
  const options = await fetchOptionsSkew(market?.price);

  console.log('[Brief] Fetching macro (DXY/VIX/TNX)...');
  const macros = await fetchMacros();

  console.log('[Brief] Fetching CME basis...');
  const cme = await fetchCME();

  console.log('[Brief] Fetching CoinMetrics...');
  const coinMetrics = await fetchCoinMetrics();

  const allData = { ...duneCache, market, tech, options, macros, cme, coinMetrics, briefCachedAt: new Date().toISOString() };

  // If Dune MVRV is missing (quota exceeded) but CoinMetrics has it, inject it
  // so the brief can use it. CoinMetrics CapRealUSD/CapMrktCurUSD is the same calc.
  if (coinMetrics?.mvrv != null && !allData.mvrv?.mvrv) {
    allData.mvrv = {
      mvrv: coinMetrics.mvrv,
      realizedPrice: coinMetrics.realizedPrice,
      source: 'CoinMetrics (CapMrktCurUSD / CapRealUSD)',
      date: coinMetrics.date,
      stale: false,
    };
    console.log(`[Brief] MVRV injected from CoinMetrics: ${coinMetrics.mvrv}`);
  }

  mkdirSync(join(__dirname, 'public'), { recursive: true });
  writeFileSync(ALL_DATA_FILE, JSON.stringify(allData, null, 2));
  console.log('[Brief] all_data.json written (market data, no brief yet)');

  if (!ANTHROPIC_KEY) {
    console.warn('[Brief] Skipping Claude — no ANTHROPIC_API_KEY');
  } else {
    try {
      console.log('[Brief] Building user message...');
      const userMessage = buildUserMessage({ market, tech, coinMetrics, macros, cme, duneCache, options });
      console.log('[Brief] Calling Claude...');
      const t0 = Date.now();
      const rawBrief = await callClaude(SYSTEM_PROMPT, userMessage);
      console.log(`[Brief] Claude responded in ${((Date.now()-t0)/1000).toFixed(1)}s`);
      const parsedBrief = parseClaudeJSON(rawBrief);
      allData.brief = parsedBrief;
      console.log(`[Brief] ✓ Brief — bias: ${parsedBrief.overallBias} | score: ${parsedBrief.compositeScore}`);
    } catch (e) {
      console.error('[Brief] Claude failed:', e.message);
      allData.brief_error = e.message;
    }
  }

  writeFileSync(ALL_DATA_FILE, JSON.stringify(allData, null, 2));
  console.log(`[Brief] ✓ all_data.json complete — ${ALL_DATA_FILE}`);
}

runBriefWorker()
  .then(() => { console.log('[Brief] Done.'); process.exit(0); })
  .catch(e  => { console.error('[Brief] Fatal:', e.message); process.exit(1); });
