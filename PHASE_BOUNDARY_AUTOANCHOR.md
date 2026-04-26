# Phase Boundary Auto-Anchor — Implementation Brief

Saved 2026-04-25. Self-contained spec so this can be picked up in a new
chat phase-by-phase. Each phase below is independently shippable; do them
in order. Phases 1 + 2 give you ~80% of the value in ~1 hour. Phase 3
needs ~30 days of `history/` archive before it's meaningful. Phase 4 is
optional sugar.

---

## Why this exists

The BTC Brief's `SYSTEM_PROMPT` (in `brief-worker.js`) currently hardcodes
the four-phase strategy with fixed dollar levels:

```
Phase A ACCUMULATION: $60K-$68K
Phase B BREAKOUT:     $68K-$79K
Phase C MOMENTUM:     $79K-$98K
Phase D BULL RUN:     $98K+
Hard stop: daily close below $58,500
```

These reflect late-2025 cycle structure. If BTC enters a new ATH cycle,
sustains a bear, or shifts on a major regulatory event, those numbers go
stale and the brief silently keeps quoting them. We want the boundaries
to drift with structural data automatically, with optional human
ratification for big regime changes.

The fix has four layers, each shippable on its own.

---

## Repo orientation (for a fresh chat)

- `data-worker.js` — fetches all non-Claude data, writes `public/all_data.json`
- `brief-worker.js` — reads `all_data.json`, calls Claude once, writes `brief` back
- `.github/workflows/data-refresh.yml` — cron 6h, runs data-worker + snapshot
- `.github/workflows/brief-generate.yml` — on-demand, runs brief-worker
- `scripts/snapshot_history.js` — copies `all_data.json` → `public/history/YYYY-MM-DD-HH.json`
- History endpoint: `https://djahwell.github.io/btc-brief/history/index.json`

Fields already in `all_data.json` we'll lean on:

- `coinMetrics.realizedPrice` — long-term structural floor
- `lthData.lth_cost_basis` — long-term holder cost basis (alternate floor)
- `tech.sma200` — 200-day moving average (trend line)
- `tech.ath` (or `market.ath`) — all-time high
- `market.price` — current spot

---

## Phase 1 — Compute boundaries from data (foundational)

**Goal.** Replace the five hardcoded anchor prices with values derived
from indicators already in `all_data.json`. Result: every 6h, the
boundaries drift with realized price, SMA200, and ATH.

**Why it matters.** Without this, every other phase is pointless. This
is the part that actually closes the staleness gap.

**What to build.** Add a block to `data-worker.js` after the existing
fetches that computes a `phaseAnchors` object and attaches it to
`allData` before write:

```js
const realized = allData.coinMetrics?.realizedPrice;
const lthCost  = allData.lthData?.lth_cost_basis;
const sma200   = allData.tech?.sma200;
const ath      = allData.tech?.ath ?? allData.market?.ath;

const floor = Math.min(realized ?? Infinity, lthCost ?? Infinity);

allData.phaseAnchors = {
  hardStop:    Math.round(floor * 0.97),
  phaseA_low:  Math.round(floor),
  phaseA_high: Math.round(sma200),
  phaseB_high: Math.round(sma200 * 1.15),
  phaseC_high: Math.round(ath * 0.98),
  derivedFrom: { realized, lthCost, sma200, ath },
  computedAt:  new Date().toISOString(),
  // Sanity check — see "Watch out" below
  inverted:    floor > sma200 || sma200 * 1.15 > ath * 0.98,
};
```

**Watch out.** After a sharp rally, SMA200 can sit far below realized
price, which would invert the phases (Phase A low > Phase A high). When
that happens (`inverted: true`), keep the prior cycle's anchors — read
them from the previous `all_data.json` (already preserved in the
write-cache flow) and reuse them, with a `regime: 'INVERTED_FALLBACK'`
note. Log a warning to GHA so you notice.

**Acceptance.** Open `all_data.json` after one cron run. `phaseAnchors`
exists, all five fields are integers, `derivedFrom` shows the source
values, `inverted` is `false` under normal conditions. Eyeball the
numbers — they should be roughly within 10% of the current hardcoded
levels at today's price.

**Time estimate.** ~30 min.

**Touch list.** `data-worker.js` only. Don't change `brief-worker.js`
yet — Phase 2 wires the new field into the prompt.

---

## Phase 2 — Inject anchors into the brief, delete hardcoded numbers

