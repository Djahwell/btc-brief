'use strict';
// Vintage store, state file, snapshot archive (STAGE2-PLAN §2, §8.10). Append-only; nothing deleted.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const day = ms => new Date(ms).toISOString().slice(0, 10);

class Vintage {
  constructor(dir, now = () => Date.now()) { this.dir = dir; this.now = now; fs.mkdirSync(dir, { recursive: true }); }
  append(name, record) {
    const d = path.join(this.dir, day(this.now()));
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, `${name}.jsonl`), JSON.stringify(record) + '\n');
  }
  // Gzip every finished day (first cycle after 00:00 UTC does it); keep the gz, remove the plain file only after the gz is verified.
  compressFinishedDays() {
    const today = day(this.now()); let n = 0;
    for (const d of fs.readdirSync(this.dir)) {
      if (d >= today || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const dd = path.join(this.dir, d);
      for (const f of fs.readdirSync(dd)) {
        if (!f.endsWith('.jsonl')) continue;
        const src = path.join(dd, f), gz = src + '.gz';
        const raw = fs.readFileSync(src);
        const packed = zlib.gzipSync(raw);
        fs.writeFileSync(gz, packed);
        if (zlib.gunzipSync(fs.readFileSync(gz)).equals(raw)) { fs.unlinkSync(src); n++; }
      }
    }
    return n;
  }
}

class State {
  constructor(file) { this.file = file; this.data = {}; try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = {}; } }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); }
}

function archiveSnapshot(dir, snap, extra, now = Date.now()) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${day(now)}.jsonl`), JSON.stringify({ ...extra, snapshot: snap }) + '\n');
  // Frozen daily snapshot: the first one written after 00:00 UTC each day (Stage 4/5 daily scoring).
  const dd = path.join(dir, 'daily'); fs.mkdirSync(dd, { recursive: true });
  const f = path.join(dd, `${day(now)}.json`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ ...extra, snapshot: snap }));
}

// Frozen daily snapshot (STAGE3-PLAN §6, Board fix 2): the first cycle of UTC day D that reads a
// daily.json generated on D (the 00:10 run), up to and including the 02:07 cycle. After that with none
// frozen, the day is recorded as missing. The frozen evaluation uses windows ending at D 00:00 (the
// Stage 4 evaluation time), so it can be rebuilt from history exactly. Never overwritten.
const FREEZE_DEADLINE_MIN = 2 * 60 + 8;          // the cycle that starts at 02:07 still counts
function freezeDue(dir, { dailyGeneratedAt }, now = Date.now()) {
  const D = day(now); const f = path.join(dir, 'frozen', `${D}.json`);
  if (fs.existsSync(f)) return null;
  const minutes = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
  if (minutes >= FREEZE_DEADLINE_MIN) return 'missing';
  if (!dailyGeneratedAt || dailyGeneratedAt.slice(0, 10) !== D) return null;   // wait for the 00:10 daily run
  return 'due';
}
function writeFrozen(dir, kind, { snap, frozenEngine }, now = Date.now()) {
  const dd = path.join(dir, 'frozen'); fs.mkdirSync(dd, { recursive: true });
  const D = day(now); const f = path.join(dd, `${D}.json`);
  if (fs.existsSync(f)) return null;
  if (kind === 'missing') fs.writeFileSync(f, JSON.stringify({ date: D, missing: true, reason: "no cycle read that day's daily.json by the 02:07 UTC cycle" }));
  else fs.writeFileSync(f, JSON.stringify({ date: D, missing: false, frozenAt: new Date(now).toISOString(), frozenEngine, snapshot: snap }));
  return kind === 'missing' ? 'missing' : 'frozen';
}
// Back-compatible single call (tests): decide and write.
function freezeDaily(dir, snap, { dailyGeneratedAt, frozenEngine = null }, now = Date.now()) {
  const k = freezeDue(dir, { dailyGeneratedAt }, now);
  return k ? writeFrozen(dir, k, { snap, frozenEngine: frozenEngine || snap.engine || null }, now) : null;
}

// Compact copy of a frozen day for the Worker (track record and the §7 parity check): scores and, per
// family, score, raw value, percentile and asOf, plus hashes. A few KB.
function frozenRecord(dir, date) {
  let f; try { f = JSON.parse(fs.readFileSync(path.join(dir, 'frozen', `${date}.json`), 'utf8')); } catch { return null; }
  if (f.missing) return { date, missing: true, reason: f.reason };
  const e = f.frozenEngine || f.snapshot.engine || {};
  const pick = v => ({ score: v.score ?? null, raw: typeof v.raw === 'number' ? v.raw : null, pct: typeof v.pct === 'number' ? v.pct : null, asOf: v.asOf ?? null, state: v.state ?? null, reason: v.score == null ? (v.reason ?? null) : null });
  return {
    date, missing: false, seq: f.snapshot.seq, generatedAt: f.snapshot.generatedAt, frozenAt: f.frozenAt,
    engine: { status: e.status ?? null, mode: e.mode ?? null, withheld: e.withheld ?? true, reason: e.reason ?? null, declarationHash: e.declarationHash ?? null, engineCodeHash: e.engineCodeHash ?? null,
      primary: e.primary ?? null, scores: e.scores ?? null,
      families: e.families ? Object.fromEntries(Object.entries(e.families).map(([k, v]) => [k, pick(v)])) : null },
  };
}

module.exports = { Vintage, State, archiveSnapshot, freezeDaily, freezeDue, writeFrozen, frozenRecord, day, FREEZE_DEADLINE_MIN };
