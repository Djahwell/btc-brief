# BTC Brief V2: FW1 forward candidate (declared 2026-11-06)

*Djahwell, 2026-11-06: "go ahead". FW1 is a new score designed after Stage 4. Its forward clock **starts at the first frozen daily record that carries FW1** (after VPS v1.1 is installed), and no earlier day is ever used to judge it; the 2019–2026 history is spent and is never used to judge or tune it. Until it passes, the app shows it labelled **"Untested — forward test since …"**. Any change to FW1 is FW2, with its own declaration and its own clock, and **days already used to judge FW1 are never reused to judge FW2**.*

## Why a new design (from STAGE4.md, no outcome-based tuning)
- Averaging graded families flattened the old score: 85% of days were Neutral and ±6 was practically unreachable.
- Trend carried almost all of the measured edge; the other families added nothing as votes.
- **FW1:** a fixed trend base, then a small number of counted confirmations and warnings. Thresholds are round numbers chosen from the design logic, not fitted.
- **What was looked at before declaring (no outcomes):** FW1's band shares on every 9th day of 2021–2026.
  - Entry: Strong bull 15%, Bull 13%, Neutral 52%, Bear 8%, Strong bear 12%.
  - Tendency: Strong bull 4%, Bull 42%, Neutral 26%, Bear 25%, Strong bear 3%.

## Rules (`engine-v2/declaration-fw1.json`, code `engine-v2/fw1.js`)
Built on the frozen engine's families, with the same lags, freshness rules and evaluation at D 00:00 UTC for the record.

**Entry (1–7 days):**
- **Base:**
  - +4 when close > SMA20 > SMA50 and SMA20 is rising over 5 bars; +6 if E1 ≥ +6 as well;
  - −4 / −6 for the mirror case;
  - otherwise 0.
- **Confirmations:**
  - ±2 from the auction state (accepted above value or failed auction low = +2; accepted below or failed auction high = −2);
  - ±2 from US spot (E5a ≥ +3 or ≤ −3).
- **Warnings:**
  - −2 when perps are frothy (E3a ≤ −3);
  - −2 at extreme greed (F&G ≥ 75);
  - +2 at fear with a failed auction low (F&G ≤ 25 and E2 FAILED_AUCTION_LOW).
- **Then:** clamp ±10, then halve when 30-day volatility is in its top decile.
- **Withheld** if E1 is not active. A confirmation or warning counts only when its family is active.

**Tendency (3–9 months):**
- **Base:** +4 above a rising SMA200 (20 bars), +6 if T3 ≥ +6 as well; −4 / −6 mirror; otherwise 0.
- **Modifiers:** MVRV cheap or rich ±2 (T1 ≥ +6 or ≤ −6); stablecoin growth ±1 (T4 ≥ +3 or ≤ −3).
- **Not used:** T2.
- **Withheld** if T3 is not active.

**Bands:** the same five bands as before.

## Forward test (live frozen daily records only)
**Record:**
- Each day's frozen record (first VPS cycle that reads that day's daily.json, by the 02:07 UTC cycle) stores FW1 with the families.
- Outcomes use the Stage 4 definitions: entry price = close of D−1, 7-day return to the close of D+6, 7-day MAE.
- Missing and withheld days are listed, never dropped.

**Entry verdict:**
- **When:** 12 months after the first frozen FW1 day. If the Bull+ group or the rest has fewer than 20 episodes, extend to 18, then 24 months. At 24 months the verdict is final either way.
- **Series:** the calendar from the first frozen FW1 record up to the last day with a complete 7-day outcome. Missing and withheld days stay inside the series as nulls and rotate with it.
- **Checkpoints:** months since the first record (30.4375 days per month). At 12 and 18 months the verdict is postponed **only** when either group (Bull+ or the rest) has fewer than 20 episodes; an episode is a maximal run of consecutive days in the same group, and a null ends a run. **p-values never trigger an extension.** At 24 months the verdict is final; too few episodes then = fail.
- **Pass needs all of:**
  1. **H1:** mean 7-day return on Bull+ days (≥ +3) minus the rest > 0, with a one-sided circular-shift p < 0.05 (shifts 30 to N − 30).
  2. **Beyond trend:** the same difference is larger than for "E1 alone ≥ +3" on the same days (point estimate > 0). Its one-sided circular-shift p (both series rotated together) decides the **label** shown after a pass:
     - p < 0.20: "passed — adds beyond trend";
     - otherwise: "passed — the trend-led score works (additions not shown to add value)".
  3. **Risk:** the 2.5th percentile of (Bull+ MAE − rest MAE) is > −1 percentage point. MAE is negative, so this means Bull+ entries are not materially deeper underwater. Circular block bootstrap, Politis–White block (floor 10), 10,000 resamples, seed 20261106.
  4. **Order:** band mean returns are non-decreasing across bands with ≥ 10 episodes, and at least two such bands are needed.
