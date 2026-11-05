# BTC Brief V2: Stage 4 declaration (v1.2, frozen 2026-11-05)

*Charter rule 7. Everything the Stage 4 test may use is fixed here before anything runs. Sections A–G are STAGE4-PLAN v1.2 §2–§8 verbatim. Any change after the freeze is a new declaration, logged as a new trial. Nothing has been run on outcomes.*

## Identity (what is frozen)

| Item | Value |
|---|---|
| Engine declaration file | `engine-v2/declaration.json` (full text in §H) |
| declarationHash (sha256 of JSON.stringify(JSON.parse(file)), embedded in every snapshot) | `f241978d70ea0d7c6af12a96b8552d2cfa4a322798b5411fba014ff4f4207287` |
| File bytes sha256 | `824819ddf320b1b41b71a296af50d99f991789243ba55d0d50662cb181faebc1` |
| Engine code hash (engine.js + view.js + live.js) | `ac6b50ffff8ac210cfebd7efde4b37e71076d2a0ecc507aeb14e95cbb143e022` |
| Repository commit | engine and declaration: `efab720`; harness and §K: see §J |
| Harness code (frozen, `stage4/frozen.json`) | stats.js `7345f926…`, harness.js `b0e4e4a0…`, run.js `4aff5491…`; frozen.json `ccff511d…` |
| History set | `v2-data` manifest generated 2026-11-05T13:08:55Z (sha256 per file in §I) |

## Trial ledger (charter rule 7)

| # | Trial | Read | Status |
|---|---|---|---|
| 1 | V-E1/E6a (primary entry) | entry | declared, not run |
| 2 | V-E1/E6b | entry | declared, not run |
| 3 | V-E2/E6a | entry | declared, not run |
| 4 | V-E2/E6b | entry | declared, not run |
| 5 | V-T1/T2+ (primary tendency) | tendency | declared, not run |
| 6 | V-T1/T2− | tendency | declared, not run |
| — | Sensitivities (not trials, not selectable): tendency without T2; lag +1 day on every non-price input; block lengths 10/40/60; robustness sign check 2019-01 → 2021-05 | | declared |

## A. Evaluation time and point-in-time rules (the same rules the live engine applies)
- **Evaluation time:** each day D at the frozen-snapshot moment (Stage 3 §6). For reconstruction, all inputs are cut at **D 00:00 UTC** using the publish lags below. Every value used was public before D 00:00, so the entry price is the bar closing at D 00:00.
- **Publish lags (conservative; the engine uses the latest value with `asOf` ≤ D − lag):**

| Family | Input | Lag rule at D 00:00 |
|---|---|---|
| E1, E2, E6, T3 | Coinbase daily bars | bars up to and including D−1 (closed at D 00:00) |
| E3a | Binance premium index 1h | 8 h mean of the 8 completed hours ending D 00:00 |
| E5a | Coinbase premium legs 1h | 24 h median of the completed hours ending D 00:00; z against the 30 prior completed days |
| E7 | Fear & Greed | value dated **D−1** |
| T1 | CoinMetrics MVRV | value dated **D−2** |
| T2 | BMP LTH supply | value dated **D−2** (revision look-ahead flagged) |
| T4 | DefiLlama USDT+USDC | value dated **D−2** (revision look-ahead flagged) |

- **Lag sensitivity:** the whole test is re-run with every non-price lag +1 day and reported. It is not a selection criterion.

