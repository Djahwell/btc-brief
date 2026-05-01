# History Archive — Phase 2 Ideas

Saved 2026-04-25. Pick up whichever idea is interesting whenever the
archive has enough days of data to make it worth analyzing (~30 days
gives you something interpretable; ~90 days makes calibration solid).

The history archive itself is already running: every 6h, the
`data-refresh.yml` workflow snapshots `public/all_data.json` to
`public/history/YYYY-MM-DD-HH.json` and rebuilds
`public/history/index.json`. Endpoints:

- Index: `https://djahwell.github.io/btc-brief/history/index.json`
- Snapshot: `https://djahwell.github.io/btc-brief/history/{key}.json`

Each snapshot has a `snapshotAt` (ISO timestamp) and `snapshotKey`
(`YYYY-MM-DD-HH`) field on top of the full `all_data.json` shape, so
every analyzer below can identify exactly when each capture happened.

---

## Idea 1 — Backtest analyzer (foundational; do first)

**Goal.** Compare each day's `brief.compositeScore` and `brief.overallBias`
to what BTC actually did over the next 1d / 7d / 30d. Output a CSV (or
small JSON) showing predicted-vs-realized for every day in the archive.

**Why it matters.** Without this you can't answer "is the brief any good?"
Everything else in Phase 2 depends on the answer to that question — score
calibration, dashboard track-record, prompt self-awareness all need a
labeled prediction-vs-outcome dataset.

**What to build.** A new local script `scripts/backtest_history.js` that:

Pulls `history/index.json` from gh-pages, picks one snapshot per UTC day
(the latest hour with a `brief` field present, since 3 of 4 daily snapshots
typically share the same brief), then for each day reads the same
snapshot's `market.price` and the price from the snapshot N days later.
Computes return = (futurePrice / todayPrice - 1) × 100 for N ∈ {1, 7, 30}.
Joins everything into a row per day. Writes the result to
`scripts/output/backtest.csv` (gitignored) — columns: date, key,
price, compositeScore, overallBias, biasReason, ret1d, ret7d, ret30d,
direction1d, direction7d (bool: did the bias direction match?).

**Inputs available now.** `brief.compositeScore`, `brief.overallBias`,
`brief.scoreDecomposition` (all 7 axes broken out), `market.price`.

**Acceptance.** Running `node scripts/backtest_history.js` produces a CSV
where the most recent rows have empty future-return columns (because
those days haven't elapsed yet) and older rows are fully populated.
Sanity-check by spot-reading 3-5 known days.

**Time estimate.** ~1-2h once 30+ days of history exist.

---

## Idea 2 — Track-record dashboard section

**Goal.** Add a "Score Track Record" panel to the existing dashboard
showing how the recent compositeScore predictions have held up. Helps
you trust (or distrust) today's score at a glance.

**Why it matters.** Right now the dashboard shows today's score in
isolation. With history, you can show the user: "Past 30 days: when
score was ≥ +6, BTC was up 1d 72% of the time; when ≤ -3, BTC was up
1d only 38% of the time. Today's score is +4 — moderate."

**What to build.** Extend `BTC_MorningBrief_Nansen_live.jsx` with a new
component (or section in the existing one) that fetches
`history/index.json` on mount, then fetches the last 30-60 day snapshots
in parallel. Computes:

- Hit rate by score bucket (e.g., score ≥ +5, +1 to +5, -1 to +1,
  -5 to -1, ≤ -5) — % of days where actual 1d move matched the bias
  direction.
- Mean realized 1d return per bucket.
- A small sparkline of compositeScore over time aligned with a sparkline
  of BTC price.

The panel should degrade gracefully when history < 30 days ("Track record
will appear after 30 days of data — currently {n} days").

**Inputs available now.** Same as Idea 1, plus `brief.todayAction.recommendation`
if you also want to break out by recommendation.

**Acceptance.** Panel renders without breaking the dashboard. Bucket
counts add up to total days. Cross-check the displayed numbers against
the Idea 1 CSV.

**Time estimate.** ~2-3h. Easier if Idea 1 is already done — same logic,
just reframe for in-browser.

**Caveat.** Fetching 60 snapshots in parallel adds ~5MB of network +
some latency. Consider a `history/summary.json` (precomputed by a new
GitHub Action that runs after data-refresh) to avoid the per-page-load
cost.

---

## Idea 3 — Score calibration / self-aware Claude prompt

**Goal.** Feed the brief's recent track record into the SYSTEM_PROMPT
so Claude can adjust for known biases ("the model has been too bullish
on +macro days for the past 14 days — discount macro contribution by
20% today").

**Why it matters.** Closes the loop: history isn't just informational,
it actively improves future scores. This is the highest-leverage Phase 2
idea but also the most subtle — easy to over-correct or fit to noise.

**What to build.** Two pieces.

First, a precomputed `history/calibration.json` updated by a new step
in `brief-generate.yml` (or a separate weekly cron) that summarizes
the past N days into a small JSON: which axes have been most predictive,
which have been least, mean error per bucket, recent overall bias hit
rate. Keep this small (<2KB) so the brief-generate workflow can include
it inline in the user message.

Second, a modification to `brief-worker.js` that loads
`history/calibration.json`, builds a "RECENT TRACK RECORD" block, and
appends it to the user message. Update `SYSTEM_PROMPT` (Section F) with
explicit instructions: "If the calibration block reports an axis has
been miscalibrated by >20% over the past 14 days, mention that
explicitly in `analystNote` and adjust that axis's weight by ±0.5
points."

**Inputs available now.** Everything from Idea 1 + Idea 2. Critically,
needs at least 60-90 days of history to avoid recalibrating on noise.

**Acceptance.** Two tests. (1) On a known-recent-mistake day, the brief
should mention the miscalibration in `analystNote`. (2) The calibration
block should be stable run-to-run within a single day (deterministic
given same history).

**Time estimate.** ~4-6h. Bigger because of the prompt iteration loop
— you'll need to run it for several days, see how Claude actually uses
the calibration data, refine the wording.

**Risk.** Over-correcting / chasing noise. Mitigate by capping the
adjustment Claude can make (±1 point on any axis) and only feeding
in patterns with enough sample size (n ≥ 14 in any bucket).

---

## Suggested order

Do Idea 1 first — it produces a CSV you can eyeball to decide whether
the brief is even worth calibrating. If the brief is largely random,
skip Idea 3 and just do Idea 2 for transparency. If the brief shows
genuine edge on one or two axes, Idea 3 is where the real value is.

## When to revisit

Set a calendar reminder for ~2026-06-01 (5 weeks of archive) to do
Idea 1's first pass. Don't bother before then — fewer than 30 days of
history won't tell you anything.
