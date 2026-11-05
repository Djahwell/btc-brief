#!/usr/bin/env node
'use strict';
// BTC Brief V2 — VPS cycle (one short run, started by brief-v2-cycle.timer at :07/:22/:37/:52).
// STAGE2-PLAN v1.1 + STAGE3-PLAN v1.1. Collects the live inputs, reads the GitHub daily inputs and the
// accepted history files, runs the shared engine (scores labelled CANDIDATE until Stage 4 passes),
// archives the snapshot (plus the frozen daily snapshot), and pushes it signed to the Worker.
//   node cycle.js            normal run
//   node cycle.js --dry-run  writes only under ./dry/, pushes nothing (used by install.sh)
const fs = require('fs');
const path = require('path');
const { Http } = require('./lib/http');
const { Vintage, State, archiveSnapshot, freezeDue, writeFrozen, frozenRecord } = require('./lib/store');
const { computeE3aHourly } = require('./lib/e3ahourly');
const { refreshHistory, loadHistory } = require('./lib/history');
const { scoreSnapshot } = require('./lib/score');
const { computeE3a } = require('./lib/premium');
const { computeDerivs } = require('./lib/derivs');
const { computeE5a } = require('./lib/cbpremium');
const { computeE4 } = require('./lib/liq');
const { diskOk, clockSynced, dirBytes } = require('./lib/sys');
const { pushSnapshot } = require('./lib/push');

const CODE_VERSION = 'brief-v2-vps/1.1.0';
const ROOT = __dirname;
const DRY = process.argv.includes('--dry-run');
const BASE = DRY ? path.join(ROOT, 'dry') : ROOT;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const home = require('os').homedir();
const expand = p => p.replace(/^~(?=$|\/)/, home);