## B. Engine constants (declared)
- **Percentile:** rank of the reading against one reference value per day strictly before D (expanding from 2018-01), mid-rank for ties, minimum 365 reference days. **Mapping:** percentile p in [25, 75] → 0; p > 75 → +10 × (p − 75)/24, capped at +10 at p ≥ 99; p < 25 → −10 × (25 − p)/24, capped at −10 at p ≤ 1. The sign is inverted for contrarian families.
- **E1:** a = (close − SMA20)/ATR14 and b = (close − SMA50)/ATR14, each mapped by percentile; slope = (SMA20 today − SMA20 5 bars earlier)/ATR14 today, mapped by percentile. E1 = round(mean of the 3 mapped scores). ATR14 is Wilder's average true range on daily bars.
- **Bars (all bar families and the E3a trigger):** Coinbase daily bars; the last 400 bars must be consecutive days, otherwise these families are withheld.
- **E2 (v1.2, V1's actual method):** value area = 70% of volume around the POC, on the last 30 daily bars, with **80 equal price bins over the 30-bar high–low range** (V1 `scripts/amt.js`; the earlier "0.25% bins" and "7-day short profile" were not V1's method and are dropped). VAH/VAL rounded to whole dollars. Volume is spread evenly across each bar's high–low range, using Coinbase + Bitstamp volume; **both volume legs are required for every bar in the window**, else E2 is withheld. States, signed scores:
  - accepted above VAH (2 of the last 3 closes above): +6
  - testing above VAH (not accepted): 0 (as V1)
  - failed auction low: +4
  - inside value: 0
  - failed auction high: −4
  - testing below VAL (not accepted): 0 (as V1)
  - accepted below VAL: −6

  Then ±1 for each additional accepting close, capped at ±8.
- **E3a (v1.2):** reading = mean of the **8 completed hourly closes** of the Binance BTCUSDT premium index ending at the evaluation hour (D 00:00 for the test and the frozen daily record). References: one per day, the same mean ending at that day's 00:00. Contrarian: p > 75 → negative (froth). Below p 25 it scores positive only if the lowest close of the last 3 days is above the lowest close of the prior 7 days (the "stopped making lows" trigger); otherwise 0. If the daily bars needed for the trigger are stale, E3a is withheld.
- **E5a:** z = (median of the 24 completed hourly USDT-adjusted premiums in the window ending at the evaluation hour − mean of the 30 prior UTC-day medians) / population sd; a day counts with ≥ 20 hours, ≥ 25 days needed. Score = clamp(round(z × 10/3), −10, +10).
- **E7:** F&G ≤ 25 → +10 × (25 − F&G)/20, capped at +10 at ≤ 5; F&G ≥ 75 → −10 × (F&G − 75)/20, capped at −10 at ≥ 95; otherwise 0.
- **E6:** 30-day realised volatility = sample sd (n − 1) of daily log returns × √365, percentile; top decile = p ≥ 90.
- **T1:** MVRV percentile, contrarian (low = positive).
- **T2:** percentile of the 30-day LTH change in BTC/day on the calendar ((v(d) − v(d′)) / days, d′ = latest BMP row on or before d − 30, span ≤ 35 days; the BMP trace has missing days). Sign + (accumulation = positive) and sign − are separate trials. BMP dates come from price alignment; about 24% of points match a neighbouring day almost as well, so **T2 is treated as look-ahead-exposed** and relies on its 2-day lag and the lag+1 sensitivity run.
- **T3:** (close − SMA200)/ATR14 and (SMA200 today − SMA200 20 bars earlier)/ATR14, each mapped by percentile, mean, rounded.
- **T4:** on the calendar: g(d) = v(d)/v(d − 30) − 1; x(d) = g(d) − median of g over (d − 365, d − 1], at least 300 values; x mapped by percentile.
- **Scorecards:** mean of the active family scores, rounded half away from zero. Quorum 4/5 (entry: E1, E2, E3a, E5a, E7) and 3/4 (tendency: T1–T4); below quorum the day is **withheld**.
  - **E6 variant (a):** warning only.
  - **E6 variant (b):** in the top decile, score = round(score / 2).
  - **V-E2:** if E1 < 0, the entry score is capped at +2. V-E2 needs E1 active, otherwise withheld.
  - **Order:** mean of active families → round half away from zero → V-E2 cap → round → E6b halving → round → clamp ±10 → band.
  - **Robustness card** (used only in the robustness window): E1, E2, E7 at quorum 3/3, computed by the shared engine.