**Goal.** Make Claude reason from today's anchors, not late-2025's. Same
goes for the JS-side `computePhase` helper — both should read from the
single `phaseAnchors` source of truth.

**Why it matters.** Phase 1 makes the data correct; Phase 2 makes the
brief actually use it. Without this step the boundaries drift in JSON
but Claude keeps quoting stale dollar amounts.

**What to build.** Two edits in `brief-worker.js`.

First, rewrite the relevant block of `SYSTEM_PROMPT` to use named
placeholders:

```
Phase A ACCUMULATION: ${PHASE_A_LOW} - ${PHASE_A_HIGH} - max conviction buy zone
Phase B BREAKOUT:     ${PHASE_A_HIGH} - ${PHASE_B_HIGH} - add 25% on confirmed daily close + ETF >$500M/day
Phase C MOMENTUM:     ${PHASE_B_HIGH} - ${PHASE_C_HIGH} - hold 55%, take 15% off near upper bound
Phase D BULL RUN:     ${PHASE_C_HIGH}+ - scale out 10% per 15% above the lower bound
Hard stop: daily close below ${HARD_STOP}
```

Second, in `buildUserMessage`, substitute the placeholders from
`allData.phaseAnchors` before sending. Use a simple `.replaceAll`
chain on a copy of `SYSTEM_PROMPT`. Also rebuild the `PHASES` array
dynamically from `phaseAnchors` so `computePhase` and the prompt agree:

```js
const a = allData.phaseAnchors;
const PHASES = [
  { id: 'A', label: 'ACCUMULATION', low: a.phaseA_low,  high: a.phaseA_high },
  { id: 'B', label: 'BREAKOUT',     low: a.phaseA_high, high: a.phaseB_high },
  { id: 'C', label: 'MOMENTUM',     low: a.phaseB_high, high: a.phaseC_high },
  { id: 'D', label: 'BULL RUN',     low: a.phaseC_high, high: a.phaseC_high * 2 },
];
```

Add a new section to the user message titled `## Today's phase anchors`
that prints the five numbers and the `derivedFrom` block, so Claude can
explain them in `analystNote` if asked.

**Acceptance.** Run `npm run brief` locally with a populated
`all_data.json`. The user message logs (or the saved brief) reference
the *new* dollar levels, not the old hardcoded ones. The `PHASES` array
in `computePhase` returns a phase consistent with the dollar amounts
Claude was told.

**Time estimate.** ~30 min.

**Touch list.** `brief-worker.js` only. Single source of truth: every
phase number now comes from `allData.phaseAnchors`. Confirm by
grepping the file — `60000`, `68000`, `79000`, `98000`, `58500` should
appear nowhere.

---

## Phase 3 — Regime detection from `history/` archive

**Goal.** Detect three structural regimes — `NEW_ATH_CYCLE`,
`SUSTAINED_BEAR`, `NORMAL` — and use the regime to modulate Phase 1's
formulas. Tells Claude *why* the boundaries moved, not just that they did.

**Why it matters.** Indicators alone are noisy. A single weird
snapshot can rewrite the strategy. Regime detection adds memory: only
let boundaries shift when the *trend* of indicators agrees, not when one
day's reading looks weird.

**Prerequisites.** ~30 days of `public/history/*.json` snapshots. Don't
start before ~2026-05-25.

**What to build.** A new `scripts/regime_check.js` that runs in
`data-refresh.yml` after the snapshot step. It loads the last ~90
snapshots from `_gh-pages/history/` (already checked out by the
existing seed step), then evaluates:

- **NEW_ATH_CYCLE** — current price is a new ATH AND realized price has
  risen >2% over the last 30 snapshot days. Action: keep Phase 1
  formulas but expand `phaseC_high` to `ath * 1.05` (push ceiling
  *above* current ATH so Phase D has runway).
- **SUSTAINED_BEAR** — price < realized price for 30+ consecutive
  snapshot days OR price < `sma200` for 60+ days. Action: pull
  `hardStop` to `realized * 0.90` (deeper room), collapse Phase A high
  to `realized * 1.05` (re-accumulation, not breakout).
- **NORMAL** — neither of the above. Use Phase 1 formulas as-is.

Write the regime + a one-line `regimeReason` into
`allData.phaseAnchors.regime`. Surface it in the user message under
`## Regime` so Claude can echo it in `analystNote`.

