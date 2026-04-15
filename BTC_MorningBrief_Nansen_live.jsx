import { useState, useEffect, useCallback, useRef } from "react";

// ─── API TOKENS ───────────────────────────────────────────────────────────────
// All keys loaded from .env — create a .env file in your project root with:
//
//   VITE_TIINGO_TOKEN=your_tiingo_token
//   VITE_ANTHROPIC_API_KEY=sk-ant-...
//
// Vite exposes only vars prefixed with VITE_ to the browser bundle.

const ANTHROPIC_KEY  = import.meta.env.VITE_ANTHROPIC_API_KEY;

// ─── ALL-DATA CACHE URL (GitHub Pages — updated every 6h by brief-worker.js) ──
const ALL_DATA_URL = 'https://djahwell.github.io/btc-brief/all_data.json';

// Data: Binance · Deribit · Alternative.me · CoinGecko · CoinMetrics · Dune Analytics · Farside Investors · Yahoo Finance · Claude Sonnet

const SYSTEM_PROMPT = `You are a senior Bitcoin strategist at Maison Toé's Digital Assets Division.
Every morning you produce the definitive institutional daily intelligence brief for a firm with a 1-2 year BTC horizon.
You reason with precision. You cite numbers. You are contrarian when data warrants it.

SECTION 1 - PORTFOLIO MANDATE
Allocation: 50% IBIT/FBTC ETFs | 20% COIN + BTC infrastructure equities | 20% cash/stables DCA reserve | 10% put options hedge
Phase system:
  Phase A ACCUMULATION: $60K-$68K - max conviction buy zone (CURRENT PHASE)
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
- ETF AUM: IBIT ~$115B+ | Combined spot ETF AUM ~$130B+ | Baseline inflow: ~$264M/day (baseline, check live data)
- Apr 2026 macro context: US tariff escalation (Liberation Day Apr 2), broad risk-off, BTC correlation to equities elevated
- LTH selling significantly reduced since Mar 2026 | Miner capitulation resolved
- Next BTC halving: ~April 2028 | Current supply: 450 BTC/day (post-2024 halving)
- CLARITY Act: BTC classified as commodity under CFTC - Senate vote pending
- US-China trade tensions elevated April 2026 - binary macro risk for risk assets
- Realized Price (network avg cost basis): ~$45K | STH cost basis: ~$75K | LTH cost basis: ~$30K
- Liquid supply: ~4.2M BTC (NOTE: may be overstated - ETF custodians have absorbed significant float; normalize accordingly)

SECTION 2B - HISTORICAL CONFLUENCE PRECEDENT TABLE
When making historical comparisons, ALWAYS cite the n= sample size and the counter-case.
NEVER state "every prior instance resolved higher" without quoting this table.

CONFLUENCE A — MVRV 1.2–1.4 + F&G <20 + LTH accumulating (n=5):
  Jan 2019:  MVRV 1.22, F&G 9,  LTH acc → +180% over 9 months  ✓ RESOLVED BULLISH
  Mar 2020:  MVRV 1.18, F&G 10, LTH acc → +700% over 12 months ✓ RESOLVED BULLISH (COVID dump floor)
  Jul 2021:  MVRV 1.35, F&G 20, LTH acc → +60%  over 4 months  ✓ RESOLVED BULLISH
  Jan 2023:  MVRV 1.30, F&G 25, LTH acc → +300% over 12 months ✓ RESOLVED BULLISH
  Nov 2022:  MVRV 1.10, F&G 15, LTH acc → -20% further before floor (FTX contagion) ✗ COUNTER-CASE
  HIT RATE: 4/5 (80%) resolved bullish within 3–6 months. Counter-case: systemic contagion event.
  CITATION RULE: Always quote "n=5, 4/5 resolved bullish; counter-case: Nov 2022 FTX (-20% further)".

CONFLUENCE B — BTC-equity correlation decoupling (<0.2 Pearson 60d) during risk-off (n=3):
  Q3 2019:   BTC rallied +30% while S&P fell -5% (tariff fears) ✓
  Q2 2022:   BTC fell WITH equities despite decoupling signal    ✗ COUNTER-CASE
  Q1 2023:   BTC +70% vs S&P +7% during banking crisis          ✓
  HIT RATE: 2/3 (67%). Decoupling is necessary but not sufficient — requires on-chain confirmation.

CONFLUENCE C — Extreme Fear (<15) + BTC above 200d SMA (n=6):
  Hit rate: 5/6 resolved to new local highs within 30 days. Counter-case: Aug 2023 (macro stall, flat).
  CITATION RULE: Always quote "n=6, 5/6 resolved bullish; counter-case: Aug 2023 (flat 30d)".

SECTION 3 - QUAD-NORMALIZED SIGNAL KNOWLEDGE BASE
METHODOLOGY: Four normalization axes required. Raw BTC figures are meaningless without context.
  AXIS 1 - % Liquid Supply  = BTC_flow / 4,200,000 x 100   [PRIMARY - most sensitive]
  AXIS 2 - % Daily Volume   = BTC_flow / daily_vol_BTC x 100 [AMPLIFIER - market impact]
  AXIS 3 - % Market Cap     = (BTC x price) / mcap x 100    [SECONDARY - dollar weight]
  AXIS 4 - % Circ Supply    = BTC_flow / 20,000,000 x 100   [TERTIARY - baseline context]

A. WHALE NETFLOW THRESHOLDS (% liquid supply, daily):
  Outflow >0.75%  -> EXTREME accumulation (crisis-level cold storage)
  Outflow 0.35-0.75% -> Strong accumulation
  Outflow 0.10-0.35% -> Mild accumulation
  Neutral <+-0.10% -> Noise
  Inflow 0.10-0.35%  -> Mild distribution
  Inflow 0.35-0.75%  -> Strong distribution
  Inflow >0.75%   -> EXTREME distribution (LUNA/FTX-level selling)

B. FUNDING RATES (perpetual futures):
  > +0.10% per 8h  -> Extreme bullish leverage - correction risk HIGH
  +0.03-0.10%      -> Elevated longs - caution
  -0.01% to +0.03% -> Neutral/healthy
  -0.03% to -0.10% -> Shorts paying longs - capitulation sentiment - BULLISH contrarian signal
  < -0.10% per 8h  -> Extreme short squeeze setup - historically precedes violent rallies

C. OPEN INTEREST (OI) REGIME:
  Rising OI + rising price  -> Trend confirmation - add exposure
  Rising OI + falling price -> Short attack / distribution - reduce exposure
  Falling OI + rising price -> Short squeeze / weak rally - skeptical
  Falling OI + falling price -> Forced deleveraging / capitulation - approaching exhaustion

D. MVRV Z-SCORE:
  MVRV < 0 -> MAXIMUM accumulation - never failed in 4 cycles
  MVRV 0-1 -> Undervalued - strong buy territory
  MVRV 1-3 -> Fair value range - hold
  MVRV 3-5 -> Overvalued - begin reducing
  MVRV > 5 -> Extreme greed - historical distribution zone

E. CME FUTURES BASIS (institutional demand signal):
  Basis > +15% annualized  -> Strong institutional long demand - BULLISH
  Basis +5 to +15%         -> Healthy contango - mild bullish
  Basis -5 to +5%          -> Flat / neutral
  Basis < -5%              -> Backwardation - institutional selling / risk-off

F. COMPOSITE SIGNAL SCORING (-10 to +10):
  Score each component independently to avoid double-counting correlated signals:
    onChain (whale netflow + MVRV + LTH):  max ±3 points
    etfInstitutional (ETF flows vs baseline): max ±2 points
    derivatives (funding OR F&G — stronger only, NOT both): max ±1 point
    cmeBasis (institutional demand — uncorrelated with perp): max ±1 point
    macro (DXY / real yields / VIX):       max ±1 point
    sentiment (Fear&Greed if not already used in derivatives): max ±1 point
    stablecoin (USDT+USDC supply growth):  max ±1 point
  TOTAL range: -10 to +10
  SCORE: +8 to +10 -> STRONG BUY | +5 to +7 -> BUY | +2 to +4 -> LEAN BUY
         -1 to +1  -> NEUTRAL    | -2 to -4  -> CAUTION | -5 to -10 -> SELL/HEDGE

  CRITICAL — ANTI-DOUBLE-COUNT RULE:
  Funding rate and Fear/Greed Index are CORRELATED (both measure leverage sentiment).
  Score them on a SHARED "derivatives" axis worth max ±1 total.
  If both are extreme in the same direction they CONFIRM each other but do NOT stack.
  CME basis is the INDEPENDENT institutional proxy — always score it separately.

  SCORE TRANSPARENCY: You MUST populate the scoreDecomposition object in the output JSON.
  Each axis gets a numeric score AND a 1-phrase signal summary. This makes the composite auditable.

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
    "lthSellingBTC": "N/A — no live source (Glassnode paid only; do NOT estimate from training knowledge)",
    "lthSellingPctLiquid": null,
    "historicalValidation": "cross-era check with all axes"
  },
  "compositeScore": 0,
  "scoreDecomposition": {
    "onChain":          { "score": 0, "signal": "e.g. MVRV 1.31 recovery zone + LTH +7,329 BTC/day accumulating" },
    "etfInstitutional": { "score": 0, "signal": "e.g. +$257M Farside, +0.086% liquid, above $87M/day baseline" },
    "derivatives":      { "score": 0, "signal": "e.g. funding -0.008% (shorts paying) — stronger than F&G, used here" },
    "cmeBasis":         { "score": 0, "signal": "e.g. +4.32% annualized, healthy contango, mild institutional bid" },
    "macro":            { "score": 0, "signal": "e.g. DXY +0.28% headwind, VIX 21 elevated, 10Y 4.38% neutral" },
    "sentiment":        { "score": 0, "signal": "e.g. F&G 12 extreme fear — skipped (captured in derivatives axis)" },
    "stablecoin":       { "score": 0, "signal": "e.g. USDT+USDC supply $XXXb, +$Xb 7d — expanding dry powder" },
    "scaleNote":        "Range -10 to +10. Each axis contribution shown. Total = sum of above."
  },
  "overallBias": "STRONG BUY | BUY | NEUTRAL | CAUTION | SELL",
  "biasReason": "<=20 words citing dominant normalized signal",
  "headline": "<=15 words - lead with the COMPOSITE SCORE picture and key on-chain/structural driver, NOT just the F&G label. F&G is one input among many — do not let it dominate the headline unless it is the single most decisive signal after all axes are weighted.",
  "marketStatus": "ACCUMULATION PHASE | BREAKOUT WATCH | MOMENTUM | BULL RUN | DISTRIBUTION | DANGER ZONE",
  "correlationRegime": {
    "btcQqqCorrelation": "e.g. 0.72",
    "regime": "HIGH | MODERATE | LOW",
    "implication": "1 sentence on whether macro or on-chain signals dominate today"
  },
  "priceAnalysis": {
    "trend": "2 sentences on structure vs key levels",
    "keyLevel": "the ONE level that matters most today",
    "realizedPriceContext": "price vs $45K realized price and $75K STH basis",
    "signal": "BULLISH | BEARISH | NEUTRAL | MIXED"
  },
  "whaleSignal": {
    "status": "ACCUMULATING | DISTRIBUTING | NEUTRAL | MIXED",
    "netflowBTC": "raw BTC",
    "netflowUSD": "USD equivalent",
    "netflowPctLiquid": "PRIMARY",
    "netflowPctVolume": "AMPLIFIER",
    "netflowPctMcap": "SECONDARY",
    "historicalContext": "validated cross-era comparison",
    "detail": "2 sentences with normalized figures",
    "actionable": "position sizing implication"
  },
  "fundingRates": {
    "rate8h": "e.g. -0.023% per 8h",
    "annualized": "e.g. -25.2% annualized",
    "regime": "CAPITULATION | BEARISH | NEUTRAL | ELEVATED | EXTREME_LONG",
    "signal": "BULLISH | BEARISH | NEUTRAL",
    "detail": "1-2 sentences interpreting funding vs historical thresholds",
    "squeeze_risk": "LOW | MEDIUM | HIGH"
  },
  "openInterest": {
    "trend": "RISING | FALLING | STABLE",
    "regime": "what OI + price direction combination tells us",
    "detail": "1-2 sentences",
    "leverageRisk": "LOW | MEDIUM | HIGH"
  },
  "mvrvSignal": {
    "estimatedZone": "RED (<0) | UNDERVALUED (0-1) | FAIR (1-3) | OVERVALUED (3-5) | EXTREME (>5)",
    "implication": "1-2 sentences on what MVRV zone means for positioning",
    "cycleContext": "comparison to historical MVRV at prior cycle bottoms"
  },
  "etfFlows": {
    "status": "INFLOW | OUTFLOW | NEUTRAL",
    "totalNetUSD": "e.g. +$310M",
    "totalNetBTC": "e.g. +4,282 BTC",
    "totalNetPctLiquid": "e.g. +0.102%",
    "totalNetPctMcap": "e.g. +0.021%",
    "ibitFlow": "IBIT specific",
    "streakDays": "consecutive days",
    "vsBaseline": "vs 3,667 BTC/day baseline",
    "detail": "1-2 sentences",
    "trend": "IMPROVING | DETERIORATING | STABLE"
  },
  "stablecoinSignal": {
    "status": "INFLOW | OUTFLOW | NEUTRAL",
    "detail": "1-2 sentences on stablecoin exchange flows",
    "signal": "BULLISH | BEARISH | NEUTRAL"
  },
  "macroContext": {
    "riskLevel": "HIGH | MEDIUM | LOW",
    "dxy": "level and direction e.g. 103.2, falling",
    "dxySignal": "BULLISH | BEARISH | NEUTRAL",
    "realYield": "10Y TIPS yield e.g. 1.82%, rising",
    "realYieldSignal": "BULLISH | BEARISH | NEUTRAL",
    "gold": "XAU price and BTC/Gold ratio",
    "goldSignal": "context for institutional appetite",
    "fedWatch": "Fed policy note relevant today",
    "geopolitical": "Iran/geopolitical risk market impact",
    "detail": "2 sentences synthesizing macro picture"
  },
  "todayAction": {
    "recommendation": "ACCUMULATE | ADD | HOLD | REDUCE | HEDGE | WAIT",
    "size": "specific allocation e.g. Deploy 5% of DCA reserve",
    "trigger": "exact normalized condition that would change this",
    "stopAlert": "ACTIVE | MONITORING | CLEAR",
    "dynamicStop": "today's recommended stop level based on live structure",
    "scoreJustification": "full component breakdown e.g. Whale -0.148% liq (+1) + ETF +0.102% (+1) + Funding -0.031% (+1) = +6 BUY"
  },
  "cmeBasis": {
    "basisPct": "e.g. +8.2% annualized",
    "regime": "STRONG CONTANGO | HEALTHY | FLAT | BACKWARDATION",
    "signal": "BULLISH | BEARISH | NEUTRAL",
    "detail": "1 sentence on what CME premium tells us about institutional positioning",
    "cmeOIvsPerp": "context on CME vs perp OI balance"
  },
  "catalystWatch": [
    {"event": "string", "timing": "string", "impact": "BULLISH | BEARISH | BINARY", "note": "<=12 words"}
  ],
  "analystNote": "4-5 sentences. Open with correlation regime. Cite normalized figures including CME basis if available. Flag alert triggers. Historical parallel. Contrarian take where data supports it.",
  "riskWarning": "the ONE risk that could invalidate today thesis"
}`;

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#060810",
  surface: "#0a0d18",
  surfaceHigh: "#0f1420",
  surfaceMid: "#131826",
  border: "#1a2540",
  borderBright: "#243560",
  accent: "#e8a020",
  accentDim: "#6b4a0e",
  green: "#00d4a0",
  greenDim: "#003d2e",
  red: "#ff3355",
  redDim: "#3d000f",
  orange: "#ff6830",
  blue: "#3b82f6",
  blueDim: "#0f2040",
  purple: "#8b5cf6",
  purpleDim: "#1e0f40",
  teal: "#06b6d4",
  gold: "#fbbf24",
  goldDim: "#3d2e00",
  text: "#e2e8f8",
  textMid: "#7a90bb",
  textDim: "#3a4a6a",
  cyan: "#22d3ee",
};

const biasColors = {
  "STRONG BUY": C.green, "BUY": C.teal, "NEUTRAL": C.textMid,
  "CAUTION": C.orange, "SELL": C.red,
};
const signalColors = {
  BULLISH: C.green, BEARISH: C.red, NEUTRAL: C.textMid, MIXED: C.orange,
  ACCUMULATING: C.green, DISTRIBUTING: C.red,
  INFLOW: C.green, OUTFLOW: C.red,
  IMPROVING: C.green, DETERIORATING: C.red, STABLE: C.textMid,
  HIGH: C.red, MEDIUM: C.orange, LOW: C.green,
  ACCUMULATE: C.green, ADD: C.teal, HOLD: C.textMid,
  REDUCE: C.orange, HEDGE: C.purple, WAIT: C.textMid,
  ACTIVE: C.red, MONITORING: C.orange, CLEAR: C.green,
  CAPITULATION: C.green, ELEVATED: C.orange, EXTREME_LONG: C.red,
};

