# BTC Brief V2: Stage C, the daily market-condition read (plan v1.0, 2026-11-06)

*Djahwell, 2026-11-06: "The tool should indicate what the market condition is for BTC regardless of its immediate direction. I want a solid financial glimpse each day of where it stands and what the figures mean. Sometimes all indicators will be green and one whale drives it the other way. I don't mind, as long as the supporting evidence is sound and the interpretation makes sense."*

**What changes:** the brief stops trying to predict and starts describing. Stages 4, R and RL showed that free daily data cannot forecast BTC's direction on history. What the data can do is state, accurately and with its history attached, where BTC stands on each financial dimension. "Green" means a dimension's own figures are supportive by standard financial reading. It does not mean "price will rise", and the page says so.

## C0. Rules fixed before building
1. **No new forecasts.**
   - No score is called a rating.
   - No colour is fitted to outcomes: every state threshold and every supportive/headwind convention below is set from financial logic, here, before build.
   - Historical evidence is shown next to each state, as fact. Where none was found, the page says "no reliable link to later price found (2019–26)".
2. **Percentiles** are point-in-time, on an expanding window from the start of each series (the engine's existing method; warm-up 365 days).
   - State bands: < 20 low; 20–40 below average; 40–60 middle; 60–80 above average; > 80 high.
3. **Evidence lookup** (Board RL rules):
   - for the current state: the median and the 10th–90th percentile range of the next 90-day return, the share of up periods, the typical 90-day dip, the number of independent windows and the distinct episodes;
   - medians and ranges, not means;
   - suppressed below 4 windows;
   - generated once from 2019–26 into a frozen file, with its sha and date shown.
4. **Tally header:** "Today: N supportive · N neutral · N headwind". It is a count of states, not a score, and it is followed by the sentence "This describes conditions, not the next move."
5. **The live = backtest rule is kept:** the same `condition.js` runs in the browser, on the VPS and in research.

## C1. Dimensions, readings, states and conventions

| # | Dimension | Reading (source) | States | Convention: supportive / headwind |
|---|---|---|---|---|
| 1 | **Valuation** | MVRV pct (CoinMetrics), distance from 200-week average pct, drawdown from ATH pct. Combined = median of the 3 percentiles | Cheap < 20 · Below avg · Fair · Rich · Stretched > 80 | Cheap / below avg supportive; rich / stretched headwind (paying less than holders' average cost) |
| 2 | **Long-term trend** | close vs 200-day average, 200-day slope over 20 days | Uptrend (above and rising) · Downtrend (below and falling) · Transition | Up supportive, down headwind |
| 3 | **Medium-term trend** | close > SMA20 > SMA50, SMA20 rising 5 days (FW1 base rule) | Uptrend · Downtrend · Mixed | as above |
| 4 | **Auction / structure** | E2 state (value area of the last 20 days) | Accepted above value · Inside value · Accepted below value · Failed auction (high or low) | Above supportive, below headwind; failed auctions flagged |
| 5 | **Leverage** | Binance perp premium 8 h, pct (E3a) | Shorts paying < 20 · Normal · Crowded long > 80 | Crowded long is a headwind (fragile, liquidation fuel); shorts paying is supportive |
| 6 | **US spot demand** | Coinbase premium, 30-day z (E5a) | Paying up ≥ +1 · Normal · Discount ≤ −1 | Paying up supportive, discount headwind |
| 7 | **Long-term holders** | LTH supply net change over 30 days (bitcoinmagazinepro) | Adding · Flat · Distributing | Adding supportive, distributing headwind (note shown: distribution is normal into strength) |
| 8 | **Liquidity** | USDT + USDC supply change over 30 days | Growing · Flat · Shrinking | Growing supportive, shrinking headwind |
| 9 | **Sentiment** | Fear & Greed | Extreme fear ≤ 25 · Fear · Neutral · Greed · Extreme greed ≥ 75 | Contrarian: extreme fear supportive, extreme greed headwind |
| 10 | **Volatility / risk size** | 30-day realized vol pct, ATR % of price | Calm < 20 · Normal · Elevated > 80 | Not coloured. Shows the typical 90-day dip at today's 200-week-stretch quintile |
| 11 | **Event risk** | existing panel (FOMC, CPI, payrolls, expiries) | Event within 48 h / none | Not coloured |

- "Flat" bands for 7 and 8 are set at ±0.25 × the series' own median absolute 30-day change, fixed here.
- Each state carries one fixed sentence, written now, saying what the figure means; for example, "Holders are on average sitting on large unrealised gains; historically these are periods when long-term holders sell into strength."

## C2. The daily read
- **Code summary (D-6), every refresh:** one line per dimension in fixed order, then the tally. For example: "BTC trades in a long-term uptrend, valued rich against its history (MVRV 78th pct). Leverage is crowded and US spot buyers are at a discount. Holders are distributing; stablecoin liquidity is growing. Sentiment: greed. Volatility normal; typical 90-day dip at this stretch about −18%."
- **Claude paragraph (D-6), at most once a day:**
  - It is turned on for this read, and it interprets only the numbers on the page.
  - The existing checker refuses forecast words and any number not on the page.
  - Its prompt asks what the combination means (for example, "strong trend but crowded leverage = fragile"), never where price goes.

## C3. On the page
- **Top:** the tally header, then the 11 dimension rows (state chip, reading, percentile bar, meaning sentence, an expandable evidence row).
- **The Entry/Tendency cards are removed from display.** FW1 keeps recording and its forward test continues (FORWARD-FW1.md); the track panel says so.
- Data health, levels, events and every value stay as they are.

## C4. Tests and checks
- `condition.js` golden tests: synthetic, plus real pinned dates.
- Parity between page and VPS.
- A test that the evidence file sha matches.
- Checker tests for the Claude paragraph.
- A Board build review before deploy, then a VPS package (v1.2) with test, install and rollback steps, so the frozen daily record carries the condition states for the live log.