- **Freshness:** a daily input is used only if its latest usable value is dated at most 1 day before D − lag (one missed publication tolerated); otherwise its family is withheld. A non-finite family score counts as withheld.
- **Bands:** ≥ +6 Strong bull; +3…+5 Bull; −2…+2 Neutral; −5…−3 Bear; ≤ −6 Strong bear.

## C. Outcomes (shared with the live track record)
- **Entry price:** Coinbase close of bar D−1 (time D 00:00 UTC).
- **7-day return:** close of bar D+6 ÷ entry − 1.
- **7-day MAE:** lowest low of bars D…D+6 ÷ entry − 1.
- **Tendency:** daily strategy returns with exposure 1 (long) or 0 (flat), and 10 bp cost per switch.
- **Withheld days:** excluded from every group; counted and reported. More than 10% withheld in a window → flagged.

## D. Candidates, windows and the trial ledger
- **Entry (4 trials):** V-E1/E6a, V-E1/E6b, V-E2/E6a, V-E2/E6b.
- **Tendency (2 trials):** V-T1 with T2 sign +, V-T1 with T2 sign −.
- **Sensitivity reports (not trials, not selectable):** tendency without T2 (T1, T3, T4, quorum 3/3); the lag+1 run; block lengths 10/40/60 days.
- **Windows (D-10, warm-up applied):**
  - **Main:** 2021-06-01 → 2026-10-31, all 5 entry families warm. E3a is warm from 2021-01; E5a has a z from 2021-06.
  - **Robustness (non-overlapping):** 2019-01-01 → 2021-05-31 with E1, E2, E7 (quorum 3/3). It is a **sign check only**: same sign → "consistent"; opposite sign → flagged "unstable" and reported to Djahwell. It is not a pass criterion.
- **Primary candidates for the screen (declared):** V-E1/E6a and V-T1/T2+. If the primary fails and another candidate passes, Djahwell decides; there is no silent switch.

## E. Tests and pass criteria (one-sided, in the declared direction)
- **Null model:** circular shift of the score series against the outcome series, with every shift of at least 60 days (all admissible shifts), so the score's own persistence is kept. p = share of shifts whose statistic ≥ the observed one.
- **Confidence intervals:** circular block bootstrap with the block length chosen by the Politis–White rule on the score series (floor 20 days), 10,000 replications, seed 20261105.
- **Independent episodes:** an episode is a run of consecutive days in the same band. Counts are reported per band. **Any band with fewer than 30 episodes is "insufficient"**; a criterion needing that band fails.
- **Entry, for each candidate (Holm correction across all entry hypotheses: 4 candidates × H1–H2 = 8):**
  - **H1:** mean 7-day return of Bull+ days minus non-Bull+ days > 0 (circular-shift p).
  - **H2 (adds to trend):** the same difference exceeds E1-alone's difference on the same dates (paired, circular-shift p on the difference).
  - **C3 (risk):** the upper 95% CI of (Bull+ MAE − non-Bull+ MAE) is below +0.5 percentage points (Bull+ entries are not materially deeper underwater).
  - **C4 (beats a persistent random score):** H1 is the circular-shift test, so this is covered: the shifted score is the block-shuffled baseline, done properly.
  - **C5 (strength):** band means are non-decreasing across every band with ≥ 30 episodes, **and** Spearman(score, 7-day return) > 0 with circular-shift p < 0.05.
  - **PASS** = H1 and H2 significant after Holm (α = 0.05), and C3 and C5 hold. If C5 fails alone, the band label is shown **without** the number (DESIGN §6).