function Tag({ text, color }) {
  const c = color || signalColors[text] || C.textMid;
  return (
    <span style={{
      background: c + "18", color: c,
      border: "1px solid " + c + "35",
      borderRadius: 3, padding: "2px 8px",
      fontSize: 9, fontWeight: 800,
      letterSpacing: 1.5, fontFamily: "monospace",
      whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

function Card({ children, accent, glow, style }) {
  const s = style || {};
  return (
    <div style={{
      background: C.surface,
      border: "1px solid " + (accent ? accent + "40" : C.border),
      borderLeft: accent ? "3px solid " + accent : undefined,
      borderRadius: 8, padding: "16px 18px",
      boxShadow: glow ? "0 0 20px " + glow + "12" : undefined,
      minWidth: 0,        // prevent grid column blowout from nowrap children
      overflow: "hidden", // clip any content that still exceeds card bounds
      ...s,
    }}>{children}</div>
  );
}

function Label({ children, color }) {
  return (
    <div style={{
      color: color || C.textDim, fontSize: 8, fontWeight: 800,
      letterSpacing: 3, fontFamily: "monospace",
      marginBottom: 10, textTransform: "uppercase",
    }}>{children}</div>
  );
}

function MiniStat({ label, value, sub, color, size }) {
  const col = color || C.textMid;
  const sz = size || 14;
  return (
    <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 12px", borderTop: "2px solid " + col }}>
      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 4 }}>{label}</div>
      <div style={{ color: col, fontSize: sz, fontWeight: 800, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ color: C.textDim, fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Skeleton({ w, h, mb }) {
  const width = w || "100%";
  const height = h || 14;
  const marginBottom = mb || 8;
  return (
    <div style={{
      width: width, height: height, background: C.surfaceHigh, borderRadius: 4,
      marginBottom: marginBottom, animation: "pulse 1.5s ease-in-out infinite",
    }} />
  );
}

// ─── Module-level constants (no state deps — defined once at load) ─────────────
const PHASES = [
  { id: "A", label: "ACCUMULATION", low: 60000,  high: 68000,  color: "#00d4a0", action: "Deploy 30% of DCA reserve" },
  { id: "B", label: "BREAKOUT",     low: 68000,  high: 79000,  color: "#06b6d4", action: "Add 25% on confirmed daily close" },
  { id: "C", label: "MOMENTUM",     low: 79000,  high: 98000,  color: "#fbbf24", action: "Hold 55%, take 15% off at $95K" },
  { id: "D", label: "BULL RUN",     low: 98000,  high: 200000, color: "#8b5cf6", action: "Scale out 10% every $15K above $100K" },
];
const HARD_STOP = 58500;
// 5-day grading window — aligns with 1-2yr mandate; avoids FLAT-heavy 24h noise
const GRADE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

function computeActivePhase(price) {
  if (!price) return null;
  if (price < HARD_STOP) return { id: "STOP", label: "STOP TRIGGERED", color: "#ff3355", action: "Hard stop — exit per mandate", pctToNext: null, pctToPrev: null, progress: 0 };
  for (var i = 0; i < PHASES.length; i++) {
    var ph = PHASES[i];
    if (price >= ph.low && price < ph.high) {
      var progress = ((price - ph.low) / (ph.high - ph.low)) * 100;
      var pctToNext = ((ph.high - price) / price * 100).toFixed(1);
      var pctToPrev = i > 0 ? ((price - PHASES[i-1].high) / price * 100).toFixed(1) : null;
      return Object.assign({}, ph, { progress: progress, pctToNext: pctToNext, pctToPrev: pctToPrev, nextPhaseAt: ph.high, prevPhaseAt: i > 0 ? PHASES[i-1].high : null });
    }
  }
  return { id: "D+", label: "EXTENDED BULL RUN", color: "#8b5cf6", action: "Scale out 10% every $15K", progress: 100, pctToNext: null };
}

const GLOBAL_CSS = "* { box-sizing: border-box; margin: 0; padding: 0; } " +
  "@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:.7} } " +
  "@keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} } " +
  "@keyframes spin { to{transform:rotate(360deg)} } " +
  "@keyframes glow { 0%,100%{opacity:.6} 50%{opacity:1} } " +
  ".fade-up { animation: fadeUp 0.35s ease forwards; }";

const STAGES = {
  "fetching-market": ["FETCHING LIVE MARKET DATA", "Binance · Deribit · Alternative.me · CoinGecko · CoinMetrics · Dune · Farside Investors · Yahoo Finance (DXY · VIX · TNX · CME Basis)"],
  "generating":      ["SYNTHESISING BRIEF", "Quad-normalization · 6-axis convergence · CME basis (2 contracts) · BTC-QQQ correlation · live macro · Claude Sonnet"],
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MorningBrief() {
  const [brief, setBrief] = useState(null);
  const [marketData, setMarketData] = useState(null);
  const [fearGreed, setFearGreed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("idle");
  const [error, setError] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [genMs, setGenMs] = useState(null);
  const [searchStatus, setSearchStatus] = useState({ etf: "pending", onchain: "pending", macro: "pending" });
  const [liquidations, setLiquidations] = useState(null);
  const [accuracyLog, setAccuracyLog] = useState([]);
  const [showAccuracy, setShowAccuracy] = useState(false);
  const [clientStop, setClientStop] = useState(null);
  const [debugLog, setDebugLog] = useState([]);
  const [techLevels, setTechLevels] = useState(null);
  const [convergence, setConvergence] = useState(null);
  const [cmeData, setCmeData] = useState(null);
  const [etfFlowData, setEtfFlowData] = useState(null);
  const [lthData, setLthData] = useState(null);
  const [stablecoinData, setStablecoinData] = useState(null);
  const [macroData, setMacroData] = useState(null);
  const intervalRef = useRef(null);
  const allDataRef  = useRef(null); // caches all_data.json for the current generateBrief() run
  const isMounted = { current: true };
  useEffect(function() { isMounted.current = true; return function() { isMounted.current = false; }; }, []);


  const safeSet = function(setter) { return function(val) { if (isMounted.current) setter(val); }; };

  // ── Load all_data.json — try local first, then GitHub Pages ───────────────────
  // Local path: /all_data.json → served by Vite from public/all_data.json
  //             (generated by `node brief-worker.js` for local dev)
  // Remote:     ALL_DATA_URL  → GitHub Pages (generated by GitHub Actions)
  const loadAllData = async function() {
    const sources = [
      { url: "/all_data.json",  timeout: 3000  },   // local (fast)
      { url: ALL_DATA_URL,      timeout: 15000 },   // GitHub Pages
    ];
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      try {
        var r = await fetch(src.url, { signal: AbortSignal.timeout(src.timeout) });
        if (!r.ok) continue;
        var d = await r.json();
        if (d && (d.briefCachedAt || d.cachedAt)) {
          allDataRef.current = d;
          console.info("[AllData] Loaded from", src.url, "— age:", Math.round((Date.now() - new Date(d.briefCachedAt || d.cachedAt).getTime()) / 3_600_000) + "h");
          return d;
        }
      } catch (e) {
        console.warn("[AllData] Failed from", src.url, ":", e.message);
      }
    }
    return null;
  };

  const addLog = (msg) => {
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setDebugLog(function(prev) { return prev.concat([ts + "  " + msg]).slice(-20); });
    console.log("[Brief] " + msg);
  };

  // opts: { timeout?: number, headers?: object, method?: string, body?: string }
  const safeFetch = async (url, opts) => {
    const ms     = (opts && opts.timeout) || 6000;
    const hdrs   = (opts && opts.headers) || {};
    const method = (opts && opts.method)  || "GET";
    const body   = (opts && opts.body)    || undefined;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, { signal: controller.signal, headers: hdrs, method, body });
      clearTimeout(id);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  // Raw text fetch — like safeFetch but returns response.text() instead of .json()
  // Used for HTML scraping (e.g. Farside ETF flow table)
  const rawFetch = async (url, opts) => {
    const ms  = (opts && opts.timeout) || 15000;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'text/html,application/xhtml+xml', ...((opts && opts.headers) || {}) },
      });
      clearTimeout(tid);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      clearTimeout(tid);
      throw e;
    }
  };

  const tryEach = async (label, fetchers) => {
    for (const item of fetchers) {
      try {
        const result = await item.fn();
        if (result != null) {
          console.info("OK " + label + " via " + item.source);
          return Object.assign({}, result, { _source: item.source });
        }
      } catch (e) {
        console.warn("FAIL " + label + " via " + item.source + ": " + e.message);
      }
    }
    console.warn("ALL FAILED: " + label);
    return null;
  };



  // Fetch 200 daily candles → compute 200d/50d/20d SMAs
  // Primary: Binance klines (no auth, no CORS, always available)
  // Fallback: Kraken OHLC
  const fetchTechnicalLevels = async function() {
    var closes = null;
    var techSource = null;

    // ── Primary: Binance klines ───────────────────────────────────────────
    // Returns [[openTime, open, high, low, close, volume, ...], ...]
    try {
      var d = await safeFetch(
        "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200",
        { timeout: 10000 }
      );
      if (!d || d.length < 20) throw new Error("not enough candles: " + (d ? d.length : 0));
      closes = d.map(function(row) { return parseFloat(row[4]); }).filter(Boolean);
      // Capture volume for live volume-trend computation (row[5] = base asset volume in BTC)
      if (!window.__btcVolumes) window.__btcVolumes = [];
      window.__btcVolumes = d.map(function(row) { return parseFloat(row[5]); }).filter(Boolean);
      techSource = "Binance daily";
    } catch (e) {
      console.warn("fetchTechnicalLevels Binance failed:", e.message, "— trying Kraken...");
    }

    // ── Fallback: Kraken OHLC ─────────────────────────────────────────────
    // Returns { result: { XXBTZUSD: [[time, open, high, low, close, ...], ...] } }
    if (!closes) {
      try {
        var kr = await safeFetch(
          "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=" +
            Math.floor((Date.now() / 1000) - 205 * 86400),
          { timeout: 12000 }
        );
        var rows = kr && kr.result && (kr.result["XXBTZUSD"] || kr.result["XBTZUSD"]);
        if (!rows || rows.length < 20) throw new Error("not enough rows");
        closes = rows.map(function(row) { return parseFloat(row[4]); }).filter(Boolean);
        techSource = "Kraken daily";
      } catch (e2) {
        console.warn("fetchTechnicalLevels Kraken failed:", e2.message);
        return null;
      }
    }

    try {
      var sma = function(arr, n) {
        var slice = arr.slice(-n);
        if (slice.length < n) return null;
        return slice.reduce(function(a, b) { return a + b; }, 0) / n;
      };
      var sma200 = sma(closes, 200);
      var sma50  = sma(closes, 50);
      var sma20  = sma(closes, 20);
      var weights = closes.slice(-200).map(function(_, i, arr) { return Math.exp(-0.02 * (arr.length - 1 - i)); });
      var wSum = weights.reduce(function(a, b) { return a + b; }, 0);
      var realisedProxy = closes.slice(-200).reduce(function(acc, c, i) { return acc + c * weights[i]; }, 0) / wSum;
      // Live volume trend: compare 5-day avg vs 20-day avg from candle data
      var vols = (window.__btcVolumes && window.__btcVolumes.length >= 20) ? window.__btcVolumes : null;
      var avgVol5d  = null, avgVol20d = null, volTrendRatio = null, volTrend = "UNKNOWN";
      if (vols) {
        avgVol5d  = vols.slice(-5).reduce(function(a, b)  { return a + b; }, 0) / 5;
        avgVol20d = vols.slice(-20).reduce(function(a, b) { return a + b; }, 0) / 20;
        volTrendRatio = avgVol20d > 0 ? (avgVol5d / avgVol20d) : null;
        volTrend = volTrendRatio == null ? "UNKNOWN"
          : volTrendRatio > 1.20 ? "RISING"
          : volTrendRatio < 0.80 ? "FALLING"
          : "STABLE";
      }
      // ── QQQ 60-day rolling Pearson correlation (live) ────────────────────
      // Fetch QQQ daily closes from Yahoo Finance via existing proxy,
      // align with BTC closes, compute Pearson r over the last 60 days.
      var btcQqqCorr = null;
      var corrWindowUsed = 0;
      try {
        var qqqRes = await safeFetch(
          "/api/yahoo/v8/finance/chart/QQQ?interval=1d&range=90d",
          { timeout: 10000 }
        );
        var qqqCloses = (qqqRes &&
          qqqRes.chart &&
          qqqRes.chart.result &&
          qqqRes.chart.result[0] &&
          qqqRes.chart.result[0].indicators &&
          qqqRes.chart.result[0].indicators.quote &&
          qqqRes.chart.result[0].indicators.quote[0] &&
          qqqRes.chart.result[0].indicators.quote[0].close) || [];
        qqqCloses = qqqCloses.filter(function(v) { return v != null && !isNaN(v); });
        var CORR_DAYS = 60;
        var btcSlice = closes.slice(-CORR_DAYS);
        var qqqSlice = qqqCloses.slice(-CORR_DAYS);
        var corrN = Math.min(btcSlice.length, qqqSlice.length);
        if (corrN >= 20) {
          btcSlice = btcSlice.slice(-corrN);
          qqqSlice = qqqSlice.slice(-corrN);
          var arrMean = function(arr) { return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length; };
          var mB = arrMean(btcSlice), mQ = arrMean(qqqSlice);
          var num = 0, dB = 0, dQ = 0;
          for (var ci = 0; ci < corrN; ci++) {
            var db = btcSlice[ci] - mB, dq = qqqSlice[ci] - mQ;
            num += db * dq; dB += db * db; dQ += dq * dq;
          }
          btcQqqCorr = (dB > 0 && dQ > 0)
            ? parseFloat((num / Math.sqrt(dB * dQ)).toFixed(2))
            : null;
          corrWindowUsed = corrN;
          console.info("[Correlation] BTC-QQQ " + corrN + "d Pearson:", btcQqqCorr);
        }
      } catch (corrErr) {
        console.warn("[Correlation] QQQ fetch failed:", corrErr.message);
      }

      return {
        sma200: sma200 ? Math.round(sma200) : null,
        sma50:  sma50  ? Math.round(sma50)  : null,
        sma20:  sma20  ? Math.round(sma20)  : null,
        realisedProxy: realisedProxy ? Math.round(realisedProxy) : null,
        candleCount: closes.length,
        techSource: techSource,
        // Live volume trend
        avgVol5d:  avgVol5d  ? Math.round(avgVol5d)  : null,
        avgVol20d: avgVol20d ? Math.round(avgVol20d) : null,
        volTrendRatio: volTrendRatio ? parseFloat(volTrendRatio.toFixed(2)) : null,
        volTrend: volTrend,
        // Live BTC-QQQ correlation
        btcQqqCorr: btcQqqCorr,
        corrWindow: corrWindowUsed,
      };
    } catch (e) {
      console.warn("fetchTechnicalLevels SMA calc failed:", e.message);
      return null;
    }
  };

  const fetchAllMarketData = async () => {
    const results = {};

    // 1. BTC PRICE + OHLCV + MARKET CAP
    // Primary: CoinGecko (multiple endpoints) → Binance → Kraken
    const btc = await tryEach("BTC price", [
      {
        source: "CoinGecko /coins/markets",
        fn: async () => {
          const d = await safeFetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&order=market_cap_desc&per_page=1&page=1&price_change_percentage=24h,7d");
          const b = d[0];
          if (!b || !b.current_price) throw new Error("no data");
          const vol = b.total_volume;
          if (!vol || vol === 0) throw new Error("volume null");
          return { price: b.current_price, change24h: b.price_change_percentage_24h, change7d: b.price_change_percentage_7d_in_currency, volume24h: vol, marketCap: b.market_cap, priceSource: "CoinGecko" };
        },
      },
      {
        source: "CoinGecko /coins/bitcoin",
        fn: async () => {
          const d = await safeFetch("https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false");
          const md = d.market_data;
          const vol = md.total_volume && md.total_volume.usd;
          if (!vol || vol === 0) throw new Error("volume null");
          return { price: md.current_price.usd, change24h: md.price_change_percentage_24h, change7d: md.price_change_percentage_7d, volume24h: vol, marketCap: md.market_cap.usd, priceSource: "CoinGecko" };
        },
      },
      {
        source: "CoinGecko simple/price",
        fn: async () => {
          const d = await safeFetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true");
          const b = d.bitcoin;
          const vol = b.usd_24h_vol;
          if (!vol || vol === 0) throw new Error("volume null");
          return { price: b.usd, change24h: b.usd_24h_change, volume24h: vol, marketCap: b.usd_market_cap, priceSource: "CoinGecko" };
        },
      },
      {
        source: "Binance 24hr scaled",
        fn: async () => {
          const s = await safeFetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT");
          const price = parseFloat(s.lastPrice);
          const pairVol = parseFloat(s.quoteVolume);
          if (!pairVol || pairVol === 0) throw new Error("no volume");
          return { price: price, change24h: parseFloat(s.priceChangePercent), volume24h: pairVol * 2.6, marketCap: price * 20000000, volumeEstimated: true, priceSource: "Binance" };
        },
      },
      {
        source: "Kraken XBTUSD",
        fn: async () => {
          const d = await safeFetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
          const t = d.result.XXBTZUSD;
          const price = parseFloat(t.c[0]);
          const volBTC = parseFloat(t.v[1]);
          if (!volBTC || volBTC === 0) throw new Error("no volume");
          return { price: price, change24h: null, volume24h: volBTC * price * 15, marketCap: price * 20000000, volumeEstimated: true, priceSource: "Kraken" };
        },
      },
    ]);
    if (btc) Object.assign(results, btc);

    // 2. FEAR & GREED
    const fg = await tryEach("Fear & Greed", [
      {
        source: "Alternative.me",
        fn: async () => {
          const d = await safeFetch("https://api.alternative.me/fng/?limit=7");
          return { fearGreedValue: parseInt(d.data[0].value, 10), fearGreedLabel: d.data[0].value_classification, fearGreed7d: d.data.map(function(x) { return parseInt(x.value, 10); }) };
        },
      },
    ]);
    if (fg) Object.assign(results, fg);

    // 3. FUNDING RATE
    const funding = await tryEach("Funding rate", [
      {
        source: "Binance fapi",
        fn: async () => {
          const d = await safeFetch("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8");
          if (!Array.isArray(d) || !d.length) throw new Error("empty");
          return { fundingRate: parseFloat(d[d.length - 1].fundingRate), fundingRateHistory: d.map(function(x) { return parseFloat(x.fundingRate); }), fundingSource: "Binance" };
        },
      },
      {
        source: "Bybit v5",
        fn: async () => {
          const d = await safeFetch("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT");
          const t = d && d.result && d.result.list && d.result.list[0];
          if (!t || !t.fundingRate) throw new Error("no fundingRate");
          return { fundingRate: parseFloat(t.fundingRate), fundingRateHistory: [parseFloat(t.fundingRate)], fundingSource: "Bybit" };
        },
      },
      {
        source: "OKX public",
        fn: async () => {
          const d = await safeFetch("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP");
          const r = d && d.data && d.data[0];
          if (!r || !r.fundingRate) throw new Error("no fundingRate");
          return { fundingRate: parseFloat(r.fundingRate), fundingRateHistory: [parseFloat(r.fundingRate)], fundingSource: "OKX" };
        },
      },
    ]);
    if (funding) Object.assign(results, funding);

    // 4. OPEN INTEREST
    const oi = await tryEach("Open interest", [
      {
        source: "Binance fapi",
        fn: async () => {
          const d = await safeFetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT");
          const oiVal = parseFloat(d.openInterest);
          return { openInterest: oiVal, openInterestUSD: oiVal * (results.price || 72000), oiSource: "Binance" };
        },
      },
      {
        source: "Bybit v5",
        fn: async () => {
          const d = await safeFetch("https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=1");
          const val = d && d.result && d.result.list && d.result.list[0] && d.result.list[0].openInterest;
          if (!val) throw new Error("no OI");
          const oiVal = parseFloat(val);
          return { openInterest: oiVal, openInterestUSD: oiVal * (results.price || 72000), oiSource: "Bybit" };
        },
      },
      {
        source: "OKX public",
        fn: async () => {
          const d = await safeFetch("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP");
          const oiVal = parseFloat(d && d.data && d.data[0] && d.data[0].oi);
          if (!oiVal) throw new Error("no OI");
          return { openInterest: oiVal, openInterestUSD: oiVal * (results.price || 72000), oiSource: "OKX" };
        },
      },
    ]);
    if (oi) Object.assign(results, oi);

    // 4b. AGGREGATE OI ACROSS EXCHANGES (Binance + Bybit + OKX)
    // Binance perp represents ~35-40% of total perp OI. We sum what we can fetch.
    var oiBybit2 = null;
    var oiOKX2   = null;
    try {
      var bybitOI2 = await safeFetch("https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=1", { timeout: 8000 });
      var bv2 = bybitOI2 && bybitOI2.result && bybitOI2.result.list && bybitOI2.result.list[0] && bybitOI2.result.list[0].openInterest;
      if (bv2) oiBybit2 = parseFloat(bv2) * (results.price || 80000);
    } catch (_e2) {}
    try {
      var okxOI2 = await safeFetch("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP", { timeout: 8000 });
      var ov2 = okxOI2 && okxOI2.data && okxOI2.data[0] && okxOI2.data[0].oi;
      if (ov2) oiOKX2 = parseFloat(ov2) * (results.price || 80000);
    } catch (_e3) {}
    var binanceOIusd = results.openInterestUSD || 0;
    var aggregateOIusd = binanceOIusd + (oiBybit2 || 0) + (oiOKX2 || 0);
    if (aggregateOIusd > binanceOIusd * 1.05) {
      results.openInterestUSD = aggregateOIusd;
      results.openInterestBTC = aggregateOIusd / (results.price || 80000);
      results.openInterest    = results.openInterestBTC;
      results.oiSource = (results.oiSource || "Binance") + (oiBybit2 ? "+Bybit" : "") + (oiOKX2 ? "+OKX" : "") + " (agg perp)";
      console.info("[OI] Aggregate perp:", (aggregateOIusd / 1e9).toFixed(2) + "B USD");
    }

    // 5. GOLD PRICE — PAXG is 1:1 gold-backed proxy for spot XAU; Binance/Kraken have no CORS
    // NOTE: PAXG may trade at small premium/discount to spot XAU — labeled as proxy
    const gold = await tryEach("Gold price", [
      {
        source: "Binance PAXGUSDT",
        fn: async () => {
          const d = await safeFetch("https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT", { timeout: 8000 });
          const price = d && parseFloat(d.lastPrice);
          if (!price) throw new Error("no price");
          const change = d.priceChangePercent != null ? parseFloat(d.priceChangePercent) : null;
          return { goldPrice: price, goldChange24h: change, goldToken: "PAXG" };
        },
      },
      {
        source: "Kraken XATUSD",
        fn: async () => {
          const d = await safeFetch("https://api.kraken.com/0/public/Ticker?pair=XATUSD", { timeout: 8000 });
          const pair = d.result && (d.result["XATUSD"] || d.result["XXATTZUSD"]);
          if (!pair) throw new Error("no pair");
          const price = parseFloat(pair.c[0]); // last trade price
          if (!price) throw new Error("no price");
          return { goldPrice: price, goldChange24h: null, goldToken: "XAT" };
        },
      },
      {
        // Last resort: CoinGecko (often rate-limited) — kept as final fallback
        source: "CoinGecko PAXG",
        fn: async () => {
          const d = await safeFetch("https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd&include_24hr_change=true", { timeout: 8000 });
          const price = d["pax-gold"] && d["pax-gold"].usd;
          if (!price) throw new Error("no price");
          return { goldPrice: price, goldChange24h: d["pax-gold"].usd_24h_change, goldToken: "PAXG" };
        },
      },
    ]);
    if (gold) {
      Object.assign(results, gold);
      if (results.price && results.goldPrice) {
        results.btcGoldRatio = results.price / results.goldPrice;
      }
    }

    // 6. LIQUIDATION HEATMAP
    // Liquidation data: all free sources (Coinglass, Binance forceOrders) are currently unavailable
    // (Coinglass 404, Binance forceOrders 401). Removed to avoid log noise.

    // 7. BTC DOMINANCE — CoinGecko global (free, no key)
    var dom = await tryEach("BTC Dominance", [
      {
        source: "CoinGecko global",
        fn: async function() {
          var d = await safeFetch("https://api.coingecko.com/api/v3/global");
          var pct = d && d.data && d.data.market_cap_percentage && d.data.market_cap_percentage.btc;
          if (!pct) throw new Error("no dominance");
          var totalMcap = d.data.total_market_cap && d.data.total_market_cap.usd;
          return { btcDominance: parseFloat(pct.toFixed(1)), totalCryptoMcap: totalMcap };
        },
      },
    ]);
    if (dom) Object.assign(results, dom);

    // 8. DERIBIT OPTIONS SKEW — true 25-delta put/call IV skew (public, no auth)
    // 25d skew = IV(25d put) - IV(25d call). Negative = puts bid up = fear. Positive = calls bid = greed.
    // Methodology: filter strikes within ±10-15% of spot to approximate 25-delta exposure,
    // then compare volume-weighted put IV vs call IV. This is a much better proxy than
    // averaging all options indiscriminately.
    var opts = await tryEach("Options skew", [
      {
        source: "Deribit 25d-approx skew",
        fn: async function() {
          var d = await safeFetch("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option", { timeout: 10000 });
          if (!d || !d.result || !d.result.length) throw new Error("no options data");
          var now = Date.now();
          var spot = results.price || 80000;
          // Near-expiry: prefer 3–30 day options (most liquid, most signal-relevant)
          var threeDays = 3 * 24 * 3600 * 1000;
          var thirtyDays = 30 * 24 * 3600 * 1000;
          var near = d.result.filter(function(o) {
            var tte = o.expiration_timestamp - now;
            return tte > threeDays && tte < thirtyDays && o.volume > 0 && o.mark_iv > 0;
          });
          // Fallback to 7-day window if 3-30d is sparse
          if (near.length < 4) {
            near = d.result.filter(function(o) {
              var tte = o.expiration_timestamp - now;
              return tte > 0 && tte < (7 * 24 * 3600 * 1000) && o.volume > 0 && o.mark_iv > 0;
            });
          }
          if (!near.length) near = d.result.filter(function(o) { return o.volume > 0 && o.mark_iv > 0; }).slice(0, 30);
          // Extract strike from instrument name: BTC-DDMMMYY-STRIKE-P/C
          var getStrike = function(name) {
            var parts = name ? name.split("-") : [];
            return parts.length >= 3 ? parseFloat(parts[2]) : null;
          };
          // 25-delta approximation: puts at 80–95% of spot, calls at 105–120% of spot
          var putLow = spot * 0.80, putHigh = spot * 0.95;
          var callLow = spot * 1.05, callHigh = spot * 1.20;
          var puts25 = near.filter(function(o) {
            var s = getStrike(o.instrument_name);
            return o.instrument_name.slice(-1) === "P" && s && s >= putLow && s <= putHigh;
          });
          var calls25 = near.filter(function(o) {
            var s = getStrike(o.instrument_name);
            return o.instrument_name.slice(-1) === "C" && s && s >= callLow && s <= callHigh;
          });
          // Fall back to all near-term options if delta filtering yields too few
          var puts  = puts25.length  >= 2 ? puts25  : near.filter(function(o) { return o.instrument_name.slice(-1) === "P"; });
          var calls = calls25.length >= 2 ? calls25 : near.filter(function(o) { return o.instrument_name.slice(-1) === "C"; });
          if (!puts.length || !calls.length) throw new Error("insufficient options data after filtering");
          // Volume-weighted average IV (not simple average — weights by open interest/volume)
          var wAvgIV = function(arr) {
            var wSum = arr.reduce(function(s, o) { return s + (o.volume || 1); }, 0);
            return arr.reduce(function(s, o) { return s + o.mark_iv * (o.volume || 1); }, 0) / wSum;
          };
          var avgPutIV  = wAvgIV(puts);
          var avgCallIV = wAvgIV(calls);
          var skew = parseFloat((avgPutIV - avgCallIV).toFixed(1));
          var pcRatio = parseFloat((puts.length / Math.max(calls.length, 1)).toFixed(2));
          var skewMethod = puts25.length >= 2 && calls25.length >= 2 ? "25d-approx" : "all-near-term";
          console.info("[Options] Skew:", skew, "| Put IV:", Math.round(avgPutIV), "| Call IV:", Math.round(avgCallIV), "| Method:", skewMethod, "| Puts:", puts.length, "Calls:", calls.length);
          return { optionsSkew: skew, optionsPCRatio: pcRatio, optionsSource: "Deribit " + skewMethod, optionsPutIV: Math.round(avgPutIV), optionsCallIV: Math.round(avgCallIV) };
        },
      },
    ]);
    if (opts) Object.assign(results, opts);

    return results;
  };

  // ─── COINMETRICS COMMUNITY ON-CHAIN DATA (free, no API key) ──────────────────
  // Docs: https://docs.coinmetrics.io/api/v4
  const fetchCoinMetricsData = async () => {
    // Community-tier free metrics only (Pro metrics like MVRV, SOPR, exchange flows return 403)
    const metrics = [
      "AdrActCnt",   // Active addresses — network health
      "TxCnt",       // Transaction count — on-chain activity
      "HashRate",    // Miner hash rate — security & miner confidence
      "FeeTotNtv",   // Total fees in BTC — blockspace demand
      "PriceUSD",    // Reference price for cross-check
    ].join(",");

    const url = "/api/coinmetrics/v4/timeseries/asset-metrics"
      + "?assets=btc&metrics=" + metrics
      + "&frequency=1d&limit_per_asset=2&sort=time";

    try {
      const raw = await safeFetch(url, { timeout: 12000 });
      const rows = raw && raw.data;
      if (!rows || !rows.length) throw new Error("no data rows");

      // Use the most recent row; fall back to previous for change calc
      const latest = rows[rows.length - 1];
      const prev   = rows.length > 1 ? rows[rows.length - 2] : null;

      const n = (key) => latest[key] != null ? parseFloat(latest[key]) : null;

      const activeAddresses = n("AdrActCnt");
      const txCount         = n("TxCnt");
      const hashRate        = n("HashRate");
      const totalFeesBTC    = n("FeeTotNtv");
      const refPrice        = n("PriceUSD");

      const out = {
        date:            latest.time ? latest.time.slice(0, 10) : null,
        activeAddresses: activeAddresses,
        txCount:         txCount,
        hashRate:        hashRate,
        totalFeesBTC:    totalFeesBTC,
        refPrice:        refPrice,
        source: "CoinMetrics Community API (free tier)",
      };

      console.info("[CoinMetrics] OK — ActiveAddr:", activeAddresses,
        "| TxCount:", txCount, "| HashRate:", hashRate ? (hashRate > 1e15 ? (hashRate / 1e18).toFixed(1) : hashRate > 5e7 ? (hashRate / 1e6).toFixed(1) : hashRate.toFixed(1)) + " EH/s" : "n/a");
      return out;
    } catch (e) {
      console.warn("[CoinMetrics] Failed:", e.message);
      return null;
    }
  };

  // ── DUNE ANALYTICS — FREE ON-CHAIN DATA (exchange flows, MVRV if available) ──
  const fetchDuneData = async () => {
    const DUNE_BASE = "/api/dune";

    // Get cached results for a Dune community query.
    // Also checks staleness — if the last execution is >30 days old the data is discarded
    // (stale numbers are worse than Claude's estimate) and a background refresh is triggered
    // so the NEXT brief load gets fresh data.
    const fetchDuneQuery = async (queryId) => {
      const url = DUNE_BASE + "/api/v1/query/" + queryId + "/results?limit=5";
      try {
        const data = await safeFetch(url, { timeout: 15000 });
        if (data && data.result && data.result.rows && data.result.rows.length > 0) {
          // ── Staleness check ────────────────────────────────────────────────
          const endedAt = data.execution_ended_at || data.submitted_at || null;
          let cacheAgeDays = null;
          if (endedAt) {
            cacheAgeDays = Math.round((Date.now() - new Date(endedAt).getTime()) / 86400000);
          }
          const label = cacheAgeDays != null ? " | cache age: " + cacheAgeDays + "d" : " | cache age: unknown";
          console.info("[Dune] Query " + queryId + " — cols:", Object.keys(data.result.rows[0]).join(", ") + label);

          // Trigger a background refresh if stale (fire-and-forget, no await)
          if (cacheAgeDays == null || cacheAgeDays > 2) {
            safeFetch(DUNE_BASE + "/api/v1/query/" + queryId + "/execute", {
              method: "POST", body: "{}", timeout: 8000,
            }).then(function() {
              console.info("[Dune] Query " + queryId + " — background refresh queued (next load will get fresh data)");
            }).catch(function() {});
          }

          // ── Secondary staleness check: parse the data's own date field ───────
          // execution_ended_at can be absent; fall back to the row's formatted_time
          // (e.g. "Feb-2022") which directly reflects the data period.
          if (cacheAgeDays == null) {
            const firstRow = data.result.rows[0];
            const rowDate  = firstRow.formatted_time || firstRow.time || firstRow.day || firstRow.date || null;
            if (rowDate) {
              const parsed = new Date(rowDate);
              if (!isNaN(parsed.getTime())) {
                cacheAgeDays = Math.round((Date.now() - parsed.getTime()) / 86400000);
              }
            }
          }
          const ageLabel = cacheAgeDays != null ? cacheAgeDays + "d old" : "age unknown";

          // Discard if >30 days old — stale numbers mislead Claude more than no data
          if (cacheAgeDays == null || cacheAgeDays > 30) {
            console.warn("[Dune] Query " + queryId + " — data is " + ageLabel + " (DISCARDED — background refresh queued; check again next run)");
            return null;
          }
          return data.result.rows;
        }
        if (data && data.error) console.warn("[Dune] Query " + queryId + " server error:", JSON.stringify(data.error));
        return null;
      } catch (e) {
        console.warn("[Dune] Query " + queryId + " failed:", e.message);
        return null;
      }
    };

    // ── MVRV via Dune execute+poll ─────────────────────────────────────────────
    // Dune API pattern:
    //   1. POST /api/v1/query  → create query, get query_id (stored in localStorage)
    //   2. POST /api/v1/query/{id}/execute  → get execution_id  (fire-and-forget)
    //   3. GET  /api/v1/query/{id}/results  → serve latest cached result
    //
    // The SQL computes realized cap from the full UTXO set (Dune bitcoin.outputs).
    // First run triggers execution; subsequent runs read the cache (stale-check applies).

    // v3 SQL: LEFT JOIN anti-join (hash anti-join in Trino — O(n+m), not O(n×m)).
    // bitcoin.outputs has NO spent_tx_id column — that column lives on bitcoin.inputs.
    // Correct pattern: LEFT JOIN bitcoin.inputs ON (spent_tx_id, spent_output_index)
    // then WHERE i.spent_tx_id IS NULL  ← means no matching input exists = UTXO.
    const MVRV_SQL = `WITH utxos AS (
  SELECT
    o.block_date                              AS creation_date,
    SUM(CAST(o.value AS DOUBLE))               AS btc_amount  -- value already in BTC on Dune
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
    SUM(u.btc_amount)                                            AS total_btc,
    SUM(u.btc_amount * COALESCE(p.price_usd, 1.0))             AS realized_cap
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

    const fetchDuneMVRV = async () => {
      // ── Primary path: read from dune-worker.js cache (public/dune_cache.json) ──
      // dune-worker.js runs separately (npm run dune:watch) and writes the result
      // of the expensive UTXO scan to public/dune_cache.json, which Vite serves
      // as a static file.  The brief reads it instantly — zero polling, zero wait.
      // Falls back to inline Dune API polling only when the worker cache is absent
      // or older than 20 hours (e.g. worker wasn't started yet today).
      const CACHE_STALE_HOURS = 20;
      try {
        var cacheRes = await safeFetch('/dune_cache.json', { timeout: 5000 });
        if (cacheRes && cacheRes.mvrv && cacheRes.cachedAt) {
          var ageMs = Date.now() - new Date(cacheRes.cachedAt).getTime();
          if (ageMs < CACHE_STALE_HOURS * 3_600_000) {
            var m = cacheRes.mvrv;
            if (m.mvrv && m.mvrv > 0 && m.mvrv < 50) {
              console.info('[Dune MVRV] ✓ From worker cache (age: ' + Math.round(ageMs / 3_600_000) + 'h) — MVRV:', m.mvrv.toFixed(3));
              return { mvrv: m.mvrv, realizedPrice: m.realizedPrice, marketCap: m.marketCap, realizedCap: m.realizedCap, mvrvDate: m.date || null };
            }
          } else {
            console.info('[Dune MVRV] Worker cache stale (' + Math.round(ageMs / 3_600_000) + 'h) — falling back to inline Dune API');
          }
        }
      } catch (cacheErr) {
        console.info('[Dune MVRV] Worker cache not available (' + cacheErr.message + ') — falling back to inline Dune API');
      }

      // ── Fallback: inline Dune execute+poll ────────────────────────────────────
      // Used when the worker hasn't run yet. Brief stays on loading spinner until
      // the query completes (≤8 min), then calls Claude once with live MVRV.
      // Design goals:
      //   1. On first daily run: trigger Dune, poll inline until complete (≤8 min).
      //      Brief stays on loading spinner — Claude is called ONCE with live MVRV.
      //   2. On subsequent same-day refreshes: use the cached execution_id + timestamp
      //      to return MVRV instantly (no re-trigger, no extra Claude API call).
      //   3. Cache expires after 20h so the next morning triggers a fresh compute.

      const POLL_INTERVAL_MS = 8000;    // check status every 8 seconds while waiting
      const MAX_WAIT_MS      = 480000;  // give up after 8 minutes
      const STALE_HOURS      = 20;      // re-trigger once the cached result is >20h old

      var lsGet = function(k)    { try { return localStorage.getItem(k);    } catch (_e) { return null; } };
      var lsSet = function(k, v) { try { localStorage.setItem(k, v);        } catch (_e) {} };
      var lsDel = function(k)    { try { localStorage.removeItem(k);        } catch (_e) {} };

      // Helper: parse MVRV from execution results response
      var parseMvrvResult = function(data) {
        var rows = data && data.result && data.result.rows;
        if (!rows || !rows.length) return null;
        var row  = rows[0];
        var mvrv = row.mvrv_ratio         != null ? parseFloat(row.mvrv_ratio)         : null;
        var rp   = row.realized_price_usd != null ? parseFloat(row.realized_price_usd) : null;
        var mc   = row.market_cap_usd     != null ? parseFloat(row.market_cap_usd)     : null;
        var rc   = row.realized_cap_usd   != null ? parseFloat(row.realized_cap_usd)   : null;
        if (mvrv != null && mvrv > 0 && mvrv < 50) {
          console.info("[Dune MVRV] ✓ MVRV:", mvrv.toFixed(3),
            "| Realized: $" + (rp ? Math.round(rp).toLocaleString() : "n/a"));
          return { mvrv, realizedPrice: rp, marketCap: mc, realizedCap: rc, mvrvDate: row.date || null };
        }
        return null;
      };

      // Helper: poll an execution_id every POLL_INTERVAL_MS until complete or timeout
      var pollExecution = async function(execId) {
        var deadline = Date.now() + MAX_WAIT_MS;
        var attempt  = 0;
        while (Date.now() < deadline) {
          await new Promise(function(r) { setTimeout(r, POLL_INTERVAL_MS); });
          attempt++;
          var elapsed = Math.round(attempt * POLL_INTERVAL_MS / 1000);
          try {
            var sRes  = await safeFetch(DUNE_BASE + "/api/v1/execution/" + execId + "/status", { timeout: 8000 });
            var state = sRes && sRes.state;
            console.info("[Dune MVRV] Poll #" + attempt + " (" + elapsed + "s) → " + state);
            if (state === "QUERY_STATE_COMPLETED") {
              var rRes   = await safeFetch(DUNE_BASE + "/api/v1/execution/" + execId + "/results", { timeout: 12000 });
              var parsed = parseMvrvResult(rRes);
              if (parsed) { lsSet("dune_mvrv_last_ts", String(Date.now())); return parsed; }
              return null;
            }
            if (state === "QUERY_STATE_FAILED" || state === "QUERY_STATE_CANCELLED") {
              console.warn("[Dune MVRV] Execution " + state + " after " + elapsed + "s");
              lsDel("dune_mvrv_execution_id_v4");
              return null;
            }
            // QUERY_STATE_EXECUTING / QUERY_STATE_PENDING → keep waiting
          } catch (pe) { console.warn("[Dune MVRV] Poll error:", pe.message); }
        }
        console.warn("[Dune MVRV] Timed out after " + (MAX_WAIT_MS / 60000) + "min — Claude will estimate MVRV");
        return null;
      };

      // ── Fast path: return cached result if <STALE_HOURS old ──────────────────
      var lastTs       = lsGet("dune_mvrv_last_ts");
      var storedExecId = lsGet("dune_mvrv_execution_id_v4");
      var ageMs        = lastTs ? (Date.now() - parseInt(lastTs)) : Infinity;
      var isFresh      = ageMs < STALE_HOURS * 3600000;

      if (isFresh && storedExecId) {
        try {
          var cachedRes    = await safeFetch(DUNE_BASE + "/api/v1/execution/" + storedExecId + "/results", { timeout: 10000 });
          var cachedParsed = parseMvrvResult(cachedRes);
          if (cachedParsed) {
            console.info("[Dune MVRV] Cached result (~" + Math.round(ageMs / 3600000) + "h old) — skipping re-execution");
            return cachedParsed;
          }
        } catch (_e) { /* cache miss — fall through to re-trigger */ }
      }

      // ── Get or create the MVRV query ID ──────────────────────────────────────
      var mvrvQueryId = lsGet("dune_mvrv_query_id_v4");
      if (!mvrvQueryId) {
        try {
          var createRes = await safeFetch(DUNE_BASE + "/api/v1/query", {
            method: "POST",
            body: JSON.stringify({
              name: "BTC MVRV Ratio - Maison Toe",
              description: "BTC MVRV = Market Cap / Realized Cap via UTXO spent_tx_id IS NULL",
              query_sql: MVRV_SQL,
              is_private: false,
              parameters: [],
            }),
            timeout: 15000,
          });
          if (createRes && createRes.query_id) {
            mvrvQueryId = String(createRes.query_id);
            lsSet("dune_mvrv_query_id_v4", mvrvQueryId);
            console.info("[Dune MVRV] Query created → id:", mvrvQueryId);
          }
        } catch (createErr) {
          console.warn("[Dune MVRV] Query creation failed:", createErr.message);
        }
      }
      if (!mvrvQueryId) { console.warn("[Dune MVRV] No query ID — Claude estimates MVRV"); return null; }

      // ── If there's an in-progress execution (stale but still running), poll it ─
      if (storedExecId) {
        try {
          var checkRes = await safeFetch(DUNE_BASE + "/api/v1/execution/" + storedExecId + "/status", { timeout: 8000 });
          var checkState = checkRes && checkRes.state;
          if (checkState === "QUERY_STATE_COMPLETED") {
            var r2 = await safeFetch(DUNE_BASE + "/api/v1/execution/" + storedExecId + "/results", { timeout: 10000 });
            var p2 = parseMvrvResult(r2);
            if (p2) { lsSet("dune_mvrv_last_ts", String(Date.now())); return p2; }
          } else if (checkState === "QUERY_STATE_EXECUTING" || checkState === "QUERY_STATE_PENDING") {
            console.info("[Dune MVRV] Resuming in-progress execution — polling inline...");
            return await pollExecution(storedExecId);
          } else {
            lsDel("dune_mvrv_execution_id_v4"); // failed/cancelled — re-trigger below
          }
        } catch (_e) {}
      }

      // ── Trigger fresh execution + poll inline until complete ──────────────────
      try {
        var execRes = await safeFetch(
          DUNE_BASE + "/api/v1/query/" + mvrvQueryId + "/execute",
          { method: "POST", body: "{}", timeout: 12000 }
        );
        if (execRes && execRes.execution_id) {
          var newExecId = execRes.execution_id;
          lsSet("dune_mvrv_execution_id_v4", newExecId);
          console.info("[Dune MVRV] Execution triggered → " + newExecId + " — polling inline (up to 8min)...");
          return await pollExecution(newExecId);
        }
      } catch (execErr) {
        console.warn("[Dune MVRV] Execute failed:", execErr.message);
      }
      return null;
    };

    const out = {
      exchangeNetflowBTC: null,
      exchangeInflowBTC:  null,
      exchangeOutflowBTC: null,
      mvrv: null,
      mvrvRealizedPrice: null,
      sopr: null,
      source: "Dune Analytics (community queries)",
    };

    // ── 0. Dune worker cache — exchange flows (if worker computed them) ────────
    // dune-worker.js may write exchangeFlow data alongside MVRV. Check first.
    try {
      var cacheCheck = await safeFetch('/dune_cache.json', { timeout: 4000 });
      if (cacheCheck && cacheCheck.exchangeFlow && cacheCheck.exchangeFlow.inflow_btc != null) {
        const ef = cacheCheck.exchangeFlow;
        const ageMs = Date.now() - new Date(cacheCheck.cachedAt).getTime();
        if (ageMs < 20 * 3_600_000) { // fresh within 20h
          out.exchangeInflowBTC  = ef.inflow_btc;
          out.exchangeOutflowBTC = ef.outflow_btc != null ? Math.abs(ef.outflow_btc) : null;
          out.exchangeNetflowBTC = ef.netflow_btc;
          out.dataDate           = ef.day || null;
          out.source             = "Dune worker cache (labeled exchange addresses)";
          console.info("[Dune] Exchange flows from worker cache — Net:", (ef.netflow_btc || 0).toFixed(0), "BTC | addrs:", ef.exchange_addr_count || "?");
        }
      }
    } catch (_ce) { /* cache miss — continue */ }

    // ── 0b. CoinGlass exchange chain flow (try public endpoint, no auth) ──────
    // Falls back cleanly if the endpoint requires a key (403) or returns no data.
    if (out.exchangeInflowBTC == null) {
      try {
        var cgData = await safeFetch(
          '/api/coinglass-open/public/v2/indicator/exchange_chain_flow?symbol=BTC&timeType=daily&limit=1',
          { timeout: 8000 }
        );
        // CoinGlass returns { code: "0", data: [{...}] } on success
        var cgRow = cgData?.data?.[0] || cgData?.data;
        if (cgRow) {
          var cgIn  = parseFloat(cgRow.inflow  ?? cgRow.inflowAmount  ?? cgRow.inflow_btc  ?? 0);
          var cgOut = parseFloat(cgRow.outflow ?? cgRow.outflowAmount ?? cgRow.outflow_btc ?? 0);
          if (cgIn > 0 || cgOut > 0) {
            out.exchangeInflowBTC  = cgIn;
            out.exchangeOutflowBTC = Math.abs(cgOut);
            out.exchangeNetflowBTC = cgIn - Math.abs(cgOut);
            out.dataDate           = cgRow.date || cgRow.time || null;
            out.source             = "CoinGlass exchange chain flow";
            console.info("[CoinGlass] Exchange flow ✓ — In:", cgIn.toFixed(0), "| Out:", cgOut.toFixed(0), "BTC");
          }
        }
      } catch (_cg) {
        console.warn("[CoinGlass] Exchange flow failed:", _cg.message);
      }
    }

    // ── 1. BTC Exchange Inflow / Outflow (query 3485694) ──────────────────────
    // Community query — only covers a partial address subset (typically 300-700 BTC gross).
    // Only use if no better source resolved above.
    // Confirmed column names: formatted_time, inflow, inflow_usd, netflow, outflow, outflow_usd, time
    // NOTE: 'netflow' in this query is a cumulative aggregate — use inflow+outflow for daily net
    const flowRows = out.exchangeInflowBTC == null ? await fetchDuneQuery(3485694) : null;
    if (flowRows && flowRows.length > 0) {
      const r = flowRows[0];
      console.info("[Dune] BTC flow row:", JSON.stringify(r));
      const inBTC  = r.inflow  != null ? parseFloat(r.inflow)  : null;
      const outBTC = r.outflow != null ? parseFloat(r.outflow) : null; // stored as negative
      out.exchangeInflowBTC  = inBTC;
      out.exchangeOutflowBTC = outBTC != null ? Math.abs(outBTC) : null; // normalise to positive
      // Daily net = inflow + outflow (outflow is negative in this schema)
      out.exchangeNetflowBTC = (inBTC != null && outBTC != null) ? inBTC + outBTC : null;
      out.dataDate = r.formatted_time || null; // e.g. "Feb-2022" — shows cache freshness
      // Convert from satoshis if the numbers look too large (>1e10 means sats)
      if (out.exchangeNetflowBTC != null && Math.abs(out.exchangeNetflowBTC) > 1e10) {
        out.exchangeNetflowBTC = out.exchangeNetflowBTC / 1e8;
        out.exchangeInflowBTC  = out.exchangeInflowBTC  ? out.exchangeInflowBTC  / 1e8 : null;
        out.exchangeOutflowBTC = out.exchangeOutflowBTC ? out.exchangeOutflowBTC / 1e8 : null;
      }
    }

    // ── 2. Fallback — CEX total inflow / outflow (query 1621987) ─────────────
    if (out.exchangeInflowBTC == null) {
      const cexRows = await fetchDuneQuery(1621987);
      if (cexRows && cexRows.length > 0) {
        const r = cexRows[0];
        console.info("[Dune] CEX flow fallback row:", JSON.stringify(r));
        // Try common column patterns for this query
        const inBTC  = r.inflow  ?? r.total_inflow  ?? r.inflow_btc  ?? null;
        const outBTC = r.outflow ?? r.total_outflow ?? r.outflow_btc ?? null;
        if (inBTC != null) out.exchangeInflowBTC  = Math.abs(parseFloat(inBTC));
        if (outBTC != null) out.exchangeOutflowBTC = Math.abs(parseFloat(outBTC));
        if (inBTC != null && outBTC != null) {
          out.exchangeNetflowBTC = parseFloat(inBTC) - Math.abs(parseFloat(outBTC));
        }
        out.dataDate = r.formatted_time || r.day || r.date || null;
      }
    }

    // ── COVERAGE CHECK ────────────────────────────────────────────────────
    // Free-tier Bitcoin exchange flow data is fundamentally limited:
    //   - labels.addresses has 0 Bitcoin CEX entries (probed 2026-04-10)
    //   - Worker tracks ~20 known cold/custody wallet addresses only
    //   - Hot deposit wallets rotate constantly — cannot be tracked for free
    // Full-market gross flow (all venues): 30,000–200,000 BTC/day
    // Cold-wallet-only coverage typically: 500–5,000 BTC/day (large settlements only)
    // Flag partial data so Claude can weight accordingly and lean on CME basis,
    // funding rate, OI, and MVRV as primary directional signals instead.
    const grossFlow = (out.exchangeInflowBTC || 0) + (out.exchangeOutflowBTC || 0);
    if (out.exchangeInflowBTC != null && grossFlow < 5000) {
      out.exchangeFlowSuspicious = true;
      out.exchangeFlowSuspiciousNote =
        "PARTIAL DATA: gross=" + grossFlow.toFixed(0) + " BTC (cold/custody wallets only; "
        + "hot deposit addresses not tracked on free tier). "
        + "Use as directional indicator for large institutional settlements only. "
        + "Primary signals: CME basis, funding rate, OI, MVRV.";
      console.warn("[Dune] Partial coverage: gross flow " + grossFlow.toFixed(0) + " BTC (cold-wallet subset only)");
    }

    // ── 3. MVRV via execute+poll ───────────────────────────────────────────
    const mvrvResult = await fetchDuneMVRV();
    if (mvrvResult) {
      out.mvrv              = mvrvResult.mvrv;
      out.mvrvRealizedPrice = mvrvResult.realizedPrice;
      out.mvrvDate          = mvrvResult.mvrvDate;
    }

    const hasData = out.exchangeNetflowBTC != null || out.exchangeInflowBTC != null;
    if (hasData) {
      console.info("[Dune] Exchange flows — Net:", out.exchangeNetflowBTC != null ? out.exchangeNetflowBTC.toFixed(0) + " BTC" : "n/a",
        "| In:", out.exchangeInflowBTC != null ? out.exchangeInflowBTC.toFixed(0) + " BTC" : "n/a",
        "| Out:", out.exchangeOutflowBTC != null ? out.exchangeOutflowBTC.toFixed(0) + " BTC" : "n/a");
    } else {
      console.warn("[Dune] No exchange flow data resolved — check browser console for column names");
    }
    return out;
  };

  // ── CME FUTURES BASIS (Yahoo Finance BTC=F vs BTC-USD spot) ─────────────────
  // Free public API, no auth required.
  // Proxy at /api/yahoo → https://query1.finance.yahoo.com
  // BTC=F is the CME front-month Bitcoin futures contract ticker on Yahoo Finance.
  const fetchCMEData = async () => {
    const out = {
      cmeBasisPct: null,
      cmeOIusd: null,
      totalAggOIusd: null,
      oiByExchange: null,
      cmeBasisSource: null,
    };
    // CME is closed Saturday and Sunday — BTC=F returns a stale Friday close while
    // BTC-USD is live, producing a meaningless basis. Skip on weekends.
    const dow = new Date().getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) {
      console.info('[CME] Weekend — CME closed, skipping basis calculation');
      return out;
    }
    try {
      // Fetch CME front-month futures and BTC spot in parallel
      var [futRes, spotRes] = await Promise.all([
        safeFetch("/api/yahoo/v8/finance/chart/BTC%3DF?interval=1d&range=5d", { timeout: 12000 }),
        safeFetch("/api/yahoo/v8/finance/chart/BTC-USD?interval=1d&range=1d",  { timeout: 12000 }),
      ]);
      var futMeta  = futRes?.chart?.result?.[0]?.meta;
      var spotMeta = spotRes?.chart?.result?.[0]?.meta;
      var futPrice  = futMeta?.regularMarketPrice  ?? futMeta?.previousClose  ?? null;
      var spotPrice = spotMeta?.regularMarketPrice ?? spotMeta?.previousClose ?? null;

      if (futPrice && spotPrice && spotPrice > 0) {
        // Days to expiry: Yahoo provides expireDate as unix seconds on the futures meta
        var expireTs  = futMeta?.expireDate;
        var daysToExp = expireTs
          ? Math.max(1, Math.round((expireTs * 1000 - Date.now()) / 86400000))
          : 30; // default 30d if field missing
        var spotBasisPct  = (futPrice - spotPrice) / spotPrice * 100;           // raw % premium
        var annualized    = parseFloat((spotBasisPct * (365 / daysToExp)).toFixed(2));
        out.cmeBasisPct    = annualized;
        out.cmeDaysToExpiry = daysToExp;
        out.cmeBasisSource = "Yahoo Finance BTC=F vs spot (" + daysToExp + "d to expiry, annualized)";
        console.info("[CME] Basis via Yahoo Finance:", annualized.toFixed(2) + "% ann | fut: $"
          + futPrice.toFixed(0) + " | spot: $" + spotPrice.toFixed(0) + " | daysToExp: " + daysToExp);

        // ── Second-month contract (dynamic CME quarterly ticker) ──────────────
        // "BTC2=F" does NOT exist on Yahoo Finance. CME quarterly contracts trade as
        // BTC[monthCode][YY].CME  e.g. BTCM26.CME (Jun-2026), BTCU26.CME (Sep-2026).
        // Month codes: Mar=H, Jun=M, Sep=U, Dec=Z.
        // We derive the second-month ticker from the front-month's expireDate so this
        // rolls correctly at every quarterly roll without any hardcoded year/month.
        var getCMESecondMonthTicker = function(frontExpireTs) {
          var MONTHS = [2, 5, 8, 11]; // 0-based: Mar, Jun, Sep, Dec
          var CODES  = ['H', 'M', 'U', 'Z'];
          var base   = new Date((frontExpireTs || Date.now() / 1000) * 1000);
          var y = base.getFullYear(), m = base.getMonth();
          for (var pass = 0; pass < 2; pass++) {
            for (var i = 0; i < MONTHS.length; i++) {
              if (pass === 0 && MONTHS[i] <= m) continue;
              return 'BTC' + CODES[i] + String(y).slice(-2) + '.CME';
            }
            y++; // wrap: Dec → Mar of next year
          }
          return null;
        };
        var secondMonthTicker = getCMESecondMonthTicker(expireTs);
        var secondMonthBasis = null;
        try {
          if (!secondMonthTicker) throw new Error("could not compute second-month CME ticker from expireDate");
          var fut2Res  = await safeFetch("/api/yahoo/v8/finance/chart/" + encodeURIComponent(secondMonthTicker) + "?interval=1d&range=5d", { timeout: 8000 });
          var fut2Meta = fut2Res && fut2Res.chart && fut2Res.chart.result && fut2Res.chart.result[0] && fut2Res.chart.result[0].meta;
          var fut2Price = (fut2Meta && (fut2Meta.regularMarketPrice || fut2Meta.previousClose)) || null;
          if (fut2Price && spotPrice > 0) {
            var expire2Ts  = fut2Meta && fut2Meta.expireDate;
            var days2ToExp = expire2Ts
              ? Math.max(1, Math.round((expire2Ts * 1000 - Date.now()) / 86400000))
              : 90;
            var basis2Raw     = (fut2Price - spotPrice) / spotPrice * 100;
            secondMonthBasis  = parseFloat((basis2Raw * (365 / days2ToExp)).toFixed(2));
            out.cmeSecondMonthBasis    = secondMonthBasis;
            out.cmeSecondMonthDaysToEx = days2ToExp;
            console.info("[CME] " + secondMonthTicker + " second-month:", secondMonthBasis.toFixed(2) + "% ann | fut2: $"
              + fut2Price.toFixed(0) + " | days:", days2ToExp);
          }
        } catch (e2) {
          console.warn("[CME] Second-month fetch failed (" + (secondMonthTicker || "no ticker") + "):", e2.message);
        }

        // If front-month is near expiry, switch to second-month as the primary basis.
        // Otherwise compute a 70/30 weighted average for a smoother rolling signal.
        var isNearExpiry = daysToExp < 14;
        out.cmeNearExpiry = isNearExpiry;
        if (isNearExpiry && secondMonthBasis != null) {
          out.cmeBasisPct    = secondMonthBasis;
          out.cmeBasisSource = "Yahoo " + secondMonthTicker + " (front-month <14d to expiry — using second month, " + days2ToExp + "d, annualized)";
          console.info("[CME] Near-expiry rollover: using", secondMonthTicker, "basis", secondMonthBasis.toFixed(2) + "%");
        } else if (secondMonthBasis != null) {
          out.cmeBasisWeighted = parseFloat((annualized * 0.7 + secondMonthBasis * 0.3).toFixed(2));
        }
      } else {
        console.warn("[CME] Yahoo Finance BTC=F — price data missing | fut:", futPrice, "| spot:", spotPrice);
      }
    } catch (e) {
      console.warn("[CME] Yahoo Finance BTC=F failed:", e.message);
    }
    return out;
  };

  // ── LIVE ETF FLOWS (Farside → Yahoo Finance fallback) ──────────────────────────
  // PRIMARY: Farside Investors (farside.co.uk) — publishes actual daily creation/redemption
  //          net flows for every US Bitcoin spot ETF. Values in $M. Typically updated T+1.
  // FALLBACK: Yahoo Finance IBIT/FBTC trading volume (activity proxy, not actual flows).
  const fetchETFFlows = async () => {
    // ── -1. Dune worker cache — ETF flow pre-fetched by Node.js worker ───────────
    // Worker tries SoSoValue → CoinGlass directly (residential IP, no Vite proxy).
    // Cached in public/dune_cache.json as { etfFlow: { total_million_usd, date, source } }.
    // Max cache age: 20h (same as exchange flow).
    try {
      var etfCache = await safeFetch('/dune_cache.json', { timeout: 4000 });
      if (etfCache && etfCache.etfFlow && etfCache.etfFlow.total_million_usd != null && etfCache.etfFlow.total_million_usd !== 0) {
        var ageMs = Date.now() - new Date(etfCache.cachedAt).getTime();
        if (ageMs < 20 * 3_600_000) {
          var ef = etfCache.etfFlow;
          var totalUSD = ef.total_million_usd * 1e6;
          var srcLabel = ef.source || 'Farside Investors';
          console.info('[ETF] Worker cache ✓ — date:', ef.date, '| total: $' + (ef.total_million_usd >= 0 ? '+' : '') + ef.total_million_usd.toFixed(0) + 'M | src:', srcLabel);
          return {
            etfTotalNetUSD:   totalUSD,
            etfIBITvolumeUSD: null,
            etfIBITclose:     null,
            etfFlowSource:    'Farside Investors (actual daily net flows)',
            etfFlowDate:      ef.date,
            etfFlowLive:      true,
          };
        } else {
          console.info('[ETF] Worker cache stale (' + Math.round(ageMs / 3_600_000) + 'h) — trying live sources');
        }
      }
    } catch (_wce) {
      console.warn('[ETF] Worker cache miss:', _wce.message);
    }

    // ── 0. Farside Investors — real daily ETF creation/redemption net flow ($M) ──
    // Proxy at /api/farside → https://farside.co.uk
    // Page: /bitcoin-etf-flow.html  — HTML table with Date | GBTC | IBIT | … | Total
    try {
      const html = await rawFetch('/api/farside/btc/', { timeout: 15000 });
      const parser = new DOMParser();
      const doc    = parser.parseFromString(html, 'text/html');
      // Find the table that has a "Total" header column
      let table = null, totalColIdx = -1;
      for (const t of doc.querySelectorAll('table')) {
        // Check header cells in the first row (th or td)
        const hdrCells = Array.from(t.querySelectorAll('tr:first-child th, tr:first-child td'));
        for (let ci = 0; ci < hdrCells.length; ci++) {
          if (hdrCells[ci].textContent.trim().toUpperCase() === 'TOTAL') {
            totalColIdx = ci; table = t; break;
          }
        }
        if (table) break;
      }
      if (!table || totalColIdx < 0) throw new Error('No Total column found in Farside table');
      // Walk rows bottom-to-top to find most recent row with a real Total value
      const rows = Array.from(table.querySelectorAll('tr'));
      for (let ri = rows.length - 1; ri >= 1; ri--) {
        const cells = Array.from(rows[ri].querySelectorAll('td'));
        if (cells.length <= totalColIdx) continue;
        const dateText  = (cells[0]?.textContent || '').trim();
        if (!dateText || dateText.length < 4) continue;
        const totalRaw  = (cells[totalColIdx]?.textContent || '').replace(/[$,\s]/g, '').trim();
        if (!totalRaw || totalRaw === '') continue;
        // Handle parenthetical negatives: (123.4) → -123.4
        const parsed    = parseFloat(totalRaw.replace(/\(([^)]+)\)/, '-$1'));
        if (isNaN(parsed)) continue;
        const totalUSD  = parsed * 1e6; // Farside values are in $M
        console.info('[ETF] Farside ✓ — date:', dateText, '| total: $' + (parsed >= 0 ? '+' : '') + parsed.toFixed(0) + 'M');
        return {
          etfTotalNetUSD:   totalUSD,
          etfIBITvolumeUSD: null,
          etfIBITclose:     null,
          etfFlowSource:    'Farside Investors (actual daily net flows)',
          etfFlowDate:      dateText,
          etfFlowLive:      true,
        };
      }
      throw new Error('No valid data rows in Farside table');
    } catch (_fe) {
      console.warn('[ETF] Farside failed:', _fe.message);
    }

    // ── 1. SoSoValue — US BTC spot ETF total daily net flow (JSON API) ────────
    // SoSoValue tracks all US spot BTC ETFs and publishes a public JSON API.
    // Proxy at /api/sosovalue → https://sosovalue.com
    // Tries several known endpoint patterns; falls through on 403/404.
    const sosoEndpoints = [
      '/api/sosovalue/api/etf/us-btc-spot/fund-flow?type=total',
      '/api/sosovalue/api/etf/us-btc-spot/net-asset?type=total',
      '/api/sosovalue/api/index/indexDailyHistory?code=US-BTC-SPOT-ETF&range=1',
    ];
    for (var _ep of sosoEndpoints) {
      try {
        var ssv = await safeFetch(_ep, { timeout: 10000 });
        // Possible shapes: { data: { totalNetInflow: 123, date: '...' } } or array
        var ssvData = ssv?.data;
        if (!ssvData) continue;
        var row = Array.isArray(ssvData) ? ssvData[ssvData.length - 1] : ssvData;
        var netM = row?.totalNetInflow ?? row?.netInflow ?? row?.net_inflow ?? row?.totalFlow ?? null;
        if (netM != null) {
          // SoSoValue typically returns values in $M
          var netUSD = Math.abs(netM) > 1e6 ? netM : netM * 1e6;
          var dateStr = row?.date || row?.time || new Date().toISOString().slice(0, 10);
          console.info('[ETF] SoSoValue ✓ (' + _ep + ') — net: $' + (netUSD / 1e6).toFixed(0) + 'M | date:', dateStr);
          return {
            etfTotalNetUSD:   netUSD,
            etfIBITvolumeUSD: null,
            etfIBITclose:     null,
            etfFlowSource:    'SoSoValue (US BTC spot ETF total net flow)',
            etfFlowDate:      dateStr,
            etfFlowLive:      true,
          };
        }
      } catch (_sv) {
        console.warn('[ETF] SoSoValue ' + _ep + ' failed:', _sv.message);
      }
    }

    // ── 2. Yahoo Finance IBIT — 5-day daily OHLCV (volume proxy fallback) ────
    try {
      var yhIBIT = await safeFetch("/api/yahoo/v8/finance/chart/IBIT?interval=1d&range=5d", { timeout: 10000 });
      var result = yhIBIT?.chart?.result?.[0];
      if (result) {
        var meta      = result.meta;
        var close     = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
        var vol       = meta?.regularMarketVolume ?? null;
        var timestamp = meta?.regularMarketTime;
        // Also try to pull previous-day close + volume from the timeseries arrays
        var closes    = result.indicators?.quote?.[0]?.close;
        var volumes   = result.indicators?.quote?.[0]?.volume;
        if ((!close || !vol) && closes && closes.length > 0) {
          var lastIdx = closes.length - 1;
          close = closes[lastIdx] ?? close;
          vol   = volumes?.[lastIdx] ?? vol;
        }
        if (close && vol && close > 0 && vol > 0) {
          var dollarVol = close * vol;
          var dateStr   = timestamp
            ? new Date(timestamp * 1000).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
          console.info("[ETF] Yahoo IBIT OK — close: $" + close.toFixed(2) + " | vol: " + Math.round(dollarVol / 1e6) + "M | date: " + dateStr);
          return {
            etfTotalNetUSD:   null,
            etfIBITvolumeUSD: dollarVol,
            etfIBITclose:     close,
            etfFlowSource:    "Yahoo Finance IBIT vol (proxy — NOT actual creation/redemption flows)",
            etfFlowDate:      dateStr,
            etfFlowLive:      false,
          };
        }
      }
    } catch (_e) {
      console.warn("[ETF] Yahoo Finance IBIT failed:", _e.message);
    }
    // 2. Yahoo Finance FBTC as secondary check (Fidelity BTC ETF — same proxy)
    try {
      var yhFBTC = await safeFetch("/api/yahoo/v8/finance/chart/FBTC?interval=1d&range=5d", { timeout: 10000 });
      var r2 = yhFBTC?.chart?.result?.[0];
      if (r2) {
        var m2     = r2.meta;
        var close2 = m2?.regularMarketPrice ?? null;
        var vol2   = m2?.regularMarketVolume ?? null;
        if (close2 && vol2 && close2 > 0) {
          var dv2 = close2 * vol2;
          console.info("[ETF] Yahoo FBTC fallback — close: $" + close2.toFixed(2) + " | vol: " + Math.round(dv2 / 1e6) + "M");
          return {
            etfTotalNetUSD:   null,
            etfIBITvolumeUSD: dv2,
            etfIBITclose:     close2,
            etfFlowSource:    "Yahoo Finance FBTC vol (proxy — NOT actual flows)",
            etfFlowDate:      new Date().toISOString().slice(0, 10),
            etfFlowLive:      false,
          };
        }
      }
    } catch (_e2) {
      console.warn("[ETF] Yahoo Finance FBTC fallback failed:", _e2.message);
    }
    console.warn("[ETF] All flow sources failed — Claude will estimate from training knowledge");
    return null;
  };

  // ── LTH Net Position Change — reads from dune-worker.js cache ───────────────
  // Worker fetches this from Bitcoin Magazine Pro via Playwright.
  // Cache key: lthData = { lth_net_btc, date, source_url }
  const fetchLTHData = async () => {
    try {
      var cacheRes = await safeFetch('/dune_cache.json', { timeout: 5000 });
      if (cacheRes && cacheRes.lthData && cacheRes.cachedAt) {
        var ageMs = Date.now() - new Date(cacheRes.cachedAt).getTime();
        if (ageMs < 20 * 3_600_000 && cacheRes.lthData.lth_net_btc != null) {
          console.info('[LTH] ✓ From worker cache — LTH net:', cacheRes.lthData.lth_net_btc, 'BTC (', cacheRes.lthData.date, ')');
          return cacheRes.lthData;
        }
      }
    } catch (e) {
      console.warn('[LTH] Cache read failed:', e.message);
    }
    return null;
  };

  // ── Stablecoin Supply — reads from dune-worker.js cache ──────────────────────
  // Worker fetches USDT+USDC from CoinGecko (free). 7d delta computed by worker.
  // Cache key: stablecoinSupply = { total_usd, delta_7d_usd, delta_7d_pct, regime, date }
  const fetchStablecoinData = async () => {
    try {
      var cacheRes = await safeFetch('/dune_cache.json', { timeout: 5000 });
      if (cacheRes && cacheRes.stablecoinSupply && cacheRes.cachedAt) {
        var ageMs = Date.now() - new Date(cacheRes.cachedAt).getTime();
        if (ageMs < 20 * 3_600_000 && cacheRes.stablecoinSupply.total_usd != null) {
          console.info('[Stable] ✓ From worker cache — Total: $' + (cacheRes.stablecoinSupply.total_usd / 1e9).toFixed(1) + 'B | Regime: ' + cacheRes.stablecoinSupply.regime);
          return cacheRes.stablecoinSupply;
        }
      }
    } catch (e) {
      console.warn('[Stable] Cache read failed:', e.message);
    }
    return null;
  };

  // ── LIVE MACRO DATA (Yahoo Finance via existing proxy) ───────────────────────
  // DXY  = US Dollar Index  (^DX-Y.NYB)
  // VIX  = CBOE Volatility Index (^VIX)
  // TNX  = 10-Year Treasury Yield (^TNX, value × 0.1 = % yield)
  // Previously all three were estimated from Claude's training knowledge;
  // now fetched live for accurate daily macro context.
  const fetchMacroData = async () => {
    const out = {
      dxy: null, dxyChange: null,
      vix: null, vixChange: null,
      tnxYield: null, tnxChange: null,
    };

    // Helper: extract latest price + 1-day change from Yahoo chart response
    var extract = function(res) {
      var meta   = res && res.chart && res.chart.result && res.chart.result[0] && res.chart.result[0].meta;
      var qdata  = res && res.chart && res.chart.result && res.chart.result[0] &&
                   res.chart.result[0].indicators && res.chart.result[0].indicators.quote &&
                   res.chart.result[0].indicators.quote[0];
      var closesArr = (qdata && qdata.close) ? qdata.close.filter(function(v) { return v != null; }) : [];
      var price  = (meta && (meta.regularMarketPrice || meta.previousClose)) || null;
      var prev   = closesArr.length >= 2 ? closesArr[closesArr.length - 2] : null;
      var change = (price && prev && prev !== 0)
        ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : null;
      return { price: price, change: change };
    };

    // Each ticker fetched independently — one 404 must not silence the others.
    // NOTE: DX-Y.NYB has NO caret prefix on Yahoo Finance (unlike ^VIX or ^TNX).
    try {
      var dxyRes = await safeFetch("/api/yahoo/v8/finance/chart/DX-Y.NYB?interval=1d&range=5d", { timeout: 10000 });
      var dxy = extract(dxyRes);
      if (dxy.price) { out.dxy = parseFloat(dxy.price.toFixed(2)); out.dxyChange = dxy.change; }
      console.info("[Macro] DXY:", out.dxy, out.dxyChange != null ? "(" + (out.dxyChange > 0 ? "+" : "") + out.dxyChange + "%)" : "");
    } catch (e) { console.warn("[Macro] DXY fetch failed:", e.message); }

    try {
      var vixRes = await safeFetch("/api/yahoo/v8/finance/chart/%5EVIX?interval=1d&range=5d", { timeout: 10000 });
      var vix = extract(vixRes);
      if (vix.price) { out.vix = parseFloat(vix.price.toFixed(1)); out.vixChange = vix.change; }
      console.info("[Macro] VIX:", out.vix, out.vixChange != null ? "(" + (out.vixChange > 0 ? "+" : "") + out.vixChange + "%)" : "");
    } catch (e) { console.warn("[Macro] VIX fetch failed:", e.message); }

    try {
      var tnxRes = await safeFetch("/api/yahoo/v8/finance/chart/%5ETNX?interval=1d&range=5d", { timeout: 10000 });
      var tnx = extract(tnxRes);
      if (tnx.price) {
        // TNX: Yahoo returns the yield already (e.g. 4.35). Guard: if > 20, divide by 10.
        out.tnxYield  = parseFloat((tnx.price > 20 ? tnx.price / 10 : tnx.price).toFixed(2));
        out.tnxChange = tnx.change;
      }
      console.info("[Macro] TNX:", out.tnxYield ? out.tnxYield + "%" : "n/a");
    } catch (e) { console.warn("[Macro] TNX fetch failed:", e.message); }

    return out;
  };

  const callClaude = async (systemPrompt, userMessage, useSearch, maxTokens) => {
    // Step 1: use cached brief only if it was generated with LIVE data quality.
    // Reject the cache and regenerate if key fields are null — the Mac browser
    // can fetch these live via Vite proxy even when GitHub Actions IPs are blocked.
    var ad = allDataRef.current;
    if (ad && ad.brief) {
      var ageMs = Date.now() - new Date(ad.briefCachedAt || ad.cachedAt).getTime();
      var hasPrice   = ad.market && ad.market.price != null;
      var hasMacros  = ad.macros && ad.macros.dxy != null;       // DXY from Yahoo/Stooq
      var hasTech    = ad.tech   && ad.tech.sma200 != null;      // SMAs from Binance/Kraken
      var hasCME     = ad.cme    && ad.cme.cmeBasisPct != null;  // CME basis from Yahoo/OKX
      var dataQuality = hasMacros && hasTech;  // minimum: live macros + live SMAs
      if (ageMs < 20 * 3_600_000 && hasPrice && dataQuality) {
        console.info("[Claude] ✓ Using pre-generated brief (age: " + Math.round(ageMs / 3_600_000) + "h, macros:" + hasMacros + " tech:" + hasTech + " cme:" + hasCME + ")");
        return JSON.stringify(ad.brief);
      } else {
        var reasons = [];
        if (!hasPrice)    reasons.push("no price");
        if (!hasMacros)   reasons.push("no macros (DXY null)");
        if (!hasTech)     reasons.push("no tech (SMA null)");
        if (ageMs >= 20 * 3_600_000) reasons.push("stale (" + Math.round(ageMs / 3_600_000) + "h)");
        console.warn("[Claude] Cached brief rejected — " + reasons.join(", ") + " — regenerating with live data");
      }
    }

    // Step 2: retry — check local first, then GitHub Pages
    var retrySources = ["/all_data.json", ALL_DATA_URL];
    for (var _ri = 0; _ri < retrySources.length; _ri++) {
      var _rUrl = retrySources[_ri];
      try {
        console.info("[Claude] Retrying all_data.json from", _rUrl);
        var retry = await fetch(_rUrl, { signal: AbortSignal.timeout(_rUrl.startsWith("/") ? 3000 : 15000) });
        if (!retry.ok) continue;
        var retryJson = await retry.json();
        if (retryJson && retryJson.brief) {
          var _rHasPrice  = retryJson.market && retryJson.market.price != null;
          var _rHasMacros = retryJson.macros && retryJson.macros.dxy != null;
          var _rHasTech   = retryJson.tech   && retryJson.tech.sma200 != null;
          if (_rHasPrice && _rHasMacros && _rHasTech) {
            allDataRef.current = retryJson;
            console.info("[Claude] ✓ Retry from", _rUrl, "— using pre-generated brief (full data quality)");
            return JSON.stringify(retryJson.brief);
          } else if (_rHasPrice) {
            console.warn("[Claude] Retry from", _rUrl, "— brief has nulls (macros:" + _rHasMacros + " tech:" + _rHasTech + ") — will regenerate live");
          }
        }
        if (retryJson && retryJson.brief_error) {
          console.warn("[Claude] brief_error in", _rUrl, ":", retryJson.brief_error);
        }
      } catch (retryErr) {
        console.warn("[Claude] Retry from", _rUrl, "failed:", retryErr.message);
      }
    }

    // Step 3: local dev fallback — call Anthropic via Vite proxy
    // (This will NOT work in the APK — we should never reach here in production)
    if (!ANTHROPIC_KEY) {
      throw new Error("Brief unavailable: no cached brief found and no API key configured.");
    }
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens || 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    };
    // web search disabled locally — adds latency /* if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }]; */
    // 90s timeout — Claude search calls can be slow but shouldn't exceed this
    const controller = new AbortController();
    const timeoutId = setTimeout(function() { controller.abort(); }, 180000);
    var res;
    try {
      res = await fetch("/api/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") throw new Error("Claude API timeout after 90s — network may be restricted in this context");
      throw fetchErr;
    }
    clearTimeout(timeoutId);
    const data = await res.json();
    if (data.error) throw new Error("API: " + data.error.type + " — " + data.error.message + " " + JSON.stringify(data.error));
    if (!data.content || !data.content.length) throw new Error("Empty response (stop: " + data.stop_reason + ")");
    return data.content.filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("").trim();
  };

  const generateBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBrief(null);
    setDebugLog([]);
    allDataRef.current = null;
    setStage("fetching-market");
    addLog("Loading cached data from GitHub Pages...");

    // Load all_data.json first — gives callClaude() the pre-generated brief
    try {
      var cachedAll = await loadAllData();
      if (cachedAll) {
        var cacheAgeH = Math.round((Date.now() - new Date(cachedAll.briefCachedAt || cachedAll.cachedAt).getTime()) / 3_600_000);
        addLog("Cache loaded ✓ — age: " + cacheAgeH + "h | brief: " + (cachedAll.brief ? "ready" : "missing"));
      } else {
        addLog("Cache unavailable — will retry when generating brief");
      }
    } catch (_ce) { addLog("Cache load error (non-fatal)"); }

    var market = {};
    try {
      market = await fetchAllMarketData();
      addLog("Market data fetched — BTC: " + (market.price ? "$" + market.price.toLocaleString() : "unavailable") + " | F&G: " + (market.fearGreedValue != null ? market.fearGreedValue : "n/a") + " | Funding: " + (market.fundingRate != null ? (market.fundingRate * 100).toFixed(4) + "%" : "n/a"));
      safeSet(setMarketData)(market);
      if (market.fearGreedValue !== undefined) {
        safeSet(setFearGreed)({ value: market.fearGreedValue, label: market.fearGreedLabel });
      }
    } catch (e) {
      addLog("Market fetch error (continuing): " + e.message);
      safeSet(setMarketData)(market);
    }

    // Fetch live technical levels (200d/50d/20d SMA + realised price proxy)
    addLog("Fetching 200 daily candles for SMA computation...");
    var tech = await fetchTechnicalLevels();

    // ── ON-CHAIN INTEL (CoinMetrics + Dune) ──────────────────────────────────────
    safeSet(setStage)("fetching-market");
    addLog("Fetching on-chain intel (CoinMetrics + Dune)...");

    // ── COINMETRICS FREE ON-CHAIN DATA (network health) ─────────────────────────
    var coinMetrics = null;
    try {
      coinMetrics = await fetchCoinMetricsData();
      if (coinMetrics) {
        addLog("CoinMetrics ✓ — ActiveAddr: " + (coinMetrics.activeAddresses != null ? Math.round(coinMetrics.activeAddresses).toLocaleString() : "n/a")
          + " | HashRate: " + (coinMetrics.hashRate != null ? (coinMetrics.hashRate > 1e15 ? (coinMetrics.hashRate / 1e18).toFixed(1) : coinMetrics.hashRate > 1e9 ? (coinMetrics.hashRate / 1e6).toFixed(1) : coinMetrics.hashRate.toFixed(1)) + " EH/s" : "n/a"));
      }
    } catch (e) {
      addLog("CoinMetrics fetch error (continuing without): " + e.message);
    }

    // ── DUNE ANALYTICS — EXCHANGE FLOWS (free cached community queries) ─────────
    var duneData = null;
    try {
      duneData = await fetchDuneData();
      if (duneData) {
        const hasFlows = duneData.exchangeNetflowBTC != null || duneData.exchangeInflowBTC != null;
        addLog(hasFlows
          ? "Dune ✓ — ExNetflow: " + (duneData.exchangeNetflowBTC != null ? duneData.exchangeNetflowBTC.toFixed(1) + " BTC" : "n/a")
            + " | In: " + (duneData.exchangeInflowBTC != null ? duneData.exchangeInflowBTC.toFixed(1) + " BTC" : "n/a")
            + " | Out: " + (duneData.exchangeOutflowBTC != null ? duneData.exchangeOutflowBTC.toFixed(1) + " BTC" : "n/a")
            + (duneData.exchangeFlowSuspicious ? " ⚠ SUSPICIOUS (low volume)" : "")
            + " | MVRV: " + (duneData.mvrv != null ? duneData.mvrv.toFixed(3) : "n/a (first-run — will cache)")
          : "Dune ⚠ — stale cache discarded (>30d old) — background refresh queued, whale flows estimated by Claude");
      }
    } catch (e) {
      addLog("Dune fetch error (continuing without): " + e.message);
    }

    // ── LIVE MACRO DATA (DXY, VIX, 10Y Yield) ───────────────────────────────────
    var macroFetch = null;
    try {
      macroFetch = await fetchMacroData();
      if (macroFetch) {
        safeSet(setMacroData)(macroFetch);
        addLog("Macro ✓ — DXY: " + (macroFetch.dxy != null ? macroFetch.dxy + (macroFetch.dxyChange != null ? " (" + (macroFetch.dxyChange > 0 ? "+" : "") + macroFetch.dxyChange + "%)" : "") : "n/a")
          + " | VIX: " + (macroFetch.vix != null ? macroFetch.vix : "n/a")
          + " | 10Y: "  + (macroFetch.tnxYield != null ? macroFetch.tnxYield + "%" : "n/a"));
      }
    } catch (e) {
      addLog("Macro fetch error (continuing): " + e.message);
    }

    // ── CME FUTURES BASIS (Yahoo Finance BTC=F) ─────────────────────────────────
    var cmeData = null;
    try {
      cmeData = await fetchCMEData();
      if (cmeData) {
        addLog("CoinGlass ✓ — CME basis: " + (cmeData.cmeBasisPct != null ? cmeData.cmeBasisPct + "%" : "n/a") + " | Total agg OI: " + (cmeData.totalAggOIusd ? "$" + (cmeData.totalAggOIusd / 1e9).toFixed(1) + "B" : "n/a") + " | CME OI: " + (cmeData.cmeOIusd ? "$" + (cmeData.cmeOIusd / 1e9).toFixed(1) + "B" : "n/a"));
        safeSet(setCmeData)(cmeData);
      }
    } catch (e) {
      addLog("CoinGlass fetch error (continuing without): " + e.message);
    }

    // ── LIVE ETF FLOWS (SoSoValue → Tiingo fallback) ─────────────────────────────
    var etfFlowData = null;
    try {
      etfFlowData = await fetchETFFlows();
      if (etfFlowData) {
        safeSet(setEtfFlowData)(etfFlowData);
        if (etfFlowData.etfTotalNetUSD != null) {
          addLog("ETF flows ✓ (" + etfFlowData.etfFlowSource + ") — Net: " + (etfFlowData.etfTotalNetUSD >= 0 ? "+" : "") + "$" + (etfFlowData.etfTotalNetUSD / 1e6).toFixed(0) + "M | date: " + (etfFlowData.etfFlowDate || "today"));
        } else {
          addLog("ETF proxy ✓ (" + etfFlowData.etfFlowSource + ") — IBIT vol: " + (etfFlowData.etfIBITvolumeUSD ? "$" + (etfFlowData.etfIBITvolumeUSD / 1e6).toFixed(0) + "M" : "n/a"));
        }
      } else {
        addLog("ETF flows ⚠ — all sources unavailable; brief will note data absent (no estimates)");
      }
    } catch (e) {
      addLog("ETF flow fetch error (continuing without): " + e.message);
    }

    // ── LTH NET POSITION (BMP via worker cache) ───────────────────────────────
    var lthDataResult = null;
    try {
      lthDataResult = await fetchLTHData();
      if (lthDataResult) {
        safeSet(setLthData)(lthDataResult);
        var lthSign = lthDataResult.lth_net_btc >= 0 ? '+' : '';
        addLog("LTH net position ✓ (BMP) — " + lthSign + lthDataResult.lth_net_btc.toLocaleString() + " BTC/day  (" + lthDataResult.date + ")");
      } else {
        addLog("LTH net position ⚠ — not in worker cache (run npm run dune)");
      }
    } catch (e) {
      addLog("LTH data fetch error (continuing without): " + e.message);
    }

    // ── STABLECOIN SUPPLY (CoinGecko via worker cache) ────────────────────────
    var stablecoinResult = null;
    try {
      stablecoinResult = await fetchStablecoinData();
      if (stablecoinResult) {
        safeSet(setStablecoinData)(stablecoinResult);
        var stableB = (stablecoinResult.total_usd / 1e9).toFixed(1);
        var stableDelta = stablecoinResult.delta_7d_usd != null
          ? (stablecoinResult.delta_7d_usd >= 0 ? '+' : '') + (stablecoinResult.delta_7d_usd / 1e9).toFixed(1) + 'B 7d'
          : 'delta N/A';
        addLog("Stablecoin supply ✓ — $" + stableB + "B total · " + stableDelta + " · " + stablecoinResult.regime);
      } else {
        addLog("Stablecoin supply ⚠ — not in worker cache (run npm run dune)");
      }
    } catch (e) {
      addLog("Stablecoin fetch error (continuing without): " + e.message);
    }

    if (tech) {
      addLog("SMAs computed — 200d: $" + (tech.sma200 ? tech.sma200.toLocaleString() : "n/a") + " | 50d: $" + (tech.sma50 ? tech.sma50.toLocaleString() : "n/a") + " | 20d: $" + (tech.sma20 ? tech.sma20.toLocaleString() : "n/a") + " | VolTrend: " + (tech.volTrend || "?"));
    } else {
      addLog("SMA fetch failed — using hardcoded fallbacks");
    }
    safeSet(setTechLevels)(tech);

    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const p = market.price;
    const vol24hUSD = market.volume24h;
    const mcap = market.marketCap;
    const volBTC = (p && vol24hUSD) ? Math.round(vol24hUSD / p) : null;
    const LIQUID = 4200000;
    const CIRC = 20000000;

    const fmt = function(n, d) { var dec = d != null ? d : 2; return n != null ? n.toFixed(dec) : "N/A"; };

    const fundingAnn = market.fundingRate != null
      ? (market.fundingRate * 3 * 365 * 100).toFixed(1) + "% annualized"
      : "unavailable";

    const normRef = (p && mcap && volBTC) ? "\nNORMALIZATION REFERENCE:\n  1,000 BTC = " + (1000 / LIQUID * 100).toFixed(3) + "% of liquid supply\n  1,000 BTC = " + (1000 / volBTC * 100).toFixed(3) + "% of volume\n  Liquid: " + LIQUID.toLocaleString() + " BTC | Circ: " + CIRC.toLocaleString() + " BTC | Daily vol: ~" + volBTC.toLocaleString() + " BTC" : "";

    // Live phase determination
    const activePhase = computeActivePhase(p);

    // Technical levels — live if available, hardcoded fallbacks otherwise
    const sma200 = (tech && tech.sma200) ? tech.sma200 : 98000;
    const sma50  = (tech && tech.sma50)  ? tech.sma50  : 82000;
    const sma20  = (tech && tech.sma20)  ? tech.sma20  : 76000;
    const realisedProxy = (tech && tech.realisedProxy) ? tech.realisedProxy : 45000;
    const techNote = tech ? "(Binance " + tech.candleCount + "-day computed)" : "(hardcoded fallback — Binance unavailable)";

    const phaseBlock = activePhase ? (
      "\n\nLIVE PHASE STATUS (computed from price $" + (p ? p.toLocaleString() : "?") + "):" +
      "\n  Active Phase: " + activePhase.id + " - " + activePhase.label +
      (activePhase.pctToNext ? "\n  Distance to next phase boundary ($" + (activePhase.nextPhaseAt ? activePhase.nextPhaseAt.toLocaleString() : "?") + "): +" + activePhase.pctToNext + "%" : "") +
      "\n  Phase progress: " + activePhase.progress.toFixed(0) + "% through current range" +
      "\n  Mandate action: " + activePhase.action
    ) : "";

    const corrStr = (tech && tech.btcQqqCorr != null)
      ? "\n  BTC-QQQ Correlation (" + (tech.corrWindow || 60) + "d Pearson): " + tech.btcQqqCorr
        + " → " + (Math.abs(tech.btcQqqCorr) > 0.7 ? "HIGH — macro regime dominant today"
                  : Math.abs(tech.btcQqqCorr) > 0.4 ? "MODERATE — mixed on-chain vs macro signals"
                  : "LOW — on-chain signals dominate") + " (use for correlationRegime field)"
      : "\n  BTC-QQQ Correlation: unavailable — estimate from macro context";

    const smaBlock = "\n\nLIVE TECHNICAL LEVELS " + techNote + ":" +
      "\n  200d SMA: $" + sma200.toLocaleString() + (p ? " (" + ((p - sma200) / sma200 * 100).toFixed(1) + "% from price)" : "") +
      "\n  50d SMA:  $" + sma50.toLocaleString() + (p ? " (" + ((p - sma50) / sma50 * 100).toFixed(1) + "% from price)" : "") +
      "\n  20d SMA:  $" + sma20.toLocaleString() + (p ? " (" + ((p - sma20) / sma20 * 100).toFixed(1) + "% from price)" : "") +
      "\n  Realised Price Proxy (200d exp-weighted avg): $" + realisedProxy.toLocaleString() +
      corrStr +
      "\n  OVERRIDE: Use these live SMA and correlation values. Ignore any hardcoded figures in Section 2.";

    // ── CONVERGENCE SIGNAL — client-side, deterministic, 6 independent axes ──────
    // Fix: funding and fear/greed are co-linear (both reflect sentiment).
    // Use the STRONGER of the two, not both. Add CME basis + vol trend as new
    // uncorrelated signals. Max score: ±7 (capped at ±5 for display label).
    var convergenceScore = 0;
    var convergenceFactors = [];

    // AXIS 1: Derivatives sentiment — funding rate (max ±1.5)
    // Reduce weight vs original because F&G below will capture overlapping sentiment
    if (market.fundingRate != null) {
      if      (market.fundingRate < -0.0003)  { convergenceScore += 2; convergenceFactors.push("Funding deeply negative (max short crowding, +2)"); }
      else if (market.fundingRate < -0.0001)  { convergenceScore += 1; convergenceFactors.push("Funding negative (shorts paying, +1)"); }
      else if (market.fundingRate <  0.0001)  { convergenceScore += 0; convergenceFactors.push("Funding neutral (no overhang)"); }
      else if (market.fundingRate >  0.0008)  { convergenceScore -= 2; convergenceFactors.push("Funding very elevated (longs over-leveraged, -2)"); }
      else if (market.fundingRate >  0.0003)  { convergenceScore -= 1; convergenceFactors.push("Funding elevated (longs crowded, -1)"); }
    }

    // AXIS 2: Retail sentiment — Fear & Greed (max ±1.5, complementary to funding)
    // Only score extreme readings to avoid double-counting with funding
    if (market.fearGreedValue != null) {
      if      (market.fearGreedValue < 15)  { convergenceScore += 2; convergenceFactors.push("Extreme Fear <15 (max contrarian buy, +2)"); }
      else if (market.fearGreedValue < 30)  { convergenceScore += 1; convergenceFactors.push("Fear zone <30 (contrarian buy, +1)"); }
      else if (market.fearGreedValue > 85)  { convergenceScore -= 2; convergenceFactors.push("Extreme Greed >85 (distribution zone, -2)"); }
      else if (market.fearGreedValue > 70)  { convergenceScore -= 1; convergenceFactors.push("Greed >70 (caution, -1)"); }
    }

    // AXIS 3: Structural regime — 200d SMA position (max ±1)
    // Reduced from ±2 to ±1: SMA position is partly co-linear with Fear/Greed
    // (both tend to be in the same direction in the same macro regime).
    // Using ±1 avoids over-weighting a correlated signal vs uncorrelated axes.
    if (sma200 && p) {
      if      (p > sma200) { convergenceScore += 1; convergenceFactors.push("Price above 200d SMA (bull structure, +1)"); }
      else                 { convergenceScore -= 1; convergenceFactors.push("Price below 200d SMA (bear structure, -1)"); }
    }

    // AXIS 4: Options hedging demand — skew (max ±1)
    if (market.optionsSkew != null) {
      if      (market.optionsSkew < -8)  { convergenceScore += 1; convergenceFactors.push("Options skew <-8 (heavy put hedging, fear, +1)"); }
      else if (market.optionsSkew > 8)   { convergenceScore -= 1; convergenceFactors.push("Options skew >8 (call speculation, -1)"); }
    }

    // AXIS 5: Institutional demand — CME basis (max ±1, UNCORRELATED with perp funding)
    var cmeBasisForConv = cmeData && cmeData.cmeBasisPct;
    if (cmeBasisForConv != null) {
      if      (cmeBasisForConv > 12) { convergenceScore += 1; convergenceFactors.push("CME basis >" + cmeBasisForConv.toFixed(0) + "% (strong inst bid, +1)"); }
      else if (cmeBasisForConv < -2) { convergenceScore -= 1; convergenceFactors.push("CME backwardation (" + cmeBasisForConv.toFixed(0) + "%, inst selling, -1)"); }
    }

    // AXIS 6: Volume participation — live trend (max ±1)
    var liveVolTrend = tech && tech.volTrend;
    if (liveVolTrend === "RISING")  { convergenceScore += 1; convergenceFactors.push("Volume rising (participation confirming, +1)"); }
    else if (liveVolTrend === "FALLING") { convergenceScore -= 1; convergenceFactors.push("Volume falling (participation fading, -1)"); }

    // Normalise to ±5 scale for label (raw max is ±9 across all axes)
    var convergenceLabel = convergenceScore >= 5 ? "STRONG BUY SETUP"
      : convergenceScore >= 3 ? "MILD BUY BIAS"
      : convergenceScore <= -5 ? "STRONG SELL SETUP"
      : convergenceScore <= -3 ? "MILD SELL BIAS"
      : "NEUTRAL";
    var convergenceColor = convergenceScore >= 5 ? C.green
      : convergenceScore >= 3 ? C.teal
      : convergenceScore <= -5 ? C.red
      : convergenceScore <= -3 ? C.orange
      : C.textMid;

    safeSet(setConvergence)({ score: convergenceScore, label: convergenceLabel, color: convergenceColor, factors: convergenceFactors });

    const marketBlock = "TODAY: " + today +
      "\nBTC Price:      " + (p ? "$" + p.toLocaleString() + " (" + fmt(market.change24h) + "% 24h | " + fmt(market.change7d) + "% 7d)" : "unavailable") +
      "\nMarket Cap:     " + (mcap ? "$" + (mcap / 1e12).toFixed(2) + "T" : "unavailable") +
      "\n24h Volume USD: " + (vol24hUSD ? "$" + (vol24hUSD / 1e9).toFixed(1) + "B" : "unavailable") +
      "\n24h Volume BTC: " + (volBTC ? "~" + volBTC.toLocaleString() + " BTC" : "unavailable") +
      "\nFear & Greed:   " + (market.fearGreedValue != null ? market.fearGreedValue + "/100 (" + market.fearGreedLabel + ")" : "unavailable") +
      "\nFunding Rate:   " + (market.fundingRate != null ? (market.fundingRate * 100).toFixed(4) + "% per 8h | " + fundingAnn : "unavailable") +
      "\nOpen Interest:  " + (market.openInterest ? market.openInterest.toFixed(0) + " BTC (~$" + (market.openInterestUSD / 1e9).toFixed(1) + "B)" : "unavailable") +
      "\nGold (XAU):     " + (market.goldPrice ? "$" + market.goldPrice.toLocaleString() + " (" + fmt(market.goldChange24h) + "% 24h)" : "unavailable") +
      "\nBTC/Gold ratio: " + (market.btcGoldRatio ? market.btcGoldRatio.toFixed(2) : "unavailable") +
      "\nBTC Dominance:  " + (market.btcDominance != null ? market.btcDominance + "%" : "unavailable") +
      "\nOptions Skew:   " + (market.optionsSkew != null ? market.optionsSkew + " (put IV " + (market.optionsPutIV || "?") + "% vs call IV " + (market.optionsCallIV || "?") + "% | P/C ratio " + (market.optionsPCRatio || "?") + ")" : "unavailable") +
      "\nConvergence:    " + convergenceLabel + " (score " + convergenceScore + " | factors: " + (convergenceFactors.length ? convergenceFactors.join(", ") : "none") + ")" +
      normRef;

    // CLIENT-SIDE STOP LOSS (deterministic - never from LLM)
    var stopData;
    if (!p) {
      stopData = { level: "$58,500", method: "mandate floor", pct: null };
    } else if (p > 74000) {
      stopData = { level: "$" + Math.round(p * 0.88).toLocaleString(), method: "12% trailing", pct: "-12" };
    } else if (p > 65000) {
      stopData = { level: "$65,000", method: "$65K support cluster", pct: ((65000 - p) / p * 100).toFixed(1) };
    } else {
      stopData = { level: "$58,500", method: "mandate floor", pct: ((58500 - p) / p * 100).toFixed(1) };
    }
    safeSet(setClientStop)(stopData);

    // ACCURACY LOG
    var log = [];
    try {
      const stored = localStorage.getItem("accuracy-log");
      if (stored) log = JSON.parse(stored);
    } catch (_e) { log = []; }

    // Grade all ungraded entries that have reached the 5-day window.
    // Entries without a ts (legacy rows) are treated as immediately gradeable.
    if (p) {
      for (var gi = 0; gi < log.length; gi++) {
        var gEntry = log[gi];
        if (gEntry.outcome || !gEntry.price || !gEntry.recommendation) continue;
        var entryAge = gEntry.ts ? (Date.now() - gEntry.ts) : Infinity;
        if (entryAge < GRADE_AFTER_MS) continue; // not yet 5 days old — skip
        var pctMove = ((p - gEntry.price) / gEntry.price) * 100;
        var rec = gEntry.recommendation;
        var outcome = "FLAT";
        if ((rec === "ACCUMULATE" || rec === "ADD") && pctMove > 2) outcome = "CORRECT";
        else if ((rec === "ACCUMULATE" || rec === "ADD") && pctMove < -2) outcome = "WRONG";
        else if ((rec === "REDUCE" || rec === "HEDGE") && pctMove < -2) outcome = "CORRECT";
        else if ((rec === "REDUCE" || rec === "HEDGE") && pctMove > 2) outcome = "WRONG";
        gEntry.outcome = outcome;
        gEntry.priceLater = p;
        gEntry.pctMove = pctMove.toFixed(2);
      }
    }
    const todayEntry = { date: today, ts: Date.now(), price: p, score: null, recommendation: null, bias: null, outcome: null, priceLater: null, pctMove: null };
    log.push(todayEntry);
    if (log.length > 30) log = log.slice(-30);
    safeSet(setAccuracyLog)(log);
    try { localStorage.setItem("accuracy-log", JSON.stringify(log)); } catch (_e) {}

    // ── PERFORMANCE FEEDBACK BLOCK ─────────────────────────────────────────────
    // Build a self-reflection block from the last 7 graded calls so Claude can
    // reason from its own track record and adjust confidence accordingly.
    var feedbackBlock = "";
    var gradedHistory = log.filter(function(e) { return e.outcome && e.outcome !== "FLAT" && e.score != null; }).slice(-7);
    if (gradedHistory.length >= 2) {
      var correct = gradedHistory.filter(function(e) { return e.outcome === "CORRECT"; }).length;
      var hitRate = Math.round(correct / gradedHistory.length * 100);

      // Pattern analysis — which signal regimes coincided with correct vs wrong calls
      var wrongCalls = gradedHistory.filter(function(e) { return e.outcome === "WRONG"; });
      var correctCalls = gradedHistory.filter(function(e) { return e.outcome === "CORRECT"; });
      var avgScoreCorrect = correctCalls.length ? (correctCalls.reduce(function(s, e) { return s + (e.score || 0); }, 0) / correctCalls.length).toFixed(1) : "n/a";
      var avgScoreWrong   = wrongCalls.length   ? (wrongCalls.reduce(function(s, e)   { return s + (e.score || 0); }, 0) / wrongCalls.length).toFixed(1)   : "n/a";

      // Bias drift — are wrong calls clustered on one side?
      var wrongBullish = wrongCalls.filter(function(e) { return e.bias === "BULLISH" || e.recommendation === "ACCUMULATE" || e.recommendation === "ADD"; }).length;
      var wrongBearish = wrongCalls.filter(function(e) { return e.bias === "BEARISH" || e.recommendation === "REDUCE" || e.recommendation === "HEDGE"; }).length;
      var biasDrift = wrongCalls.length >= 2
        ? (wrongBullish > wrongBearish ? "OVERCONFIDENT BULLISH (most wrong calls were buy signals)" : wrongBearish > wrongBullish ? "OVERCONFIDENT BEARISH (most wrong calls were sell signals)" : "BALANCED ERRORS")
        : "insufficient data";

      // Score calibration — are high scores more predictive?
      var highScoreCalls = gradedHistory.filter(function(e) { return Math.abs(e.score || 0) >= 5; });
      var highScoreHitRate = highScoreCalls.length
        ? Math.round(highScoreCalls.filter(function(e) { return e.outcome === "CORRECT"; }).length / highScoreCalls.length * 100)
        : null;

      feedbackBlock = "\n\nYOUR RECENT CALL PERFORMANCE (last " + gradedHistory.length + " graded calls):" +
        "\n  Hit rate: " + hitRate + "% (" + correct + "/" + gradedHistory.length + " correct)" +
        "\n  Avg score on CORRECT calls: " + avgScoreCorrect + " | Avg score on WRONG calls: " + avgScoreWrong +
        "\n  Bias drift: " + biasDrift +
        (highScoreHitRate != null ? "\n  High-conviction calls (score >=5 or <=-5) hit rate: " + highScoreHitRate + "%" : "") +
        "\n\n  CALL LOG (newest first):" +
        gradedHistory.slice().reverse().map(function(e) {
          return "\n    " + (e.date ? e.date.slice(0,10) : "?") +
            " | price $" + (e.price ? e.price.toLocaleString() : "?") +
            " | score " + (e.score != null ? (e.score > 0 ? "+" : "") + e.score : "?") +
            " | bias " + (e.bias || "?") +
            " | rec " + (e.recommendation || "?") +
            " | outcome " + e.outcome +
            (e.pctMove != null ? " (" + (e.pctMove > 0 ? "+" : "") + e.pctMove + "%)" : "");
        }).join("") +
        "\n\n  SELF-CALIBRATION INSTRUCTIONS:" +
        "\n  1. If hit rate < 50%: widen uncertainty language, reduce conviction score magnitude." +
        "\n  2. If bias drift is OVERCONFIDENT BULLISH/BEARISH: actively seek the contrary signal before assigning bias." +
        "\n  3. If high-conviction hit rate < 60%: cap compositeScore magnitude at +/-5 until recalibrated." +
        "\n  4. If avg score on wrong calls >= avg score on correct calls: your confidence is anti-correlated with accuracy — invert your certainty weighting." +
        "\n  Apply these adjustments explicitly in your reasoning before generating scores.";

      addLog("Feedback block: " + gradedHistory.length + " graded calls | hit rate " + hitRate + "% | drift: " + biasDrift.split(" ")[0]);
    } else {
      feedbackBlock = "\n\nPERFORMANCE FEEDBACK: Insufficient graded history (" + gradedHistory.length + " calls). No self-calibration applied yet — build confidence normally.";
      addLog("Feedback block: insufficient history (" + gradedHistory.length + " graded calls) — calibration skipped");
    }

    try {
      // SINGLE CALL: SYNTHESIZE DIRECTLY
      safeSet(setStage)("generating");
      setSearchStatus({ etf: "done", onchain: "done", macro: "done" });
      const t0 = Date.now();
      addLog("Synthesis starting — sending live market data + performance feedback to Claude...");

      var liqBlock = "";
      if (market.liqLongUSD || market.liqShortUSD) {
        const ll = market.liqLongUSD || 0;
        const ls = market.liqShortUSD || 0;
        const lt = ll + ls;
        const liqRatio = lt > 0 ? (ll / lt * 100).toFixed(0) + "% longs / " + (ls / lt * 100).toFixed(0) + "% shorts" : "N/A";
        liqBlock = "\nLiquidations (" + (market.liqWindow || "recent") + ", " + (market.liqSource || "exchange") + "):\n  Long liq:  $" + (ll / 1e6).toFixed(1) + "M\n  Short liq: $" + (ls / 1e6).toFixed(1) + "M\n  Liq ratio: " + liqRatio;
      }

      // ── COINMETRICS FREE ON-CHAIN BLOCK ────────────────────────────────────
      var coinMetricsBlock = "";
      if (coinMetrics) {
        const cm = coinMetrics;
        coinMetricsBlock = "\n\nCOINMETRICS NETWORK HEALTH (live, free community tier — " + (cm.date || "recent") + "):";
        coinMetricsBlock += "\n  Active Addresses: " + (cm.activeAddresses != null ? Math.round(cm.activeAddresses).toLocaleString() : "n/a");
        coinMetricsBlock += "\n  Tx Count (24h):   " + (cm.txCount != null ? Math.round(cm.txCount).toLocaleString() : "n/a");
        coinMetricsBlock += "\n  Hash Rate:        " + (cm.hashRate != null ? (cm.hashRate > 1e15 ? (cm.hashRate / 1e18).toFixed(1) : cm.hashRate > 5e7 ? (cm.hashRate / 1e6).toFixed(1) : cm.hashRate.toFixed(1)) + " EH/s" : "n/a");
        coinMetricsBlock += "\n  Total Fees (BTC): " + (cm.totalFeesBTC != null ? cm.totalFeesBTC.toFixed(2) + " BTC" : "n/a");
        coinMetricsBlock += "\n  Ref Price:        " + (cm.refPrice != null ? "$" + Math.round(cm.refPrice).toLocaleString() : "n/a");
        coinMetricsBlock += "\n  INSTRUCTION: Use active addresses and tx count as network adoption signals. Hash rate confirms miner confidence.";
      } else {
        coinMetricsBlock = "\n\nCOINMETRICS NETWORK HEALTH: Unavailable — use training knowledge for network estimates.";
      }

      // ── LIVE MACRO BLOCK (DXY / VIX / 10Y yield) ─────────────────────────
      var macroBlock2 = "";
      if (macroFetch && (macroFetch.dxy != null || macroFetch.vix != null || macroFetch.tnxYield != null)) {
        macroBlock2 = "\n\nLIVE MACRO DATA (Yahoo Finance — real-time, overrides training-knowledge estimates):";
        if (macroFetch.dxy != null) {
          var dxyDir = macroFetch.dxyChange != null ? (macroFetch.dxyChange > 0 ? "rising" : macroFetch.dxyChange < 0 ? "falling" : "flat") : "unknown";
          var dxySig = macroFetch.dxy > 104 ? "BEARISH for BTC (strong dollar)" : macroFetch.dxy < 100 ? "BULLISH for BTC (weak dollar)" : "NEUTRAL";
          macroBlock2 += "\n  DXY (US Dollar Index): " + macroFetch.dxy + (macroFetch.dxyChange != null ? " (" + (macroFetch.dxyChange > 0 ? "+" : "") + macroFetch.dxyChange + "% 1d)" : "") + " — " + dxyDir + " → " + dxySig;
        }
        if (macroFetch.vix != null) {
          var vixRegime = macroFetch.vix > 30 ? "HIGH FEAR (risk-off)" : macroFetch.vix > 20 ? "ELEVATED (caution)" : macroFetch.vix < 15 ? "COMPLACENCY (low hedging)" : "NORMAL";
          macroBlock2 += "\n  VIX (implied vol):     " + macroFetch.vix + (macroFetch.vixChange != null ? " (" + (macroFetch.vixChange > 0 ? "+" : "") + macroFetch.vixChange + "% 1d)" : "") + " → " + vixRegime;
        }
        if (macroFetch.tnxYield != null) {
          var tnxSig = macroFetch.tnxYield > 4.5 ? "BEARISH for BTC (real yield pressure)" : macroFetch.tnxYield < 3.5 ? "BULLISH for BTC (easing pressure)" : "NEUTRAL";
          macroBlock2 += "\n  10Y Treasury Yield:    " + macroFetch.tnxYield + "%" + (macroFetch.tnxChange != null ? " (" + (macroFetch.tnxChange > 0 ? "+" : "") + macroFetch.tnxChange + "% 1d)" : "") + " → " + tnxSig;
        }
        macroBlock2 += "\n  INSTRUCTION: These are LIVE macro readings — use them for the macroContext section. They OVERRIDE the training-knowledge estimates in Section 2. Compute DXY and real-yield signals independently from on-chain signals.";
      } else {
        macroBlock2 = "\n\nLIVE MACRO DATA: Unavailable — use training knowledge for DXY, VIX, and yield estimates.";
      }

      // ── DUNE BLOCK ─────────────────────────────────────────────────────────
      var duneBlock = "";
      if (duneData && (duneData.exchangeNetflowBTC != null || duneData.exchangeInflowBTC != null)) {
        const dd = duneData;
        duneBlock = "\n\nDUNE ANALYTICS — BTC EXCHANGE FLOWS (live on-chain, " + (duneData.source || "Dune") + "):";
        duneBlock += "\n  Exchange Netflow (BTC): " + (dd.exchangeNetflowBTC != null ? dd.exchangeNetflowBTC.toFixed(0) + " BTC" : "n/a");
        duneBlock += "\n  Exchange Inflow (BTC):  " + (dd.exchangeInflowBTC  != null ? dd.exchangeInflowBTC.toFixed(0)  + " BTC" : "n/a");
        duneBlock += "\n  Exchange Outflow (BTC): " + (dd.exchangeOutflowBTC != null ? dd.exchangeOutflowBTC.toFixed(0) + " BTC" : "n/a");
        // Implausibility warning passed directly to Claude
        if (dd.exchangeFlowSuspicious) {
          duneBlock += "\n  ⚠ DATA QUALITY: " + dd.exchangeFlowSuspiciousNote;
          duneBlock += "\n  INSTRUCTION: Weight these exchange flow numbers LOW. They likely represent a partial subset of exchanges. Do not use them as the primary whale signal — rely more on CME basis, funding, and F&G for today's score.";
        } else {
          duneBlock += "\n  INSTRUCTION: Use exchange netflow as primary on-chain signal. Negative = BTC leaving exchanges (bullish accumulation). Positive = BTC entering exchanges (distribution risk). Apply quad-normalization via netflowPctLiquid and netflowPctVolume.";
        }
        // MVRV from Dune execute+poll
        if (dd.mvrv != null) {
          var mvrvZone = dd.mvrv < 1 ? "UNDERVALUED (<1) — maximum accumulation historically" : dd.mvrv < 2 ? "FAIR VALUE (1-2)" : dd.mvrv < 3.5 ? "FAIR-HIGH (2-3.5)" : dd.mvrv < 5 ? "OVERVALUED (3.5-5) — begin reducing" : "EXTREME (>5) — historical distribution zone";
          duneBlock += "\n\n  LIVE MVRV (Dune — realized cap from full UTXO set):";
          duneBlock += "\n    MVRV Ratio: " + dd.mvrv.toFixed(3) + " → " + mvrvZone;
          if (dd.mvrvRealizedPrice) duneBlock += "\n    Realized Price (avg UTXO cost basis): $" + Math.round(dd.mvrvRealizedPrice).toLocaleString();
          if (dd.mvrvDate) duneBlock += "\n    Data date: " + dd.mvrvDate;
          duneBlock += "\n    INSTRUCTION: This is a LIVE on-chain MVRV — use it for the mvrvSignal section. OVERRIDES training-knowledge MVRV estimates.";
        } else {
          duneBlock += "\n\n  MVRV: Query executing in background (first run). Use training knowledge: MVRV ~1.5 (fair-value zone, April 2026 estimate).";
        }
        if (dd.sopr != null) duneBlock += "\n  SOPR: " + dd.sopr.toFixed(3);
      } else if (duneData) {
        duneBlock = "\n\nDUNE ANALYTICS — EXCHANGE FLOWS: Query returned no data. Use training knowledge for exchange flow estimates.";
      } else {
        duneBlock = "\n\nDUNE ANALYTICS — EXCHANGE FLOWS: Unavailable. Use training knowledge for exchange flow estimates.";
      }

      // ── CME BASIS + AGGREGATE OI BLOCK ───────────────────────────────────────
      var cmeBlock = "";
      if (cmeData) {
        cmeBlock = "\n\nCME FUTURES BASIS & AGGREGATE OI (CoinGlass):";
        if (cmeData.cmeBasisPct != null) {
          var basisLabel = cmeData.cmeBasisPct > 15 ? "STRONG CONTANGO — institutional demand elevated"
            : cmeData.cmeBasisPct > 5  ? "HEALTHY CONTANGO — mild institutional bid"
            : cmeData.cmeBasisPct > -5 ? "FLAT — neutral institutional positioning"
            : "BACKWARDATION — institutional risk-off";
          cmeBlock += "\n  CME Basis (annualized): " + (cmeData.cmeBasisPct > 0 ? "+" : "") + cmeData.cmeBasisPct + "% → " + basisLabel;
        } else {
          cmeBlock += "\n  CME Basis: unavailable";
        }
        if (cmeData.cmeDaysToExpiry != null) {
          cmeBlock += "\n  Front-month days to expiry: " + cmeData.cmeDaysToExpiry + "d";
          if (cmeData.cmeNearExpiry) cmeBlock += " ⚠ NEAR EXPIRY — basis switched to second-month contract";
        }
        if (cmeData.cmeSecondMonthBasis != null) {
          cmeBlock += "\n  Second-month basis (CME quarterly): " + (cmeData.cmeSecondMonthBasis > 0 ? "+" : "") + cmeData.cmeSecondMonthBasis + "% ann" + (cmeData.cmeSecondMonthDaysToEx != null ? " (" + cmeData.cmeSecondMonthDaysToEx + "d to expiry)" : "");
        }
        if (cmeData.cmeBasisWeighted != null) {
          cmeBlock += "\n  Weighted basis (70% front / 30% second): " + (cmeData.cmeBasisWeighted > 0 ? "+" : "") + cmeData.cmeBasisWeighted + "% ann";
        }
        if (cmeData.totalAggOIusd != null) cmeBlock += "\n  Aggregate Perp+Futures OI: $" + (cmeData.totalAggOIusd / 1e9).toFixed(2) + "B";
        if (cmeData.cmeOIusd      != null) cmeBlock += "\n  CME OI: $"   + (cmeData.cmeOIusd / 1e9).toFixed(2) + "B (institutional venue)";
        if (cmeData.oiByExchange) {
          var topEx = Object.keys(cmeData.oiByExchange).sort(function(a, b) { return (cmeData.oiByExchange[b] - cmeData.oiByExchange[a]); }).slice(0, 4);
          cmeBlock += "\n  OI by exchange: " + topEx.map(function(ex) { return ex + " $" + (cmeData.oiByExchange[ex] / 1e9).toFixed(1) + "B"; }).join(" | ");
        }
        cmeBlock += "\n  INSTRUCTION: CME basis is an UNCORRELATED signal from perp funding — use it independently in scoring (Section F). High CME premium = institutional longs accumulating. If near expiry, prefer second-month basis for the cleaner institutional signal.";
      } else {
        cmeBlock = "\n\nCME FUTURES BASIS: Unavailable — estimate institutional positioning from DXY/macro context.";
      }

      // ── LIVE ETF FLOW BLOCK ───────────────────────────────────────────────────
      var etfLiveBlock = "";
      if (etfFlowData && etfFlowData.etfTotalNetUSD != null) {
        var etfNet    = etfFlowData.etfTotalNetUSD;
        var etfNetBTC = p ? Math.round(etfNet / p) : null;
        var etfPctLiq = etfNetBTC && p ? ((etfNetBTC / LIQUID) * 100).toFixed(3) : null;
        etfLiveBlock  = "\n\nLIVE ETF FLOWS (" + etfFlowData.etfFlowSource + " — " + (etfFlowData.etfFlowDate || "today") + "):";
        etfLiveBlock += "\n  Total Net Flow (USD): " + (etfNet >= 0 ? "+" : "") + "$" + (etfNet / 1e6).toFixed(0) + "M";
        if (etfNetBTC)   etfLiveBlock += "\n  Total Net Flow (BTC): " + (etfNetBTC >= 0 ? "+" : "") + etfNetBTC.toLocaleString() + " BTC";
        if (etfPctLiq)   etfLiveBlock += "\n  % of Liquid Supply:   " + (etfNetBTC >= 0 ? "+" : "") + etfPctLiq + "%";
        if (etfFlowData.etfIBITusd != null) etfLiveBlock += "\n  IBIT Flow: " + (etfFlowData.etfIBITusd >= 0 ? "+" : "") + "$" + (etfFlowData.etfIBITusd / 1e6).toFixed(0) + "M";
        etfLiveBlock += "\n  INSTRUCTION: This is LIVE ETF data — use as primary ETF signal. Override training knowledge.";
      } else if (etfFlowData && etfFlowData.etfIBITvolumeUSD != null) {
        etfLiveBlock = "\n\nETF MARKET ACTIVITY (Yahoo Finance IBIT — trading volume, NOT creation/redemption flows):";
        etfLiveBlock += "\n  IBIT Dollar Volume: $" + (etfFlowData.etfIBITvolumeUSD / 1e6).toFixed(0) + "M | Close: $" + (etfFlowData.etfIBITclose || "?");
        etfLiveBlock += "\n  NOTE: This is IBIT trading volume, not ETF inflow/outflow data. Do not report as a flow figure. Use as market activity signal only (high vol = active participation).";
      } else {
        etfLiveBlock = "\n\nETF FLOWS: Live data unavailable. Do not report an ETF inflow/outflow figure. Note only that ETF flow data could not be fetched today.";
      }

      // ── LIVE LTH NET POSITION BLOCK (Bitcoin Magazine Pro) ───────────────────
      var lthBlock = "";
      if (lthDataResult && lthDataResult.lth_net_btc != null) {
        var lthVal    = lthDataResult.lth_net_btc;
        var lthSign   = lthVal >= 0 ? '+' : '';
        var lthPctLiq = ((lthVal / LIQUID) * 100).toFixed(3);
        var lthLabel  = lthVal >= 5000 ? "ACCUMULATING" : lthVal <= -5000 ? "DISTRIBUTING" : "NEUTRAL";
        lthBlock  = "\n\nLIVE LTH NET POSITION CHANGE (Bitcoin Magazine Pro — " + lthDataResult.date + "):";
        lthBlock += "\n  LTH Net BTC/day: " + lthSign + lthVal.toLocaleString() + " BTC";
        lthBlock += "\n  % of Liquid Supply: " + lthSign + lthPctLiq + "%";
        lthBlock += "\n  Regime: " + lthLabel;
        lthBlock += "\n  INSTRUCTION: Use this as the primary LTH distribution signal. Populate lthSellingBTC = '" + lthSign + lthVal.toLocaleString() + " BTC/day' and lthSellingPctLiquid = '" + lthSign + lthPctLiq + "%'. This is LIVE data — do NOT override with training knowledge.";
      } else {
        lthBlock = "\n\nLTH NET POSITION: Live data unavailable. Set lthSellingBTC = 'N/A' and lthSellingPctLiquid = null. Do NOT estimate from training knowledge.";
      }

      // ── STABLECOIN SUPPLY BLOCK (CoinGecko via worker cache) ─────────────────
      var stablecoinBlock = "";
      if (stablecoinResult && stablecoinResult.total_usd != null) {
        var stTotalB  = (stablecoinResult.total_usd / 1e9).toFixed(1);
        var stUsdtB   = stablecoinResult.usdt_supply_usd != null ? (stablecoinResult.usdt_supply_usd / 1e9).toFixed(1) : "N/A";
        var stUsdcB   = stablecoinResult.usdc_supply_usd != null ? (stablecoinResult.usdc_supply_usd / 1e9).toFixed(1) : "N/A";
        var stDeltaB  = stablecoinResult.delta_7d_usd != null
          ? (stablecoinResult.delta_7d_usd >= 0 ? '+' : '') + (stablecoinResult.delta_7d_usd / 1e9).toFixed(1) + 'B'
          : "N/A";
        var stDeltaPct = stablecoinResult.delta_7d_pct != null
          ? (stablecoinResult.delta_7d_pct >= 0 ? '+' : '') + stablecoinResult.delta_7d_pct.toFixed(2) + '%'
          : "N/A";
        stablecoinBlock  = "\n\nLIVE STABLECOIN SUPPLY (CoinGecko — " + stablecoinResult.date + "):";
        stablecoinBlock += "\n  USDT supply: $" + stUsdtB + "B";
        stablecoinBlock += "\n  USDC supply: $" + stUsdcB + "B";
        stablecoinBlock += "\n  USDT+USDC total: $" + stTotalB + "B";
        stablecoinBlock += "\n  7-day delta: " + stDeltaB + " (" + stDeltaPct + ")";
        stablecoinBlock += "\n  Regime: " + stablecoinResult.regime;
        stablecoinBlock += "\n  INSTRUCTION: Use this for scoreDecomposition.stablecoin axis. EXPANDING (>+$5B/7d) = dry powder building = +1 score. CONTRACTING (>-$5B/7d) = liquidity draining = -1 score. STABLE or 7d delta N/A (first snapshot, no prior baseline yet) = score 0. This is LIVE data — do NOT override with training knowledge.";
      } else {
        stablecoinBlock = "\n\nSTABLECOIN SUPPLY: Live data unavailable. Estimate stablecoin regime from training knowledge and note it as estimated.";
      }

      // ── LIVE VOLUME TREND BLOCK ───────────────────────────────────────────────
      var volTrendBlock = "";
      if (tech && tech.volTrend && tech.volTrend !== "UNKNOWN") {
        volTrendBlock = "\n\nLIVE VOLUME TREND (computed from " + tech.candleCount + " daily candles):";
        volTrendBlock += "\n  5d avg volume:  " + (tech.avgVol5d ? tech.avgVol5d.toLocaleString() + " BTC/day" : "n/a");
        volTrendBlock += "\n  20d avg volume: " + (tech.avgVol20d ? tech.avgVol20d.toLocaleString() + " BTC/day" : "n/a");
        volTrendBlock += "\n  5d/20d ratio:   " + (tech.volTrendRatio || "n/a") + " → " + tech.volTrend;
        volTrendBlock += "\n  INSTRUCTION: Use this for volumeTrend field in normalization block. RISING = participation increasing (confirms price moves). FALLING = conviction fading.";
      }

      const finalPrompt = marketBlock + phaseBlock + smaBlock + liqBlock + coinMetricsBlock
        + macroBlock2 + duneBlock + cmeBlock + etfLiveBlock + lthBlock + stablecoinBlock + volTrendBlock + feedbackBlock
        + "\n\nDATA SOURCE QUALITY SUMMARY:"
        + "\n- LIVE (high confidence): price, funding, OI, fear/greed, options skew, gold, dominance, SMAs, vol trend, CME basis (front + second month)"
        + (macroFetch && macroFetch.dxy != null ? ", DXY" : "") + (macroFetch && macroFetch.vix != null ? ", VIX" : "") + (macroFetch && macroFetch.tnxYield != null ? ", 10Y yield" : "")
        + (tech && tech.btcQqqCorr != null ? ", BTC-QQQ correlation (" + tech.corrWindow + "d live)" : "")
        + (duneData && duneData.mvrv != null ? ", MVRV (Dune live)" : "")
        + (etfFlowData && etfFlowData.etfTotalNetUSD != null ? ", ETF flows" : etfFlowData ? ", IBIT vol proxy" : "")
        + (lthDataResult && lthDataResult.lth_net_btc != null ? ", LTH net position (BMP live)" : "")
        + (stablecoinResult && stablecoinResult.total_usd != null ? ", stablecoin supply (CoinGecko live)" : "")
        + "\n- ESTIMATED (training knowledge): whale netflows"
        + (duneData && duneData.exchangeFlowSuspicious ? " (⚠ Dune flows suspicious — see flag above)" : "")
        + (etfFlowData && etfFlowData.etfTotalNetUSD != null ? "" : ", ETF actual creation/redemption flows")
        + (duneData && duneData.mvrv != null ? "" : ", MVRV (Dune executing — use ~1.5 estimate)")
        + (lthDataResult && lthDataResult.lth_net_btc != null ? "" : ", LTH net position")
        + (stablecoinResult && stablecoinResult.total_usd != null ? "" : ", stablecoin supply")
        + ", STH SOPR"
        + "\n\nGenerate the full morning brief JSON now. Apply quad-normalization to all flows. Score each signal component INDEPENDENTLY per Section F — do NOT double-count funding + fear/greed. For correlationRegime use the live Pearson r above. Return ONLY valid JSON. No markdown. No preamble.";

      const jsonRaw = await callClaude(SYSTEM_PROMPT, finalPrompt, false, 7000);
      const totalMs = Date.now() - t0;
      addLog("Done (" + (totalMs / 1000).toFixed(1) + "s) — parsing JSON...");

      // Strip markdown fences and leading/trailing whitespace
      const cleaned = jsonRaw.replace(/```json\s*|```\s*/g, "").trim();

      // Attempt to repair truncated JSON by closing any unclosed braces/brackets/strings
      const repairJson = (str) => {
        // Remove trailing commas before } or ]
        let s = str.replace(/,\s*([\}\]])/g, "$1");
        // Count unclosed { and [
        let braces = 0, brackets = 0, inStr = false, escape = false;
        for (let i = 0; i < s.length; i++) {
          const c = s[i];
          if (escape) { escape = false; continue; }
          if (c === "\\" && inStr) { escape = true; continue; }
          if (c === '"' && !escape) { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === "{") braces++;
          else if (c === "}") braces--;
          else if (c === "[") brackets++;
          else if (c === "]") brackets--;
        }
        // Close any open string first
        if (inStr) s += '"';
        // Close open arrays then objects
        while (brackets > 0) { s += "]"; brackets--; }
        while (braces  > 0) { s += "}"; braces--;  }
        return s;
      };

      var parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e1) {
        addLog("JSON parse attempt 1 failed (" + e1.message + ") — trying extraction + repair...");
        try {
          const match = cleaned.match(/\{[\s\S]*/);
          if (!match) throw new Error("no JSON object found");
          const repaired = repairJson(match[0]);
          parsed = JSON.parse(repaired);
          addLog("JSON repaired successfully.");
        } catch (e2) {
          console.error("[Brief] Raw Claude response:", jsonRaw.slice(0, 500));
          throw new Error("JSON parse failed after repair: " + e2.message + " | Raw start: " + jsonRaw.slice(0, 200));
        }
      }

      // Update accuracy log with today call
      try {
        const stored2 = localStorage.getItem("accuracy-log");
        if (stored2) {
          const freshLog = JSON.parse(stored2);
          const last2 = freshLog[freshLog.length - 1];
          if (last2 && !last2.score) {
            last2.score = parsed.compositeScore;
            last2.recommendation = parsed.todayAction && parsed.todayAction.recommendation;
            last2.bias = parsed.overallBias;
            setAccuracyLog(freshLog.slice());
            localStorage.setItem("accuracy-log", JSON.stringify(freshLog));
          }
        }
      } catch (_e) {}

      safeSet(setBrief)(parsed);
      if (market.liqLongUSD != null) {
        safeSet(setLiquidations)({ long: market.liqLongUSD, short: market.liqShortUSD, source: market.liqSource, window: market.liqWindow });
      } else {
        safeSet(setLiquidations)(null);
      }
      safeSet(setGenerated)(new Date());
      safeSet(setGenMs)({ total: totalMs });
      safeSet(setStage)("done");
      addLog("Done — brief generated successfully.");
    } catch (e) {
      addLog("FATAL ERROR: " + e.message);
      safeSet(setError)(e.message || "Unknown error");
      safeSet(setStage)("error");
      console.error("Brief error:", e);
    }
    safeSet(setLoading)(false);
  }, []);

  // Initial load
  useEffect(function() { generateBrief(); }, []);



  const biasColor = brief ? (biasColors[brief.overallBias] || C.textMid) : C.textMid;


  // Accuracy stats
  const accGraded = accuracyLog.filter(function(e) { return e.outcome && e.outcome !== "FLAT"; });
  const accCorrect = accGraded.filter(function(e) { return e.outcome === "CORRECT"; }).length;
  const accPct = accGraded.length > 0 ? Math.round(accCorrect / accGraded.length * 100) : null;

  // ── ACCURACY PANEL PRE-COMPUTED VARS (extracted from IIFE) ──────────────────
  var accGradedRecent  = accGraded.slice(-7);
  var accWrongRecent   = accGradedRecent.filter(function(e) { return e.outcome === "WRONG"; });
  var accWrongBull     = accWrongRecent.filter(function(e) { return e.bias === "BULLISH" || e.recommendation === "ACCUMULATE" || e.recommendation === "ADD"; }).length;
  var accWrongBear     = accWrongRecent.filter(function(e) { return e.bias === "BEARISH" || e.recommendation === "REDUCE" || e.recommendation === "HEDGE"; }).length;
  var accDriftLabel    = accWrongRecent.length >= 2 ? (accWrongBull > accWrongBear ? "OVRBULLISH" : accWrongBear > accWrongBull ? "OVRBEARISH" : "BALANCED") : String.fromCharCode(8212);
  var accDriftColor    = accDriftLabel === "OVRBULLISH" ? C.orange : accDriftLabel === "OVRBEARISH" ? C.red : accDriftLabel === "BALANCED" ? C.green : C.textDim;
  var accHighConv      = accGradedRecent.filter(function(e) { return Math.abs(e.score || 0) >= 5; });
  var accHcHit         = accHighConv.length ? Math.round(accHighConv.filter(function(e) { return e.outcome === "CORRECT"; }).length / accHighConv.length * 100) : null;
  const score = (brief && brief.compositeScore != null) ? parseInt(brief.compositeScore, 10) : null;
  const scoreColor = score == null ? C.textMid : score >= 5 ? C.green : score >= 2 ? C.teal : score >= -1 ? C.textMid : score >= -4 ? C.orange : C.red;

  // Rate limit info - computed before render
  const isRateLimit = !!(error && (error.includes("rate_limit_error") || error.includes("exceeded_limit")));
  var resetInfo = null;
  if (isRateLimit && error) {
    try {
      const jsonMatch = error.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const errParsed = JSON.parse(jsonMatch[0]);
        const resetsAt = errParsed.resetsAt || (errParsed.windows && errParsed.windows["5h"] && errParsed.windows["5h"].resets_at);
        if (resetsAt) {
          const resetDate = new Date(resetsAt * 1000);
          const diffMs = resetDate - Date.now();
          const diffMins = Math.max(0, Math.ceil(diffMs / 60000));
          const diffHrs = Math.floor(diffMins / 60);
          const remMins = diffMins % 60;
          resetInfo = {
            time: resetDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            countdown: diffHrs > 0 ? diffHrs + "h " + remMins + "m" : remMins + "m",
            utilization: errParsed.windows && errParsed.windows["5h"] && errParsed.windows["5h"].utilization,
          };
        }
      }
    } catch (_e) {}
  }

  // Liquidation display vars
  const liqTotal = liquidations ? ((liquidations.long || 0) + (liquidations.short || 0)) : 0;
  const liqLongPct = liqTotal > 0 ? (liquidations.long / liqTotal * 100) : 50;
  const liqShortPct = 100 - liqLongPct;
  const liqSkew = liqLongPct > 65 ? "LONG DOMINATED" : liqLongPct < 35 ? "SHORT DOMINATED" : "BALANCED";
  const liqColor = liqLongPct > 65 ? C.red : liqLongPct < 35 ? C.green : C.textMid;


  // Phase indicator — activePhase computed here, JSX rendered inline in return()
  var _ap = computeActivePhase(marketData && marketData.price);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "Georgia, serif" }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap" />
      <style>{GLOBAL_CSS}</style>

      {/* TOPBAR */}
      <div style={{ borderBottom: "1px solid " + C.border, padding: "0 28px", display: "flex", justifyContent: "space-between", alignItems: "center", height: 46, background: "#040608", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "JetBrains Mono, monospace", color: C.accent, fontWeight: 700, fontSize: 12, letterSpacing: 3 }}>◆ MAISON TOÉ</span>
          <span style={{ color: C.border }}>│</span>
          <span style={{ color: C.textDim, fontSize: 10, letterSpacing: 1.5, fontFamily: "monospace" }}>BTC INTELLIGENCE BRIEF</span>
          {brief && brief.marketStatus && <Tag text={brief.marketStatus} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {generated && (
            <span style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>
              {"Generated " + generated.toLocaleTimeString()}
              {genMs && (
                <span style={{ color: C.border }}>{" · ⚡ " + (genMs.total / 1000).toFixed(1) + "s"}</span>
              )}
            </span>
          )}
          <button onClick={function() { setShowAccuracy(function(a) { return !a; }); }} style={{ background: "transparent", border: "1px solid " + C.border, color: C.textDim, borderRadius: 4, padding: "4px 10px", fontSize: 9, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "monospace" }}>
            ACCURACY
          </button>
          <button onClick={function() { generateBrief(); }} disabled={loading} style={{ background: loading ? "transparent" : C.accentDim, border: "1px solid " + (loading ? C.border : C.accent), color: loading ? C.textDim : C.accent, borderRadius: 4, padding: "4px 14px", fontSize: 9, fontWeight: 700, letterSpacing: 2, cursor: loading ? "not-allowed" : "pointer", fontFamily: "monospace" }}>
            {loading ? "GENERATING..." : "REFRESH"}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "28px 20px" }}>

        {/* LOADING */}
        {loading && (
          <div>
            <div style={{ textAlign: "center", padding: "40px 0 28px", borderBottom: "1px solid " + C.border, marginBottom: 28 }}>
              <div style={{ width: 32, height: 32, border: "2px solid " + C.border, borderTop: "2px solid " + C.accent, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 18px" }} />
              <div style={{ color: C.accent, fontSize: 10, letterSpacing: 3, fontFamily: "monospace", fontWeight: 700 }}>
                {STAGES[stage] ? STAGES[stage][0] : "LOADING..."}
              </div>
              <div style={{ color: C.textDim, fontSize: 10, marginTop: 6, fontFamily: "monospace" }}>
                {STAGES[stage] ? STAGES[stage][1] : ""}
              </div>
              {stage === "searching-parallel" && (
                <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 12 }}>
                  {[{ key: "etf", label: "ETF FLOWS" }, { key: "onchain", label: "ON-CHAIN" }, { key: "macro", label: "MACRO" }].map(function(item) {
                    var st = searchStatus[item.key];
                    var dotColor = st === "done" ? C.green : st === "failed" ? C.red : C.accent;
                    return (
                      <div key={item.key} style={{ textAlign: "center" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", margin: "0 auto 4px", background: dotColor, animation: st === "searching" ? "glow 0.8s ease infinite" : undefined }} />
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>{item.label}</div>
                        <div style={{ fontSize: 8, fontFamily: "monospace", color: dotColor }}>{st === "done" ? "✓" : st === "failed" ? "✗" : "…"}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 18 }}>
                {Object.keys(STAGES).map(function(s, i) {
                  return (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: s === stage ? C.accent : C.border, animation: s === stage ? "glow 1s ease infinite" : undefined }} />
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
              {[1,2,3].map(function(i) { return <Card key={i}><Skeleton h={8} mb={12} /><Skeleton w="60%" h={22} mb={8} /><Skeleton h={10} /></Card>; })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[1,2].map(function(i) { return <Card key={i}><Skeleton h={8} mb={10} /><Skeleton h={14} mb={6} /><Skeleton w="70%" h={10} /></Card>; })}
            </div>
            {/* Live debug log */}
            {debugLog.length > 0 && (
              <div style={{ marginTop: 20, background: C.surfaceHigh, borderRadius: 6, padding: "12px 16px", border: "1px solid " + C.border }}>
                <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8 }}>LIVE STATUS LOG</div>
                {debugLog.map(function(line, i) {
                  return (
                    <div key={i} style={{ color: line.includes("ERROR") || line.includes("FAILED") ? C.red : line.includes("done") || line.includes("Done") ? C.green : C.textMid, fontSize: 10, fontFamily: "monospace", lineHeight: 1.8 }}>{line}</div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ERROR */}
        {stage === "error" && !loading && (
          <Card accent={C.red} style={{ textAlign: "center", padding: 40 }}>
            {isRateLimit ? (
              <div>
                <div style={{ fontSize: 28, marginBottom: 12 }}>⏱</div>
                <div style={{ color: C.red, fontFamily: "monospace", fontSize: 13, fontWeight: 800, letterSpacing: 2, marginBottom: 8 }}>RATE LIMIT — 5H WINDOW EXCEEDED</div>
                {resetInfo ? (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ color: C.textMid, fontSize: 12, marginBottom: 6 }}>
                      {"Window resets at "}
                      <span style={{ color: C.accent, fontWeight: 700 }}>{resetInfo.time}</span>
                    </div>
                    <div style={{ color: C.gold, fontSize: 28, fontWeight: 900, fontFamily: "monospace", marginBottom: 6 }}>{resetInfo.countdown}</div>
                    <div style={{ color: C.textDim, fontSize: 10, fontFamily: "monospace" }}>remaining until reset</div>
                    {resetInfo.utilization && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace", marginBottom: 6 }}>WINDOW UTILIZATION</div>
                        <div style={{ background: C.surfaceHigh, borderRadius: 4, height: 8, width: 280, margin: "0 auto", overflow: "hidden" }}>
                          <div style={{ width: Math.min(100, resetInfo.utilization * 100) + "%", height: "100%", background: resetInfo.utilization >= 1 ? C.red : C.orange }} />
                        </div>
                        <div style={{ color: C.orange, fontSize: 10, fontFamily: "monospace", marginTop: 4 }}>{(resetInfo.utilization * 100).toFixed(0) + "% used"}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: C.textDim, fontSize: 11, marginBottom: 20 }}>Usage window exceeded. Try again in a few hours.</div>
                )}
                <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace", maxWidth: 400, margin: "0 auto 16px", lineHeight: 1.6 }}>
                  This dashboard uses 1 Claude API call per brief. The claude.ai 5-hour usage window applies.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 24, marginBottom: 12 }}>⚠</div>
                <div style={{ color: C.red, fontFamily: "monospace", fontSize: 11, maxWidth: 540, margin: "0 auto 16px", wordBreak: "break-word" }}>{error}</div>
              </div>
            )}
            <button onClick={generateBrief} style={{ background: C.redDim, border: "1px solid " + C.red, color: C.red, padding: "7px 18px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>
              {(isRateLimit && resetInfo) ? "RETRY AFTER " + resetInfo.time : "RETRY"}
            </button>
          </Card>
        )}

        {/* BRIEF */}
        {brief && !loading && (
          <div className="fade-up">

            {/* MASTHEAD */}
            <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid " + C.border }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 300 }}>
                  <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace", letterSpacing: 3, marginBottom: 8 }}>
                    {brief.date && brief.date.toUpperCase()}
                  </div>
                  <h1 style={{ fontFamily: "Playfair Display, serif", fontSize: 28, fontWeight: 900, color: C.text, lineHeight: 1.2, marginBottom: 10, maxWidth: 600 }}>
                    {brief.headline}
                  </h1>
                  <div style={{ color: C.textMid, fontSize: 13, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>
                    {brief.biasReason}
                  </div>
                  {brief.correlationRegime && (
                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>BTC/QQQ CORR:</span>
                      <Tag text={(brief.correlationRegime.btcQqqCorrelation || "") + " — " + (brief.correlationRegime.regime || "")} color={brief.correlationRegime.regime === "HIGH" ? C.orange : brief.correlationRegime.regime === "LOW" ? C.green : C.textMid} />
                      <span style={{ color: C.textDim, fontSize: 10 }}>{brief.correlationRegime.implication}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ background: biasColor + "12", border: "2px solid " + biasColor, borderRadius: 8, padding: "18px 22px", textAlign: "center", minWidth: 130 }}>
                    <div style={{ color: C.textDim, fontSize: 8, letterSpacing: 3, fontFamily: "monospace", marginBottom: 6 }}>BIAS</div>
                    <div style={{ color: biasColor, fontSize: 16, fontWeight: 900, fontFamily: "Playfair Display, serif" }}>{brief.overallBias}</div>
                  </div>
                  {score != null && !isNaN(score) && (
                    <div style={{ background: scoreColor + "12", border: "2px solid " + scoreColor, borderRadius: 8, padding: "18px 22px", textAlign: "center", minWidth: 90 }}>
                      <div style={{ color: C.textDim, fontSize: 8, letterSpacing: 3, fontFamily: "monospace", marginBottom: 6 }}>SCORE</div>
                      <div style={{ color: scoreColor, fontSize: 28, fontWeight: 900, fontFamily: "JetBrains Mono, monospace" }}>
                        {score > 0 ? "+" : ""}{score}
                      </div>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>/10</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* SCORE DECOMPOSITION — auditable breakdown of composite score */}
            {brief.scoreDecomposition && (
              <div style={{ marginBottom: 14, background: C.surface, border: "1px solid " + C.border, borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 3, marginBottom: 8 }}>SCORE DECOMPOSITION  ·  -10 to +10  ·  each axis auditable</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { key: "onChain",          label: "ON-CHAIN" },
                    { key: "etfInstitutional", label: "ETF/INST" },
                    { key: "derivatives",      label: "DERIV" },
                    { key: "cmeBasis",         label: "CME BASIS" },
                    { key: "macro",            label: "MACRO" },
                    { key: "sentiment",        label: "SENTIMENT" },
                    { key: "stablecoin",       label: "STABLECOIN" },
                  ].map(({ key, label }) => {
                    const axis = brief.scoreDecomposition[key];
                    if (!axis || axis.score == null) return null;
                    const s = parseInt(axis.score, 10);
                    const color = s > 0 ? C.green : s < 0 ? C.red : C.textDim;
                    return (
                      <div key={key} title={axis.signal || ""} style={{ background: color + "15", border: "1px solid " + color + "50", borderRadius: 5, padding: "5px 9px", cursor: "default" }}>
                        <div style={{ color: C.textDim, fontSize: 7, fontFamily: "monospace", letterSpacing: 1 }}>{label}</div>
                        <div style={{ color, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{s > 0 ? "+" : ""}{s}</div>
                        {axis.signal && (
                          <div style={{ color: C.textDim, fontSize: 7, fontFamily: "monospace", maxWidth: 120, marginTop: 2, lineHeight: 1.3 }}>{axis.signal.slice(0, 55)}{axis.signal.length > 55 ? "…" : ""}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CONVERGENCE SIGNAL — synthesises funding + sentiment + options */}
            {convergence && (
              <div style={{ marginBottom: 14, background: convergence.color + "08", border: "1px solid " + convergence.color + "50", borderRadius: 8, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 3, marginBottom: 4 }}>LIVE CONVERGENCE SIGNAL</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: convergence.color, fontSize: 16, fontWeight: 900, fontFamily: "JetBrains Mono, monospace" }}>{convergence.label}</span>
                    <span style={{ background: convergence.color + "20", color: convergence.color, fontFamily: "monospace", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>{(convergence.score > 0 ? "+" : "") + convergence.score}</span>
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {convergence.factors.map(function(f, i) { return <span key={i} style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace", background: C.surfaceHigh, padding: "2px 6px", borderRadius: 3 }}>{f}</span>; })}
                    {convergence.factors.length === 0 && <span style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>No strong signal triggers active</span>}
                  </div>
                </div>
                <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", textAlign: "right" }}>
                  <div>Funding · F&G · 200d SMA · Options Skew · CME Basis · Vol Trend</div>
                  <div style={{ marginTop: 2 }}>6-axis · client-side deterministic · not from LLM</div>
                </div>
              </div>
            )}

            {/* LIVE PHASE INDICATOR */}
            {_ap && (
              <div style={{ marginBottom: 16, background: _ap.color + "0d", border: "1px solid " + _ap.color + "40", borderLeft: "4px solid " + _ap.color, borderRadius: 8, padding: "14px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 3, marginBottom: 3 }}>ACTIVE PHASE - PORTFOLIO MANDATE</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: _ap.color, fontSize: 20, fontWeight: 900, fontFamily: "JetBrains Mono, monospace" }}>{"Phase " + _ap.id}</span>
                        <span style={{ color: _ap.color, fontSize: 13, fontWeight: 600 }}>{_ap.label}</span>
                      </div>
                      <div style={{ color: C.textMid, fontSize: 11, marginTop: 3 }}>{_ap.action}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    {PHASES.map(function(ph) {
                      var isActive = ph.id === _ap.id;
                      var priceNow = marketData && marketData.price;
                      var isPast = priceNow && ph.high <= priceNow;
                      return (
                        <div key={ph.id} style={{ textAlign: "center", opacity: isActive ? 1 : isPast ? 0.5 : 0.3 }}>
                          <div style={{ color: isActive ? ph.color : C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1, marginBottom: 2 }}>{"PHASE " + ph.id}</div>
                          <div style={{ color: isActive ? ph.color : C.textDim, fontSize: 9, fontFamily: "monospace" }}>{isPast ? "COMPLETE" : isActive ? "ACTIVE" : "$" + (ph.low / 1000).toFixed(0) + "K"}</div>
                        </div>
                      );
                    })}
                    {_ap.pctToNext && (
                      <div style={{ background: _ap.color + "18", borderRadius: 6, padding: "8px 14px", textAlign: "center" }}>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>TO NEXT PHASE</div>
                        <div style={{ color: _ap.color, fontSize: 15, fontWeight: 800, fontFamily: "monospace" }}>{"+" + _ap.pctToNext + "%"}</div>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>{"$" + _ap.nextPhaseAt.toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 12, background: C.bg, borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div style={{ width: Math.min(100, _ap.progress).toFixed(1) + "%", height: "100%", background: _ap.color, borderRadius: 4, transition: "width 0.5s ease" }} />
                </div>
                {techLevels && (
                  <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
                    {[
                      { label: "200d SMA", val: techLevels.sma200, note: "bull/bear line" },
                      { label: "50d SMA",  val: techLevels.sma50,  note: "medium trend" },
                      { label: "20d SMA",  val: techLevels.sma20,  note: "short trend" },
                      { label: "Realised Proxy", val: techLevels.realisedProxy, note: "avg cost basis est." },
                    ].map(function(item) {
                      if (!item.val) return null;
                      var price2 = marketData && marketData.price;
                      var pct = price2 ? ((price2 - item.val) / item.val * 100) : null;
                      var col = pct == null ? C.textMid : pct > 0 ? C.green : C.red;
                      return (
                        <div key={item.label} style={{ textAlign: "center" }}>
                          <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>{item.label}</div>
                          <div style={{ color: C.textMid, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{"$" + item.val.toLocaleString()}</div>
                          {pct != null && <div style={{ color: col, fontSize: 9, fontFamily: "monospace" }}>{(pct > 0 ? "+" : "") + pct.toFixed(1) + "%"}</div>}
                          <div style={{ color: C.textDim, fontSize: 8 }}>{item.note}</div>
                        </div>
                      );
                    })}
                    <div style={{ marginLeft: "auto", color: C.textDim, fontSize: 8, fontFamily: "monospace", alignSelf: "flex-end" }}>
                      {techLevels.candleCount + "d candles · " + techLevels.techSource}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* LIVE MARKET STATS */}
            {marketData && marketData.price && (
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { label: "BTC", value: "$" + marketData.price.toLocaleString(), sub: (marketData.change24h >= 0 ? "+" : "") + (marketData.change24h ? marketData.change24h.toFixed(2) : "0") + "% 24h", color: marketData.change24h >= 0 ? C.green : C.red },
                  { label: "VOLUME 24H", value: "$" + (marketData.volume24h / 1e9).toFixed(1) + "B", sub: "~" + Math.round(marketData.volume24h / marketData.price).toLocaleString() + " BTC" + (marketData.volumeEstimated ? " (est.)" : ""), color: C.blue },
                  { label: "BTC DOM.", value: marketData.btcDominance != null ? marketData.btcDominance + "%" : "—", sub: "vs total crypto", color: C.purple },
                  { label: "OPT SKEW", value: marketData.optionsSkew != null ? (marketData.optionsSkew > 0 ? "+" : "") + marketData.optionsSkew : "—", sub: marketData.optionsSkew != null ? (marketData.optionsSkew < -3 ? "fear hedge" : marketData.optionsSkew > 3 ? "call demand" : "neutral") : "Deribit", color: marketData.optionsSkew != null ? (marketData.optionsSkew < -3 ? C.red : marketData.optionsSkew > 3 ? C.orange : C.textMid) : C.textDim },
                  { label: "MARKET CAP", value: "$" + (marketData.marketCap / 1e12).toFixed(2) + "T", sub: "total network value", color: C.teal },
                  fearGreed ? { label: "FEAR & GREED", value: fearGreed.value + "/100", sub: fearGreed.label, color: fearGreed.value < 25 ? C.red : fearGreed.value < 45 ? C.orange : fearGreed.value < 55 ? C.textMid : fearGreed.value < 75 ? C.teal : C.green } : null,
                  marketData.fundingRate != null ? { label: "FUNDING 8H", value: (marketData.fundingRate * 100).toFixed(4) + "%", sub: marketData.fundingRate < -0.01 ? "shorts paying - bullish" : marketData.fundingRate > 0.05 ? "longs over-leveraged" : "neutral", color: marketData.fundingRate < -0.02 ? C.green : marketData.fundingRate > 0.05 ? C.red : C.textMid } : null,
                  marketData.goldPrice ? { label: "GOLD (XAU proxy)", value: "$" + marketData.goldPrice.toLocaleString(), sub: "BTC/Gold: " + (marketData.btcGoldRatio ? marketData.btcGoldRatio.toFixed(1) : "N/A") + (marketData.goldToken ? " · " + marketData.goldToken : ""), color: C.gold } : null,
                  etfFlowData && etfFlowData.etfTotalNetUSD != null ? (() => {
                    const flowDate = etfFlowData.etfFlowDate;
                    const lagDays = flowDate ? Math.round((Date.now() - new Date(flowDate).getTime()) / 86400000) : 0;
                    const lagTag = lagDays > 1 ? " · ⚠ T+" + lagDays + " lag" : " · confirmed";
                    return { label: "ETF FLOWS", value: (etfFlowData.etfTotalNetUSD >= 0 ? "+" : "") + "$" + (etfFlowData.etfTotalNetUSD / 1e6).toFixed(0) + "M", sub: (flowDate || "today") + lagTag, color: etfFlowData.etfTotalNetUSD >= 0 ? C.green : C.red };
                  })()
                    : etfFlowData && etfFlowData.etfIBITvolumeUSD != null
                    ? { label: "IBIT VOLUME", value: "$" + (etfFlowData.etfIBITvolumeUSD / 1e6).toFixed(0) + "M", sub: "trading vol · not flow data", color: C.textMid }
                    : { label: "ETF FLOWS", value: "N/A", sub: "flow data unavailable", color: C.textDim },
                  cmeData && cmeData.cmeBasisPct != null ? { label: "CME BASIS" + (cmeData.cmeNearExpiry ? " (2M)" : ""), value: (cmeData.cmeBasisPct > 0 ? "+" : "") + cmeData.cmeBasisPct + "%", sub: cmeData.cmeBasisPct > 12 ? "strong contango" : cmeData.cmeBasisPct > 4 ? "healthy contango" : cmeData.cmeBasisPct < -2 ? "backwardation" : "flat", color: cmeData.cmeBasisPct > 12 ? C.green : cmeData.cmeBasisPct > 4 ? C.teal : cmeData.cmeBasisPct < -2 ? C.red : C.textMid } : null,
                  macroData && macroData.dxy != null ? { label: "DXY", value: String(macroData.dxy), sub: macroData.dxyChange != null ? (macroData.dxyChange > 0 ? "↑" : "↓") + " " + Math.abs(macroData.dxyChange) + "% 1d" : "US Dollar Index", color: macroData.dxy > 104 ? C.red : macroData.dxy < 100 ? C.green : C.textMid } : null,
                  macroData && macroData.vix != null ? { label: "VIX", value: String(macroData.vix), sub: macroData.vix > 30 ? "high fear" : macroData.vix > 20 ? "elevated" : "calm", color: macroData.vix > 30 ? C.red : macroData.vix > 20 ? C.orange : C.green } : null,
                  macroData && macroData.tnxYield != null ? { label: "10Y YIELD", value: macroData.tnxYield + "%", sub: macroData.tnxChange != null ? (macroData.tnxChange > 0 ? "↑" : "↓") + " " + Math.abs(macroData.tnxChange) + "% 1d" : "US 10Y Treasury", color: macroData.tnxYield > 4.5 ? C.red : macroData.tnxYield < 3.5 ? C.green : C.textMid } : null,
                ].filter(Boolean).map(function(s, i) {
                  return (
                    <div key={i} style={{ flex: 1, minWidth: 120, background: C.surface, border: "1px solid " + C.border, borderTop: "2px solid " + s.color, borderRadius: 6, padding: "10px 14px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, letterSpacing: 2, fontFamily: "monospace", marginBottom: 5 }}>{s.label}</div>
                      <div style={{ color: s.color, fontSize: 17, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>{s.value}</div>
                      <div style={{ color: C.textDim, fontSize: 9, marginTop: 2 }}>{s.sub}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* LIQUIDATION HEATMAP */}
            {liquidations && (liquidations.long > 0 || liquidations.short > 0) && (
              <div style={{ background: C.surface, border: "1px solid " + C.border, borderLeft: "3px solid " + liqColor, borderRadius: 8, padding: "14px 18px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 3, fontWeight: 800 }}>
                    {"LIQUIDATION HEATMAP — " + (liquidations.window || "recent").toUpperCase() + " · " + (liquidations.source || "")}
                  </span>
                  <Tag text={liqSkew} color={liqColor} />
                </div>
                <div style={{ display: "flex", height: 20, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ width: liqLongPct + "%", background: C.red + "90", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {liqLongPct > 15 && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{liqLongPct.toFixed(0) + "%"}</span>}
                  </div>
                  <div style={{ width: liqShortPct + "%", background: C.green + "90", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {liqShortPct > 15 && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>{liqShortPct.toFixed(0) + "%"}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>LONGS LIQUIDATED</div>
                      <div style={{ color: C.red, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{"$" + ((liquidations.long || 0) / 1e6).toFixed(1) + "M"}</div>
                      <div style={{ color: C.textDim, fontSize: 9 }}>Forced sell pressure</div>
                    </div>
                    <div>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>SHORTS LIQUIDATED</div>
                      <div style={{ color: C.green, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{"$" + ((liquidations.short || 0) / 1e6).toFixed(1) + "M"}</div>
                      <div style={{ color: C.textDim, fontSize: 9 }}>Forced buy pressure</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>TOTAL</div>
                    <div style={{ color: C.textMid, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{"$" + (liqTotal / 1e6).toFixed(1) + "M"}</div>
                    <div style={{ color: C.textDim, fontSize: 9 }}>
                      {liqLongPct > 65 ? "Longs over-leveraged" : liqLongPct < 35 ? "Shorts squeezed - reversal potential" : "Balanced deleveraging"}
                    </div>
                  </div>
                </div>
              </div>
            )}


            {/* QUAD-NORMALIZED PANEL */}
            {brief.normalization && (
              <div style={{ background: C.surfaceMid, border: "1px solid " + C.border, borderLeft: "3px solid " + C.purple, borderRadius: 8, padding: "14px 18px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ color: C.purple, fontSize: 8, fontFamily: "monospace", letterSpacing: 3, fontWeight: 800 }}>QUAD-NORMALIZED SIGNALS</span>
                  <span style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>
                    {["Liquid: " + brief.normalization.liquidSupply, "MCap: " + brief.normalization.marketCap, "Vol: " + brief.normalization.dailyVolumeBTC].join(" · ")}
                  </span>
                </div>
                <div style={{ background: C.bg, borderRadius: 5, padding: "8px 14px", marginBottom: 10, display: "flex", gap: 24, alignItems: "center", borderLeft: "3px solid " + C.gold }}>
                  <div>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1, marginBottom: 2 }}>VOLUME REGIME</div>
                    <span style={{ color: C.gold, fontSize: 12, fontWeight: 800, fontFamily: "monospace" }}>{brief.normalization.volumeRegime}</span>
                  </div>
                  <div>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>24H VOL</div>
                    <span style={{ color: C.textMid, fontSize: 11, fontFamily: "monospace" }}>{(brief.normalization.dailyVolumeUSD || "") + " / " + (brief.normalization.dailyVolumeBTC || "")}</span>
                  </div>
                  <div>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>TREND</div>
                    <span style={{ color: brief.normalization.volumeTrend === "RISING" ? C.green : brief.normalization.volumeTrend === "FALLING" ? C.red : C.textMid, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{brief.normalization.volumeTrend}</span>
                  </div>
                  {brief.normalization.historicalValidation && (
                    <div style={{ marginLeft: "auto", color: C.textDim, fontSize: 9, fontStyle: "italic", maxWidth: 320 }}>{brief.normalization.historicalValidation}</div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div style={{ background: C.bg, borderRadius: 5, padding: "10px 12px", borderTop: "2px solid " + C.teal }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1, marginBottom: 5 }}>WHALE NETFLOW</div>
                    <div style={{ color: C.teal, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{brief.normalization.whaleNetflowBTC}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                      {[
                        { l: "% LIQUID (PRIMARY)", v: brief.normalization.whaleNetflowPctLiquid, c: C.purple },
                        { l: "% VOLUME", v: brief.normalization.whaleNetflowPctVolume, c: C.gold },
                        { l: "% MCAP", v: brief.normalization.whaleNetflowPctMcap, c: C.textMid },
                      ].map(function(r, i) {
                        return r.v ? (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: r.c, fontSize: 8, fontFamily: "monospace" }}>{r.l}</span>
                            <span style={{ color: r.c, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{r.v}</span>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                  <div style={{ background: C.bg, borderRadius: 5, padding: "10px 12px", borderTop: "2px solid " + C.blue }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1, marginBottom: 5 }}>ETF ABSORPTION</div>
                    <div style={{ color: C.blue, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{brief.normalization.etfFlowUSD}</div>
                    <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace", marginBottom: 4 }}>{brief.normalization.etfFlowBTC} BTC absorbed</div>
                    {brief.normalization.etfFlowPctLiquid && (
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: C.purple, fontSize: 8, fontFamily: "monospace" }}>% LIQUID (PRIMARY)</span>
                        <span style={{ color: C.purple, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{brief.normalization.etfFlowPctLiquid}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ background: C.bg, borderRadius: 5, padding: "10px 12px", borderTop: "2px solid " + C.orange }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1, marginBottom: 5 }}>LTH NET POSITION</div>
                    {lthData && lthData.lth_net_btc != null ? (() => {
                      const val     = lthData.lth_net_btc;
                      const sign    = val >= 0 ? '+' : '';
                      const pctLiq  = (val / 4_200_000 * 100).toFixed(3);
                      const color   = val >= 0 ? C.green : C.orange;
                      const label   = val >= 5000 ? "accumulating" : val <= -5000 ? "distributing" : "neutral";
                      return (
                        <>
                          <div style={{ color, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>
                            {sign}{Math.abs(val).toLocaleString()} BTC/day
                          </div>
                          <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>
                            {label} · {lthData.date}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                            <span style={{ color: C.purple, fontSize: 8, fontFamily: "monospace" }}>% LIQUID</span>
                            <span style={{ color: C.purple, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{sign}{pctLiq}%</span>
                          </div>
                        </>
                      );
                    })() : (
                      <>
                        <div style={{ color: C.textDim, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>N/A</div>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginTop: 4 }}>run npm run dune to fetch</div>
                      </>
                    )}
                  </div>
                  {/* ── STABLECOIN SUPPLY (CoinGecko via worker cache) ── */}
                  <div style={{ background: C.bg, borderRadius: 5, padding: "10px 12px", borderTop: "2px solid " + C.teal }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1, marginBottom: 5 }}>STABLE DEMAND</div>
                    {stablecoinData && stablecoinData.total_usd != null ? (() => {
                      const totalB  = (stablecoinData.total_usd / 1e9).toFixed(1);
                      const deltaB  = stablecoinData.delta_7d_usd != null
                        ? (stablecoinData.delta_7d_usd >= 0 ? '+' : '') + (stablecoinData.delta_7d_usd / 1e9).toFixed(1) + 'B'
                        : null;
                      const regime  = stablecoinData.regime || "STABLE";
                      const regimeColor = regime === "EXPANDING" ? C.green : regime === "CONTRACTING" ? C.red : C.textMid;
                      return (
                        <>
                          <div style={{ color: C.teal, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>
                            ${totalB}B
                          </div>
                          <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginTop: 2 }}>
                            USDT+USDC · {stablecoinData.date}
                          </div>
                          {deltaB && (
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                              <span style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>7D DELTA</span>
                              <span style={{ color: regimeColor, fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>{deltaB}</span>
                            </div>
                          )}
                          <div style={{ marginTop: 4 }}>
                            <span style={{
                              background: regimeColor + "18", color: regimeColor,
                              border: "1px solid " + regimeColor + "35",
                              borderRadius: 3, padding: "1px 6px",
                              fontSize: 8, fontWeight: 800, letterSpacing: 1.2, fontFamily: "monospace",
                            }}>{regime}</span>
                          </div>
                        </>
                      );
                    })() : (
                      <>
                        <div style={{ color: C.textDim, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>N/A</div>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginTop: 4 }}>run npm run dune to fetch</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ROW 1: Price / Whale / ETF */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>

              <Card accent={signalColors[brief.priceAnalysis && brief.priceAnalysis.signal]}>
                <Label>Price Structure</Label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>Market Structure</span>
                  <Tag text={brief.priceAnalysis && brief.priceAnalysis.signal} />
                </div>
                <p style={{ color: C.textMid, fontSize: 12, lineHeight: 1.7, marginBottom: 12, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.priceAnalysis && brief.priceAnalysis.trend}</p>
                <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "9px 12px", marginBottom: 8 }}>
                  <div style={{ color: C.textDim, fontSize: 8, letterSpacing: 2, fontFamily: "monospace", marginBottom: 3 }}>KEY LEVEL TODAY</div>
                  <div style={{ color: C.gold, fontSize: 11, lineHeight: 1.5 }}>{brief.priceAnalysis && brief.priceAnalysis.keyLevel}</div>
                </div>
                {brief.priceAnalysis && brief.priceAnalysis.realizedPriceContext && (
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 12px" }}>
                    <div style={{ color: C.textDim, fontSize: 8, letterSpacing: 2, fontFamily: "monospace", marginBottom: 3 }}>COST BASIS CONTEXT</div>
                    <div style={{ color: C.textMid, fontSize: 10, lineHeight: 1.5 }}>{brief.priceAnalysis.realizedPriceContext}</div>
                  </div>
                )}
              </Card>

              <Card accent={signalColors[brief.whaleSignal && brief.whaleSignal.status]}>
                <Label>Whale / On-Chain</Label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>Exchange Flows</span>
                  <Tag text={brief.whaleSignal && brief.whaleSignal.status} />
                </div>
                {brief.whaleSignal && brief.whaleSignal.netflowBTC && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <div style={{ flex: 1, background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>RAW BTC</div>
                      <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{brief.whaleSignal.netflowBTC}</div>
                      {brief.whaleSignal.netflowUSD && <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>{brief.whaleSignal.netflowUSD}</div>}
                    </div>
                    {brief.whaleSignal.netflowPctLiquid && (
                      <div style={{ flex: 1, background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px", borderTop: "2px solid " + C.purple }}>
                        <div style={{ color: C.purple, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>% LIQUID (PRIMARY)</div>
                        <div style={{ color: C.purple, fontSize: 13, fontWeight: 900, fontFamily: "monospace" }}>{brief.whaleSignal.netflowPctLiquid}</div>
                        {brief.whaleSignal.netflowPctVolume && <div style={{ color: C.gold, fontSize: 9, fontFamily: "monospace" }}>{brief.whaleSignal.netflowPctVolume + " vol"}</div>}
                      </div>
                    )}
                  </div>
                )}
                {brief.whaleSignal && brief.whaleSignal.historicalContext && (
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "7px 10px", marginBottom: 8 }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>VS HISTORY</div>
                    <div style={{ color: C.purple, fontSize: 10, lineHeight: 1.5 }}>{brief.whaleSignal.historicalContext}</div>
                  </div>
                )}
                <p style={{ color: C.textMid, fontSize: 11, lineHeight: 1.6, marginBottom: 8, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.whaleSignal && brief.whaleSignal.detail}</p>
                <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                  <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>POSITION IMPLICATION</div>
                  <div style={{ color: C.teal, fontSize: 10, lineHeight: 1.5 }}>{brief.whaleSignal && brief.whaleSignal.actionable}</div>
                </div>
              </Card>

              <Card accent={signalColors[brief.etfFlows && brief.etfFlows.status]}>
                <Label>ETF Flows</Label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>Institutional Capital</span>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <Tag text={brief.etfFlows && brief.etfFlows.status} />
                    <Tag text={brief.etfFlows && brief.etfFlows.trend} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {brief.etfFlows && brief.etfFlows.totalNetUSD && (
                    <div style={{ flex: 1, background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>TOTAL NET</div>
                      <div style={{ color: brief.etfFlows.status === "INFLOW" ? C.green : C.red, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{brief.etfFlows.totalNetUSD}</div>
                      {brief.etfFlows.totalNetBTC && <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>{brief.etfFlows.totalNetBTC + " BTC"}</div>}
                    </div>
                  )}
                  {brief.etfFlows && brief.etfFlows.totalNetPctLiquid && (
                    <div style={{ flex: 1, background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px", borderTop: "2px solid " + C.purple }}>
                      <div style={{ color: C.purple, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>% LIQUID</div>
                      <div style={{ color: C.purple, fontSize: 13, fontWeight: 900, fontFamily: "monospace" }}>{brief.etfFlows.totalNetPctLiquid}</div>
                    </div>
                  )}
                  {brief.etfFlows && brief.etfFlows.ibitFlow && (
                    <div style={{ flex: 1, background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>IBIT</div>
                      <div style={{ color: C.accent, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{brief.etfFlows.ibitFlow}</div>
                    </div>
                  )}
                </div>
                <p style={{ color: C.textMid, fontSize: 11, lineHeight: 1.6, marginBottom: 6, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.etfFlows && brief.etfFlows.detail}</p>
                {brief.etfFlows && brief.etfFlows.vsBaseline && <div style={{ color: C.textDim, fontSize: 10, fontStyle: "italic" }}>{"vs baseline: " + brief.etfFlows.vsBaseline}</div>}
                {brief.etfFlows && brief.etfFlows.streakDays && (
                  <div style={{ marginTop: 6 }}>
                    <Tag text={brief.etfFlows.streakDays + " consecutive"} color={brief.etfFlows.status === "INFLOW" ? C.green : C.red} />
                  </div>
                )}
              </Card>
            </div>

            {/* CME BASIS CARD — shown when CoinGlass data is available */}
            {cmeData && (cmeData.cmeBasisPct != null || cmeData.totalAggOIusd != null) && (
              <div style={{ marginBottom: 14, background: C.surfaceMid, border: "1px solid " + C.border, borderLeft: "3px solid " + C.blue, borderRadius: 8, padding: "12px 18px", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ color: C.blue, fontSize: 8, fontFamily: "monospace", letterSpacing: 3, fontWeight: 800, flexShrink: 0 }}>CME FUTURES · INSTITUTIONAL DEMAND</div>
                {cmeData.cmeBasisPct != null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>CME BASIS (ANNLZD)</div>
                    <div style={{ color: cmeData.cmeBasisPct > 12 ? C.green : cmeData.cmeBasisPct > 4 ? C.teal : cmeData.cmeBasisPct < -2 ? C.red : C.textMid, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>
                      {(cmeData.cmeBasisPct > 0 ? "+" : "") + cmeData.cmeBasisPct + "%"}
                    </div>
                    <div style={{ color: C.textDim, fontSize: 8 }}>{cmeData.cmeBasisPct > 12 ? "Strong contango" : cmeData.cmeBasisPct > 4 ? "Healthy contango" : cmeData.cmeBasisPct < -2 ? "Backwardation" : "Flat"}</div>
                  </div>
                )}
                {cmeData.totalAggOIusd != null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>AGGREGATE OI</div>
                    <div style={{ color: C.cyan, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>${(cmeData.totalAggOIusd / 1e9).toFixed(1)}B</div>
                    <div style={{ color: C.textDim, fontSize: 8 }}>all venues</div>
                  </div>
                )}
                {cmeData.cmeOIusd != null && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>CME OI</div>
                    <div style={{ color: C.blue, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>${(cmeData.cmeOIusd / 1e9).toFixed(1)}B</div>
                    <div style={{ color: C.textDim, fontSize: 8 }}>institutional</div>
                  </div>
                )}
                {cmeData.oiByExchange && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {Object.keys(cmeData.oiByExchange).sort(function(a, b) { return cmeData.oiByExchange[b] - cmeData.oiByExchange[a]; }).slice(0, 5).map(function(ex) {
                      return (
                        <div key={ex} style={{ background: C.bg, borderRadius: 4, padding: "4px 8px", textAlign: "center" }}>
                          <div style={{ color: C.textDim, fontSize: 7, fontFamily: "monospace" }}>{ex}</div>
                          <div style={{ color: C.textMid, fontSize: 9, fontFamily: "monospace", fontWeight: 700 }}>${(cmeData.oiByExchange[ex] / 1e9).toFixed(1)}B</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ marginLeft: "auto", color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>CoinGlass · live</div>
              </div>
            )}

            {/* ROW 2: Funding / OI / CME Basis / MVRV / Stablecoins */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 14 }}>

              {brief.fundingRates && (
                <Card accent={brief.fundingRates.signal === "BULLISH" ? C.green : brief.fundingRates.signal === "BEARISH" ? C.red : C.textMid}>
                  <Label>Funding Rates</Label>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Tag text={brief.fundingRates.regime} color={brief.fundingRates.regime === "CAPITULATION" ? C.green : brief.fundingRates.regime === "EXTREME_LONG" ? C.red : brief.fundingRates.regime === "ELEVATED" ? C.orange : C.textMid} />
                    <Tag text={brief.fundingRates.signal} />
                  </div>
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "10px 12px", marginBottom: 10 }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 3 }}>RATE PER 8H</div>
                    <div style={{ color: brief.fundingRates.signal === "BULLISH" ? C.green : brief.fundingRates.signal === "BEARISH" ? C.red : C.textMid, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>{brief.fundingRates.rate8h}</div>
                    <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>{brief.fundingRates.annualized}</div>
                  </div>
                  <p style={{ color: C.textMid, fontSize: 10, lineHeight: 1.6, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.fundingRates.detail}</p>
                  <div style={{ marginTop: 8 }}>
                    <span style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>SQUEEZE RISK: </span>
                    <Tag text={brief.fundingRates.squeeze_risk} color={brief.fundingRates.squeeze_risk === "HIGH" ? C.green : brief.fundingRates.squeeze_risk === "MEDIUM" ? C.orange : C.textDim} />
                  </div>
                </Card>
              )}

              {brief.openInterest && (
                <Card accent={C.cyan}>
                  <Label>Open Interest</Label>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Tag text={brief.openInterest.trend} />
                    <Tag text={"LEVERAGE: " + brief.openInterest.leverageRisk} color={brief.openInterest.leverageRisk === "HIGH" ? C.red : brief.openInterest.leverageRisk === "MEDIUM" ? C.orange : C.green} />
                  </div>
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "9px 12px", marginBottom: 10 }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>REGIME</div>
                    <div style={{ color: C.cyan, fontSize: 11, lineHeight: 1.4 }}>{brief.openInterest.regime}</div>
                  </div>
                  <p style={{ color: C.textMid, fontSize: 10, lineHeight: 1.6, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.openInterest.detail}</p>
                </Card>
              )}

              {brief.cmeBasis && (
                <Card accent={signalColors[brief.cmeBasis.signal] || C.blue}>
                  <Label>CME Futures Basis</Label>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Tag text={brief.cmeBasis.regime || "—"} color={brief.cmeBasis.signal === "BULLISH" ? C.green : brief.cmeBasis.signal === "BEARISH" ? C.red : C.blue} />
                    <Tag text={brief.cmeBasis.signal} />
                  </div>
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "10px 12px", marginBottom: 10 }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 3 }}>BASIS (ANNUALIZED)</div>
                    <div style={{ color: brief.cmeBasis.signal === "BULLISH" ? C.green : brief.cmeBasis.signal === "BEARISH" ? C.red : C.blue, fontSize: 18, fontWeight: 800, fontFamily: "monospace" }}>{brief.cmeBasis.basisPct}</div>
                  </div>
                  <p style={{ color: C.textMid, fontSize: 10, lineHeight: 1.6, marginBottom: 8, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.cmeBasis.detail}</p>
                  {brief.cmeBasis.cmeOIvsPerp && <div style={{ color: C.textDim, fontSize: 9, fontStyle: "italic" }}>{brief.cmeBasis.cmeOIvsPerp}</div>}
                </Card>
              )}

              {brief.mvrvSignal && (
                <Card accent={C.purple}>
                  <Label>MVRV Zone</Label>
                  <div style={{ marginBottom: 10 }}>
                    <Tag text={brief.mvrvSignal.estimatedZone} color={
                      brief.mvrvSignal.estimatedZone && brief.mvrvSignal.estimatedZone.includes("RED") ? C.green :
                      brief.mvrvSignal.estimatedZone && brief.mvrvSignal.estimatedZone.includes("UNDERVALUED") ? C.teal :
                      brief.mvrvSignal.estimatedZone && brief.mvrvSignal.estimatedZone.includes("OVERVALUED") ? C.orange : C.textMid
                    } />
                  </div>
                  <p style={{ color: C.textMid, fontSize: 10, lineHeight: 1.6, marginBottom: 8, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.mvrvSignal.implication}</p>
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>CYCLE CONTEXT</div>
                    <div style={{ color: C.purple, fontSize: 10, lineHeight: 1.5 }}>{brief.mvrvSignal.cycleContext}</div>
                  </div>
                </Card>
              )}

              {brief.stablecoinSignal && (
                <Card accent={signalColors[brief.stablecoinSignal.signal]}>
                  <Label>Stablecoin Flows</Label>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Tag text={brief.stablecoinSignal.status} />
                    <Tag text={brief.stablecoinSignal.signal} />
                  </div>
                  <p style={{ color: C.textMid, fontSize: 11, lineHeight: 1.6, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.stablecoinSignal.detail}</p>
                </Card>
              )}
            </div>

            {/* ROW 3: Macro / Action */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

              <Card accent={signalColors[brief.macroContext && brief.macroContext.riskLevel]}>
                <Label>Macro Environment</Label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>Global Risk</span>
                  <Tag text={"RISK: " + (brief.macroContext && brief.macroContext.riskLevel)} color={signalColors[brief.macroContext && brief.macroContext.riskLevel]} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                  {brief.macroContext && brief.macroContext.dxy && (
                    <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>DXY</div>
                      <div style={{ color: signalColors[brief.macroContext.dxySignal] || C.textMid, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{brief.macroContext.dxy}</div>
                      <Tag text={brief.macroContext.dxySignal} color={signalColors[brief.macroContext.dxySignal]} />
                    </div>
                  )}
                  {brief.macroContext && brief.macroContext.realYield && (
                    <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>10Y REAL YIELD</div>
                      <div style={{ color: signalColors[brief.macroContext.realYieldSignal] || C.textMid, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{brief.macroContext.realYield}</div>
                      <Tag text={brief.macroContext.realYieldSignal} color={signalColors[brief.macroContext.realYieldSignal]} />
                    </div>
                  )}
                  {brief.macroContext && brief.macroContext.gold && (
                    <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>GOLD / BTC-GOLD</div>
                      <div style={{ color: C.gold, fontSize: 11, fontWeight: 700, fontFamily: "monospace" }}>{brief.macroContext.gold}</div>
                    </div>
                  )}
                </div>
                <p style={{ color: C.textMid, fontSize: 11, lineHeight: 1.6, marginBottom: 10, fontFamily: "Inter, sans-serif", fontWeight: 300 }}>{brief.macroContext && brief.macroContext.detail}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 10px" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>FED WATCH</div>
                    <div style={{ color: C.textMid, fontSize: 10 }}>{brief.macroContext && brief.macroContext.fedWatch}</div>
                  </div>
                  {brief.macroContext && brief.macroContext.geopolitical && (
                    <div style={{ background: C.redDim + "60", borderRadius: 5, padding: "7px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>GEOPOLITICAL</div>
                      <div style={{ color: C.orange, fontSize: 10 }}>{brief.macroContext.geopolitical}</div>
                    </div>
                  )}
                </div>
              </Card>

              <Card style={{
                background: ((signalColors[brief.todayAction && brief.todayAction.recommendation] || C.accent) + "08"),
                border: "1px solid " + ((signalColors[brief.todayAction && brief.todayAction.recommendation] || C.accent) + "30"),
                borderLeft: "4px solid " + (signalColors[brief.todayAction && brief.todayAction.recommendation] || C.accent),
              }}>
                <Label>Today Action</Label>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ color: signalColors[brief.todayAction && brief.todayAction.recommendation] || C.accent, fontSize: 24, fontWeight: 900, fontFamily: "Playfair Display, serif" }}>
                    {brief.todayAction && brief.todayAction.recommendation}
                  </span>
                  <Tag text={"STOP: " + (brief.todayAction && brief.todayAction.stopAlert)} color={signalColors[brief.todayAction && brief.todayAction.stopAlert]} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ background: C.bg, borderRadius: 5, padding: "9px 12px" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 3 }}>SIZE / ALLOCATION</div>
                    <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{brief.todayAction && brief.todayAction.size}</div>
                  </div>
                  <div style={{ background: C.bg, borderRadius: 5, padding: "9px 12px" }}>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 3 }}>CHANGES IF</div>
                    <div style={{ color: C.orange, fontSize: 11 }}>{brief.todayAction && brief.todayAction.trigger}</div>
                  </div>
                  <div style={{ background: C.redDim + "70", border: "1px solid " + C.red + "30", borderRadius: 5, padding: "9px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>STOP LOSS — CLIENT COMPUTED</div>
                      {clientStop && clientStop.method && <Tag text={clientStop.method} color={C.red} />}
                    </div>
                    <div style={{ color: C.red, fontSize: 16, fontWeight: 800, fontFamily: "monospace" }}>
                      {(clientStop && clientStop.level) || "$58,500"}
                    </div>
                    {clientStop && clientStop.pct && (
                      <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>
                        {clientStop.pct + "% from current · not from LLM"}
                      </div>
                    )}
                  </div>
                  {brief.todayAction && brief.todayAction.dynamicStop && (
                    <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "7px 10px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 2 }}>ANALYST STOP NOTE</div>
                      <div style={{ color: C.textMid, fontSize: 10, fontStyle: "italic" }}>{brief.todayAction.dynamicStop}</div>
                    </div>
                  )}
                  {brief.todayAction && brief.todayAction.scoreJustification && (
                    <div style={{ background: C.bg, borderRadius: 5, padding: "9px 12px" }}>
                      <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 3 }}>SCORE BREAKDOWN</div>
                      <div style={{ color: C.textMid, fontSize: 9, lineHeight: 1.6, fontFamily: "monospace" }}>{brief.todayAction.scoreJustification}</div>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* ANALYST NOTE */}
            <Card style={{ marginBottom: 14, borderTop: "3px solid " + C.accent }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <Label color={C.accent}>Senior Analyst Note</Label>
                <span style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>Maison Toé Digital Assets — BTC Desk</span>
              </div>
              <p style={{ color: C.text, fontSize: 14, lineHeight: 1.9, fontFamily: "Playfair Display, serif", fontStyle: "italic", fontWeight: 400, borderLeft: "2px solid " + C.accent, paddingLeft: 18 }}>
                {brief.analystNote}
              </p>
            </Card>

            {/* CATALYST WATCH + RISK */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Card>
                <Label>Catalyst Watch</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(brief.catalystWatch || []).map(function(cat, i) {
                    return (
                      <div key={i} style={{ background: C.surfaceHigh, borderRadius: 5, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 3 }}>
                            <span style={{ color: C.text, fontSize: 11, fontWeight: 600 }}>{cat.event}</span>
                            <Tag text={cat.impact} color={cat.impact === "BULLISH" ? C.green : cat.impact === "BEARISH" ? C.red : C.purple} />
                          </div>
                          <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>{cat.timing}</div>
                          <div style={{ color: C.textMid, fontSize: 10, marginTop: 3 }}>{cat.note}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card accent={C.red} style={{ background: C.redDim + "30" }}>
                <Label color={C.red}>Primary Risk — Thesis Killer</Label>
                <p style={{ color: C.text, fontSize: 13, lineHeight: 1.8, marginBottom: 18, fontFamily: "Inter, sans-serif" }}>
                  {brief.riskWarning}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", background: C.bg, borderRadius: 5 }}>
                    <span style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>HARD STOP</span>
                    <span style={{ color: C.red, fontWeight: 700, fontFamily: "monospace", fontSize: 11 }}>
                      {(brief.todayAction && brief.todayAction.dynamicStop) || (brief.todayAction && brief.todayAction.stopAlert) || "See action card"}
                    </span>
                  </div>
                  {brief.contextTimestamp && (
                    <div style={{ color: C.textDim, fontSize: 9, fontStyle: "italic", padding: "4px 0" }}>
                      {brief.contextTimestamp}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* ACCURACY TRACKER */}
            {showAccuracy && (
              <Card style={{ marginTop: 14 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <Label>Model Accuracy — 30-Day Call Log</Label>
                    <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>Last 7 graded fed back to Claude each session</div>
                  </div>
                  {accPct != null ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 14px", textAlign: "center" }}>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>HIT RATE</div>
                        <div style={{ color: accPct >= 60 ? C.green : accPct >= 40 ? C.orange : C.red, fontSize: 20, fontWeight: 800, fontFamily: "monospace" }}>{accPct + "%"}</div>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>{accGraded.length + " graded"}</div>
                      </div>
                      <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 14px", textAlign: "center" }}>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>BIAS DRIFT</div>
                        <div style={{ color: accDriftColor, fontSize: 13, fontWeight: 800, fontFamily: "monospace" }}>{accDriftLabel}</div>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>last 7 errors</div>
                      </div>
                      {accHcHit != null && (
                        <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 14px", textAlign: "center" }}>
                          <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>HIGH CONV.</div>
                          <div style={{ color: accHcHit >= 60 ? C.green : accHcHit >= 40 ? C.orange : C.red, fontSize: 20, fontWeight: 800, fontFamily: "monospace" }}>{accHcHit + "%"}</div>
                          <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>score abs&gt;=5</div>
                        </div>
                      )}
                      <div style={{ background: C.surfaceHigh, borderRadius: 5, padding: "8px 14px", flex: 1, minWidth: 160 }}>
                        <div style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", marginBottom: 4 }}>CALIBRATION STATUS</div>
                        {accPct >= 60 ? (
                          <div style={{ color: C.green, fontSize: 10, fontFamily: "monospace" }}>WELL CALIBRATED — full conviction scores active</div>
                        ) : accPct >= 40 ? (
                          <div style={{ color: C.orange, fontSize: 10, fontFamily: "monospace" }}>MARGINAL — Claude instructed to widen uncertainty</div>
                        ) : accGraded.length >= 3 ? (
                          <div style={{ color: C.red, fontSize: 10, fontFamily: "monospace" }}>POOR — Claude instructed to cap scores at +/-5</div>
                        ) : (
                          <div style={{ color: C.textDim, fontSize: 10, fontFamily: "monospace" }}>Building baseline — need 2+ graded calls</div>
                        )}
                      </div>
                    </div>
                  ) : <Tag text="AWAITING DATA — need 2 sessions to grade" color={C.textDim} />}
                </div>
                {accuracyLog.length === 0 ? (
                  <div style={{ color: C.textDim, fontSize: 11, fontStyle: "italic", textAlign: "center", padding: 20 }}>
                    No calls logged yet. Accuracy builds after the second session.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "110px 90px 60px 90px 90px 90px 1fr", gap: 8, padding: "4px 10px" }}>
                      {["DATE","PRICE","SCORE","BIAS","ACTION","OUTCOME","% MOVE 5D"].map(function(h) {
                        return <div key={h} style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>{h}</div>;
                      })}
                    </div>
                    {accuracyLog.slice().reverse().map(function(entry, i) {
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 90px 60px 90px 90px 90px 1fr", gap: 8, padding: "7px 10px", background: i % 2 === 0 ? C.surfaceHigh : C.surface, borderRadius: 4, borderLeft: "3px solid " + (entry.outcome === "CORRECT" ? C.green : entry.outcome === "WRONG" ? C.red : C.border) }}>
                          <div style={{ color: C.textDim, fontSize: 9, fontFamily: "monospace" }}>{entry.date ? entry.date.slice(0, 10) : "—"}</div>
                          <div style={{ color: C.textMid, fontSize: 9, fontFamily: "monospace" }}>{entry.price ? "$" + entry.price.toLocaleString() : "—"}</div>
                          <div style={{ color: entry.score >= 5 ? C.green : entry.score >= 2 ? C.teal : entry.score < 0 ? C.red : C.textMid, fontSize: 9, fontWeight: 700, fontFamily: "monospace" }}>
                            {entry.score != null ? (entry.score > 0 ? "+" + entry.score : String(entry.score)) : "—"}
                          </div>
                          <div style={{ color: biasColors[entry.bias] || C.textMid, fontSize: 9, fontFamily: "monospace" }}>{entry.bias || "—"}</div>
                          <div style={{ color: signalColors[entry.recommendation] || C.textMid, fontSize: 9, fontFamily: "monospace" }}>{entry.recommendation || "—"}</div>
                          <div style={{ color: entry.outcome === "CORRECT" ? C.green : entry.outcome === "WRONG" ? C.red : C.textDim, fontSize: 9, fontFamily: "monospace" }}>
                            {entry.outcome
                              ? entry.outcome
                              : entry.ts
                                ? (function() {
                                    var msLeft = (entry.ts + GRADE_AFTER_MS) - Date.now();
                                    var dLeft = Math.ceil(msLeft / 86400000);
                                    return dLeft > 0 ? dLeft + "d left" : "GRADING…";
                                  })()
                                : "PENDING"}
                          </div>
                          <div style={{ color: entry.pctMove > 0 ? C.green : entry.pctMove < 0 ? C.red : C.textDim, fontSize: 9, fontFamily: "monospace" }}>
                            {entry.pctMove != null ? (entry.pctMove > 0 ? "+" : "") + entry.pctMove + "%" : "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ marginTop: 10, color: C.textDim, fontSize: 9, fontStyle: "italic" }}>
                  Grading: ACCUMULATE/ADD correct if BTC +2%+ after 5 days. REDUCE/HEDGE correct if BTC -2%+. FLAT if within 2%. Outcome column shows days remaining until graded.
                </div>
              </Card>
            )}

            {/* FOOTER */}
            <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid " + C.border, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace", letterSpacing: 1 }}>
                MAISON TOÉ DIGITAL ASSETS — FOR PROFESSIONAL INVESTORS — NOT FINANCIAL ADVICE
              </span>
              <span style={{ color: C.textDim, fontSize: 8, fontFamily: "monospace" }}>
                Live: Binance · Deribit · Alternative.me · CoinGecko · CoinMetrics · Dune · Farside Investors · Yahoo Finance (BTC=F, DXY, VIX, TNX) · Claude Sonnet
              </span>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}