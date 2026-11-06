# BTC Brief V2: FW1 forward candidate (declared 2026-11-06)

*Djahwell, 2026-11-06: "go ahead". FW1 is a new score designed after Stage 4. It is judged **only on days from its first frozen daily record onward**; the 2019–2026 history is spent and is never used to judge or tune it. Until it passes, the app shows it labelled **"Untested — forward test since …"**. Any change to FW1 is FW2, with its own declaration and its own clock.*

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
- **Pass needs all of:**
  1. **H1:** mean 7-day return on Bull+ days (≥ +3) minus the rest > 0, with a one-sided circular-shift p < 0.05 (shifts 30 to N − 30).
  2. **Beyond trend:** the same difference is larger than for "E1 alone ≥ +3" on the same days (point estimate > 0; p reported, not required, because the forward sample is small).
  3. **Risk:** the 2.5th percentile of (Bull+ MAE − rest MAE) is > −1 percentage point. MAE is negative, so this means Bull+ entries are not materially deeper underwater. Circular block bootstrap, Politis–White block (floor 10), 10,000 resamples, seed 20261106.
  4. **Order:** band mean returns are non-decreasing across bands with ≥ 10 episodes, and at least two such bands are needed.
- **Fail:** FW1 is retired, and the page goes back to descriptive mode for that read.

**Tendency verdict:**
- **When:** 24 months, with the exposure rule from Stage 4 §K.3 (long when ≥ +3, 10 bp per switch).
- **Pass:** the ratio beats "always long" and the 200-day rule, the ratio is > 0, and the rule is long on ≥ 10% of days.
- Until then it is shown as untested.

**Kept for comparison, not shown:** the frozen Stage 4 candidates keep being recorded on the same days.
