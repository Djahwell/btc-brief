# BTC Brief V2: Stage R, research before rebuilding the ratings (plan v1.1, 2026-11-06, Board changes applied)

*Djahwell, 2026-11-06: (c) two ratings, **direction** and **risk**. Do proper research with statistics on which indicators mattered in the first test period and under which market conditions, and decide their place in the score **before** running candidate iterations. Something must work on history before it is pushed forward.*

## R0. Rules fixed before any data is read
1. **Periods**, set now and never moved:
   - **Design (D):** 2021-06-01 → 2024-06-30. Research and tuning happen only here.
   - **Hold-out (H):** 2024-07-01 → 2026-10-29. Sealed; each finalist is tested once.
   - **Regime check (C):** 2019-01-01 → 2021-05-31. Sealed; used only for finalists, as a different-market check.
2. **Sealing is enforced in code.**
   - During R1 and R2, the research loader (`research/load.js`) returns **no row of any kind** (indicators or outcomes) dated after 2024-06-24, and loads no price bar after 2024-06-30. Past returns, drawdowns and "days since high" on hold-out days would be lagged hold-out outcomes, so they are sealed too.
   - 2024-06-24 is the last day whose 7-day outcome ends inside the design period. That leaves a gap of 6 days before H.
   - The loader, the R1 study script and, later, the hold-out runner are hashed.
3. **Honest limit: H and C are partly seen.**
   - Stage 4 and the FW1 look covered 2019–2026 in aggregate. Their gist is known: trend worked in 2019–21 and was weak after 2021.
   - So a hold-out pass is labelled **"passed a partly-seen hold-out"**, and C is a sign check, not an independent test.
   - **The forward test (R4) decides.** Nothing is shown beyond "untested" until it passes.
4. **Targets (measured from D 00:00, entry = close of D−1, Coinbase).**
   - **Primary:** the 7-day return (direction) and the 7-day MAE = lowest low ÷ entry − 1 (risk).
   - **Descriptive only:** 1- and 3-day returns, and the 7-day range.

## R1. Indicator study (design period only)
For every indicator, measured at D 00:00 with the declared lags:

| Group | Indicators |
|---|---|
| Trend | E1 parts (distance to SMA20 and SMA50 in ATR, SMA20 slope), T3 parts (distance to SMA200, slope), FW1 base state |
| Momentum and mean reversion | past 1-, 3-, 7- and 30-day return; drawdown from the 30-day and 90-day highs; days since the 30-day high |
| Auction | E2 state; position versus VAL, POC and VAH in ATR |
| Volatility | 30-day realised volatility percentile; 7-day vs 30-day realised volatility ratio; ATR as % of price |
| Positioning | E3a premium percentile; E5a z; Fear & Greed |
| On-chain and liquidity | MVRV percentile; LTH net 30-day; stablecoin growth (T4 raw) |

Measured per indicator, against each **primary** target:
- **Rank correlation (Spearman)** with a circular block bootstrap 95% interval (block length by Politis–White, floor 20, 2,000 resamples, seed 20261106).
- **Quintile profile:** mean outcome per quintile, with block-bootstrap intervals. Quintile edges come from the pooled design period. States are reported per state.
- **For MAE, the effect beyond volatility:** partial Spearman given the trailing 30-day realised volatility. MAE grows mechanically with volatility, so an indicator that only proxies volatility gets no risk role.
- **Partial effect after trend:** Spearman within each of the 3 trend states, combined as a day-weighted average. Its interval comes from the block bootstrap of the combined statistic.
- **Multiple testing:** Benjamini–Yekutieli FDR at 10% across all pooled primary tests (indicators × 2 targets). Year and condition results are descriptive and never make an indicator significant on their own.
- **Stability (descriptive):**
  - by calendar year (2021 H2, 2022, 2023, 2024 H1), and by design half (2021-06 → 2022-12, 2023-01 → 2024-06);
  - by **market condition**: 3 trend states (above a rising 200-day, below a falling 200-day, mixed) × 3 volatility terciles = 9 cells, with each cell's day count.
- **Redundancy:** the correlation matrix between indicators, and the partial effect of each one after the trend state.

**Role rules, fixed now (mechanical):**
- **Direction driver:**
  - FDR-significant pooled on the 7-day return;
  - the same sign in at least 3 of 4 years;
  - the trend-partial effect has the same sign.