- **Tendency, for each candidate:**
  - **Exposure rule:** long when the tendency score ≥ +3, flat otherwise.
  - **Segments**, cut at the halving dates:
    - S1: 2019-01-01 → 2020-05-10
    - S2: 2020-05-11 → 2024-04-19
    - S3: 2024-04-20 → 2026-10-31
  - Each segment is evaluated on its own days only.
  - **PASS** = in every segment, the return/max-drawdown ratio of the rule exceeds both "always long" and the 200-day rule (long above a rising SMA200, flat otherwise, same costs).
  - The label is at most **"in-sample consistent"** (about 3–8 independent half-years per segment); otherwise the score is "descriptive" permanently.

## F. If nothing passes (declared now)
- A failed candidate is retired, never tuned and re-run on this history (it is now spent).
- **Entry fails:** the screen shows the family bars and states but no entry score ("descriptive mode").
- **Tendency fails:** the tendency scorecard is descriptive, with family bars and no score.
- Any new candidate can be validated **only forward**, in the Stage 5 shadow, with its own declaration.

## G. Relevance to Maison Toé (descriptive, run once, after the main test)
- **Trades:** the V4 Stage 3 replay box and trend twin trades (on Djahwell's Mac, staged with his OK), **restricted to the main window** (2021-06 → 2026-10).
- **Point-in-time:** the engine is evaluated at each signal time t, using the §2 lag rules relative to t. Daily families use the bars closed before t; E3a uses the 8 completed hours before t; E5a uses the completed hours before t.
- **Report:** 3 bands (≤ −3, −2…+2, ≥ +3), each with count, average R, win rate and a 95% interval from a bootstrap clustered by trade day. Plus Spearman(score, R), and **E1-alone reported alongside**, because E1 overlaps the bot's own trend condition and part of any link can be mechanical. Box and trend are reported separately.
- **Caveat stated in the report:** the replay period was also V4's research period (all of 2020–2026 has been seen).
- Any later change to the score counts as a new trial against this test too. A bot filter would be a separate V4 candidate.


## H. Engine declaration file (verbatim)

```json
{
  "schema": "brief-v2-declaration/1",
  "status": "STAGE 4 DECLARATION v1 \u2014 frozen 2026-11-05 (STAGE4-DECLARATION.md records this file's hash). Any change = a new declaration and a new trial.",
  "referenceStart": "2018-01-01",
  "warmupDays": 365,
  "percentileMap": {
    "zeroLow": 25,
    "zeroHigh": 75,
    "fullLow": 1,
    "fullHigh": 99,
    "max": 10
  },
  "lagsDays": {
    "daily_bars": 1,
    "fear_greed": 1,
    "mvrv": 2,
    "lth": 2,
    "stablecoins": 2
  },
  "staleGraceDays": 1,
  "staleGraceNote": "A daily input is active when its latest usable value is dated at most staleGraceDays before D \u2212 lag (one missed publication tolerated). Daily bars: last bar \u2265 D \u2212 1 \u2212 staleGraceDays.",
  "barsContiguousDays": 400,
  "barsNote": "Bar families (E1, E2, E6, T3) and the E3a trigger use row windows on Coinbase daily bars; the last 400 bars must be consecutive days, else these families are withheld. Daily-input staleness is date-based (lag + grace), not staleAfterSec.",
  "e1": {
    "sma": [
      20,
      50
    ],
    "atr": 14,
    "slopeLookback": 5,
    "note": "Each part mapped by percentile separately, then E1 = round(mean of the 3 mapped scores). Slope = (SMA20 today \u2212 SMA20 5 bars earlier) / ATR14 today. ATR = Wilder."
  },
  "e2": {
    "profileDays": 30,
    "bins": 80,
    "valueAreaPct": 0.7,
    "acceptCloses": 2,
    "acceptWindow": 3,
    "probeWindow": 5,
    "scores": {
      "IMBALANCE_UP": 6,
      "TESTING_VAH": 0,
      "FAILED_AUCTION_LOW": 4,
      "BALANCE": 0,
      "FAILED_AUCTION_HIGH": -4,
      "TESTING_VAL": 0,
      "IMBALANCE_DOWN": -6
    },
    "extraClosePoint": 1,
    "cap": 8,
    "note": "V1 scripts/amt.js method verbatim: 80 equal bins over the 30-bar high-low range (STAGE4-PLAN \u00a73 text said 0.25% bins \u2014 corrected to V1's actual method), VAH/VAL rounded to whole dollars, price = close of bar D\u22121 (V1 used live spot). TESTING_VAH/VAL score 0 as in V1 ('no accepted directional edge yet'). Flagged for the Board check."
  },
  "e3a": {
    "windowHours": 8,
    "triggerRecentDays": 3,
    "triggerPriorDays": 7,
    "note": "Reading = mean of the 8 completed hourly closes of the Binance BTCUSDT premium index, ending at the evaluation hour (D 00:00 for the backtest and the frozen daily record; the last completed hour for intraday display). References = one per day, the same mean ending at that day's 00:00. Below p25: positive only if min(last 3 closes) > min(the 7 closes before); if daily bars are stale the family is withheld."
  },
  "e5a": {
    "zFull": 3,
    "note": "z = (median of the 24 completed hourly USDT-adjusted premiums ending at the evaluation hour \u2212 mean of the 30 prior UTC-day medians) / population sd; a day counts with \u2265 20 hours; \u2265 25 days needed. Score = clamp(round(z \u00d7 10/3), \u00b110)."
  },
  "e6": {
    "rvDays": 30,
    "topDecilePct": 90,
    "note": "30-day realised volatility = sample standard deviation (n \u2212 1) of daily log returns \u00d7 \u221a365, percentile against all prior days; not a vote."
  },
  "e7": {
    "fearAt": 25,
    "fearFull": 5,
    "greedAt": 75,
    "greedFull": 95
  },
  "t1": {
    "contrarian": true
  },
  "t3": {
    "sma": 200,
    "atr": 14,
    "slopeLookback": 20,
    "note": "Parts: (close \u2212 SMA200)/ATR14 and (SMA200 today \u2212 SMA200 20 bars earlier)/ATR14, each mapped by percentile, then round(mean)."
  },
  "t4": {
    "growthDays": 30,
    "medianDays": 365,
    "minMedianDays": 300,
    "note": "Calendar-based: g(d) = v(d)/v(d\u221230) \u2212 1 and x(d) = g(d) \u2212 median g over (d\u2212365, d\u22121] (\u2265 300 values); x mapped by percentile."
  },
  "scorecards": {
    "entry": {
      "families": [
        "E1",
        "E2",
        "E3a",
        "E5a",
        "E7"
      ],
      "quorum": 4
    },
    "tendency": {
      "families": [
        "T1",
        "T2",
        "T3",
        "T4"
      ],
      "quorum": 3
    },
    "bands": [
      {
        "min": 6,
        "name": "Strong bull"
      },
      {
        "min": 3,
        "name": "Bull"
      },
      {
        "min": -2,
        "name": "Neutral"
      },
      {
        "min": -5,
        "name": "Bear"
      },
      {
        "min": -10,
        "name": "Strong bear"
      }
    ],
    "e2CapWhenTrendNegative": 2,
    "modifierOrder": "mean of active families \u2192 round half away from zero \u2192 [V-E2: if E1 < 0, min(score, +2); V-E2 needs E1 active, else withheld] \u2192 round \u2192 [E6b: if E6 top decile, score / 2] \u2192 round \u2192 clamp \u00b110 \u2192 band",
    "robustness": {
      "families": [
        "E1",
        "E2",
        "E7"
      ],
      "quorum": 3,
      "note": "Robustness window 2019-01-01 \u2192 2021-05-31, sign check only (STAGE4-PLAN \u00a75)."
    }
  },
  "candidates": {
    "entry": [
      "V-E1/E6a",
      "V-E1/E6b",
      "V-E2/E6a",
      "V-E2/E6b"
    ],
    "tendency": [
      "V-T1/T2+",
      "V-T1/T2-"
    ],
    "primary": {
      "entry": "V-E1/E6a",
      "tendency": "V-T1/T2+"
    }
  },
  "hashNote": "declarationHash = sha256 of JSON.stringify(JSON.parse(file)) (not of the file bytes)."
}
```

## I. Inputs: history set and family availability

History files (`v2-data/v2/history`, manifest 2026-11-05T13:08:55Z):

| File | sha256 (first 16) |
|---|---|
| coinbase_daily | 02cd9f62481d91fc |
| bitstamp_daily | 12eec185602b30ff |
| coinbase_premium_legs_1h | 6990af70101f1b38 |
| binance_premium_index_1h | 3c63d57e4bcb5714 |
| binance_funding | 6d0f4b9a73d88942 (not used by any family) |
| fear_greed | d6cadb301415e581 |
| coinmetrics_mvrv | cc89c193a1708715 |
| bgeometrics_realized | 0b448e2a581d848f (not used by any family) |
| stablecoins_usdt_usdc | 5fdc7a5d998c3be5 |
| bmp_lth | e061cc660a11ff70 (dated by price alignment; median error 0.11%) |

Family availability, measured on every 10th day (count of sampled days where the family or card is active; no outcomes looked at):

| Window | Sampled days | E1 | E2 | E3a | E5a | E7 | T1 | T2 | T3 | T4 | Entry card | Tendency card | Tendency without T2 | Robustness card |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2019-01-01 → 2020-05-10 (robustness, S1) | 50 | 49 | 50 | 0 | 0 | 50 | 49 | 49 | 49 | 20 | 0 | 49 | 20 | 49 |
| 2020-05-11 → 2021-05-31 (robustness, S2 head) | 39 | 39 | 39 | 10 | 0 | 39 | 39 | 39 | 39 | 39 | 10 | 39 | 39 | 39 |
| 2021-06-01 → 2026-10-31 (main; S2 tail + S3) | 198 | 198 | 198 | 191 | 198 | 198 | 198 | 198 | 198 | 198 | 198 | 198 | 198 | 198 |

Consequences, declared now:
- **Entry** is tested only in the main window (all five families warm). E3a is withheld on a few main-window days (Binance archive gaps, e.g. July 2021); quorum 4/5 keeps the card active, and those days are counted.
- **Tendency in S1:** T4 is warming up for most of S1, so the tendency card runs on T1, T2 and T3 (quorum 3/4) there. The **no-T2 sensitivity is withheld for most of S1** and is reported for S2 and S3 only.
- **Robustness card** (E1, E2, E7, quorum 3/3) is active through the whole robustness window.
- The first sampled day (2019-01-01) is one day short of the E1 warm-up and is withheld.

## K. Clarifications (Board check of v1, all additions; the engine declaration file and its hash are unchanged)

1. **Harness frozen.** The test is run only by `stage4/run.js` with `stage4/harness.js` and `stage4/stats.js`. Their sha256, the engine files' sha256 and the history set are listed in `stage4/frozen.json`; the runner refuses to start if any differs, or if `stage4/GO` does not contain the declarationHash (Djahwell's "go").
2. **Main window end = 2026-10-29.** The last bar in the frozen set is 2026-11-04, so the last day with a complete 7-day outcome (bar D+6) is 2026-10-29. Outcomes use only bars from the frozen set.
3. **Tendency backtest:**
   - exposure is decided at D 00:00 from the score at D and earns ln(close D / close D−1) (Coinbase);
   - **withheld days are flat** (no score, no position);
   - every strategy starts flat at the segment start and pays 10 bp (0.001 log) per switch, so "always long" pays one entry;
   - ratio = total log return over the segment ÷ maximum drawdown of the equity curve exp(cumulative log return) (fraction); a zero drawdown gives ±∞ by the sign of the return;
   - **a segment passes only if** the rule's ratio beats both benchmarks **and** is above 0 **and** the rule is long on at least 10% of the segment's days (a never-long or mostly withheld rule cannot pass by staying flat through a falling market);
   - 200-day rule: long at D 00:00 when close(D−1) > SMA200(D−1) **and** SMA200(D−1) > SMA200(D−21) (20 bars, as T3), Coinbase closes.
