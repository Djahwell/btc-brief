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
//   node brief-worker.js            # run once, then exit
//   VITE_ANTHROPIC_API_KEY=sk-... node brief-worker.js
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname }                                       from 'path';
import { fileURLToPath }                                       from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const DUNE_CACHE_FILE  = join(__dirname, 'public', 'dune_cache.json');
const ALL_DATA_FILE    = join(__dirname, 'public', 'all_data.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

const ENV             = loadEnv();
const ANTHROPIC_KEY   = ENV.VITE_ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  return res.json();
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

  // BTC price + 24h stats (Binance)
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
      { signal: AbortSignal.timeout(8000) });
    const s = await r.json();
    out.price       = parseFloat(s.lastPrice);
    out.change24h   = parseFloat(s.priceChangePercent);
    out.volume24hUSD = parseFloat(s.quoteVolume) * 2.6; // rough global vol scale
    out.marketCap   = out.price * 20000000;
    out.priceSource = 'Binance';
    console.log(`[Market] BTC: $${out.price.toLocaleString()} (${out.change24h > 0 ? '+' : ''}${out.change24h.toFixed(2)}% 24h)`);
  } catch (e) {
    console.warn('[Market] Binance price failed:', e.message);
    // CoinGecko fallback
    try {
      const r2 = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true',
        { signal: AbortSignal.timeout(10000) });
      const d = await r2.json();
      const b = d.bitcoin;
      out.price       = b.usd;
      out.change24h   = b.usd_24h_change;
      out.volume24hUSD = b.usd_24h_vol;
      out.marketCap   = b.usd_market_cap;
      out.priceSource = 'CoinGecko';
    } catch (e2) { console.warn('[Market] CoinGecko price fallback also failed:', e2.message); }
  }

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
    out.fundingRate        = parseFloat(d[d.length - 1].fundingRate);
    out.fundingRateHistory = d.map(x => parseFloat(x.fundingRate));
    out.fundingSource      = 'Binance';
    console.log(`[Market] Funding: ${(out.fundingRate * 100).toFixed(4)}% per 8h`);
  } catch (e) {
    console.warn('[Market] Binance funding failed:', e.message);
    // Bybit fallback
    try {
      const r2 = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT',
        { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      const t = d2?.result?.list?.[0];
      if (t?.fundingRate) { out.fundingRate = parseFloat(t.fundingRate); out.fundingSource = 'Bybit'; }
    } catch (_) {}
  }

  // Open Interest (Binance fapi)
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
      { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    out.openInterest    = parseFloat(d.openInterest);
    out.openInterestUSD = out.openInterest * (out.price || 80000);
    out.oiSource        = 'Binance';
  } catch (e) { console.warn('[Market] OI failed:', e.message); }

  // Gold price (Binance PAXG)
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT',
      { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    out.goldPrice    = parseFloat(d.lastPrice);
    out.goldChange24h = parseFloat(d.priceChangePercent);
    out.goldToken    = 'PAXG';
    if (out.price && out.goldPrice) out.btcGoldRatio = out.price / out.goldPrice;
  } catch (e) { console.warn('[Market] Gold (PAXG) failed:', e.message); }

  // BTC dominance (CoinGecko global)
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global', { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    const pct = d?.data?.market_cap_percentage?.btc;
    if (pct) out.btcDominance = parseFloat(pct.toFixed(1));
  } catch (e) { console.warn('[Market] Dominance failed:', e.message); }

  return out;
}

