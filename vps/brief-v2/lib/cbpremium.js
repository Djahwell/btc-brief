'use strict';
// E5a USDT-adjusted Coinbase premium (DESIGN v0.4 §3.2; STAGE2-PLAN §8.8).
// Rebuilt every cycle from COMPLETED hourly candles, same products and alignment as the audited history:
//   adj = Coinbase BTC-USD ÷ (Binance BTC-USDT × Coinbase USDT-USD) − 1   (hourly closes)
// value = median of the last 24 completed hours (%)
// z     = (value − mean(D)) / sd(D), D = the 30 previous completed UTC days' medians of hourly adj
const H = 3600, DAYS = 31;

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function coinbaseHourly(http, product, startSec, endSec, vintageName, state) {
  const out = new Map();
  for (let s = startSec; s < endSec; s += 300 * H) {
    const e = Math.min(s + 300 * H, endSec);
    const rows = await http.json(vintageName, `https://api.exchange.coinbase.com/products/${product}/candles?granularity=3600&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`, { store: false });
    for (const r of rows) if (r[0] >= startSec && r[0] < endSec) out.set(r[0], Number(r[4]));
  }
  return out;
}

async function binanceSpotHourly(http, startSec, endSec) {
  // Public market-data mirror: separate from the bot's api.binance.com / fapi weight budget.
  const rows = await http.json('binance_spot_1h', `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&startTime=${startSec * 1000}`, { store: false });
  const out = new Map();
  for (const r of rows) { const t = Number(r[0]) / 1000; if (t >= startSec && t < endSec) out.set(t, Number(r[4])); }
  return out;
}

function computeFromLegs(cb, usdt, bn, endSec) {
  const hours = [...cb.keys()].filter(t => usdt.has(t) && bn.has(t)).sort((a, b) => a - b);
  const adj = new Map(hours.map(t => [t, (cb.get(t) / (bn.get(t) * usdt.get(t)) - 1) * 100]));
  const last24 = hours.filter(t => t >= endSec - 24 * H).map(t => adj.get(t));
  const curDayStart = Math.floor(endSec / 86400) * 86400;
  const byDay = new Map();
  for (const t of hours) { const d = Math.floor(t / 86400) * 86400; if (d >= curDayStart) continue; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(adj.get(t)); }
  const days = [...byDay.keys()].sort((a, b) => a - b).slice(-30).filter(d => byDay.get(d).length >= 20);
  const D = days.map(d => median(byDay.get(d)));
  const value = last24.length >= 20 ? median(last24) : null;
  let z = null;
  if (value != null && D.length >= 25) {
    const mu = D.reduce((s, x) => s + x, 0) / D.length;
    const sd = Math.sqrt(D.reduce((s, x) => s + (x - mu) ** 2, 0) / D.length);
    z = sd > 0 ? (value - mu) / sd : null;
  }
  return { value, z, hours24: last24.length, days: D.length, lastHour: hours.length ? hours[hours.length - 1] : null, adj };
}

async function computeE5a(http, state, vintage, nowMs) {
  const endSec = Math.floor(nowMs / 1000 / H) * H;          // current hour excluded: completed hours only
  const startSec = endSec - DAYS * 24 * H;
  const cb = await coinbaseHourly(http, 'BTC-USD', startSec, endSec, 'coinbase_btcusd_1h');
  const usdt = await coinbaseHourly(http, 'USDT-USD', startSec, endSec, 'coinbase_usdtusd_1h');
  const bn = await binanceSpotHourly(http, startSec, endSec);
  const r = computeFromLegs(cb, usdt, bn, endSec);
  // Vintage: only hours not stored before (keeps the store small); the full set is re-fetched each cycle.
  const lastStored = state.e5aLastStoredHour || 0;
  const fresh = [...r.adj.keys()].filter(t => t > lastStored);
  if (vintage && fresh.length) {
    vintage.append('e5a_legs_1h', { at: new Date(nowMs).toISOString(), rows: fresh.map(t => ({ t, cb: cb.get(t), usdt: usdt.get(t), bn: bn.get(t) })) });
    state.e5aLastStoredHour = fresh[fresh.length - 1];
  }
  const complete = r.hours24 >= 20 && r.days >= 25;
  return {
    value: r.value, z30: r.z, unit: '%', window: '24h median of hourly USDT-adjusted premium; z vs 30 prior daily medians',
    asOf: r.lastHour ? new Date((r.lastHour + H) * 1000).toISOString() : null,
    hours24: r.hours24, days: r.days, quality: r.value == null ? 'MISSING' : complete ? 'OK' : 'STALE',
  };
}

module.exports = { computeE5a, computeFromLegs };
