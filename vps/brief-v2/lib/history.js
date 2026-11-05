'use strict';
// History pull for the live engine (STAGE3-PLAN §3). Once per UTC day (or when nothing is cached),
// download the v2-data history manifest + files into history/next/, accept them only if every check
// passes, then swap them into history/current/. A refused pull keeps the previous accepted copy.
// Acceptance checks (fail closed, all must pass):
//   1. manifest schema brief-v2-history/1 and no build errors
//   2. every file listed with a sha256 is downloaded and matches it
//   3. versus the previously accepted copy: no file disappears, row counts never decrease, the last
//      date never moves backwards, and (c) the overlapping rows agree within each input's tolerance
//      (OVERLAP below). A revision beyond tolerance (e.g. BMP or DefiLlama rewriting history) refuses
//      the set and keeps the previous one, flagged, until Djahwell accepts it by writing that
//      manifest's generatedAt into history/ACCEPT (one line).
// The GitHub build already refuses to commit a partial build; these checks guard the transfer
// and a bad rebuild.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

function acceptance(next, prev) {
  const bad = [];
  if (next.schema !== 'brief-v2-history/1') bad.push(`manifest schema ${next.schema}`);
  if (Array.isArray(next.errors) && next.errors.length) bad.push(`manifest has ${next.errors.length} build errors`);
  if (prev) {
    for (const [k, p] of Object.entries(prev.files || {})) {
      const n = next.files?.[k];
      if (!n) { bad.push(`${k} disappeared`); continue; }
      if (n.rows < p.rows) bad.push(`${k} rows ${p.rows} → ${n.rows}`);
      if (p.last && n.last && n.last < p.last) bad.push(`${k} last ${p.last} → ${n.last} (backwards)`);
    }
  }
  for (const [k, n] of Object.entries(next.files || {})) if (!n.sha256) bad.push(`${k} has no sha256 in the manifest`);
  return bad;
}

// Overlap tolerance per file: [value field, relative tolerance]. Same tolerances as the cross-checks.
const OVERLAP = {
  coinbase_daily: ['c', 0.002], bitstamp_daily: ['c', 0.002], coinbase_premium_legs_1h: ['cb', 0.001],
  binance_premium_index_1h: ['close', 1e-9], binance_funding: ['rate', 1e-9], fear_greed: ['v', 0],
  coinmetrics_mvrv: ['v', 0.01], bgeometrics_realized: ['v', 0.01], stablecoins_usdt_usdc: ['usdt', 0.01], bmp_lth: ['v', 0.002],
};
function overlapIssues(name, prevRows, nextRows) {
  const spec = OVERLAP[name]; if (!spec) return [`${name}: no overlap rule declared`];
  const [f, tol] = spec; const prev = new Map(prevRows.map(r => [r.t, r[f]]));
  let n = 0, worst = 0, first = null;
  for (const r of nextRows) {
    if (!prev.has(r.t)) continue;
    const a = prev.get(r.t), b = r[f];
    if (a == null && b == null) continue;
    const rel = a == null || b == null ? Infinity : Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
    if (tol === 0 ? a !== b : rel > tol) { n++; if (rel > worst) worst = rel; if (!first) first = new Date(r.t * 1000).toISOString().slice(0, 10); }
  }
  return n ? [`${name}: ${n} overlapping rows revised beyond tolerance (first ${first}, max ${(worst * 100).toFixed(3)}%)`] : [];
}

