# BTC Brief V2: Stage C, the daily market-condition read (plan v1.1, 2026-11-06)

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

## C5. v1.1: Board check (APPROVE WITH CHANGES), all applied in `engine-v2/condition-declaration.json` (COND-1)
- **Wording and colour:** the words read "supportive / headwind (by convention)", shown in blue and amber hues, never green and red.
- **Evidence:** every row shows its evidence inline, labelled "not a tested link to later price (2019–26)". Missing data shows "no data" and is never counted as neutral.
- **Long-term holders:** shown, not coloured.
- **Leverage:**
  - "crowded long" needs the premium above the 80th percentile **and** open interest rising over 7 days, with funding shown;
  - a low premium with rising OI reads "short-crowded (squeeze fuel)", not coloured.
- **Valuation:** "nearness to the ATH" is signed so that high = expensive, matching the other two measures. Each series' start date is stated.
- **Liquidity:** uses growth against its own trend (engine T4 raw). The flat bands are fixed at 0.25 × the median absolute value.
- **Wording fixes:**
  - Coinbase: "versus its recent norm";
  - auction: 30-day value area;
  - volatility evidence is by volatility state.
- **Structure:** the medium-term trend and auction rows are merged into one structure row.
- **No numeric tally:** a grouped one-line read (Value · Trend · Positioning · Flows · Sentiment) replaces it.
- **The Claude paragraph stays off** until its checker is rebuilt for state words, with a ban on causal and predictive phrases.
- **FW1:** the status line stays; it is still recording.

## C6. Financial condition score (Djahwell, 2026-11-06: "I'd still like a score and a bull or bear signal for the financial reading at that moment")
**Rule (declaration `score`, after the Board build review):**
- **Votes:** one per group (Value, Trend, Flows, Sentiment), each from −1 to +1, taken from the rows' stated conventions.
  - Trend is the mean of the two trend rows, so trend counts once.
  - Flows is the mean of US spot demand and liquidity.
- **Leverage is shown but not scored.** Its headwind state needs open-interest history, which does not exist before Nov 2026, so a scored version could not be described on history (Board defect fix).
- **Score:** the sum × 2.5, on a range of −10 to +10. Quorum: 3 of 4 groups.
- **Bands:**

  | Band name | Score |
  |---|---|
  | Strong bull condition | ≥ 5 |
  | Bull condition | ≥ 2 |
  | Neutral | > −2 |
  | Bear condition | > −5 |
  | Strong bear condition | ≤ −5 |

- **Shown in neutral colours.** All five bands' 2019–26 history is shown side by side.
- **Not tested and has no forward test.** Any later claim about the score needs a new forward declaration, written before the data.

**History 2019–26** (descriptive; `condition-evidence.json`):

| Band | Days | 90-day median | Up | Typical dip | Windows |
|---|---|---|---|---|---|
| Strong bull | 211 | too few (2.3 windows) | | | |
| Bull | 626 | +21% | 65% | −9% | 7.0 |
| Neutral | 1,385 | +1% | 52% | −19% | 15.4 |
| Bear | 448 | +4% | 54% | −19% | 5.0 |
| Strong bear | 99 | too few (1.1 windows) | | | |
| All days | 2,771 | +8% | 58% | −15% | |

**Board build review (PASS WITH CHANGES), applied:**
- leverage removed from the score;
- all-band history table added;
- neutral colours;
- "no history" shown for OI-dependent states;
- episodes shown only when there are at least 2;
- the percentile definition and the 200-week start date disclosed;
- a no-forward-test line added.
