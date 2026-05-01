# BTC Morning Brief — Technical Handoff Brief
**Project:** `BTC_MorningBrief_Nansen_live.jsx`
**Location:** `/BTC Brief Mac/` (user's mounted workspace folder)
**Stack:** React 18 + Vite 5, single JSX file, runs at `localhost:5173` via `npm run dev`
**Branding:** "Maison Toé" (top-left logo and footer)

---

## 1. What This App Does

A daily Bitcoin intelligence dashboard that:
1. Fetches live market, on-chain, macro, and ETF data from ~12 free APIs
2. Builds a structured data prompt and sends it to **Claude Haiku** via Anthropic API
3. Renders the JSON response as a professional briefing with composite buy/sell score, quad-normalized whale signals, ETF flows, macro context, and price structure analysis

---

## 2. File Structure

```
BTC Brief Mac/
├── BTC_MorningBrief_Nansen_live.jsx   ← main component (~2,200 lines)
├── vite.config.js                      ← proxy config for all APIs
├── package.json                        ← React 18.3.1 + Vite 5.4.11
├── index.html                          ← Vite entry, bg #060810
├── src/main.jsx                        ← mounts <MorningBrief />
└── .env                                ← API keys (not committed)
```

### .env keys required
```
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_TIINGO_TOKEN=...          # equity prices only (crypto plan not active)
VITE_NANSEN_API_KEY=...        # present but unused (401, account unfunded)
VITE_DUNE_API_KEY=...          # active, free tier
```

---

## 3. Vite Proxy Config (vite.config.js)

All APIs are proxied server-side so CORS is bypassed and keys never reach the browser.

| Prefix | Target | Auth | Notes |
|--------|--------|------|-------|
| `/api/anthropic` | `api.anthropic.com` | `x-api-key` injected | Claude Haiku synthesis |
| `/api/coinmetrics` | `community-api.coinmetrics.io` | none | Free tier |
| `/api/dune` | `api.dune.com` | `x-dune-api-key` injected | Free tier |
| `/api/coinglass-open` | `open-api.coinglass.com` | none | Kept but 404s |
| `/api/tiingo` | `api.tiingo.com` | `Authorization` injected | Equities only |
| `/api/yahoo` | `query1.finance.yahoo.com` | `User-Agent` spoof | DXY, VIX, TNX, CME BTC=F, QQQ |
| `/api/farside` | `farside.co.uk` | custom UA + Referer kept | HTML scrape of ETF flow table |
| `/api/sosovalue` | `sosovalue.com` | none | ETF flows fallback |

---

## 4. Data Sources — Current Status

### ✅ Working
| Source | Data | How |
|--------|------|-----|
| CoinGecko `/coins/markets` | BTC price, 24h change, volume, market cap | Direct (no auth) |
| CoinGecko `/global` | BTC dominance | Direct |
| Binance `fapi/v1/fundingRate` | Perpetual funding rate | Direct (no auth) |
| Binance `fapi/v1/openInterest` | Open interest in BTC | Direct |
| Binance `PAXGUSDT` 24hr ticker | Gold (XAU) price + 24h change | Direct (no auth, replaces CoinGecko gold which 429s) |
| Binance klines `BTCUSDT 1d 200` | 200-day OHLCV for SMA computation | Direct (no auth) |
| Kraken OHLC | 200-day fallback if Binance fails | Direct |
| Deribit BTC-PERPETUAL | Options 25-delta put/call IV skew | Direct (no auth) |
| Alternative.me | Fear & Greed index | Direct (no auth) |
| **Yahoo Finance `/api/yahoo`** | **DXY (^DXY), VIX (^VIX), 10Y yield (^TNX)** | Via Vite proxy |
| **Yahoo Finance `/api/yahoo`** | **CME BTC=F front-month futures price** (for annualized basis) | Via Vite proxy |
| **Yahoo Finance `/api/yahoo`** | **QQQ 90-day closes** (for BTC-QQQ Pearson correlation) | Via Vite proxy |
| **Farside Investors `/api/farside`** | **Real daily BTC ETF net flows ($M) — HTML table scrape** | Via Vite proxy (Referer kept) |
| CoinMetrics community | Active addresses, Tx count, Hash rate | Via proxy |
| Dune query `3485694` | BTC exchange inflow/outflow (cached Feb-2022) | Via proxy |

### ❌ Permanently Removed (all code cleaned up)
- **Nansen** — 401 Unauthorized (account unfunded, x402 micropayment required)
- **Tiingo crypto** — 403 Forbidden (requires paid crypto plan)
- **Coinglass liquidations** — 404 / no data (endpoints changed)
- **Binance forceOrders** — 401 (now requires auth)
- **CoinGecko gold tokens** — 429 rate limited (replaced by Binance PAXG)

### ⚠️ Known Issues
- **Dune data is stale** — query `3485694` cached result is from Feb-2022. The netflow numbers (~−4 BTC daily net, 335 in / 339 out) are computed as `inflow + outflow` (the `netflow` column is cumulative and not used). This still provides directional signal but is months old.
- **Hash rate** — CoinMetrics community returns it in TH/s. Code uses auto-detect: `> 1e15 → /1e18`, `> 5e7 → /1e6`, else treat as EH/s. Currently displays ~953 EH/s correctly.
- **ETF flows data freshness** — Farside HTML scrape is the most reliable. SoSoValue JSON is a backup. Both are for US spot BTC ETFs (IBIT, FBTC, GBTC, etc.).

---

## 5. Key Functions in JSX

```
fetchAllMarketData()       — price, volume, OI, funding, gold, dominance, options skew, gold, QQQ corr
fetchTechnicalLevels()     — 200-day Binance klines → SMA200/50/20 + realised price proxy
fetchCoinMetricsData()     — free community on-chain: activeAddr, txCount, hashRate, fees
fetchDuneData()            — exchange inflow/outflow via Dune query 3485694
fetchCMEData()             — Yahoo Finance BTC=F futures → annualised basis %, days to expiry
fetchETFFlows()            — Farside HTML scrape → SoSoValue JSON → Yahoo IBIT volume fallback
fetchMacroData()           — Yahoo Finance: ^DXY, ^VIX, ^TNX (1d change each)
generateBrief()            — orchestrates all fetches → builds Claude prompt → parses JSON response
```

### rawFetch vs safeFetch
- `safeFetch(url, opts)` — wraps `fetch` with AbortController timeout, returns parsed JSON, throws on non-2xx
- `rawFetch(url, opts)` — returns raw text (used for Farside HTML scraping)

---

## 6. Claude Prompt Architecture

Claude Haiku (`claude-haiku-4-5-20251001`) receives a structured prompt with:
- Live market data block (price, volume, OI, funding, gold, dominance, options skew)
- Phase status (computed from BTC price vs hardcoded phase boundaries)
- Live SMA block (200d/50d/20d from Binance klines)
- Liquidations block (empty — all sources removed)
- CoinMetrics block (network health)
- Dune block (exchange flows)
- Macro block (DXY, VIX, 10Y yield from Yahoo)
- CME basis block (annualized futures premium)
- ETF live block (Farside/SoSoValue daily flows)
- Feedback/calibration block (stored in localStorage)

Response: JSON with `compositeScore`, `bias`, `headline`, `subHeadline`, `priceAnalysis`, `whaleSignal`, `etfFlows`, `mvrvSignal`, `macroContext`, `normalization`, and more.

**Max tokens:** 7,000 (raised from 5,000 to prevent truncation)
**JSON repair:** `repairJson()` function closes unclosed braces/brackets if response is cut off

---

## 7. How Yahoo Finance Was Wired In

Yahoo Finance provides free public OHLCV via undocumented v8 chart API:
```
GET https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?interval=1d&range=Nd
```

**CORS issue:** Browser can't call Yahoo directly. Fixed via Vite proxy `/api/yahoo` → `query1.finance.yahoo.com` with `User-Agent: Mozilla/5.0` header injected.

**Tickers used:**
- `^DXY` (→ encoded as `%5EDXY`) — US Dollar Index
- `^VIX` (→ `%5EVIX`) — CBOE Volatility Index
- `^TNX` (→ `%5ETNX`) — 10-Year Treasury Note Yield
- `BTC=F` (→ `BTC%3DF`) — CME Bitcoin front-month futures
- `BTC-USD` — spot reference for CME basis calculation
- `QQQ` — Nasdaq ETF for BTC-QQQ 60-day rolling correlation

**CME basis logic:** Fetches front-month `BTC=F` price, computes annualized basis vs spot. If front-month is <14 days to expiry, automatically rolls to second month (e.g. `BTCM25.CME`).

---

## 8. How Farside ETF Flows Were Wired In

Farside Investors (`farside.co.uk/btc/`) publishes a daily HTML table of all US spot BTC ETF creation/redemption flows.

**Challenge:** Farside returns 403 if `Referer` header is stripped (which the standard `noCors` helper does). Fixed with a custom proxy configure that removes `origin` but **keeps** `Referer`.

**Parsing:** `rawFetch` fetches HTML, `DOMParser` parses it, finds the table, locates the `Total` column, reads the most recent non-empty row, and returns `totalUSD` in dollars (values in table are $M).

**Fallback chain:** Farside → SoSoValue JSON → Yahoo Finance IBIT volume (activity proxy, not actual flows).

---

## 9. Running the App

```bash
cd "BTC Brief Mac"
npm install        # first time only
npm run dev        # starts at localhost:5173
```

Open `localhost:5173` in Safari (tested) or Chrome.
Hit **REFRESH** button to generate a new brief (~45–65 seconds).

---

## 10. What Could Be Improved Next

1. **Dune data freshness** — Find an actively-maintained Dune query for BTC exchange flows (query 3485694 cache is from Feb-2022). Could also trigger a fresh execution using the free 10 credits/month.
2. **MVRV / SOPR** — Still estimated by Claude from training knowledge. No free live source found yet. Glassnode has a free tier worth investigating.
3. **Liquidations** — All current free sources are broken. CoinGlass changed their API. Binance forceOrders now requires auth.
4. **ETF flows** — Farside scrape is fragile (HTML table structure could change). SoSoValue JSON is a more robust backup.
5. **Accuracy tracking** — `localStorage` stores past brief grades. Currently shows "insufficient history" because it's a fresh Mac setup.

---

*Generated April 2026 — Maison Toé Digital Assets*
