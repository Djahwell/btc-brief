'use strict';
// E3a reading used by the ENGINE (Board build review #1): the mean of the 8 completed HOURLY closes of
// the Binance BTCUSDT premium index — the exact definition of the history file and the backtest
// (engine-v2/view.js). Two windows: ending at the last completed hour (intraday display) and ending at
// today's 00:00 UTC (frozen daily record = Stage 4 evaluation time). All 8 closes required; exact
// zeros are placeholders (missing). The 1-minute 8 h mean in premium.js stays the displayed/cross-checked input.
const H = 3600;

function mean8(closes, endSec) {
  const xs = [];
  for (let k = 8; k >= 1; k--) { const v = closes.get(endSec - k * H); if (v == null) return null; xs.push(v); }
  return xs.reduce((a, b) => a + b, 0) / 8;
}

async function computeE3aHourly(http, nowMs) {
  // weight 1 (limit < 100). 30 h covers both windows until well after the 02:07 freeze deadline.
  const rows = await http.json('binance_premium_1h', 'https://fapi.binance.com/fapi/v1/premiumIndexKlines?symbol=BTCUSDT&interval=1h&limit=30', { store: true });
  const nowSec = Math.floor(nowMs / 1000);
  const closes = new Map();
  for (const r of rows) {
    const t = Math.floor(Number(r[0]) / 1000), c = Number(r[4]);
    if (t + H <= nowSec && Number.isFinite(c) && c !== 0) closes.set(t, c);   // completed hours only
  }
  const endLast = Math.floor(nowSec / H) * H;
  const d00 = Math.floor(nowSec / 86400) * 86400;
  const cur = mean8(closes, endLast), mid = mean8(closes, d00);
  return {
    current: { value: cur, endSec: endLast, asOf: new Date(endLast * 1000).toISOString() },
    atD00: { value: mid, endSec: d00, asOf: new Date(d00 * 1000).toISOString() },
    unit: 'fraction', window: 'mean of 8 completed hourly closes',
  };
}

module.exports = { computeE3aHourly, mean8 };