- **Fail:** FW1 is retired, and the page goes back to descriptive mode for that read.

**Tendency verdict:**
- **When:** 24 months, with the exposure rule from Stage 4 §K.3 (long when ≥ +3, 10 bp per switch).
- **Pass:** the ratio beats "always long" and the 200-day rule, the ratio is > 0, and the rule is long on ≥ 10% of days.
- 24 months is about one regime, with no segments, so a pass is labelled at most **"forward-consistent (one regime)"**.
- Until then it is shown as untested.

**Display:** the label "FW1 · Untested — forward test since its first daily record" sits on the score itself. The Stage 4 candidates stay hidden. The Claude paragraph stays off until it has a payload built for FW1.

**Kept for comparison, not shown:** the frozen Stage 4 candidates keep being recorded on the same days.

## Freeze (2026-11-06, before the first FW1 record)
| File | sha256 |
|---|---|
| `engine-v2/declaration-fw1.json` | `7d18d7e45dbf6c7dab6764c81388de2d84ab9e4262aca276316d6136d4331898` (declarationHash `e11e2b44…` carried in every snapshot) |
| `engine-v2/fw1.js` | `8a2feabc8dfebfce9e43cc31cafb5f93ed890d6ece7199f2a9520063f8443663` (carried as `fw1CodeHash` in every snapshot and frozen record) |
| `stage4/fw1test.js` (forward-test harness) | `1d8310814b5c67ad9cf7bc9d400770a67152ee4642144c10e323ee9aa92db072` |
| `stage4/stats.js` | `7345f9264df82fe3a19756c298abb1af1c890fc49330e926bfc06458a7c0b43e` (unchanged from Stage 4) |

The frozen daily record keeps FW1's full breakdown (score, band, parts, volatility halving) with both hashes, so every frozen day can be rebuilt by the parity check.

## Board review record
- **2026-11-06, APPROVE WITH CHANGES.** All 7 required changes are applied above: freeze hashes; start date = first frozen FW1 record; harness frozen with the null, episode and extension rules; beyond-trend p decides the label; tendency label limited to one regime; breakdown kept in the frozen record; tests for E5a ±, greed, capitulation +4 and strong down. The two ways a failed FW1 could be rescued are ruled out in writing.
- **VPS v1.1 before the Stage 2 gate:** accepted; the Stage 2 tolerance report will state that the check ran on v1.1 code (input collection unchanged).

## In-sample look at FW1 on 2019–2026 (Djahwell's request, 2026-11-06; descriptive, after the freeze)
*This does not change FW1, its declaration or its forward test. FW1 was designed after Stage 4 had used this history, so these figures are biased and are not evidence either way.*

- **Entry, 2021-06 → 2026-10:**
  - Bull+ days minus the rest: −0.13 pp on the 7-day return (p 0.52).
  - Band means are flat and not in order: Strong bear +0.70%, Bear +0.39%, Neutral +0.56%, Bull +0.04%, Strong bull +0.77% (average day +0.53%).
  - Bull+ 7-day worst drops were about 0.9 pp shallower than the rest.
- **Entry, 2019 → 2021-05:** Bull+ minus the rest +3.5 pp (p 0.04); Strong bull +5.9% over 7 days. Trend-following worked in that bull market and stopped working after it.
- **Tendency** (long when ≥ +3, compared on return ÷ worst drawdown):

| Period | FW1 rule | Always long | 200-day rule |
|---|---|---|---|
| 2019–2020 | 0.15 below zero | 1.38 | 0.15 below zero |
| 2020–2024 | 1.32 | 2.59 | 2.17 |
| 2024–2026 | 0.08 below zero | 0.36 | 0.21 below zero |

  FW1 trailed always long in every period, at roughly the 200-day rule's level.

**Reading:** on this history FW1 shows no 1–7 day edge since 2021, so its forward test is expected to fail unless the market's behaviour changes.