- **Risk driver:** FDR-significant pooled on MAE, and its partial Spearman given 30-day volatility is significant at 0.05 with the same sign in both design halves.
- **Conditional modifier:**
  - not a driver, but in one declared condition cell with at least 150 days its Spearman is significant at 0.05;
  - an interaction test (cell effect minus pooled effect, block bootstrap) is significant at 0.05;
  - the same sign holds in both design halves.
  - At most 2 modifiers per rating are kept, the 2 with the largest |cell effect|.
- **Drop:** everything else.

**Output:** `STAGE-R1.md`, an indicator-by-indicator table: sign, size, interval, FDR result, stability, condition, and the mechanical role.

The Board reviews R1 before any score is built.

## R2. Candidate building (design period only)
- Candidates are built **only from indicators with an R1 role**, in the role R1 gave them.
- **Trial budget: 50 in total** (direction and risk together), each one logged in `research/trials.csv` before it is run. Any variation of thresholds, weights or windows counts as a trial.
- **Design metrics:**
  - direction: Bull+ (≥ +3) minus the rest on the 7-day return, band monotonicity, and the margin over the trend state alone;
  - risk: partial Spearman(risk score, MAE | 30-day volatility), and the MAE gap between the high and low risk bands.
- **Risk bands, declared now:** three bands (Low, Normal, High risk), cut at the design-period terciles of the candidate's own score.
- **Trial log:** every trial is identified by the hash of its code and parameters. The log stores its daily design-period series: for direction, ret7 × (Bull+ indicator) minus the benchmark rule's same series, the benchmark being the uptrend state; for risk, the product of standardised risk score and standardised MAE minus the vol-only rating's same product. These series feed the SPA test.
- A candidate must hold up in each design year, not just on the pooled average.
- **Finalists:** at most 3 per rating, frozen with hashes before the hold-out.

## R3. Hold-out and regime check (one run)
- Each finalist is run once on H, with the Stage 4 statistics (circular-shift p, block bootstrap, episode minimums: 30 per group on H).
- **Correction for the search:**
  - Hansen SPA p-value on the **design-period** daily series of all logged trials, against their benchmarks (stationary bootstrap, 5,000 resamples). This corrects the selection.
  - Holm across finalists on H.
- **Power, stated before the run:** the minimum detectable effect on H is computed from design-period volatility and persistence (no H outcomes) and recorded. If it exceeds the design-period effect, the hold-out is declared likely inconclusive in advance, and the forward test decides.
- **Pass (direction):**
  - H1 Holm-significant at 0.05;
  - **beyond trend:** the Bull+ difference exceeds that of the uptrend state and of the best single R1 driver on the same days (paired circular shift, Holm);
  - band means in order (bands with at least 30 episodes; at least two such bands);
  - no deeper MAE for Bull+ (lower bound > −0.5 pp, correctly signed this time);
  - the SPA p < 0.10.
- **Pass (risk):**
  - partial Spearman(risk score, MAE | 30-day volatility) significant at 0.05 (Holm);
  - it beats the vol-only rating in a paired comparison;
  - the high-risk band's mean MAE is deeper than the low-risk band's, with its 95% interval excluding 0;
  - the SPA p < 0.10.
- **Regime check C (sign only):** the same sign is "consistent"; the opposite sign is flagged "regime-dependent" and shown as such.
- **Episode minimums not met on H:** the result is *withheld* (inconclusive), not failed, and the forward test decides.
- **Nothing passes:** the page stays descriptive. The R1 findings are still published, as context.

## R4. Forward confirmation (decides)
- A rating that passes H, or is inconclusive on H, is shown labelled **"Untested — passed a partly-seen hold-out, live check since …"** (or "hold-out inconclusive").
- The forward test runs the **full** H1 / beyond-trend test (direction) or the partial-Spearman test (risk) at 12 months, extendable to 18 and 24 months on episode counts only, as declared for FW1.
- FW1 keeps recording in the background with its own separate record.

## Order and stop-gates
R0 Board check (incl. the role rules) → R1 study → Board review of R1 → Djahwell sees R1 → R2 (trials logged) → finalists frozen + Board check → **stop-gate: Djahwell's "go"** for the single hold-out run → R3 → R4.

## Board review record
**v1.0 (2026-11-06): APPROVE WITH CHANGES.** All 8 changes applied in v1.1:
1. hold-out labelled partly seen, and the forward test decides at the full bar;
2. everything after 2024-06-24 sealed in code;
3. two primary targets, BY FDR, mechanical role rules, partial-effect method, quintile edges and intervals;
4. SPA on design-period trial series, with trials identified by hash;
5. a beyond-trend test for direction;
6. risk rating must beat trailing volatility, with declared risk bands;
7. power stated before the hold-out;
8. an episode fallback, and FW1 kept separate.
