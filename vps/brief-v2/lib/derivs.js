'use strict';
// E3b open interest in BTC (forward-only) + funding (context). STAGE2-PLAN §8.7.
// Contract specs read live every cycle; a spec that differs from the declared one fails that venue.
// Declared instruments (USDT-linear and USD-inverse perps). USDC perps are not included.
const INSTRUMENTS = [
  { venue: 'binance', inst: 'BTCUSDT', type: 'linear', specNote: 'OI reported in BTC' },
  { venue: 'binance', inst: 'BTCUSD_PERP', type: 'inverse', expect: { contractSize: 100 } },
  { venue: 'bybit', inst: 'BTCUSDT', type: 'linear', specNote: 'OI reported in BTC' },
  { venue: 'bybit', inst: 'BTCUSD', type: 'inverse', specNote: 'OI reported in USD (1 USD contracts)', expect: { contractType: 'InversePerpetual' } },
  { venue: 'okx', inst: 'BTC-USDT-SWAP', type: 'linear', expect: { ctVal: 0.01, ctValCcy: 'BTC' } },
  { venue: 'okx', inst: 'BTC-USD-SWAP', type: 'inverse', expect: { ctVal: 100, ctValCcy: 'USD' } },
];

async function venueBinance(http) {
  const out = {};
  const oi = await http.json('binance_oi_linear', 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
  const pi = await http.json('binance_premiumindex', 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
  out.BTCUSDT = { oi_btc: Number(oi.openInterest), time: Number(oi.time), mark: Number(pi.markPrice), funding: Number(pi.lastFundingRate), nextFunding: Number(pi.nextFundingTime) };
  const ex = await http.json('binance_dapi_exchangeinfo', 'https://dapi.binance.com/dapi/v1/exchangeInfo', { store: false });
  const sym = (ex.symbols || []).find(s => s.symbol === 'BTCUSD_PERP');
  const size = Number(sym?.contractSize);
  if (size !== 100) throw new Error(`BTCUSD_PERP contractSize ${size} ≠ declared 100`);
  const oid = await http.json('binance_oi_inverse', 'https://dapi.binance.com/dapi/v1/openInterest?symbol=BTCUSD_PERP');
  const pid = await http.json('binance_dapi_premiumindex', 'https://dapi.binance.com/dapi/v1/premiumIndex?symbol=BTCUSD_PERP');
  const mark = Number((Array.isArray(pid) ? pid[0] : pid).markPrice);
  out.BTCUSD_PERP = { contracts: Number(oid.openInterest), contractSize: size, mark, oi_btc: Number(oid.openInterest) * size / mark, time: Number(oid.time) };
  return out;
}

async function venueBybit(http) {
  const out = {};
  const lin = await http.json('bybit_tickers_linear', 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
  const l = lin?.result?.list?.[0];
  out.BTCUSDT = { oi_btc: Number(l.openInterest), mark: Number(l.markPrice), funding: Number(l.fundingRate), time: Number(lin.time) };
  const spec = await http.json('bybit_instrument_inverse', 'https://api.bybit.com/v5/market/instruments-info?category=inverse&symbol=BTCUSD', { store: false });
  const ct = spec?.result?.list?.[0]?.contractType;
  if (ct !== 'InversePerpetual') throw new Error(`Bybit BTCUSD contractType ${ct} ≠ InversePerpetual`);
  const inv = await http.json('bybit_tickers_inverse', 'https://api.bybit.com/v5/market/tickers?category=inverse&symbol=BTCUSD');
  const i = inv?.result?.list?.[0];
  out.BTCUSD = { oi_usd: Number(i.openInterest), mark: Number(i.markPrice), oi_btc: Number(i.openInterest) / Number(i.markPrice), funding: Number(i.fundingRate), time: Number(inv.time) };
  return out;
}

async function venueOkx(http) {
  const out = {};
  for (const [inst, exp] of [['BTC-USDT-SWAP', { ctVal: 0.01, ctValCcy: 'BTC' }], ['BTC-USD-SWAP', { ctVal: 100, ctValCcy: 'USD' }]]) {
    const spec = (await http.json(`okx_instrument_${inst}`, `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${inst}`, { store: false }))?.data?.[0];
    if (Number(spec?.ctVal) !== exp.ctVal || spec?.ctValCcy !== exp.ctValCcy) throw new Error(`OKX ${inst} spec ${spec?.ctVal} ${spec?.ctValCcy} ≠ declared ${exp.ctVal} ${exp.ctValCcy}`);
    const oi = (await http.json(`okx_oi_${inst}`, `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${inst}`))?.data?.[0];
    const row = { contracts: Number(oi.oi), oi_btc: Number(oi.oiCcy), oi_usd: Number(oi.oiUsd), time: Number(oi.ts) };
    // Consistency check against the live spec: linear oiCcy = contracts × ctVal; inverse oiUsd = contracts × ctVal.
    const chk = exp.ctValCcy === 'BTC' ? row.contracts * exp.ctVal / row.oi_btc : row.contracts * exp.ctVal / row.oi_usd;
    if (!(Math.abs(chk - 1) < 0.01)) throw new Error(`OKX ${inst} OI units inconsistent with spec (ratio ${chk})`);
    if (inst === 'BTC-USDT-SWAP') row.funding = Number((await http.json('okx_funding', 'https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'))?.data?.[0]?.fundingRate);
    out[inst] = row;
  }
  return out;
}

// OI history kept in state (hourly samples, 8 days) for 24 h / 7 d change.
function oiChanges(state, total, nowMs) {
  const H = 3600 * 1000; const hist = (state.oiHist || []).filter(x => x.t >= nowMs - 8 * 24 * H);
  if (total != null && (!hist.length || nowMs - hist[hist.length - 1].t >= H - 5 * 60 * 1000)) hist.push({ t: nowMs, v: total });
  state.oiHist = hist;
  const at = ago => { const target = nowMs - ago; let best = null; for (const x of hist) if (Math.abs(x.t - target) <= 2 * H && (!best || Math.abs(x.t - target) < Math.abs(best.t - target))) best = x; return best; };
  const d1 = at(24 * H), d7 = at(7 * 24 * H);
  return { chg24h_pct: d1 && total != null ? (total / d1.v - 1) * 100 : null, chg7d_pct: d7 && total != null ? (total / d7.v - 1) * 100 : null };
}

async function computeDerivs(http, state, nowMs) {
  const venues = {}; const errors = [];
  for (const [v, fn] of [['binance', venueBinance], ['bybit', venueBybit], ['okx', venueOkx]]) {
    try { venues[v] = await fn(http); } catch (e) { venues[v] = null; errors.push(`${v}: ${e.message}`); }
  }
  const complete = Object.values(venues).every(Boolean);
  let total = 0; for (const v of Object.values(venues)) if (v) for (const r of Object.values(v)) total += r.oi_btc;
  const totalOk = complete ? total : null;            // never a partial total presented as the market
  const ch = oiChanges(state, totalOk, nowMs);
  const funding = {
    binance: venues.binance?.BTCUSDT?.funding ?? null,
    bybit: venues.bybit?.BTCUSDT?.funding ?? null,
    okx: venues.okx?.['BTC-USDT-SWAP']?.funding ?? null,
  };
  return { venues, total_btc: totalOk, partial_total_btc: complete ? null : total, ...ch, funding, errors, instruments: INSTRUMENTS };
}

module.exports = { computeDerivs, oiChanges, INSTRUMENTS };
