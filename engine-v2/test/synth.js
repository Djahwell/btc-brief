'use strict';
// Deterministic synthetic history (seeded) for golden and fail-closed tests. No network, no files.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const DAY = 86400;
function synthHistory(days = 1700, seed = 7) {
  const r = rng(seed); const start = Date.parse('2017-01-01T00:00:00Z') / 1000;
  const cb = [], bs = [], prem = [], legs = [], fng = [], mvrv = [], st = [];
  let p = 1000, m = 1.5, s = 1e9;
  for (let i = 0; i < days; i++) {
    const t = start + i * DAY;
    const ret = (r() - 0.48) * 0.08; const o = p; p = p * (1 + ret);
    const h = Math.max(o, p) * (1 + r() * 0.02), l = Math.min(o, p) * (1 - r() * 0.02);
    cb.push({ t, o, h, l, c: p, v: 1000 + r() * 5000 }); bs.push({ t, o, h, l, c: p, v: 500 + r() * 2000 });
    for (let k = 0; k < 24; k++) {
      prem.push({ t: t + k * 3600, close: (r() - 0.5) * 0.001, open: 0 });
      legs.push({ t: t + k * 3600, cb: p * (1 + (r() - 0.5) * 0.001), usdt: 1, bn: p });
    }
    fng.push({ t, v: Math.floor(r() * 100) });
    m = Math.max(0.5, m * (1 + ret * 0.9)); mvrv.push({ t, v: m });
    s = s * (1 + (r() - 0.45) * 0.01); st.push({ t, usdt: s, usdc: s / 3 });
  }
  return {
    coinbase_daily: { rows: cb }, bitstamp_daily: { rows: bs },
    binance_premium_index_1h: { rows: prem }, coinbase_premium_legs_1h: { rows: legs },
    fear_greed: { rows: fng }, coinmetrics_mvrv: { rows: mvrv }, stablecoins_usdt_usdc: { rows: st },
  };
}
// Declaration used by the synthetic tests: the real one with referenceStart moved to the synthetic start.
function synthDecl() {
  const d = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'declaration.json'), 'utf8'));
  d.referenceStart = '2017-01-01';
  return d;
}
module.exports = { synthHistory, synthDecl };
