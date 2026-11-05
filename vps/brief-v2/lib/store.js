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

module.exports = { Vintage, State, archiveSnapshot, day };
