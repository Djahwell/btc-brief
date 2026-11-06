'use strict';
// Runs the shared engine (engine-v2, copied into ./engine by package.sh) on the live view.
// STAGE3-PLAN §2: same file as the Stage 4 backtest; snapshot carries the declaration hash and the
// engine code hash so the page and the parity check can refuse anything else.
// Two evaluation moments (Board build review #1–#2):
//   'live'   — display: E3a = 8 hourly closes ending at the last completed hour, E5a = window ending at
//              the last completed hour; both must be within their staleAfterSec (review #13).
//   'frozen' — the daily record: both windows end at today's 00:00 UTC, exactly as the backtest.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function engineDir() {
  for (const d of [path.join(__dirname, '..', 'engine'), path.join(__dirname, '..', '..', '..', 'engine-v2')]) if (fs.existsSync(path.join(d, 'engine.js'))) return d;
  throw new Error('engine not found');
}

function codeHash(dir) {
  const h = crypto.createHash('sha256');
  for (const f of ['engine.js', 'view.js', 'live.js']) h.update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex');
}

const fin = x => typeof x === 'number' && Number.isFinite(x);

// Live readings for the engine from the snapshot inputs. Returns { premium8h (fraction), e5aZ, notes }.
function liveReadings(inputs, nowMs, mode) {
  const notes = [];
  const prem = inputs.perp_premium_binance_8h || {}, cbp = inputs.coinbase_premium_adj || {};
  const fresh = (asOf, maxSec) => asOf && (nowMs - Date.parse(asOf)) / 1000 <= maxSec;
  let premium8h = null, e5aZ = null;
  if (mode === 'frozen') {
    premium8h = fin(prem.hourly8?.atD00?.value) ? prem.hourly8.atD00.value : null;
    e5aZ = cbp.atD00 && cbp.atD00.complete && fin(cbp.atD00.z30) ? cbp.atD00.z30 : null;
  } else {
    const h = prem.hourly8?.current;
    if (h && fin(h.value) && fresh(h.asOf, (prem.staleAfterSec || 1800) + 3600)) premium8h = h.value;   // hour-end stamp: allow the hour in progress
    else notes.push('E3a hourly reading missing or stale');
    if (cbp.quality === 'OK' && fin(cbp.z30) && fresh(cbp.asOf, cbp.staleAfterSec || 7200)) e5aZ = cbp.z30;
    else notes.push('E5a reading missing or stale');
  }
  return { premium8h, e5aZ, notes };
}

// inputs: the snapshot inputs block; history: loadHistory() result or null; daily: daily.json or null.
function scoreSnapshot({ inputs, history, daily, nowMs, mode = 'live' }) {
  const dir = engineDir();
  const E = require(path.join(dir, 'engine.js'));
  const L = require(path.join(dir, 'live.js'));
  const decl = JSON.parse(fs.readFileSync(path.join(dir, 'declaration.json'), 'utf8'));
  const base = { status: 'CANDIDATE — untested (Stage 4 pending)', mode, declarationHash: E.declarationHash(decl), engineCodeHash: codeHash(dir), evaluatedAt: new Date(nowMs).toISOString() };
  if (!history) return { ...base, withheld: true, reason: 'no accepted history files on the VPS', families: null, scores: null };
  const lr = liveReadings(inputs, nowMs, mode);
  const { view, joinIssues } = L.liveView({ hist: history.hist, daily, live: { nowMs, premium8h: lr.premium8h, e5aZ: lr.e5aZ } });
  const r = E.evaluate(view, decl);
  let summary = null; try { summary = require(path.join(dir, 'summary.js')).summarize(r, decl); } catch (_) { /* optional */ }
  // FW1 forward candidate (FORWARD-FW1.md): same families and bars, its own declaration and hash.
  let fw1 = null;
  try {
    const fd = JSON.parse(fs.readFileSync(path.join(dir, 'declaration-fw1.json'), 'utf8'));
    fw1 = { ...require(path.join(dir, 'fw1.js')).fw1(r, view.bars, fd), declarationHash: E.declarationHash(fd), fw1CodeHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'fw1.js'))).digest('hex'), status: 'UNTESTED — forward test (FORWARD-FW1.md)' };
  } catch (e) { fw1 = { error: String(e.message).slice(0, 120) }; }
  return {
    ...base, withheld: false,
    date: r.date, primary: r.primary, families: r.families, scores: r.scores, warnings: r.warnings,
    summary, fw1, joinIssues, readingNotes: lr.notes, history: { generatedAt: history.manifest.generatedAt },
    daily: { generatedAt: daily?.generatedAt ?? null },
  };
}

module.exports = { scoreSnapshot, liveReadings, engineDir, codeHash };
