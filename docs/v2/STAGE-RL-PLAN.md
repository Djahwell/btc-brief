# BTC Brief V2: Stage RL, the longer-horizon indicator study and rating (plan v1.1, 2026-11-06)

*Djahwell, 2026-11-06: "use the data for what it's actually useful for. If the 7-day doesn't work, look at the longer time frame and do the same study. Find what all those indicators indicate and rate it." Stage R (7 days) ended at R1 with no direction signal (STAGE-R1.md). RL repeats the study at 30, 90 and 180 days, then builds ratings only from what qualifies.*

## RL0. Rules fixed before any data is read
1. **Horizons and targets** (measured from D 00:00, entry = close of D−1, Coinbase):
   - **Primary:** the 30-, 90- and 180-day return. For the 90 days ahead: the maximum drawdown (lowest low ÷ entry − 1).
   - **Descriptive only:** the 60-day return.
2. **Periods.**
   - **Design:** 2019-01-01 → 2024-06-30. Rows run up to 2024-06-30 minus the horizon, so every outcome window ends inside the design period.
   - **Hold-out:** 2024-07-01 → 2026-10-31, sealed in code exactly as in Stage R. No indicator row and no bar after the cut-off is loaded.
   - The design period now includes 2019–21, because a long horizon needs more than one market phase.
3. **Honest limits.**
   - 2019–2026 has been seen in aggregate (Stage 4, R1 and the FW1 look), so the hold-out is partly seen.
   - At 180 days the design period holds only about 10 independent windows, and the hold-out about 4. A 180-day effect can only be detected if it is large. **The forward record decides**, as in Stage R.
4. **Testing (fixing the R1 defect).**
   - **p-values:** two-sided circular-shift tests with shifts from h to N − h, where h is the horizon in days. Before any data, the declaration records the smallest possible p for each horizon.
   - **Multiple testing:** Benjamini–Hochberg FDR at 10% within each horizon, over indicators × primary targets. BH replaces BY, because BY's threshold cannot be reached at this resolution (the R1 defect). The decision is recorded here, before any data.
   - **Feasibility check:** if the smallest possible p is still above the first BH threshold for a horizon, that horizon is declared "untestable at this sample size" in advance.

## RL0b. Board check (v1.1) and the feasibility result
**Board: approve with changes.** Applied:
- 180 days is descriptive-only. 90 days is conditional on a power check.
- Every design test is in-sample. Stage 4, R1 and FW1 saw 2019–21 in aggregate, so there is no unseen-regime check.
- Shifts start at max(h, the indicator's Politis–White block). Feasibility uses the effective number of rotations, (N − 2·shift) / shift, not the raw count of shifts.
- Days since halving is descriptive-only: the design period holds only 2 cycles.
- The driver rule gains three conditions:
  - at least 4 effective windows in each half;
  - for past-return indicators, an overlap/autocorrelation check;
  - for drawdown, the partial effect given volatility must be significant.
- Drivers are capped at 3 per horizon.
- RL2–RL4 are tightened:
  - band cut-offs are declared;
  - a White Reality Check over the trials;
  - Bull+ against the rest;
  - benchmarks: the 200-day trend for returns, 30-day volatility for drawdown;
  - frozen loader and runner hashes;
  - display needs at least the same sign on the hold-out;
  - the context table covers every indicator, shows window counts, and is suppressed below 4 windows.

**Feasibility, computed from the indicator series only (no outcome read; `research/rl0-feasibility.js`):**

| Horizon | Design days | Tests | First BH threshold | Smallest possible p (best indicator) | Testable |
|---|---|---|---|---|---|
| 30 d | 1,978 | 33 | 0.0030 | 0.015 | no |
| 90 d | 1,918 | 66 | 0.0015 | 0.049 | no |
| 180 d | 1,828 | 33 | 0.0030 | 0.109 | no |

**Result: under RL0 rule 4, every horizon is untestable as an indicator screen.** The slow indicators take about 100 days each to become independent. Since 2019 that leaves roughly 18–24 independent 30- or 90-day windows and 8 at 180 days. No indicator out of 33 can reach significance on so few. The RL1 driver rule therefore cannot select anything, whatever the data shows. Before any outcome is read, the next step goes back to Djahwell. The options:
- (a) a descriptive map only;
- (b) the descriptive map plus one composite rating per horizon, declared before outcomes and tested as a single hypothesis;
- (c) stop.

## RL1. Indicator study (design only)
- **Indicators:**
  - the 28 indicators from R1;
  - plus 5 slow ones, which are computed from Coinbase bars only:
    - drawdown from the all-time high;
    - past 90- and 180-day returns;
    - days since the last halving (2016-07-09, 2020-05-11, 2024-04-20);
    - distance from the 200-week average.
- **Measures, as in R1:**
  - Spearman correlation with a circular block-bootstrap interval;
  - quintile profiles with intervals;
  - the trend-partial effect (within 200-day trend states);
  - stability by halves of the design period (2019-01 → 2021-09 and 2021-10 → 2024-06);
  - for the drawdown target, the partial effect given volatility.
  - There is no 9-cell condition grid: at long horizons the cells would hold too few independent windows. Conditions are reported only as the 3 trend states.
- **Role rules (mechanical, fixed now):**
  - **Driver** for a horizon:
    - BH-significant for that horizon;
    - the same sign in both design halves;
    - the trend-partial effect has the same sign.
  - **Drop:** everything else.
  - An indicator may be a driver at one horizon and not at another; that is reported.
- **Output:** `STAGE-RL1.md`. For each horizon, the per-indicator table and what each indicator indicates (sign, size, condition), plus a plain-language reading. Board review, then Djahwell.

## RL2. Ratings (design only)
- One rating per horizon that has at least one driver. A rating combines only that horizon's drivers.
- **Combination rules** (declared before RL1 results are seen):
  1. the equal-weight average of the drivers' design-period percentile scores, signed by each driver's sign;
  2. a count of drivers in their favourable top or bottom quintile.
- **Trial budget:** 20, logged with hashes and daily series, as in Stage R. Each candidate must hold its sign in both design halves.
- **Bands:** the same five bands, cut at fixed score levels (as in V2).

## RL3. Hold-out (one run, after Djahwell's "go")
- **Statistic:** top band minus the rest on the horizon return, with a circular-shift p and Holm across horizons.
- **Bands:** means in order across bands with enough independent windows. The minimum number of windows per band, for each horizon, is declared in the RL2 freeze from the design-period block length.
- **Benchmark:** the rating must beat the 200-day trend state alone, as a paired test.
- **Labels:**
  - a pass reads "passed a partly-seen hold-out";
  - too few windows reads "hold-out inconclusive".
- The forward test decides, as for FW1.

## RL4. On the page
- A rating that passes RL3, or is inconclusive there, is shown as **"Untested — long-horizon rating, live check since …"**. Its drivers are listed with what each one currently indicates.
- If nothing qualifies, the page shows the RL1 reading per indicator ("historically, when MVRV was this low, the next 6 months were…") as context, with the honest interval and number of independent windows.
