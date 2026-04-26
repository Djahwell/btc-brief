#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/snapshot_history.js  —  Daily/intraday snapshot writer
// ─────────────────────────────────────────────────────────────────────────────
// Copies public/all_data.json  ->  public/history/YYYY-MM-DD-HH.json (UTC).
// Run by data-refresh.yml after data-worker has populated all_data.json.
//
// Why: builds an append-only archive of every cron cycle (4x/day) so the
// brief's predicted bias / score / on-chain signals can be back-tested
// against the actual price move that followed.
//
// Filename:    history/YYYY-MM-DD-HH.json   (UTC hour, e.g. 2026-04-25-18.json)
// Index file:  history/index.json           (lists every snapshot key, sorted desc)
//
// Storage estimate: ~80KB/snapshot * 4/day = ~115MB/year on the gh-pages branch
// (single-commit deploy keeps the git history slim — branch size = current
// public/ folder size, no dangling history).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname }                                                              from 'path';
import { fileURLToPath }                                                              from 'url';

const __filename   = fileURLToPath(import.meta.url);
const ROOT         = dirname(dirname(__filename));
const SRC          = join(ROOT, 'public', 'all_data.json');
const HISTORY_DIR  = join(ROOT, 'public', 'history');
const INDEX_FILE   = join(HISTORY_DIR, 'index.json');

// ── Pre-flight: source file must exist and parse ──────────────────────────────
if (!existsSync(SRC)) {
  console.error(`[snapshot] ${SRC} not found — skipping (data-worker may have failed)`);
  process.exit(0); // soft-fail: don't break CI deploy
}

let data;
try {
  data = JSON.parse(readFileSync(SRC, 'utf8'));
} catch (e) {
  console.error(`[snapshot] all_data.json is invalid JSON: ${e.message}`);
  process.exit(0);
}

// ── Build snapshot key (UTC, deterministic per cron hour) ─────────────────────
const now  = new Date();
const yyyy = now.getUTCFullYear();
const mm   = String(now.getUTCMonth() + 1).padStart(2, '0');
const dd   = String(now.getUTCDate()).padStart(2, '0');
const hh   = String(now.getUTCHours()).padStart(2, '0');
const key  = `${yyyy}-${mm}-${dd}-${hh}`;
const filename = `${key}.json`;

mkdirSync(HISTORY_DIR, { recursive: true });
const dest = join(HISTORY_DIR, filename);

// ── Annotate snapshot with capture metadata then write ────────────────────────
// snapshotKey makes the file self-identifying even if renamed; snapshotAt is
// the precise capture moment (cron schedule may drift by minutes).
data.snapshotAt  = now.toISOString();
data.snapshotKey = key;

writeFileSync(dest, JSON.stringify(data, null, 2));
const sizeKB = (statSync(dest).size / 1024).toFixed(1);
console.log(`[snapshot] Wrote ${filename} (${sizeKB} KB)`);

// ── Rebuild index.json — descending sort so newest is first ───────────────────
// Clients can fetch history/index.json once to discover available snapshots
// without scraping a directory listing (gh-pages doesn't expose one).
const allFiles = readdirSync(HISTORY_DIR)
  .filter(f => f.endsWith('.json') && f !== 'index.json' && /^\d{4}-\d{2}-\d{2}-\d{2}\.json$/.test(f));
const keys = allFiles.map(f => f.replace('.json', '')).sort().reverse();

const oldest = keys[keys.length - 1] || null;
const newest = keys[0] || null;

writeFileSync(INDEX_FILE, JSON.stringify({
  generatedAt: now.toISOString(),
  count:       keys.length,
  newest,
  oldest,
  keys,
}, null, 2));

console.log(`[snapshot] index.json updated — ${keys.length} snapshots (oldest: ${oldest}, newest: ${newest})`);