function rec(fields) {
  const r = { value: null, unit: null, window: null, asOf: null, fetchedAt: new Date().toISOString(), source: null, scope: null, quality: 'MISSING', staleAfterSec: null, ...fields };
  if (r.value === undefined || (typeof r.value === 'number' && !Number.isFinite(r.value))) r.value = null;
  if (r.value == null && r.quality === 'OK') r.quality = 'MISSING';
  return r;
}

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(BASE, { recursive: true });
  const disk = diskOk(ROOT, { gb: cfg.diskFloorGB ?? 5, pct: cfg.diskFloorPct ?? 20 });
  if (!disk.ok) { console.error(`[cycle] disk floor: ${(disk.freeBytes / 1e9).toFixed(1)} GB free < ${(disk.floorBytes / 1e9).toFixed(1)} GB — stopping`); process.exit(2); }
  const clock = await clockSynced();
  const vintage = new Vintage(path.join(BASE, 'vintages'));
  const gzipped = vintage.compressFinishedDays();
  const state = new State(path.join(BASE, 'state.json'));
  const http = new Http({ vintage, deadline: t0 + (cfg.cycleDeadlineSec ?? 140) * 1000 });   // always leave time to save and push
  const now = Date.now();
  const errors = [];

  // Live families (each isolated: one failing source never stops the others)
  let e3a = null, der = null, e5a = null, e4 = null, e3h = null;
  try { e3a = await computeE3a(http, state.data, now); errors.push(...e3a.errors.map(e => `E3a ${e}`)); } catch (e) { errors.push(`E3a: ${e.message}`); }
  try { e3h = await computeE3aHourly(http, now); } catch (e) { errors.push(`E3a hourly: ${e.message}`); }
  try { der = await computeDerivs(http, state.data, now); errors.push(...der.errors.map(e => `derivs ${e}`)); } catch (e) { errors.push(`derivs: ${e.message}`); }
  try { e5a = await computeE5a(http, state.data, vintage, now); } catch (e) { errors.push(`E5a: ${e.message}`); }
  try { e4 = await computeE4({ dir: expand(cfg.liqDir), statusFile: expand(cfg.liqStatusFile), unit: cfg.liqUnit }, now, der?.total_btc ?? null); } catch (e) { errors.push(`E4: ${e.message}`); }

  // Daily inputs from GitHub (v2-data branch)
  let daily = null;
  try { daily = await http.json('github_daily', cfg.dailyUrl + `?t=${Math.floor(now / 60000)}`, { store: false }); } catch (e) { errors.push(`daily.json: ${e.message}`); }
  const dailyInputs = {};
  if (daily?.inputs) for (const [k, v] of Object.entries(daily.inputs)) dailyInputs[k] = { ...v, via: 'github v2-daily' };

  const inputs = {
    perp_premium_binance_8h: rec({ ...(e3a?.scored || {}), source: 'Binance fapi premiumIndexKlines 1m (BTCUSDT)', scope: 'Binance BTCUSDT perp (scored series; OKX/Bybit cross-checks only)', staleAfterSec: 1800, crosscheck: e3a?.crosscheck ?? null, check_series: e3a?.check ?? null, hourly8: e3h }),
    funding_context: rec({ value: der && Object.values(der.funding).some(v => v != null) ? der.funding : null, unit: 'fraction per funding interval', window: 'last/current interval', asOf: new Date(now).toISOString(), source: 'Binance premiumIndex, Bybit tickers, OKX funding-rate', scope: 'context only (dead band at 0.01%; not scored)', quality: der && Object.values(der.funding).some(v => v != null) ? 'OK' : 'MISSING', staleAfterSec: 1800 }),
    oi_btc_total: rec({ value: der?.total_btc ?? null, unit: 'BTC', window: 'spot', asOf: der?.asOf ?? null, source: 'Binance fapi/dapi, Bybit v5, OKX v5 open interest (contract specs checked live)', scope: 'USDT-linear + USD-inverse perps on Binance, Bybit, OKX (USDC perps excluded)', quality: der?.total_btc != null ? 'OK' : 'MISSING', staleAfterSec: 1800, chg24h_pct: der?.chg24h_pct ?? null, chg7d_pct: der?.chg7d_pct ?? null, partial_total_btc: der?.partial_total_btc ?? null, byVenue: der?.venues ?? null }),
    coinbase_premium_adj: rec({ ...(e5a || {}), source: 'Coinbase BTC-USD, Coinbase USDT-USD, Binance BTCUSDT (vision mirror), hourly closes', scope: 'US spot (Coinbase) vs offshore spot (Binance), USDT corrected', staleAfterSec: 7200 }),
    liquidations_24h: rec({ ...(e4 || {}), source: 'maisontoe-liq recorder files (read-only)', staleAfterSec: 1800 }),
  };

  // E5a reproducibility check (§8.8): the GitHub job computes the same daily medians with the same code;
  // compare on the days both have. Divergence > 0.2 bp raises an alarm flag.
  const repro = daily?.inputs?.coinbase_premium_adj_repro?.dayMedians;
  if (inputs.coinbase_premium_adj && repro && e5a?.dayMedians) {
    const common = Object.keys(repro).filter(d => d in e5a.dayMedians);
    const diffs = common.map(d => Math.abs(repro[d] - e5a.dayMedians[d]) * 100);    // % → bp
    const maxBp = diffs.length ? Math.max(...diffs) : null;
    inputs.coinbase_premium_adj.repro_check = { days: common.length, max_diff_bp: maxBp, alarm_bp: 0.2, status: maxBp == null ? 'MISSING' : maxBp <= 0.2 ? 'OK' : 'ALARM' };
    if (maxBp != null && maxBp > 0.2) errors.push(`E5a reproducibility ALARM: VPS vs GitHub daily medians differ by ${maxBp.toFixed(3)} bp`);
  }
  // History files (once per UTC day, acceptance-checked) and the engine. Any failure withholds the
  // scores block; it never stops the inputs snapshot.
  let hist = { status: 'not run' }, engine = null, frozenEngine = null;
  try {
    hist = await refreshHistory({ dir: path.join(BASE, 'history'), baseUrl: cfg.historyBaseUrl, state: state.data, now, deadline: t0 + (cfg.cycleDeadlineSec ?? 140) * 1000 - 20000 });
    if (hist.issues?.length) errors.push(`history ${hist.status}: ${hist.issues.join('; ')}`);
  } catch (e) { errors.push(`history: ${e.message}`); }
  try {
    const history = loadHistory(path.join(BASE, 'history'));
    engine = scoreSnapshot({ inputs, history, daily, nowMs: now, mode: 'live' });
    engine.historyPull = { status: hist.status, issues: hist.issues || [] };
    // Frozen daily evaluation (windows ending at D 00:00), only in the cycle that freezes the day.
    if (freezeDue(path.join(BASE, 'snapshots'), { dailyGeneratedAt: daily?.generatedAt ?? null }, now) === 'due') {
      frozenEngine = scoreSnapshot({ inputs, history, daily, nowMs: now, mode: 'frozen' });
    }
    if (engine.joinIssues?.length) errors.push(`join: ${engine.joinIssues.length} overlap issue(s), first: ${engine.joinIssues[0].series} ${engine.joinIssues[0].issue}`);
  } catch (e) { errors.push(`engine: ${e.message}`); engine = { status: 'ERROR', withheld: true, reason: `engine error: ${e.message}`.slice(0, 200), families: null, scores: null }; }

  // seq: time-based floor so a lost/corrupt state.json can never lock pushes out (Worker needs increasing seq)
  state.data.seq = Math.max((state.data.seq || 0) + 1, Math.floor(Date.now() / 1000));
  const snap = {
    schema: 'brief-v2/2', codeVersion: CODE_VERSION, seq: state.data.seq, generatedAt: new Date().toISOString(), host: 'vps',
    inputs, engine, daily: { url: cfg.dailyUrl, generatedAt: daily?.generatedAt ?? null, inputs: dailyInputs, errors: daily?.errors ?? null },
    runs: {
      durationMs: Date.now() - t0, deadlineHit: http.deadlineHit, httpCalls: http.calls, binanceMaxUsedWeight1m: http.maxWeightSeen, binanceBudgetStopped: http.binanceStopped,
      clock, disk: { freeGB: +(disk.freeBytes / 1e9).toFixed(1), freePct: +disk.freePct.toFixed(1), storeMB: +(dirBytes(BASE) / 1e6).toFixed(1) }, gzippedFiles: gzipped,
      errors: [...errors, ...http.errors.map(e => `${e.name}: ${e.error}`)].slice(0, 40), dryRun: DRY,
    },
  };

  // Frozen daily snapshot (track record). Decided and written BEFORE the push so the Worker gets it;
  // the compact record rides along on every push until one push succeeds (Worker never overwrites).
  // Pending dates are a queue, oldest first, so an unpushed day is never overwritten by the next one.
  const due = freezeDue(path.join(BASE, 'snapshots'), { dailyGeneratedAt: daily?.generatedAt ?? null }, now);
  const frozen = due ? writeFrozen(path.join(BASE, 'snapshots'), due, { snap, frozenEngine: frozenEngine || { status: 'ERROR', withheld: true, reason: 'frozen evaluation did not run' } }, now) : null;
  if (!Array.isArray(state.data.frozenPending)) state.data.frozenPending = state.data.frozenPending ? [state.data.frozenPending] : [];
  if (frozen) { console.log(`[cycle] frozen daily snapshot: ${frozen}`); state.data.frozenPending.push(new Date(now).toISOString().slice(0, 10)); }
  while (state.data.frozenPending.length) {
    const rec = frozenRecord(path.join(BASE, 'snapshots'), state.data.frozenPending[0]);
    if (rec) { snap.frozen = rec; break; }
    state.data.frozenPending.shift();
  }
  let push = { ok: false, status: null, skipped: DRY ? 'dry-run' : null };
  if (!DRY) {
    if (!process.env.V2_PUSH_SECRET) push = { ok: false, skipped: 'V2_PUSH_SECRET not set' };
    else if (!clock.synced) push = { ok: false, skipped: 'clock not NTP-synchronised (Worker would reject or misorder)' };
    else {
      try {
        push = await pushSnapshot({ workerUrl: cfg.workerUrl, secret: process.env.V2_PUSH_SECRET }, snap);
        if (push.status === 409 && Number.isInteger(push.body?.have)) {          // Worker holds a higher seq: catch up once
          snap.seq = push.body.have + 1; state.data.seq = snap.seq;
          push = await pushSnapshot({ workerUrl: cfg.workerUrl, secret: process.env.V2_PUSH_SECRET }, snap);
        }
      } catch (e) { push = { ok: false, error: e.message }; }
    }
  }
  if (push.ok && snap.frozen && state.data.frozenPending[0] === snap.frozen.date) state.data.frozenPending.shift();
  archiveSnapshot(path.join(BASE, 'snapshots'), snap, { pushed: !!push.ok, receivedAt: push.body?.receivedAt ?? null, pushStatus: push.status ?? push.skipped ?? push.error ?? null });
  state.save();
  fs.writeFileSync(path.join(BASE, 'status.json'), JSON.stringify({ lastRun: snap.generatedAt, seq: snap.seq, push, runs: snap.runs, quality: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.quality])) }, null, 1));

  // One readable summary line per input (journalctl -u brief-v2-cycle)
  for (const [k, v] of Object.entries(inputs)) console.log(`[cycle] ${k}: ${typeof v.value === 'object' && v.value ? JSON.stringify(v.value) : v.value} ${v.unit || ''} [${v.quality}]`);
  if (engine?.scores) { const e = engine.scores[engine.primary?.entry], t = engine.scores[engine.primary?.tendency]; console.log(`[cycle] engine (${engine.status}): entry ${e?.withheld ? 'withheld' : e?.score + ' ' + e?.band} | tendency ${t?.withheld ? 'withheld' : t?.score + ' ' + t?.band} | history ${hist.status}`); }
  else console.log(`[cycle] engine: withheld — ${engine?.reason || 'unknown'} | history ${hist.status}`);
  console.log(`[cycle] daily inputs: ${Object.keys(dailyInputs).join(', ') || 'none'} | push: ${push.ok ? 'OK seq ' + snap.seq : JSON.stringify(push)} | binance weight max ${http.maxWeightSeen} | ${Date.now() - t0} ms | errors ${snap.runs.errors.length}`);
  if (snap.runs.errors.length) for (const e of snap.runs.errors) console.log(`[cycle]   ! ${e}`);
}

main().catch(e => { console.error('[cycle] fatal:', e); process.exit(1); });
