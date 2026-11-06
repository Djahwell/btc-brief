'use strict';
// Stage R indicator values at D 00:00 (information before D only; declared lags via the frozen engine).
// No outcomes here. Usage: node research/features.js <historyDir> <from> <to> <out.json>
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const R = path.join(__dirname, '..', 'engine-v2');
const E = require(path.join(R, 'engine.js')), V = require(path.join(R, 'view.js')), F = require(path.join(R, 'fw1.js'));
const add = (x, n) => new Date(Date.parse(x + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function features(P, decl, fd, D) {
  const v = V.viewAt(P, D); const r = E.evaluate(v, decl); const f = r.families; const fw = F.fw1(r, v.bars, fd);
  const bars = v.bars.filter(b => b.d < D); const n = bars.length; const c = bars.map(b => b.c);
  const ret = k => (n > k ? c[n - 1] / c[n - 1 - k] - 1 : null);
  const hi = k => Math.max(...bars.slice(-k).map(b => b.h));
  const lr = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : null));
  const sd = arr => { const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)); };
  const rv7 = n > 8 ? sd(lr.slice(-7)) : null, rv30 = n > 31 ? sd(lr.slice(-30)) : null;
  const atr = f.E1.levels?.atr14 ?? null; const close = c[n - 1];
  const daysSinceHi30 = n > 30 ? 29 - bars.slice(-30).map(b => b.h).lastIndexOf(hi(30)) : null;
  const e2 = f.E2 || {};
  return {
    d: D,
    // trend
    dist20: num(f.E1.parts?.dist20?.raw), dist50: num(f.E1.parts?.dist50?.raw), slope20: num(f.E1.parts?.slope20?.raw), E1: num(f.E1.score),
    dist200: num(f.T3.parts?.dist200?.raw), slope200: num(f.T3.parts?.slope200?.raw), T3: num(f.T3.score),
    fw1Base: fw.entry && !fw.entry.withheld ? fw.entry.parts[0].pts : null, fw1Entry: fw.entry && !fw.entry.withheld ? fw.entry.score : null, fw1Tend: fw.tendency && !fw.tendency.withheld ? fw.tendency.score : null,
    // momentum / mean reversion
    ret1: ret(1), ret3: ret(3), ret7: ret(7), ret30: ret(30),
    dd30: n > 30 ? close / hi(30) - 1 : null, dd90: n > 90 ? close / hi(90) - 1 : null, daysSinceHi30,
    // auction
    e2State: e2.state || null, E2: num(e2.score),
    posVAL: atr && num(e2.val) != null ? (close - e2.val) / atr : null, posPOC: atr && num(e2.poc) != null ? (close - e2.poc) / atr : null, posVAH: atr && num(e2.vah) != null ? (close - e2.vah) / atr : null,
    // volatility
    rvPct: num(f.E6.pct), rvRatio: rv7 && rv30 ? rv7 / rv30 : null, atrPct: atr ? atr / close : null, rv30: rv30,
    // positioning
    premPct: num(f.E3a.pct), premRaw: num(f.E3a.raw), E3a: num(f.E3a.score), cbZ: num(f.E5a.raw), fng: num(f.E7.raw),
    // on-chain / liquidity
    mvrvPct: num(f.T1.pct), mvrvRaw: num(f.T1.raw), lth30: num(f['T2+'].raw), stableX: num(f.T4.raw),
  };
}

if (require.main === module) {
  const [dir, from, to, out] = process.argv.slice(2); const h = {};
  for (const fn of fs.readdirSync(dir)) if (fn.endsWith('.gz')) h[fn.slice(0, -8)] = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, fn))));
  const decl = JSON.parse(fs.readFileSync(path.join(R, 'declaration.json'))), fd = JSON.parse(fs.readFileSync(path.join(R, 'declaration-fw1.json')));
  const P = V.prepare(h); const rows = [];
  for (let D = from; D <= to; D = add(D, 1)) rows.push(features(P, decl, fd, D));
  fs.writeFileSync(out, JSON.stringify(rows));
}
module.exports = { features };
