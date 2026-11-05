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
// daily.json generated on D (the 00:10 run), before 02:07 UTC. At or after 02:07 with none frozen,
// the day is recorded as missing. Same moment as the Stage 4 evaluation time. Never overwritten.
const FREEZE_DEADLINE_MIN = 2 * 60 + 7;
function freezeDaily(dir, snap, { dailyGeneratedAt }, now = Date.now()) {
  const dd = path.join(dir, 'frozen'); fs.mkdirSync(dd, { recursive: true });
  const D = day(now); const f = path.join(dd, `${D}.json`);
  if (fs.existsSync(f)) return null;
  const minutes = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
  if (minutes >= FREEZE_DEADLINE_MIN) { fs.writeFileSync(f, JSON.stringify({ date: D, missing: true, reason: 'no cycle read that day\'s daily.json before 02:07 UTC' })); return 'missing'; }
  if (!dailyGeneratedAt || dailyGeneratedAt.slice(0, 10) !== D) return null;   // wait for the 00:10 daily run
  fs.writeFileSync(f, JSON.stringify({ date: D, missing: false, frozenAt: new Date(now).toISOString(), snapshot: snap }));
  return 'frozen';
}

module.exports = { Vintage, State, archiveSnapshot, freezeDaily, day, FREEZE_DEADLINE_MIN };
