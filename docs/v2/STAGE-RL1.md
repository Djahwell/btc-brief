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

**Band context (no rating language, per the declaration):**
- 90-day mean return:
  - favourable band: +35%, 4.9 independent windows, interval +12…+70;
  - neutral: +15%;
  - unfavourable: +12%;
  - always long: +18%.
- Every band's interval overlaps the others.

## 2. What each indicator has indicated (descriptive, 2019–2026)
Quintile means are shown only where a quintile holds at least 4 independent windows; at 180 days none does. No row below is significant after correction; the "p" is the single-indicator s-grid value, uncorrected across 33 indicators.

**A. Valuation / stretch (MVRV, distance from the 200-week average, drawdown from the all-time high).** This is the most consistent pattern in the data.
- **Cheaper meant better next 90–180 days.** The sign is the same in both halves for all three indicators.
  - Drawdown from the ATH vs the 90-day return: r −0.26. When BTC was deepest below its high (bottom fifth), the next 90 days averaged +36%; when it was nearest its high (top fifth), +7%.
  - Distance from the 200-week average vs the 180-day return: r −0.44.
- **Stretched also meant deeper dips.** Far above the 200-week average, the next-90-day worst point averaged −26%, against −11% when close to it (r −0.33, p 0.09). The drawdown-from-ATH halves are −0.33 / −0.29.
- **Strength:** about 6–8 market cycles. The pattern is consistent but statistically unproven (p 0.14–0.57).

**B. Volatility (ATR, realized-volatility percentile).**
- Higher volatility meant a deeper next-90-day drawdown: ATR r −0.26, p 0.04 uncorrected, both halves negative.
- This is the R1 finding again, now at 90 days.
- It tells you the size of the swing, not its direction.

**C. Short-term trend and auction position (E1, distance from the 20- and 50-day averages, value-area position, past 30-day return).**
- A mild positive at 30–90 days (r +0.10 to +0.18): buying strength worked slightly better than buying weakness.
- Almost all of it comes from 2019–22 (r +0.15 to +0.27). Since 2023 it is about 0 to +0.09.
- **A momentum effect that has faded.**

**D. The 200-day trend (T3, distance and slope from the 200-day average).** About zero at every horizon (|r| ≤ 0.05).

**E. Flow and sentiment (Fear & Greed, funding/premium, Coinbase premium, stablecoin supply, LTH 30-day).**
- Small and unstable; signs often flip between halves.
- LTH 30-day is +0.31 since 2023 but 0.00 in 2019–22.

**F. Days since the halving.** Descriptive only, because there are 2 cycles. Not reported as a finding.

## 3. Reading
- **Direction:** history since 2019 cannot prove any indicator or combination at 30–180 days. There are too few independent cycles, about 19 at 30 days, 6 at 90 and 3 at 180.
- The one consistent tendency is valuation: cheaper than usual (far below the ATH, near the 200-week average, low MVRV) came before better 3–6-month returns, and that held in both halves. It is a description, not a tested rating.
- **Risk:** stretch above the 200-week average and current volatility both came before deeper 90-day drawdowns. That also holds in both halves, and it matches R1.
- **Short-term momentum** helped in 2019–22 and has not since.
