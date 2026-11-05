# BTC Brief V2: forward test of the event flag (declared 2026-11-05)

*Djahwell, 2026-11-05: an event panel (no score) plus a forward-only test of "high-impact event within 48 h" as a volatility flag. This test is separate from Stage 4 and can never change the frozen Stage 4 test, its candidates or any score.*

## Flag (recorded point-in-time)
- **Recording:** each UTC day D, the first run of the daily job (00:10 UTC) appends one row to `v2-data/v2/events-log.json`: `within48h` = true if a **high-impact** event falls in [D 00:00, D+2 00:00) UTC, according to the calendar as known at that moment. Rows are never rewritten.
- **High-impact events:**
  - FOMC decisions (statement at 14:00 New York time on the meeting's second day);
  - US CPI (08:30 New York time);
  - US payrolls / Employment Situation (08:30 New York time);
  - quarterly Deribit BTC options expiries (last Friday of March, June, September and December, 08:00 UTC).
- **Medium, shown on the page but not in the flag:** monthly Deribit expiries.
- **Sources:**
  - FOMC: federalreserve.gov, fetched on every run.
  - CPI and payrolls: bls.gov. bls.gov refuses GitHub's servers, so these come from the official BLS schedule read by hand (`scripts/v2/bls-schedule.json`, dated). A day counts only if every source was OK when its row was recorded (`sourcesOk`).

## Outcome and test
- **Outcome:** 48-hour range = (highest high − lowest low of the Coinbase daily bars D and D+1) ÷ close of D−1.
- **Statistic:** mean outcome on flagged days minus mean on unflagged days.
- **Test:** one-sided circular-shift test, shifts 60 to N − 60; p = (1 + #{shifted ≥ observed}) / (1 + #shifts).
- **When:** first run once there are at least **40 flagged and 40 unflagged** days with `sourcesOk` (about 6–9 months). Before that the result reads "collecting".
- **Pass:** difference > 0 and p < 0.05. The page may then say that wider moves around scheduled events are confirmed in the live record. Fail: the panel stays as plain context.
- One test, no variants. Any change to the flag, the event list or the outcome is a new declaration with its own forward period.

## Code
`scripts/v2/events.mjs` (calendar and daily flag), `scripts/v2/track.mjs` `eventFlagTest` (the test), page panel in `public/v2/app.js`.
