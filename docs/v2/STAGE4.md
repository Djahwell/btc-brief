# BTC Brief V2: Stage 4 results (2026-11-05)

*Frozen run of `STAGE4-DECLARATION.md` v1.2 (declarationHash `f241978d…`, harness `frozen.json` `ccff511d…`). Run on GitHub (run 42059664646); every gate passed: declaration, engine and harness hashes, history set, GO. Results: `v2-data/stage4/2026-11-05/`. Maison Toé report run after the main test with the frozen `mt-run.js` (§M). Board results review: **valid; both scorecards go to descriptive mode (§F).***

## Verdict
| Read | Result | Consequence (§F, declared before the run) |
|---|---|---|
| Entry (1–7 days), 4 candidates | **All fail** | Descriptive mode: family bars, states and levels, no entry score |
| Tendency (3–9 months), 2 candidates | **Both fail** | Descriptive mode: family bars, no tendency score |

## Entry (main window 2021-06-01 → 2026-10-29, 1,977 days, none withheld)
| Candidate | H1: Bull+ minus rest, 7-day return | p | H2: beyond E1 alone | p | C5 Spearman (p) | Pass |
|---|---|---|---|---|---|---|
| V-E1/E6a (primary) | +1.40 pp | 0.087 | +0.19 pp | 0.47 | 0.016 (0.33) | No |
| V-E1/E6b | +1.45 pp | 0.080 | +0.24 pp | 0.44 | 0.016 (0.33) | No |
| V-E2/E6a | +1.55 pp | 0.068 | +0.34 pp | 0.40 | 0.016 (0.33) | No |
| V-E2/E6b | +1.61 pp | 0.060 | +0.40 pp | 0.39 | 0.016 (0.33) | No |

- **Holm:** the smallest threshold over the 8 hypotheses is 0.00625; nothing is rejected.
- **H2:** nearly all of the Bull+ difference is already in E1 (trend) alone.
- **Episodes:** about 88 Bull+ and 89 non-Bull+ episodes, so the 30-episode rule is met.
- **Bands (primary):** mean 7-day return Bear +0.36%, Neutral +0.39%, Bull +1.75%. Strong bull has 2 days and Strong bear none.
- **C3 (risk):** Bull+ entries had a **shallower** 7-day worst drop than the rest (+1.8 pp). **Declaration defect:** C3 was written as "upper bound < +0.5 pp", but MAE is negative by §C, so the intended check was "lower bound > −0.5 pp". As written it fails exactly when Bull+ is safer. It decides nothing, because H1 and H2 fail anyway. Under §K.8 a corrected re-run would be a new trial on spent history, so it is not done.
- **Sensitivities (reported, not selectable):**
  - lag +1: same picture, H1 p 0.05–0.09;
  - block lengths 10/40/60: same;
  - robustness 2019 → 2021-05 (E1, E2, E7): +2.3 pp, the same sign as the main window, so "consistent".

## Tendency (exposure: long when score ≥ +3)
| Candidate | S1 2019–20 | S2 2020–24 | S3 2024–26 | Pass |
|---|---|---|---|---|
| V-T1/T2+ (primary) | ratio 9.7, long 1% of days → fails the 10%-long rule | −1.02 vs always-long 2.59 | 0.69 vs 0.36 / −0.21, long 3% | No |
| V-T1/T2− | 2.23, beats both | 0.11 vs 2.59 | −1.06 | No |

The 10%-long rule decided nothing: T2+ fails S2 on the ratio anyway. Without T2 (sensitivity, S2–S3 only): fails. Lag +1: fails.

## Design finding (Board)
Each family scores 0 between its 25th and 75th percentile, which is half of the time, and the scorecard averages five such families. The contrarian families (E3a, E7) also tend to offset the trend families. Result:
- 85% of entry days are Neutral and ±6 is practically unreachable;
- Bull+ (about 10% of days) is in effect "E1 strongly up with nothing offsetting";
- the tendency score almost never reaches +3.

This is a property of the declared design, not a bug. Changing it and retesting on 2019–2026 would be data-mining. A new design can only be judged forward.

## Maison Toé relevance (descriptive, run once; trades 2021-06 → 2026-10; twin R)
| | ≤ −3 | −2…+2 | ≥ +3 | Spearman (95% CI, clustered by day) |
|---|---|---|---|---|
| Box, entry score (110 trades) | 4 trades, −0.91 R, 0% wins | 90, +1.13 R, 51% | 16, +1.03 R, 62% | +0.20 (0.01, 0.38) |
| Box, E1 alone | 16, +0.77 R | 78, +0.95 R | 16, +1.77 R | +0.10 (−0.09, 0.29) |
| Trend, entry score (361) | — | 308, +0.90 R, 32% | 53, +0.37 R, 36% | +0.10 (−0.06, 0.26) |
| Trend, tendency score | 5, −0.33 R | 349, +0.87 R | 7, −0.60 R | −0.07 (−0.23, 0.09) |

**Reading:**
- **Box:** the positive correlation comes from 4 trades in the ≤ −3 band. Bull+ is no better than Neutral.
- **Trend:** there is nothing to read; Bull+ is, if anything, worse.
- No filter is supported. "Skip box trades when entry ≤ −3" is at most a hypothesis (n = 4), testable only forward as a separate V4 candidate.
- **Caveats:** the replay period was also V4's research period. The rows carry no direction field, so the bots must be confirmed long-only for the bands to mean anything.

## What is allowed next (Board)
- **Legitimate, forward only, each with its own declaration written before the data:**
  - the frozen candidates keep running in shadow, labelled "failed Stage 4, logged, not shown";
  - a new candidate design, judged only on days after its declaration;
  - the Maison Toé box filter, as a V4 candidate in that bot's own shadow ledger.
- **Not legitimate:**
  - re-running with C3 corrected;
  - re-tuning bands, dead zone, weights or thresholds on 2019–2026;
  - promoting E1 alone because Bull+ "worked through trend";
  - reading S1 or S3 tendency wins as partial passes;
  - picking a filter cut-off from these 4 trades.
