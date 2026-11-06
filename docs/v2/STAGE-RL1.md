# BTC Brief V2: Stage RL results (RLC-1 test and the long-horizon indicator map), 2026-11-06

*Plan: STAGE-RL-PLAN.md v1.1. Declaration: research/rlc-declaration.json (sha 5f4bcda5…, Board APPROVE WITH CHANGES, changes 1–5 applied before any outcome was read). Data: 2019-01-03 → 2026-10-31 minus horizon, Coinbase daily, history manifest frozen 2026-11-05. Results: research/results/rlc1-result.json, rl-map.json.*

## 1. RLC-1 (valuation + trend composite): FAILED — retired
| Horizon | Spearman | p (s-spaced grid, 21 rotations) | 2019–22 / 2023–26 | C given trend | Valuation alone | Trend (T3) alone |
|---|---|---|---|---|---|---|
| 30 d | +0.12 | 0.64 | +0.15 / +0.07 | +0.11 | +0.07 | +0.02 |
| 90 d | +0.18 | 0.68 | +0.13 / +0.20 | +0.18 | +0.13 | +0.01 |
| 180 d (descriptive) | +0.30 | 0.64 (13 rot.) | +0.24 / +0.37 | +0.30 | +0.23 | +0.02 |

- **Holm result:** not significant at either horizon. Per the declaration, RLC-1 is retired, and no variant will be tested on this history.
- **Why it fails although the sign is right everywhere:** the composite and BTC's returns both move in multi-month cycles. Rotating the composite against the returns produces correlations as large as the real one in about 13 of 21 rotations. Since 2019 there are too few cycles to tell a real link from cycle-on-cycle coincidence.
- **The positive part comes from valuation; the 200-day trend contributes about nothing.**

**Band context** (all five bands, no rating language, per the declaration; the bands are not in order):

| 90 d | Strong fav. | Favourable | Neutral | Unfavourable | Strong unfav. | Always long |
|---|---|---|---|---|---|---|
| Mean return | +25% | +35% | +15% | +12% | +3% | +18% |
| Independent windows | 3.0 | 4.9 | 15.8 | 5.6 | 1.5 | |

| 30 d | Strong fav. | Favourable | Neutral | Unfavourable | Strong unfav. | Always long |
|---|---|---|---|---|---|---|
| Mean return | +8% | +12% | +2.5% | +4% | +8% | +5% |

Every interval overlaps the others.

## 2. What each indicator has indicated (descriptive, 2019–2026)
Quintile means are shown only where a quintile holds at least 4 independent windows; at 180 days none does. No row below is significant after correction; the "p" is the single-indicator s-grid value, uncorrected across 33 indicators.

**A. Valuation / stretch (drawdown from the ATH, distance from the 200-week average, MVRV).**
- **Drawdown from the ATH and the 200-week stretch leaned the same way in both halves: cheaper came before better 90–180 days.**
  - Drawdown from the ATH vs the 90-day return: r −0.26 (halves −0.26 / −0.36).
  - Distance from the 200-week average: r −0.25 at 90 days and −0.44 at 180 days.
- **MVRV leans that way only weakly:** r −0.09 at 90 days, its quintiles are not ordered, and its 30-day halves flip sign.
- **None of these is statistically distinguishable from cycle coincidence:** single-indicator p 0.14–0.77, before any correction across 132 tests.
- **The cheap days come from 2–3 episodes, not many cycles:**
  - drawdown from the ATH: 2019-H1, late 2019 → Apr 2020, Jun 2022 → Sep 2023;
  - 200-week stretch: Mar 2020, Jun 2022 → Oct 2023, Feb → Aug 2026.
- **Count:** about 6 windows of 90 days per quintile, and 2019–2026 holds roughly 1.5 BTC market cycles.

**B. Stretch and volatility vs the next-90-day drawdown.** This is a description, not a finding.
- Far above the 200-week average, the next-90-day worst point averaged −26%, against −11% when close to it (r −0.33, p 0.09).
- Higher ATR also came before deeper drawdowns (r −0.26, p 0.04, uncorrected). At 132 tests, about 5 p-values this low are expected by chance. The volatility link is also mostly mechanical: wider daily ranges produce deeper lows.
- These tell you the size of the swing, not its direction. They repeat the R1 finding at 90 days.

**C. Short-term trend and auction position (E1, distance from the 20- and 50-day averages, value-area position, past 30-day return).**
- A mild positive at 30–90 days (r +0.10 to +0.18): buying strength worked slightly better than buying weakness.
- Almost all of it comes from 2019–22 (r +0.15 to +0.27). Since 2023 it is about 0 to +0.09.
- **Positive in 2019–22, near zero since; never established.**

**D. The 200-day trend (T3, distance and slope from the 200-day average).** About zero at every horizon (|r| ≤ 0.05).

**E. Flow and sentiment (Fear & Greed, funding/premium, Coinbase premium, stablecoin supply, LTH 30-day).**
- Small and unstable; signs often flip between halves.
- LTH 30-day is +0.31 since 2023 but 0.00 in 2019–22.

**F. Days since the halving.** Descriptive only, because there are 2 cycles. Not reported as a finding.

## 3. Reading
- **Direction:** history since 2019 cannot prove any indicator or combination at 30–180 days.
  - There are about 94, 31 and 15 non-overlapping windows at 30, 90 and 180 days.
  - What limits the tests is about 21 effective rotations of slow, cyclical series, within roughly 1.5 market cycles.
- **Valuation:** distance below the ATH and the 200-week stretch leaned the same way, cheaper before better, in both halves. MVRV leaned only weakly. None is distinguishable from cycle coincidence.
- **Risk:** stretch above the 200-week average came before deeper 90-day drawdowns. Volatility did too, but that is largely mechanical.
- **Short-term momentum:** positive in 2019–22, near zero since; never established.

## 4. Board review of this doc (2026-11-06): APPROVE WITH CHANGES, applied
- Corrected: cycle and window counts, MVRV, all five bands shown, multiple-testing note, momentum wording.
- **Page rules, if a context panel is added:**
  - show all three valuation/stretch measures together, never one;
  - lead with the median, range and share of up periods, not the mean;
  - give windows and distinct episodes;
  - label it "descriptive, 2019–26, not a tested rating; not significant after correction";
  - no favourable/unfavourable colour or wording.
- **Dip line:** a lookup by quintile of ONE indicator, labelled "typical 90-day dip at this level, historically"; never a fitted combination.
- **FW1:** the tendency number may be removed from display. Its forward test continues.
