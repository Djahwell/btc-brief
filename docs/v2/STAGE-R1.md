# BTC Brief V2: Stage R1 indicator study (2026-11-06)

*Design period only: 2021-06-01 → 2024-06-24, 1,120 days. Sealed loader verified: no row after 2024-06-24 and no bar after 2024-06-30. Code hashes: load.js `03a901f6…`, r1.js `3aae895e…`, features.js `4d09df06…`. Board review: **ran as declared; direction null credible; Stage R ends at R1 under the declared rules.***

## Result
- **Direction (7-day return):** no indicator has a usable relation. The best unadjusted p is 0.29, signs flip between years, and the quintiles are noise. This covers 28 indicators: trend (20/50/200-day distance and slope), auction position, past returns, drawdowns, perp premium, Coinbase premium, Fear & Greed, MVRV, LTH flow, stablecoin growth and volatility.
- **Risk (7-day worst dip):** only volatility relates.
  - ATR as % of price: r = −0.31 (95% CI −0.42 to −0.13), p 0.007.
  - Short/long volatility ratio: p 0.035.
  - Nothing else: trend, positioning and sentiment add nothing.

| Volatility tercile (ATR % of price) | Days | Median 7-day dip | Worst 10% of days |
|---|---|---|---|
| Low (≤ 3.6%) | 374 | −2.7% | −8.2% |
| Medium (3.6–5.0%) | 373 | −5.2% | −13.6% |
| High (> 5.0%) | 373 | −5.7% | −15.8% |

In ATR units, the 7-day dip has a median of 1.0 ATR, 1.7 ATR at the 75th percentile and 2.8 ATR at the 90th.

- **Mechanical roles: none.** No direction driver, no risk driver, no modifier. R2 therefore has nothing to build from, and the trial budget stays unspent.

## Defect in the declaration (Board finding 2)
- With 1,001 circular shifts the smallest possible p is about 0.001. The Benjamini–Yekutieli threshold at q = 0.10 over 56 tests was about 0.0004, so **no test could ever have passed**. "No risk role" was fixed by the test design, not by the data.
- This changes no outcome. Re-running with a looser rule after seeing p = 0.007 would be a post-hoc change, and the volatility→dip link is the trivial baseline in any case.
- Recorded, like the C3 sign defect in Stage 4.

## Other Board notes
- **Power:** slow-moving series such as volatility leave only about 15 independent rotations. The test can detect only |r| ≈ 0.3 or more on such indicators. A direction edge the size Stage 4 saw (r ≈ 0.02–0.07) is far below what any 2–3 year sample can confirm.
- **rvPct partial (+0.19):** an artefact. rvPct is almost a monotone function of rv30, and the residual is a time trend.
- **daysSinceHi30 quintile shape:** a heavily tied counter plus a few long downtrend runs. Not an effect.
- Only 3 of the 9 condition cells reached 150 days, so "condition stability" covered 3 cells.

## What follows (declared consequence)
- Stage R stops at R1. The page stays descriptive and this report is published.
- **Allowed and honest:** a volatility context display ("typical 7-day dip at today's volatility, from 2021–24"), labelled "volatility context — not a tested rating".
- **Optional:** a single calibration test of that display on the sealed hold-out, for example whether the design-period 80% dip interval covers 70–90% of hold-out days. It must be declared and frozen before the hold-out is opened.
- FW1 keeps its separate forward record.
