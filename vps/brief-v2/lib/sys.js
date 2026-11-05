'use strict';
// Host guards: disk floor, clock sync (STAGE2-PLAN §8.1, §8.4).
const fs = require('fs');
const { execFile } = require('child_process');

function diskFree(dir) {
  const s = fs.statfsSync(dir);
  const free = s.bavail * s.bsize, total = s.blocks * s.bsize;
  return { freeBytes: free, totalBytes: total, freePct: total ? free / total * 100 : null };
}
// Stop if free < max(5 GB, 20%) (defaults; config.json diskFloorGB / diskFloorPct).
function diskOk(dir, { gb = 5, pct = 20 } = {}) {
  const d = diskFree(dir);
  const floor = Math.max(gb * 1024 ** 3, pct / 100 * d.totalBytes);
  return { ok: d.freeBytes >= floor, ...d, floorBytes: floor };
}
function clockSynced() {
  return new Promise(res => execFile('timedatectl', ['show', '-p', 'NTPSynchronized', '--value'], { timeout: 5000 }, (err, out) => {
    const v = String(out || '').trim();
    res({ synced: v === 'yes', raw: err ? `error: ${err.message}` : v });
  }));
}
function dirBytes(dir) {
  let n = 0;
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else n += fs.statSync(p).size; } };
  try { walk(dir); } catch { /* ignore */ }
  return n;
}
module.exports = { diskOk, clockSynced, dirBytes };