4. **Episodes.** For H1, H2 and C3 the two groups are Bull+ (score ≥ +3, Bull and Strong bull merged) and non-Bull+; an episode is a maximal run of consecutive evaluated days in the same group, and a withheld day ends a run. **Both groups need ≥ 30 episodes**, else the candidate fails. For C5 the five bands are counted separately; **C5 needs at least two bands with ≥ 30 episodes** (fewer = C5 fails), and the means must be non-decreasing across those bands in order.
5. **Statistics.**
   - circular shift: every k in [60, N − 60] (one rotation direction covers both, modulo N); the zero shift is not in the null; p = (1 + #{stat_k ≥ observed}) / (1 + #shifts);
   - block length: Politis–White (circular bootstrap, 2009 correction) on **each candidate's own score series** (withheld days removed), rounded up, floor 20;
   - C3 upper bound = 97.5th percentile of 10,000 circular-block replicates (seed 20261105, PRNG mulberry32), margin +0.5 percentage points;
   - H2 comparator: E1-alone with the same Bull+ threshold (≥ +3), on days where both are scored; both score series are rotated together.
6. **Robustness sign check.** Statistic: the H1 difference (Bull+ ≥ +3 minus the rest, 7-day return) of the robustness card (E1, E2, E7 at 3/3) over 2019-01-01 → 2021-05-31, compared in sign with the primary candidate's main-window H1 difference. Same sign → "consistent", opposite → "unstable" (reported, not a pass criterion).
7. **Lag +1 run.** `lagsDays` overrides: fear_greed 2, mvrv 3, lth 3, stablecoins 3. Daily bars, E3a and E5a unchanged; the grace rule (1 day) unchanged.
8. **No rescue of a failed candidate.**
   - Only the history set in §I may be used. A re-run on a rebuilt or revised history (BMP, DefiLlama, MVRV, any file) is a new trial.
   - **Entry preference order, declared:** V-E1/E6a, then V-E1/E6b, then V-E2/E6a, then V-E2/E6b. If several pass, the first in this order is the one shown; Djahwell is told about all of them.
   - **T2 look-ahead exposure:** a tendency PASS that turns into FAIL in the lag +1 run is labelled "lag-sensitive" and shown as descriptive only.
   - The only partial outcome is C5 failing alone (band label shown without the number).
9. **Availability.** The table in §I uses every 10th day; the full count over all days is attached before the run (§L), still without any outcome. Withheld shares above 10% in a window or segment are reported (`withheldShare`, `withheldFlag`) and not acted on.
10. **Naming.** `scorecards.tendency.families` in the declaration file lists "T2"; the engine runs the two declared trials as T2+ and T2− (the `V-T1/T2+` and `V-T1/T2-` cards). The file is left unchanged so its hash stays valid.

## J. Freeze record
- Frozen by the builder on 2026-11-05 after the Stage 3 build review (PASS WITH CHANGES, all items closed).
- Board check of v1: CHANGES REQUIRED (10 items, all additions) → §K and the frozen harness added (v1.1). Board check of v1.1: pending.
- Stop-gate: the test runs only after Djahwell answers "go" to the run list (6 trials, the sensitivities, the Maison Toé relevance report). The Maison Toé trades are on Djahwell's Mac (`CryptoBrain/maisontoe/v4/engine/runs/`); staging them needs his OK.