async function getBuf(fetchImpl, url, deadline) {
  const left = deadline - Date.now();
  if (left < 5000) throw new Error('cycle deadline: history pull postponed');
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'brief-v2 (personal)' }, signal: AbortSignal.timeout(Math.min(30000, left - 3000)) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('/').pop()}`);
  return Buffer.from(await r.arrayBuffer());
}

// Returns { status, generatedAt, files, issues } and leaves accepted files in <dir>/current.
async function refreshHistory({ dir, baseUrl, fetchImpl = globalThis.fetch, state, now = Date.now(), deadline = Infinity }) {
  const cur = path.join(dir, 'current'), next = path.join(dir, 'next');
  fs.mkdirSync(cur, { recursive: true });
  let prev = null; try { prev = JSON.parse(fs.readFileSync(path.join(cur, 'manifest.json'), 'utf8')); } catch { /* none yet */ }
  const today = new Date(now).toISOString().slice(0, 10);
  if (prev && state.historyCheckedDay === today) return { status: 'cached', generatedAt: prev.generatedAt, issues: state.historyIssues || [] };
  let issues = [];
  try {
    const manBuf = await getBuf(fetchImpl, `${baseUrl}/manifest.json?t=${Math.floor(now / 60000)}`, deadline);
    const man = JSON.parse(manBuf.toString('utf8'));
    if (prev && man.generatedAt === prev.generatedAt) { state.historyCheckedDay = today; state.historyIssues = []; return { status: 'unchanged', generatedAt: prev.generatedAt, issues: [] }; }
    issues = acceptance(man, prev);
    if (!issues.length) {
      fs.rmSync(next, { recursive: true, force: true }); fs.mkdirSync(next, { recursive: true });
      for (const [k, f] of Object.entries(man.files || {})) {
        const buf = await getBuf(fetchImpl, `${baseUrl}/${k}.json.gz?sha=${f.sha256.slice(0, 12)}`, deadline);
        if (sha256(buf) !== f.sha256) { issues.push(`${k} sha256 mismatch`); break; }
        const parsed = JSON.parse(zlib.gunzipSync(buf));            // must be a readable gzip of JSON
        if (!Array.isArray(parsed.rows) || parsed.rows.length !== f.rows) { issues.push(`${k} row count ${parsed.rows?.length} ≠ manifest ${f.rows}`); break; }
        const prevFile = path.join(cur, `${k}.json.gz`);
        if (prev && fs.existsSync(prevFile)) issues.push(...overlapIssues(k, JSON.parse(zlib.gunzipSync(fs.readFileSync(prevFile))).rows, parsed.rows));
        fs.writeFileSync(path.join(next, `${k}.json.gz`), buf);
      }
    }
    let accepted = null; try { accepted = fs.readFileSync(path.join(dir, 'ACCEPT'), 'utf8').trim(); } catch { /* none */ }
    const onlyRevisions = issues.length && issues.every(i => /revised beyond tolerance/.test(i));
    if (onlyRevisions && accepted === man.generatedAt) issues = [];                 // Djahwell accepted these revisions
    if (issues.length) { state.historyCheckedDay = today; state.historyIssues = issues; fs.rmSync(next, { recursive: true, force: true }); return { status: prev ? 'refused-kept-previous' : 'refused-no-history', generatedAt: prev?.generatedAt ?? null, issues }; }
    fs.writeFileSync(path.join(next, 'manifest.json'), manBuf);
    const old = path.join(dir, 'previous');
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(cur, old); fs.renameSync(next, cur);           // swap; the previous copy is kept one generation
    state.historyCheckedDay = today; state.historyIssues = [];
    return { status: 'updated', generatedAt: man.generatedAt, issues: [] };
  } catch (e) {
    // Network failure: keep what we have and retry next cycle (checked-day not set).
    return { status: prev ? 'pull-failed-kept-previous' : 'pull-failed-no-history', generatedAt: prev?.generatedAt ?? null, issues: [String(e.message || e)] };
  }
}

function loadHistory(dir) {
  const cur = path.join(dir, 'current'); const hist = {};
  let manifest = null; try { manifest = JSON.parse(fs.readFileSync(path.join(cur, 'manifest.json'), 'utf8')); } catch { return null; }
  for (const f of fs.readdirSync(cur)) if (f.endsWith('.json.gz')) hist[f.slice(0, -8)] = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(cur, f))));
  return { hist, manifest };
}

module.exports = { refreshHistory, loadHistory, acceptance, overlapIssues, OVERLAP };
