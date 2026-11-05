'use strict';
// Runs the shared engine (engine-v2, copied into ./engine by package.sh) on the live view.
// STAGE3-PLAN §2: same file as the Stage 4 backtest; snapshot carries the declaration hash and the
// engine code hash so the page and the parity check can refuse anything else.
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

// inputs: the snapshot inputs block; history: loadHistory() result or null; daily: daily.json or null.
function scoreSnapshot({ inputs, history, daily, nowMs }) {
  const dir = engineDir();
  const E = require(path.join(dir, 'engine.js'));
  const L = require(path.join(dir, 'live.js'));
  const decl = JSON.parse(fs.readFileSync(path.join(dir, 'declaration.json'), 'utf8'));
  const base = { status: 'CANDIDATE — untested (Stage 4 pending)', declarationHash: E.declarationHash(decl), engineCodeHash: codeHash(dir), evaluatedAt: new Date(nowMs).toISOString() };
  if (!history) return { ...base, withheld: true, reason: 'no accepted history files on the VPS', families: null, scores: null };
  const ok = r => r && r.quality === 'OK' && typeof r.value === 'number' && Number.isFinite(r.value);
  const prem = inputs.perp_premium_binance_8h, cbp = inputs.coinbase_premium_adj;
  const live = {
    nowMs,
    premium8hPct: ok(prem) ? prem.value : null,
    e5aZ: ok(cbp) && Number.isFinite(cbp.z30) ? cbp.z30 : null,
  };
  const { view, joinIssues } = L.liveView({ hist: history.hist, daily, live });
  const r = E.evaluate(view, decl);
  return {
    ...base, withheld: false,
    date: r.date, primary: r.primary, families: r.families, scores: r.scores, warnings: r.warnings,
    joinIssues, history: { generatedAt: history.manifest.generatedAt },
    daily: { generatedAt: daily?.generatedAt ?? null },
  };
}

module.exports = { scoreSnapshot, engineDir, codeHash };