**Hysteresis (important).** Don't promote regime changes instantly.
Add a `pendingRegime` field — only promote `NEW_ATH_CYCLE` or
`SUSTAINED_BEAR` after **7 consecutive cron cycles** (~42h) flag the
same regime. Stops a single weird snapshot from flipping the strategy.

**Acceptance.** Two tests. (1) Backfill: run `regime_check.js` against
existing snapshots and confirm it correctly classifies any pre-existing
runs of "price below SMA200" as SUSTAINED_BEAR (or absence thereof as
NORMAL). (2) Smoke: synthetically inject a "new ATH" snapshot and
confirm the regime stays NORMAL until the 7th synthetic cycle, then
flips to NEW_ATH_CYCLE.

**Time estimate.** ~3-4h. Most of that is testing the hysteresis logic
end-to-end.

**Touch list.** New: `scripts/regime_check.js`. Edit:
`data-worker.js` (call `regime_check.js` and merge result into
`phaseAnchors`), `data-refresh.yml` (add a step OR — simpler — just
have `data-worker.js` call it inline). `brief-worker.js` to add a
`## Regime` section to the user message.

---

## Phase 4 — Claude proposes, you ratify (optional)

**Goal.** Let Claude suggest "phase A high should rise to $X because Y"
without taking effect until you approve.

**Why it matters.** Layers 1-3 handle drift automatically.
Layer 4 handles *strategic* shifts (e.g., "the cycle has clearly
changed character, the whole framework needs new levels"). Keeps a human
in the loop for the rare big moves while letting day-to-day drift
happen automatically.

**What to build.** Three pieces.

1. Extend the brief's output JSON schema with a new optional field:
   ```json
   "proposedAnchorChanges": [
     { "anchor": "phaseB_high", "from": 92000, "to": 105000, "reason": "..." }
   ]
   ```
   Update `SYSTEM_PROMPT` to instruct Claude: only populate this when
   you genuinely think the auto-derived level is wrong, with at least
   a 5% delta and a specific structural reason (not noise).

2. A `phase_overrides.json` file in the repo root, hand-edited by you.
   Empty by default. When you accept a proposal, add an entry:
   ```json
   { "phaseB_high": 105000, "acceptedAt": "2026-07-15", "reason": "..." }
   ```

3. In `data-worker.js`, after computing `phaseAnchors`, read
   `phase_overrides.json` and overlay any overrides on top of the
   computed values. Mark overridden anchors with `source: 'manual'`
   in `derivedFrom` so Claude knows.

4. In the dashboard (`BTC_MorningBrief_Nansen_live.jsx`), add a small
   "Pending proposals" panel that shows
   `brief.proposedAnchorChanges` so you see them when reviewing the
   brief — no need to dig through JSON.

**Acceptance.** End-to-end: edit `phase_overrides.json` to override
`phaseB_high`, run `npm run data && npm run brief`. The user message
shows the overridden value, Claude's brief reasons from it, and
`derivedFrom.source` reads `'manual'` for that anchor.

**Time estimate.** ~2-3h. Mostly schema + dashboard wiring.

---

## Suggested execution order

1. **Phase 1** (~30 min) — landing this alone fixes the staleness bug.
2. **Phase 2** (~30 min) — wires Phase 1 into the actual prompt.
3. *Wait ~30 days for archive to mature.*
4. **Phase 3** (~3-4h) — adds regime memory.
5. **Phase 4** (optional) — only if you find yourself disagreeing with
   the auto-derived numbers in practice.

Phases 1 + 2 should ship as a single PR — they don't make sense apart.
Phase 3 is its own PR. Phase 4 is its own PR.

---

## Pre-flight checklist for a fresh chat

When picking this up in a new conversation, paste the relevant phase
section and confirm with the assistant:

- "Look at `brief-worker.js` and find every place a phase boundary
  number appears. List them before editing."
- "Confirm `allData.coinMetrics.realizedPrice`,
  `allData.lthData.lth_cost_basis`, `allData.tech.sma200`, and
  `allData.tech.ath` are all populated in the most recent
  `public/all_data.json`. If any are missing, surface that before
  proceeding."
- "Run `node data-worker.js` then `cat public/all_data.json | jq
  .phaseAnchors` and show me the output before editing
  `brief-worker.js`."

That last check is the one to insist on — it's how you catch the
"inverted phases" edge case before it ships.
