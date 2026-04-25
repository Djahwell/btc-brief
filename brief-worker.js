#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// brief-worker.js  —  BTC Morning Brief · Claude Brief Generator (slim)
// ─────────────────────────────────────────────────────────────────────────────
// Lean refactor (2026-04-25): all data fetching moved to data-worker.js.
// This worker reads public/all_data.json, builds the Claude user message,
// calls Anthropic Claude once, and writes back only the brief fields.
//
// Pre-condition: data-worker.js must have run and produced all_data.json
// containing market.price (otherwise we abort WITHOUT calling Anthropic to
// avoid burning API budget on an incomplete brief).
//
// Usage:
//   node brief-worker.js
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname }                                       from 'path';
import { fileURLToPath }                                       from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const ALL_DATA_FILE  = join(__dirname, 'public', 'all_data.json');
const WORKER_VERSION = '3.0.0'; // slim: data fetching delegated to data-worker.js

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
  "normalization": { "currentPrice": "", "marketCap": "", "dailyVolumeBTC": "", "volumeTrend": "", "lthSellingBTC": "N/A or live value", "lthSellingPctLiquid": null, "whaleNetflowBTC": "e.g. -6,200 BTC (negative = outflow from exchanges = accumulation)", "whaleNetflowPctLiquid": "e.g. -0.148%", "whaleNetflowPctVolume": "e.g. -1.63%", "whaleNetflowPctMcap": "e.g. -0.031%", "etfFlowUSD": "e.g. +$664M", "etfFlowBTC": "e.g. +4,282 BTC (convert from USD using today's price)", "etfFlowPctLiquid": "e.g. +0.102%" }
}`;

// ── Main run ──────────────────────────────────────────────────────────────────
async function runBriefWorker() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[Brief] Run started v${WORKER_VERSION} — ${new Date().toISOString()}`);

  // ── Pre-flight: all_data.json must exist with market.price ──────────────────
  // Per architecture: data-worker.js runs every 6h via cron and produces this
  // file. brief-worker.js refuses to call Anthropic if the data is missing,
  // so we never burn API budget on an incomplete brief.
  if (!existsSync(ALL_DATA_FILE)) {
    console.error(`[Brief] FATAL: ${ALL_DATA_FILE} not found.`);
    console.error('[Brief] Run `node data-worker.js` first. Aborting WITHOUT calling Anthropic.');
    process.exit(1);
  }

  let allData;
  try {
    allData = JSON.parse(readFileSync(ALL_DATA_FILE, 'utf8'));
  } catch (e) {
    console.error(`[Brief] FATAL: failed to parse ${ALL_DATA_FILE}: ${e.message}`);
    console.error('[Brief] Aborting WITHOUT calling Anthropic.');
    process.exit(1);
  }

  if (!allData?.market?.price) {
    console.error('[Brief] FATAL: market.price missing from all_data.json.');
    console.error('[Brief] data-worker.js may have failed to fetch price. Aborting WITHOUT calling Anthropic.');
    process.exit(1);
  }

  console.log(`[Brief] all_data.json loaded — cachedAt: ${allData.cachedAt || 'unknown'} | price: $${allData.market.price.toLocaleString()}`);

  if (!ANTHROPIC_KEY) {
    console.error('[Brief] FATAL: VITE_ANTHROPIC_API_KEY missing. Aborting.');
    process.exit(1);
  }

  // ── Build user message + call Claude ────────────────────────────────────────
  // Pass duneCache=allData so buildUserMessage's `dc.etfFlow`, `dc.mvrv`,
  // `dc.exchangeFlow`, `dc.lthData`, `dc.stablecoinSupply`, and
  // `dc.binanceLargeTrades` lookups all hit the unified all_data.json shape.
  try {
    console.log('[Brief] Building user message...');
    const userMessage = buildUserMessage({
      market:      allData.market,
      tech:        allData.tech,
      options:     allData.options,
      macros:      allData.macros,
      cme:         allData.cme,
      coinMetrics: allData.coinMetrics,
      duneCache:   allData,
    });

    console.log('[Brief] Calling Claude...');
    const t0 = Date.now();
    const rawBrief = await callClaude(SYSTEM_PROMPT, userMessage);
    console.log(`[Brief] Claude responded in ${((Date.now()-t0)/1000).toFixed(1)}s`);

    const parsedBrief = parseClaudeJSON(rawBrief);
    allData.brief         = parsedBrief;
    allData.briefCachedAt = new Date().toISOString();
    delete allData.brief_error; // clear stale error on success

    console.log(`[Brief] ✓ Brief — bias: ${parsedBrief.overallBias} | score: ${parsedBrief.compositeScore}`);
  } catch (e) {
    console.error('[Brief] Claude failed:', e.message);
    allData.brief_error   = e.message;
    allData.briefErrorAt  = new Date().toISOString();

    mkdirSync(join(__dirname, 'public'), { recursive: true });
    writeFileSync(ALL_DATA_FILE, JSON.stringify(allData, null, 2));
    process.exit(1);
  }

  mkdirSync(join(__dirname, 'public'), { recursive: true });
  writeFileSync(ALL_DATA_FILE, JSON.stringify(allData, null, 2));
  console.log(`[Brief] ✓ all_data.json updated — ${ALL_DATA_FILE}`);
}

runBriefWorker()
  .then(() => { console.log('[Brief] Done.'); process.exit(0); })
  .catch(e  => { console.error('[Brief] Fatal:', e.message); process.exit(1); });