// ── Fetch 200-day candles → SMAs + QQQ correlation ────────────────────────────
async function fetchTechnicalData(btcPrice) {
  // Binance 200d klines
  let closes = null, volumes = null;
  try {
    const r = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200',
      { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    closes  = d.map(row => parseFloat(row[4])).filter(Boolean);
    volumes = d.map(row => parseFloat(row[5])).filter(Boolean);
  } catch (e) {
    console.warn('[Tech] Binance candles failed:', e.message);
    return null;
  }

  const sma = (arr, n) => {
    const sl = arr.slice(-n);
    return sl.length < n ? null : sl.reduce((a, b) => a + b, 0) / n;
  };
  const sma200 = sma(closes, 200);
  const sma50  = sma(closes, 50);
  const sma20  = sma(closes, 20);

  // QQQ 60-day rolling Pearson correlation
  let btcQqqCorr = null, corrWindow = 0;
  try {
    const qqqRes = await yfetch('QQQ', '90d');
    const qqqCloses = (qqqRes?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .filter(v => v != null && !isNaN(v));
    const CORR_DAYS = 60;
    const btcSlice = closes.slice(-CORR_DAYS);
    const qqqSlice = qqqCloses.slice(-CORR_DAYS);
    const corrN = Math.min(btcSlice.length, qqqSlice.length);
    if (corrN >= 20) {
      const btc60 = btcSlice.slice(-corrN);
      const qqq60 = qqqSlice.slice(-corrN);
      const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
      const mB = mean(btc60), mQ = mean(qqq60);
      let num = 0, dB = 0, dQ = 0;
      for (let i = 0; i < corrN; i++) {
        const db = btc60[i] - mB, dq = qqq60[i] - mQ;
        num += db * dq; dB += db * db; dQ += dq * dq;
      }
      btcQqqCorr = (dB > 0 && dQ > 0) ? parseFloat((num / Math.sqrt(dB * dQ)).toFixed(2)) : null;
      corrWindow = corrN;
    }
    console.log(`[Tech] BTC-QQQ ${corrWindow}d corr: ${btcQqqCorr}`);
  } catch (e) { console.warn('[Tech] QQQ correlation failed:', e.message); }

  // Volume trend
  const avgVol5d  = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVol20d = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volTrendRatio = avgVol20d > 0 ? avgVol5d / avgVol20d : null;
  const volTrend = !volTrendRatio ? 'UNKNOWN'
    : volTrendRatio > 1.2 ? 'RISING'
    : volTrendRatio < 0.8 ? 'FALLING'
    : 'STABLE';

  console.log(`[Tech] SMAs — 200d: $${sma200 ? Math.round(sma200).toLocaleString() : 'n/a'} | 50d: $${sma50 ? Math.round(sma50).toLocaleString() : 'n/a'} | 20d: $${sma20 ? Math.round(sma20).toLocaleString() : 'n/a'} | VolTrend: ${volTrend}`);

  return {
    sma200: sma200 ? Math.round(sma200) : null,
    sma50:  sma50  ? Math.round(sma50)  : null,
    sma20:  sma20  ? Math.round(sma20)  : null,
    candleCount: closes.length,
    avgVol5d:  Math.round(avgVol5d),
    avgVol20d: Math.round(avgVol20d),
    volTrendRatio: volTrendRatio ? parseFloat(volTrendRatio.toFixed(2)) : null,
    volTrend,
    btcQqqCorr,
    corrWindow,
  };
}

// ── Fetch options skew (Deribit — public, no auth) ────────────────────────────
async function fetchOptionsSkew(spotPrice) {
  try {
    const r = await fetch(
      'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
      { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    if (!d?.result?.length) throw new Error('no options data');

    const now = Date.now();
    const spot = spotPrice || 80000;
    const threeDays = 3 * 24 * 3600 * 1000;
    const thirtyDays = 30 * 24 * 3600 * 1000;
    let near = d.result.filter(o => {
      const tte = o.expiration_timestamp - now;
      return tte > threeDays && tte < thirtyDays && o.volume > 0 && o.mark_iv > 0;
    });
    if (near.length < 4) {
      near = d.result.filter(o => {
        const tte = o.expiration_timestamp - now;
        return tte > 0 && tte < 7 * 24 * 3600 * 1000 && o.volume > 0 && o.mark_iv > 0;
      });
    }
    if (!near.length) near = d.result.filter(o => o.volume > 0 && o.mark_iv > 0).slice(0, 30);

    const getStrike = name => {
      const parts = name?.split('-') || [];
      return parts.length >= 3 ? parseFloat(parts[2]) : null;
    };
    const putLow = spot * 0.80, putHigh = spot * 0.95;
    const callLow = spot * 1.05, callHigh = spot * 1.20;
    const puts25  = near.filter(o => o.instrument_name.slice(-1) === 'P' && (s => s && s >= putLow && s <= putHigh)(getStrike(o.instrument_name)));
    const calls25 = near.filter(o => o.instrument_name.slice(-1) === 'C' && (s => s && s >= callLow && s <= callHigh)(getStrike(o.instrument_name)));
    const puts  = puts25.length  >= 2 ? puts25  : near.filter(o => o.instrument_name.slice(-1) === 'P');
    const calls = calls25.length >= 2 ? calls25 : near.filter(o => o.instrument_name.slice(-1) === 'C');
    if (!puts.length || !calls.length) throw new Error('insufficient options after filtering');

    const wAvgIV = arr => {
      const wSum = arr.reduce((s, o) => s + (o.volume || 1), 0);
      return arr.reduce((s, o) => s + o.mark_iv * (o.volume || 1), 0) / wSum;
    };
    const avgPutIV  = wAvgIV(puts);
    const avgCallIV = wAvgIV(calls);
    const skew = parseFloat((avgPutIV - avgCallIV).toFixed(1));
    const pcRatio = parseFloat((puts.length / Math.max(calls.length, 1)).toFixed(2));
    console.log(`[Options] Skew: ${skew} | Put IV: ${Math.round(avgPutIV)} | Call IV: ${Math.round(avgCallIV)}`);
    return { optionsSkew: skew, optionsPCRatio: pcRatio, optionsPutIV: Math.round(avgPutIV), optionsCallIV: Math.round(avgCallIV), optionsSource: 'Deribit' };
  } catch (e) {
    console.warn('[Options] Deribit failed:', e.message);
    return null;
  }
}

// ── Fetch macro data (DXY, VIX, TNX) from Yahoo Finance ──────────────────────
async function fetchMacros() {
  const out = { dxy: null, dxyChange: null, vix: null, vixChange: null, tnxYield: null, tnxChange: null };
  try {
    const d = yfExtract(await yfetch('DX-Y.NYB'));
    if (d.price) { out.dxy = parseFloat(d.price.toFixed(2)); out.dxyChange = d.change; }
    console.log(`[Macro] DXY: ${out.dxy}${d.change != null ? ` (${d.change > 0 ? '+' : ''}${d.change}%)` : ''}`);
  } catch (e) { console.warn('[Macro] DXY failed:', e.message); }

  await sleep(300);
  try {
    const d = yfExtract(await yfetch('%5EVIX'));
    if (d.price) { out.vix = parseFloat(d.price.toFixed(1)); out.vixChange = d.change; }
    console.log(`[Macro] VIX: ${out.vix}`);
  } catch (e) { console.warn('[Macro] VIX failed:', e.message); }

  await sleep(300);
  try {
    const d = yfExtract(await yfetch('%5ETNX'));
    if (d.price) {
      out.tnxYield  = parseFloat((d.price > 20 ? d.price / 10 : d.price).toFixed(2));
      out.tnxChange = d.change;
    }
    console.log(`[Macro] TNX: ${out.tnxYield}%`);
  } catch (e) { console.warn('[Macro] TNX failed:', e.message); }

  return out;
}

// ── Fetch CME futures basis from Yahoo Finance ────────────────────────────────
async function fetchCME() {
  try {
    await sleep(300);
    const [futJson, spotJson] = await Promise.all([
      yfetch('BTC%3DF', '5d'),
      yfetch('BTC-USD', '1d'),
    ]);
    const futMeta  = futJson?.chart?.result?.[0]?.meta;
    const spotMeta = spotJson?.chart?.result?.[0]?.meta;
    const futPrice  = futMeta?.regularMarketPrice  ?? futMeta?.previousClose  ?? null;
    const spotPrice = spotMeta?.regularMarketPrice ?? spotMeta?.previousClose ?? null;
    if (!futPrice || !spotPrice || spotPrice <= 0) throw new Error('price data missing');

    const expireTs  = futMeta?.expireDate;
    const daysToExp = expireTs
      ? Math.max(1, Math.round((expireTs * 1000 - Date.now()) / 86400000))
      : 30;
    const spotBasisPct = (futPrice - spotPrice) / spotPrice * 100;
    const annualized   = parseFloat((spotBasisPct * (365 / daysToExp)).toFixed(2));

    console.log(`[CME] Basis: ${annualized > 0 ? '+' : ''}${annualized}% ann | fut: $${Math.round(futPrice).toLocaleString()} | daysToExpiry: ${daysToExp}`);

    // Second-month contract
    let cmeSecondMonthBasis = null, cmeSecondMonthDaysToEx = null;
    try {
      const MONTHS = [2, 5, 8, 11]; const CODES = ['H', 'M', 'U', 'Z'];
      const base = new Date((expireTs || Date.now() / 1000) * 1000);
      let y = base.getFullYear(), m = base.getMonth();
      let secondTicker = null;
      outer: for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < MONTHS.length; i++) {
          if (pass === 0 && MONTHS[i] <= m) continue;
          secondTicker = 'BTC' + CODES[i] + String(y).slice(-2) + '.CME';
          break outer;
        }
        y++;
      }
      if (secondTicker) {
        await sleep(300);
        const fut2Json = await yfetch(secondTicker, '5d');
        const fut2Meta = fut2Json?.chart?.result?.[0]?.meta;
        const fut2Price = fut2Meta?.regularMarketPrice ?? fut2Meta?.previousClose ?? null;
        if (fut2Price && spotPrice > 0) {
          const expire2Ts  = fut2Meta?.expireDate;
          const days2      = expire2Ts ? Math.max(1, Math.round((expire2Ts * 1000 - Date.now()) / 86400000)) : 90;
          const basis2Raw  = (fut2Price - spotPrice) / spotPrice * 100;
          cmeSecondMonthBasis    = parseFloat((basis2Raw * (365 / days2)).toFixed(2));
          cmeSecondMonthDaysToEx = days2;
        }
      }
    } catch (_) {}

    const isNearExpiry = daysToExp < 14;
    const cmeBasisPct  = (isNearExpiry && cmeSecondMonthBasis != null) ? cmeSecondMonthBasis : annualized;
    const cmeBasisWeighted = (!isNearExpiry && cmeSecondMonthBasis != null)
      ? parseFloat((annualized * 0.7 + cmeSecondMonthBasis * 0.3).toFixed(2)) : null;

    return {
      cmeBasisPct, cmeDaysToExpiry: daysToExp, cmeNearExpiry: isNearExpiry,
      cmeSecondMonthBasis, cmeSecondMonthDaysToEx, cmeBasisWeighted,
      cmeBasisSource: `Yahoo Finance BTC=F vs spot (${daysToExp}d to expiry, annualized)`,
    };
  } catch (e) {
    console.warn('[CME] Failed:', e.message);
    return null;
  }
}

// ── Fetch CoinMetrics community API ───────────────────────────────────────────
async function fetchCoinMetrics() {
  try {
    const metrics = ['AdrActCnt', 'TxCnt', 'HashRate', 'FeeTotNtv', 'PriceUSD'].join(',');
    const url = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=${metrics}&frequency=1d&limit_per_asset=2&sort=time`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw  = await r.json();
    const rows = raw?.data;
    if (!rows?.length) throw new Error('no data');
    const latest = rows[rows.length - 1];
    const n = k => latest[k] != null ? parseFloat(latest[k]) : null;
    const out = {
      date: latest.time?.slice(0, 10) ?? null,
      activeAddresses: n('AdrActCnt'),
      txCount: n('TxCnt'),
      hashRate: n('HashRate'),
      totalFeesBTC: n('FeeTotNtv'),
      refPrice: n('PriceUSD'),
      source: 'CoinMetrics Community API',
    };
    const hr = out.hashRate;
    console.log(`[CoinMetrics] ActiveAddr: ${Math.round(out.activeAddresses || 0).toLocaleString()} | HashRate: ${hr ? (hr > 1e15 ? (hr / 1e18).toFixed(1) : (hr / 1e6).toFixed(1)) + ' EH/s' : 'n/a'}`);
    return out;
  } catch (e) {
    console.warn('[CoinMetrics] Failed:', e.message);
    return null;
  }
}

// ── Trading phase computation ─────────────────────────────────────────────────
const PHASES = [
  { id: 'A', label: 'ACCUMULATION', low: 60000,  high: 68000  },
  { id: 'B', label: 'BREAKOUT',     low: 68000,  high: 79000  },
  { id: 'C', label: 'MOMENTUM',     low: 79000,  high: 98000  },
  { id: 'D', label: 'BULL RUN',     low: 98000,  high: 200000 },
];
const HARD_STOP = 58500;

function computePhase(price) {
  if (!price) return null;
  if (price < HARD_STOP) return { id: 'STOP', label: 'STOP TRIGGERED', action: 'Hard stop — exit per mandate', pctToNext: null, progress: 0 };
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
  const p      = market?.price;
  const today  = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const LIQUID = 4_200_000;
  const CIRC   = 20_000_000;
  const vol24hUSD = market?.volume24hUSD;
  const mcap      = market?.marketCap;
  const volBTC    = (p && vol24hUSD) ? Math.round(vol24hUSD / p) : null;
  const fmt = (n, dec = 2) => n != null ? n.toFixed(dec) : 'N/A';

  const fundingAnn = market?.fundingRate != null
    ? `${(market.fundingRate * 3 * 365 * 100).toFixed(1)}% annualized` : 'unavailable';

  const normRef = (p && mcap && volBTC)
    ? `\nNORMALIZATION REFERENCE:\n  1,000 BTC = ${(1000 / LIQUID * 100).toFixed(3)}% of liquid supply\n  1,000 BTC = ${(1000 / volBTC * 100).toFixed(3)}% of volume\n  Liquid: ${LIQUID.toLocaleString()} BTC | Circ: ${CIRC.toLocaleString()} BTC | Daily vol: ~${volBTC.toLocaleString()} BTC`
    : '';

  const marketBlock = `TODAY: ${today}
BTC Price:      ${p ? '$' + p.toLocaleString() + ' (' + fmt(market.change24h) + '% 24h)' : 'unavailable'}
Market Cap:     ${mcap ? '$' + (mcap / 1e12).toFixed(2) + 'T' : 'unavailable'}
24h Volume USD: ${vol24hUSD ? '$' + (vol24hUSD / 1e9).toFixed(1) + 'B' : 'unavailable'}
24h Volume BTC: ${volBTC ? '~' + volBTC.toLocaleString() + ' BTC' : 'unavailable'}
Fear & Greed:   ${market?.fearGreedValue != null ? market.fearGreedValue + '/100 (' + market.fearGreedLabel + ')' : 'unavailable'}
Funding Rate:   ${market?.fundingRate != null ? (market.fundingRate * 100).toFixed(4) + '% per 8h | ' + fundingAnn : 'unavailable'}
Open Interest:  ${market?.openInterest ? market.openInterest.toFixed(0) + ' BTC (~$' + (market.openInterestUSD / 1e9).toFixed(1) + 'B)' : 'unavailable'}
Gold (XAU):     ${market?.goldPrice ? '$' + market.goldPrice.toLocaleString() + ' (' + fmt(market.goldChange24h) + '% 24h)' : 'unavailable'}
BTC/Gold ratio: ${market?.btcGoldRatio ? market.btcGoldRatio.toFixed(2) : 'unavailable'}
BTC Dominance:  ${market?.btcDominance != null ? market.btcDominance + '%' : 'unavailable'}
Options Skew:   ${options?.optionsSkew != null ? options.optionsSkew + ' (put IV ' + (options.optionsPutIV || '?') + '% vs call IV ' + (options.optionsCallIV || '?') + '% | P/C ratio ' + (options.optionsPCRatio || '?') + ')' : 'unavailable'}
${normRef}`;

  const phase = computePhase(p);
  const phaseBlock = phase ? `\n\nLIVE PHASE STATUS (computed from price $${p ? p.toLocaleString() : '?'}):
  Active Phase: ${phase.id} - ${phase.label}
${phase.pctToNext ? `  Distance to next phase boundary ($${phase.nextPhaseAt ? phase.nextPhaseAt.toLocaleString() : '?'}): +${phase.pctToNext}%` : ''}
  Phase progress: ${phase.progress.toFixed(0)}% through current range` : '';

  const corrStr = (tech?.btcQqqCorr != null)
    ? `\n  BTC-QQQ Correlation (${tech.corrWindow || 60}d Pearson): ${tech.btcQqqCorr} → ${Math.abs(tech.btcQqqCorr) > 0.7 ? 'HIGH — macro regime dominant today' : Math.abs(tech.btcQqqCorr) > 0.4 ? 'MODERATE — mixed on-chain vs macro signals' : 'LOW — on-chain signals dominate'} (use for correlationRegime field)`
    : '\n  BTC-QQQ Correlation: unavailable — estimate from macro context';

  const smaBlock = tech ? `\n\nLIVE TECHNICAL LEVELS (Binance ${tech.candleCount}-day computed):
  200d SMA: $${tech.sma200 ? tech.sma200.toLocaleString() : 'n/a'}${p ? ' (' + ((p - tech.sma200) / tech.sma200 * 100).toFixed(1) + '% from price)' : ''}
  50d SMA:  $${tech.sma50 ? tech.sma50.toLocaleString() : 'n/a'}${p ? ' (' + ((p - tech.sma50) / tech.sma50 * 100).toFixed(1) + '% from price)' : ''}
  20d SMA:  $${tech.sma20 ? tech.sma20.toLocaleString() : 'n/a'}${p ? ' (' + ((p - tech.sma20) / tech.sma20 * 100).toFixed(1) + '% from price)' : ''}${corrStr}
  OVERRIDE: Use these live SMA and correlation values. Ignore any hardcoded figures in Section 2.`
    : '\n\nTECHNICAL LEVELS: Unavailable — use hardcoded fallbacks from Section 2.';

  const coinMetricsBlock = coinMetrics
    ? `\n\nCOINMETRICS NETWORK HEALTH (live, free community tier — ${coinMetrics.date || 'recent'}):
  Active Addresses: ${coinMetrics.activeAddresses != null ? Math.round(coinMetrics.activeAddresses).toLocaleString() : 'n/a'}
  Tx Count (24h):   ${coinMetrics.txCount != null ? Math.round(coinMetrics.txCount).toLocaleString() : 'n/a'}
  Hash Rate:        ${coinMetrics.hashRate != null ? (coinMetrics.hashRate > 1e15 ? (coinMetrics.hashRate / 1e18).toFixed(1) : (coinMetrics.hashRate / 1e6).toFixed(1)) + ' EH/s' : 'n/a'}
  Total Fees (BTC): ${coinMetrics.totalFeesBTC != null ? coinMetrics.totalFeesBTC.toFixed(2) + ' BTC' : 'n/a'}
  INSTRUCTION: Use active addresses and tx count as network adoption signals.`
    : '\n\nCOINMETRICS NETWORK HEALTH: Unavailable — use training knowledge.';

  const macroBlock = (macros?.dxy != null || macros?.vix != null || macros?.tnxYield != null)
    ? (() => {
        let b = '\n\nLIVE MACRO DATA (Yahoo Finance — real-time, overrides training-knowledge estimates):';
        if (macros.dxy != null) {
          const dxyDir = macros.dxyChange != null ? (macros.dxyChange > 0 ? 'rising' : macros.dxyChange < 0 ? 'falling' : 'flat') : 'unknown';
          const dxySig = macros.dxy > 104 ? 'BEARISH for BTC (strong dollar)' : macros.dxy < 100 ? 'BULLISH for BTC (weak dollar)' : 'NEUTRAL';
          b += `\n  DXY (US Dollar Index): ${macros.dxy}${macros.dxyChange != null ? ' (' + (macros.dxyChange > 0 ? '+' : '') + macros.dxyChange + '% 1d)' : ''} — ${dxyDir} → ${dxySig}`;
        }
        if (macros.vix != null) {
          const vixR = macros.vix > 30 ? 'HIGH FEAR (risk-off)' : macros.vix > 20 ? 'ELEVATED (caution)' : macros.vix < 15 ? 'COMPLACENCY' : 'NORMAL';
          b += `\n  VIX (implied vol):     ${macros.vix}${macros.vixChange != null ? ' (' + (macros.vixChange > 0 ? '+' : '') + macros.vixChange + '% 1d)' : ''} → ${vixR}`;
        }
        if (macros.tnxYield != null) {
          const tnxSig = macros.tnxYield > 4.5 ? 'BEARISH for BTC (real yield pressure)' : macros.tnxYield < 3.5 ? 'BULLISH for BTC' : 'NEUTRAL';
          b += `\n  10Y Treasury Yield:    ${macros.tnxYield}%${macros.tnxChange != null ? ' (' + (macros.tnxChange > 0 ? '+' : '') + macros.tnxChange + '% 1d)' : ''} → ${tnxSig}`;
        }
        b += '\n  INSTRUCTION: These are LIVE macro readings — use them for macroContext. OVERRIDE training-knowledge estimates.';
        return b;
      })()
    : '\n\nLIVE MACRO DATA: Unavailable — use training knowledge for DXY, VIX, and yield estimates.';

  // MVRV + exchange flows from dune_cache.json
  const dc = duneCache;
  let duneBlock = '';
  if (dc?.mvrv || dc?.exchangeFlow) {
    const ef = dc.exchangeFlow;
    duneBlock = '\n\nDUNE ANALYTICS — BTC ON-CHAIN DATA:';
    if (ef?.netflow_btc != null) {
      duneBlock += `\n  Exchange Netflow: ${ef.netflow_btc.toFixed(0)} BTC`;
      duneBlock += `\n  Exchange Inflow:  ${(ef.inflow_btc || 0).toFixed(0)} BTC`;
      duneBlock += `\n  Exchange Outflow: ${(ef.outflow_btc || 0).toFixed(0)} BTC`;
      const gross = (ef.inflow_btc || 0) + (ef.outflow_btc || 0);
      if (gross < 5000) duneBlock += '\n  ⚠ PARTIAL DATA: cold/custody wallets only. Use directional indicator only.';
      else duneBlock += '\n  INSTRUCTION: Negative = BTC leaving exchanges (accumulation). Apply quad-normalization.';
    }
    if (dc?.mvrv?.mvrv) {
      const mv = dc.mvrv;
      const mvZone = mv.mvrv < 1 ? 'UNDERVALUED (<1)' : mv.mvrv < 2 ? 'FAIR VALUE (1-2)' : mv.mvrv < 3.5 ? 'FAIR-HIGH (2-3.5)' : mv.mvrv < 5 ? 'OVERVALUED (3.5-5)' : 'EXTREME (>5)';
      duneBlock += `\n\n  LIVE MVRV (Dune — realized cap from full UTXO set):
    MVRV Ratio: ${mv.mvrv.toFixed(3)} → ${mvZone}`;
      if (mv.realizedPrice) duneBlock += `\n    Realized Price: $${Math.round(mv.realizedPrice).toLocaleString()}`;
      duneBlock += '\n    INSTRUCTION: LIVE on-chain MVRV — overrides training-knowledge estimates.';
    }
  } else {
    duneBlock = '\n\nDUNE ANALYTICS: Unavailable. Use training knowledge for on-chain estimates.';
  }

  // CME block
  let cmeBlock = '';
  if (cme?.cmeBasisPct != null) {
    const basisLabel = cme.cmeBasisPct > 15 ? 'STRONG CONTANGO — institutional demand elevated'
      : cme.cmeBasisPct > 5 ? 'HEALTHY CONTANGO — mild institutional bid'
      : cme.cmeBasisPct > -5 ? 'FLAT — neutral institutional positioning'
      : 'BACKWARDATION — institutional risk-off';
    cmeBlock = `\n\nCME FUTURES BASIS:
  CME Basis (annualized): ${cme.cmeBasisPct > 0 ? '+' : ''}${cme.cmeBasisPct}% → ${basisLabel}
  Front-month days to expiry: ${cme.cmeDaysToExpiry}d${cme.cmeNearExpiry ? ' ⚠ NEAR EXPIRY — using second month' : ''}`;
    if (cme.cmeSecondMonthBasis != null) cmeBlock += `\n  Second-month basis: ${cme.cmeSecondMonthBasis > 0 ? '+' : ''}${cme.cmeSecondMonthBasis}% ann`;
    if (cme.cmeBasisWeighted != null) cmeBlock += `\n  Weighted (70/30): ${cme.cmeBasisWeighted > 0 ? '+' : ''}${cme.cmeBasisWeighted}% ann`;
    cmeBlock += '\n  INSTRUCTION: CME basis is UNCORRELATED from perp funding — score independently.';
  } else {
    cmeBlock = '\n\nCME FUTURES BASIS: Unavailable — estimate institutional positioning from macro context.';
  }

  // ETF flows from dune_cache.json
  let etfBlock = '';
  const etf = dc?.etfFlow;
  if (etf?.total_million_usd != null) {
    const etfNet = etf.total_million_usd * 1e6;
    const etfNetBTC = p ? Math.round(etfNet / p) : null;
    const etfPctLiq = etfNetBTC ? ((etfNetBTC / LIQUID) * 100).toFixed(3) : null;
    etfBlock = `\n\nLIVE ETF FLOWS (Farside Investors — ${etf.date || 'today'}):
  Total Net Flow (USD): ${etfNet >= 0 ? '+' : ''}$${(etfNet / 1e6).toFixed(0)}M`;
    if (etfNetBTC) etfBlock += `\n  Total Net Flow (BTC): ${etfNetBTC >= 0 ? '+' : ''}${etfNetBTC.toLocaleString()} BTC`;
    if (etfPctLiq) etfBlock += `\n  % of Liquid Supply:   ${etfNetBTC >= 0 ? '+' : ''}${etfPctLiq}%`;
    etfBlock += '\n  INSTRUCTION: LIVE ETF data — use as primary ETF signal. Override training knowledge.';
  } else {
    etfBlock = '\n\nETF FLOWS: Live data unavailable. Do not report an ETF inflow/outflow figure.';
  }

  // LTH block
  let lthBlock = '';
  const lth = dc?.lthData;
  if (lth?.lth_net_btc != null) {
    const sign = lth.lth_net_btc >= 0 ? '+' : '';
    const pctLiq = ((lth.lth_net_btc / LIQUID) * 100).toFixed(3);
    const regime = lth.lth_net_btc >= 5000 ? 'ACCUMULATING' : lth.lth_net_btc <= -5000 ? 'DISTRIBUTING' : 'NEUTRAL';
    lthBlock = `\n\nLIVE LTH NET POSITION CHANGE (Bitcoin Magazine Pro — ${lth.date}):
  LTH Net BTC/day: ${sign}${lth.lth_net_btc.toLocaleString()} BTC
  % of Liquid Supply: ${sign}${pctLiq}%
  Regime: ${regime}
  INSTRUCTION: LIVE data — populate lthSellingBTC = '${sign}${lth.lth_net_btc.toLocaleString()} BTC/day', lthSellingPctLiquid = '${sign}${pctLiq}%'. Do NOT override with training knowledge.`;
  } else {
    lthBlock = '\n\nLTH NET POSITION: Unavailable. Set lthSellingBTC = \'N/A\' and lthSellingPctLiquid = null.';
  }

  // Stablecoin block
  let stableBlock = '';
  const st = dc?.stablecoinSupply;
  if (st?.total_usd != null) {
    const totalB = (st.total_usd / 1e9).toFixed(1);
    const deltaB = st.delta_7d_usd != null ? (st.delta_7d_usd >= 0 ? '+' : '') + (st.delta_7d_usd / 1e9).toFixed(1) + 'B' : 'N/A';
    stableBlock = `\n\nLIVE STABLECOIN SUPPLY (CoinGecko — ${st.date}):
  USDT supply: $${st.usdt_supply_usd != null ? (st.usdt_supply_usd / 1e9).toFixed(1) + 'B' : 'N/A'}
  USDC supply: $${st.usdc_supply_usd != null ? (st.usdc_supply_usd / 1e9).toFixed(1) + 'B' : 'N/A'}
  USDT+USDC total: $${totalB}B
  7-day delta: ${deltaB}
  Regime: ${st.regime || 'STABLE'}
  INSTRUCTION: Use for scoreDecomposition.stablecoin axis. EXPANDING = dry powder building = +1. CONTRACTING = -1. This is LIVE data.`;
  } else {
    stableBlock = '\n\nSTABLECOIN SUPPLY: Unavailable. Estimate from training knowledge.';
  }

  // Volume trend block
  let volTrendBlock = '';
  if (tech?.volTrend && tech.volTrend !== 'UNKNOWN') {
    volTrendBlock = `\n\nLIVE VOLUME TREND (computed from ${tech.candleCount} daily candles):
  5d avg volume:  ${tech.avgVol5d ? tech.avgVol5d.toLocaleString() + ' BTC/day' : 'n/a'}
  20d avg volume: ${tech.avgVol20d ? tech.avgVol20d.toLocaleString() + ' BTC/day' : 'n/a'}
  5d/20d ratio:   ${tech.volTrendRatio || 'n/a'} → ${tech.volTrend}
  INSTRUCTION: Use for volumeTrend field. RISING = participation increasing.`;
  }

  const qualitySummary = `\n\nDATA SOURCE QUALITY SUMMARY:
- LIVE (high confidence): price, funding, OI, fear/greed, options skew, gold, dominance, SMAs, vol trend, CME basis` +
    (macros?.dxy != null ? ', DXY' : '') + (macros?.vix != null ? ', VIX' : '') + (macros?.tnxYield != null ? ', 10Y yield' : '') +
    (tech?.btcQqqCorr != null ? `, BTC-QQQ correlation (${tech.corrWindow}d live)` : '') +
    (dc?.mvrv?.mvrv != null ? ', MVRV (Dune live)' : '') +
    (etf?.total_million_usd != null ? ', ETF flows (Farside)' : '') +
    (lth?.lth_net_btc != null ? ', LTH net position (BMP live)' : '') +
    (st?.total_usd != null ? ', stablecoin supply (CoinGecko live)' : '') +
    `\n- ESTIMATED (training knowledge): whale netflows` +
    (dc?.mvrv?.mvrv == null ? ', MVRV (use ~1.5 estimate)' : '') +
    (etf?.total_million_usd == null ? ', ETF actual flows' : '') +
    `, STH SOPR
\nGenerate the full morning brief JSON now. Apply quad-normalization to all flows. Score each signal component INDEPENDENTLY per Section F — do NOT double-count funding + fear/greed. Return ONLY valid JSON. No markdown. No preamble.`;

  return marketBlock + phaseBlock + smaBlock + coinMetricsBlock + macroBlock + duneBlock + cmeBlock + etfBlock + lthBlock + stableBlock + volTrendBlock + qualitySummary;
}

// ── Call Anthropic Claude ─────────────────────────────────────────────────────
async function callClaude(systemPrompt, userMessage) {
  if (!ANTHROPIC_KEY) throw new Error('No ANTHROPIC_API_KEY');
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 7000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(180000), // 3 min
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Anthropic HTTP ${r.status}: ${err.slice(0, 200)}`);
  }
  const data = await r.json();
  if (data.error) throw new Error(`Anthropic API error: ${data.error.type} — ${data.error.message}`);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// ── Parse & repair JSON from Claude ──────────────────────────────────────────
function parseClaudeJSON(raw) {
  const cleaned = raw.replace(/```json\s*|```\s*/g, '').trim();
  const repairJson = str => {
    let s = str.replace(/,\s*([\}\]])/g, '$1');
    let braces = 0, brackets = 0, inStr = false, escape = false;
    for (const c of s) {
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"' && !escape) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') braces++;
      else if (c === '}') braces--;
      else if (c === '[') brackets++;
      else if (c === ']') brackets--;
    }
    if (inStr) s += '"';
    while (brackets > 0) { s += ']'; brackets--; }
    while (braces  > 0) { s += '}'; braces--;  }
    return s;
  };
  try { return JSON.parse(cleaned); } catch (_) {}
  const match = cleaned.match(/\{[\s\S]*/);
  if (!match) throw new Error('no JSON object found in Claude response');
  return JSON.parse(repairJson(match[0]));
}

// ── SYSTEM PROMPT (copied from BTC_MorningBrief_Nansen_live.jsx) ──────────────
// Keep in sync with the JSX version when making updates.
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
Key resistance: $72.5K (61.8% Fib) | $79K (bear flag invalidation) | $98K (200d SMA = true bull reversal)
Key support:   $68K (20d SMA zone) | $65K (whale accumulation zone) | $60K (2026 cycle low)
Key catalysts: CLARITY Act vote | Fed Chair appointment May 2026 | CA/Indiana pension laws Jul 1 | US Midterms Nov 2026

SECTION 2 - BACKGROUND CONTEXT (as of April 2026)
NOTE: Treat this as background only. Live data fed in the user message ALWAYS overrides this narrative.
MACRO NOTE: DXY, VIX, and 10Y Treasury yield are now fed as LIVE values in the user message.
Do NOT use Section 2 estimates for those three fields — always use the live readings.
- BTC ATH: $126,073 (Oct 6, 2025) | Bear phase: Oct 2025–Feb 2026 (5 consecutive red months)
- Recovery phase: March–April 2026 | Current range mid-cycle rebound
- ETF AUM: IBIT ~$115B+ | Combined spot ETF AUM ~$130B+ | Baseline inflow: ~$264M/day
- Apr 2026 macro context: US tariff escalation (Liberation Day Apr 2), broad risk-off
- LTH selling significantly reduced since Mar 2026 | Miner capitulation resolved
- Next BTC halving: ~April 2028 | Current supply: 450 BTC/day (post-2024 halving)
- CLARITY Act: BTC classified as commodity under CFTC - Senate vote pending
- Realized Price (network avg cost basis): ~$45K | STH cost basis: ~$75K | LTH cost basis: ~$30K

SECTION 2B - HISTORICAL CONFLUENCE PRECEDENT TABLE
When making historical comparisons, ALWAYS cite the n= sample size and the counter-case.

CONFLUENCE A — MVRV 1.2–1.4 + F&G <20 + LTH accumulating (n=5):
  HIT RATE: 4/5 (80%) resolved bullish within 3–6 months.
  CITATION RULE: Always quote "n=5, 4/5 resolved bullish; counter-case: Nov 2022 FTX (-20% further)".

CONFLUENCE B — BTC-equity correlation decoupling (<0.2 Pearson 60d) during risk-off (n=3):
  HIT RATE: 2/3 (67%). Decoupling is necessary but not sufficient.

CONFLUENCE C — Extreme Fear (<15) + BTC above 200d SMA (n=6):
  Hit rate: 5/6 resolved to new local highs within 30 days.
  CITATION RULE: Always quote "n=6, 5/6 resolved bullish; counter-case: Aug 2023 (flat 30d)".

SECTION 3 - QUAD-NORMALIZED SIGNAL KNOWLEDGE BASE
METHODOLOGY: Four normalization axes required.
  AXIS 1 - % Liquid Supply  = BTC_flow / 4,200,000 x 100
  AXIS 2 - % Daily Volume   = BTC_flow / daily_vol_BTC x 100
  AXIS 3 - % Market Cap     = (BTC x price) / mcap x 100
  AXIS 4 - % Circ Supply    = BTC_flow / 20,000,000 x 100

A. WHALE NETFLOW THRESHOLDS (% liquid supply, daily):
  Outflow >0.75%  -> EXTREME accumulation
  Outflow 0.35-0.75% -> Strong accumulation
  Outflow 0.10-0.35% -> Mild accumulation
  Neutral <+-0.10% -> Noise
  Inflow 0.10-0.35%  -> Mild distribution
  Inflow 0.35-0.75%  -> Strong distribution
  Inflow >0.75%   -> EXTREME distribution

B. FUNDING RATES (perpetual futures):
  > +0.10% per 8h  -> Extreme bullish leverage
  +0.03-0.10%      -> Elevated longs - caution
  -0.01% to +0.03% -> Neutral/healthy
  -0.03% to -0.10% -> Shorts paying longs - BULLISH contrarian signal
  < -0.10% per 8h  -> Extreme short squeeze setup

C. OPEN INTEREST REGIME:
  Rising OI + rising price  -> Trend confirmation
  Rising OI + falling price -> Short attack / distribution
  Falling OI + rising price -> Short squeeze / weak rally
  Falling OI + falling price -> Forced deleveraging / capitulation

D. MVRV Z-SCORE:
  MVRV < 0 -> MAXIMUM accumulation
  MVRV 0-1 -> Undervalued - strong buy territory
  MVRV 1-3 -> Fair value range - hold
  MVRV 3-5 -> Overvalued - begin reducing
  MVRV > 5 -> Extreme greed

E. CME FUTURES BASIS (institutional demand signal):
  Basis > +15% annualized  -> Strong institutional long demand
  Basis +5 to +15%         -> Healthy contango
  Basis -5 to +5%          -> Flat / neutral
  Basis < -5%              -> Backwardation - institutional selling

F. COMPOSITE SIGNAL SCORING (-10 to +10):
  onChain (whale netflow + MVRV + LTH):  max ±3 points
  etfInstitutional (ETF flows vs baseline): max ±2 points
  derivatives (funding OR F&G — stronger only, NOT both): max ±1 point
  cmeBasis (institutional demand — uncorrelated with perp): max ±1 point
  macro (DXY / real yields / VIX):       max ±1 point
  sentiment (Fear&Greed if not already used): max ±1 point
  stablecoin (USDT+USDC supply growth):  max ±1 point
  TOTAL range: -10 to +10
  SCORE: +8 to +10 -> STRONG BUY | +5 to +7 -> BUY | +2 to +4 -> LEAN BUY
         -1 to +1  -> NEUTRAL    | -2 to -4  -> CAUTION | -5 to -10 -> SELL/HEDGE

  CRITICAL — ANTI-DOUBLE-COUNT RULE:
  Funding rate and Fear/Greed Index are CORRELATED (both measure leverage sentiment).
  Score them on a SHARED "derivatives" axis worth max ±1 total.
  CME basis is the INDEPENDENT institutional proxy — always score it separately.
  SCORE TRANSPARENCY: You MUST populate the scoreDecomposition object in the output JSON.

SECTION 4 - OUTPUT RULES
Return ONLY valid JSON. No markdown fences. No preamble. No text outside the JSON.

{
  "date": "Day, Month DD YYYY",
  "contextTimestamp": "note if Section 2 context appears stale vs live data",
  "normalization": {
    "currentPrice": "$XX,XXX",
    "marketCap": "$X.XXT",
    "circulatingSupply": "~20.0M BTC",
    "liquidSupply": "~4.2M BTC",
    "dailyVolumeBTC": "~XXX,XXX BTC",
    "dailyVolumeUSD": "~$XXB",
    "volumeRegime": "HIGH | NORMAL | LOW",
    "volumeTrend": "RISING | FALLING | STABLE",
    "whaleNetflowBTC": "e.g. -6,200 BTC",
    "whaleNetflowPctLiquid": "e.g. -0.148%",
    "whaleNetflowPctVolume": "e.g. -1.63%",
    "whaleNetflowPctMcap": "e.g. -0.031%",
    "etfFlowUSD": "e.g. +$310M",
    "etfFlowBTC": "e.g. +4,282 BTC",
    "etfFlowPctLiquid": "e.g. +0.102%",
    "lthSellingBTC": "N/A or live value",
    "lthSellingPctLiquid": null
  },
  "compositeScore": 0,
  "scoreDecomposition": {
    "onChain":          { "score": 0, "signal": "" },
    "etfInstitutional": { "score": 0, "signal": "" },
    "derivatives":      { "score": 0, "signal": "" },
    "cmeBasis":         { "score": 0, "signal": "" },
    "macro":            { "score": 0, "signal": "" },
    "sentiment":        { "score": 0, "signal": "" },
    "stablecoin":       { "score": 0, "signal": "" },
    "scaleNote":        "Range -10 to +10."
  },
  "overallBias": "STRONG BUY | BUY | NEUTRAL | CAUTION | SELL",
  "biasReason": "<=20 words citing dominant normalized signal",
  "headline": "<=15 words",
  "marketStatus": "ACCUMULATION PHASE | BREAKOUT WATCH | MOMENTUM | BULL RUN | DISTRIBUTION | DANGER ZONE",
  "correlationRegime": { "btcQqqCorrelation": "", "regime": "HIGH | MODERATE | LOW", "implication": "" },
  "priceAnalysis": { "trend": "", "keyLevel": "", "realizedPriceContext": "", "signal": "BULLISH | BEARISH | NEUTRAL | MIXED" },
  "whaleSignal": { "status": "ACCUMULATING | DISTRIBUTING | NEUTRAL | MIXED", "netflowBTC": "", "netflowUSD": "", "netflowPctLiquid": "", "netflowPctVolume": "", "netflowPctMcap": "", "historicalContext": "", "detail": "", "actionable": "" },
  "fundingRates": { "rate8h": "", "annualized": "", "regime": "CAPITULATION | BEARISH | NEUTRAL | ELEVATED | EXTREME_LONG", "signal": "", "detail": "", "squeeze_risk": "LOW | MEDIUM | HIGH" },
  "openInterest": { "trend": "RISING | FALLING | STABLE", "regime": "", "detail": "", "leverageRisk": "LOW | MEDIUM | HIGH" },
  "mvrvSignal": { "estimatedZone": "", "implication": "", "cycleContext": "" },
  "etfFlows": { "status": "INFLOW | OUTFLOW | NEUTRAL", "totalNetUSD": "", "totalNetBTC": "", "totalNetPctLiquid": "", "totalNetPctMcap": "", "ibitFlow": "", "streakDays": "", "vsBaseline": "", "detail": "", "trend": "IMPROVING | DETERIORATING | STABLE" },
  "stablecoinSignal": { "status": "INFLOW | OUTFLOW | NEUTRAL", "detail": "", "signal": "" },
  "macroContext": { "riskLevel": "HIGH | MEDIUM | LOW", "dxy": "", "dxySignal": "", "realYield": "", "realYieldSignal": "", "gold": "", "goldSignal": "", "fedWatch": "", "geopolitical": "", "detail": "" },
  "todayAction": { "recommendation": "ACCUMULATE | ADD | HOLD | REDUCE | HEDGE | WAIT", "size": "", "trigger": "", "stopAlert": "ACTIVE | MONITORING | CLEAR", "dynamicStop": "", "scoreJustification": "" },
  "cmeBasis": { "basisPct": "", "regime": "STRONG CONTANGO | HEALTHY | FLAT | BACKWARDATION", "signal": "", "detail": "", "cmeOIvsPerp": "" },
  "catalystWatch": [{"event": "", "timing": "", "impact": "BULLISH | BEARISH | BINARY", "note": ""}],
  "analystNote": "4-5 sentences.",
  "riskWarning": "the ONE risk that could invalidate today thesis"
}`;

// ── Main run ──────────────────────────────────────────────────────────────────
async function runBriefWorker() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[Brief] Run started — ${new Date().toISOString()}`);

  // 1. Load existing dune_cache.json
  const duneCache = loadDuneCache();
  console.log(`[Brief] Dune cache loaded — cachedAt: ${duneCache.cachedAt || 'unknown'}`);

  // 2. Fetch market data
  console.log('[Brief] Fetching live market snapshot...');
  const market = await fetchMarketSnapshot();

  // 3. Fetch technical levels (SMAs + QQQ correlation)
  console.log('[Brief] Fetching 200d candles + QQQ correlation...');
  const tech = await fetchTechnicalData(market?.price);

  // 4. Options skew (Deribit)
  console.log('[Brief] Fetching options skew (Deribit)...');
  const options = await fetchOptionsSkew(market?.price);

  // 5. Macro data (Yahoo Finance)
  console.log('[Brief] Fetching macro data (DXY / VIX / TNX)...');
  const macros = await fetchMacros();

  // 6. CME basis (Yahoo Finance BTC=F)
  console.log('[Brief] Fetching CME futures basis...');
  const cme = await fetchCME();

  // 7. CoinMetrics community API
  console.log('[Brief] Fetching CoinMetrics...');
  const coinMetrics = await fetchCoinMetrics();

  // 8. Assemble all_data payload (merge with dune_cache)
  const allData = {
    ...duneCache,
    market,
    tech,
    options,
    macros,
    cme,
    coinMetrics,
    briefCachedAt: new Date().toISOString(),
  };

  // Write all_data.json without brief first (so market data is available even if Claude fails)
  mkdirSync(join(__dirname, 'public'), { recursive: true });
  writeFileSync(ALL_DATA_FILE, JSON.stringify(allData, null, 2));
  console.log(`[Brief] all_data.json written (without brief) — ${ALL_DATA_FILE}`);

  // 9. Generate Claude brief
  if (!ANTHROPIC_KEY) {
    console.warn('[Brief] Skipping Claude call — no ANTHROPIC_API_KEY');
  } else {
    try {
      console.log('[Brief] Building user message...');
      const userMessage = buildUserMessage({ market, tech, coinMetrics, macros, cme, duneCache, options });

      console.log('[Brief] Calling Claude (claude-sonnet-4-6)...');
      const t0 = Date.now();
      const rawBrief = await callClaude(SYSTEM_PROMPT, userMessage);
      const elapsed  = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[Brief] Claude responded in ${elapsed}s`);

      const parsedBrief = parseClaudeJSON(rawBrief);
      allData.brief = parsedBrief;

      console.log(`[Brief] ✓ Brief generated — bias: ${parsedBrief.overallBias} | score: ${parsedBrief.compositeScore} | headline: ${parsedBrief.headline}`);
    } catch (e) {
      console.error('[Brief] Claude call failed:', e.message);
      allData.brief_error = e.message;
    }
  }

  // 10. Write final all_data.json
  writeFileSync(ALL_DATA_FILE, JSON.stringify(allData, null, 2));
  console.log(`[Brief] ✓ all_data.json written — ${ALL_DATA_FILE}`);
}

runBriefWorker()
  .then(() => { console.log('[Brief] Done.'); process.exit(0); })
  .catch(e  => { console.error('[Brief] Fatal:', e.message); process.exit(1); });
