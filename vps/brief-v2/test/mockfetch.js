'use strict';
// Deterministic mock of every exchange endpoint the cycle calls (used by tests and the e2e dry run).
// OKX responses are real captures (test/fixtures); Binance/Bybit are built to the documented formats.
const fs = require('fs'); const path = require('path');
const fx = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const MIN = 60000;
// Synthetic v2-data history ending yesterday (deterministic), served as gz files + manifest with sha256.
let _hist = null;
function synthHistoryFiles(now) {
  const end = Math.floor(now / 864e5) * 864e5; if (_hist && _hist.end === end) return _hist;
  const { engineDir } = require('../lib/score');
  const { synthHistory } = require(path.join(engineDir(), 'test', 'synth.js'));
  const days = 2200; const start = new Date(end - days * 864e5).toISOString().slice(0, 10);
  const h = synthHistory(days, 7, start); const gz = {}; const files = {};
  const zlib = require('zlib'); const crypto = require('crypto');
  for (const [k, v] of Object.entries(h)) { gz[k] = zlib.gzipSync(JSON.stringify(v)); files[k] = { rows: v.rows.length, last: new Date(v.rows[v.rows.length - 1].t * 1000).toISOString(), sha256: crypto.createHash('sha256').update(gz[k]).digest('hex') }; }
  _hist = { end, gz, manifest: { schema: 'brief-v2-history/1', generatedAt: new Date(end).toISOString(), files, errors: [] } };
  return _hist;
}
function mk(opts = {}) {
  const now = opts.now || Date.now();
  const prem = t => opts.premium ? opts.premium(t) : -0.0004 + 0.0001 * Math.sin(t / 3.6e6);
  const calls = [];
  const res = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body, arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url); const q = u.searchParams;
    if (opts.fail && opts.fail(url)) return res({ msg: 'fail' }, opts.failStatus || 500);
    const w = { 'x-mbx-used-weight-1m': String(opts.weight ?? 37) };
    if (u.host === 'fapi.binance.com') {
      if (u.pathname === '/fapi/v1/premiumIndexKlines') {
        const start = Number(q.get('startTime')); const limit = Number(q.get('limit'));
        const rows = []; for (let t = Math.ceil(start / MIN) * MIN, i = 0; i < limit && t <= now; t += MIN, i++) rows.push([t, '0', '0', '0', String(prem(t)), '0', t + MIN - 1, '0', 60, '0', '0', '0']);
        return res(rows, 200, w);
      }
      if (u.pathname === '/fapi/v1/fundingInfo') return res(opts.fundingInfo ?? [{ symbol: 'ETHUSDT', fundingIntervalHours: 8 }], 200, w);
      if (u.pathname === '/fapi/v1/fundingRate') {
        const out = []; const last = Math.floor(now / (8 * 3.6e6)) * 8 * 3.6e6;
        for (let k = 4; k >= 0; k--) { const T = last - k * 8 * 3.6e6; let s = 0, n = 0; for (let t = T - 8 * 3.6e6; t < T; t += MIN) { s += prem(t); n++; } const P = s / n; out.push({ symbol: 'BTCUSDT', fundingTime: T, fundingRate: String(P + Math.min(0.0005, Math.max(-0.0005, 0.0001 - P))), markPrice: '80000' }); }
        return res(out, 200, w);
      }
      if (u.pathname === '/fapi/v1/openInterest') return res({ openInterest: '85000.123', symbol: 'BTCUSDT', time: now }, 200, w);
      if (u.pathname === '/fapi/v1/premiumIndex') return res({ symbol: 'BTCUSDT', markPrice: '80400.1', indexPrice: '80430.0', lastFundingRate: '0.00004', nextFundingTime: now + 3.6e6 }, 200, w);
    }
    if (u.host === 'dapi.binance.com') {
      if (u.pathname === '/dapi/v1/exchangeInfo') return res({ symbols: [{ symbol: 'BTCUSD_PERP', contractSize: opts.binanceContractSize ?? 100 }] }, 200, w);
      if (u.pathname === '/dapi/v1/openInterest') return res({ symbol: 'BTCUSD_PERP', openInterest: '900000', contractType: 'PERPETUAL', time: now }, 200, w);
      if (u.pathname === '/dapi/v1/premiumIndex') return res([{ symbol: 'BTCUSD_PERP', markPrice: '80380.5' }], 200, w);
    }
    if (u.host === 'api.bybit.com') {
      if (u.pathname === '/v5/market/tickers' && q.get('category') === 'linear') return res({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', openInterest: '52000.5', markPrice: '80401', fundingRate: '0.00003' }] }, time: now });
      if (u.pathname === '/v5/market/tickers' && q.get('category') === 'inverse') return res({ retCode: 0, result: { list: [{ symbol: 'BTCUSD', openInterest: '560000000', markPrice: '80390', fundingRate: '0.00002' }] }, time: now });
      if (u.pathname === '/v5/market/instruments-info') return res({ retCode: 0, result: { list: [{ symbol: 'BTCUSD', contractType: opts.bybitContractType ?? 'InversePerpetual' }] } });
      if (u.pathname === '/v5/market/premium-index-price-kline') { const list = []; const t0 = Math.floor(now / MIN) * MIN; for (let i = 0; i < 480; i++) { const t = t0 - i * MIN; list.push([String(t), '0', '0', '0', String(prem(t) + (opts.bybitOffset || 0))]); } return res({ retCode: 0, result: { list } }); }
    }
    if (u.host === 'www.okx.com') {
      if (u.pathname === '/api/v5/public/premium-history') { const after = Number(q.get('after') || now); const data = []; for (let i = 0; i < 100; i++) { const t = after - (i + 1) * MIN; data.push({ instId: 'BTC-USDT-SWAP', premium: String(prem(t) + (opts.okxOffset || 0)), ts: String(t) }); } return res({ code: '0', data }); }
      if (u.pathname === '/api/v5/public/instruments') return res(fx(q.get('instId') === 'BTC-USD-SWAP' ? 'okx_inst_usd.json' : 'okx_inst_usdt.json'));
      if (u.pathname === '/api/v5/public/open-interest') return res(fx(q.get('instId') === 'BTC-USD-SWAP' ? 'okx_oi_usd.json' : 'okx_oi_usdt.json'));
      if (u.pathname === '/api/v5/public/funding-rate') return res(fx('okx_funding.json'));
      if (u.pathname === '/api/v5/public/mark-price') return res(fx('okx_mark_usd.json'));
    }
    if (u.host === 'api.exchange.coinbase.com') {
      const prod = u.pathname.split('/')[2]; const s = Date.parse(q.get('start')) / 1000, e = Date.parse(q.get('end')) / 1000; const rows = [];
      for (let t = e; t >= s; t -= 3600) { const btc = 80000 + 500 * Math.sin(t / 86400); const usdt = 0.9995 + 0.0002 * Math.sin(t / 50000); const c = prod === 'USDT-USD' ? usdt : btc * (1 + 0.0001 * Math.sin(t / 30000)); rows.push([t, c, c, c, c, 10]); }
      return res(rows);
    }
    if (u.host === 'data-api.binance.vision') {
      const st = Number(q.get('startTime')); const rows = [];
      for (let t = st; t < st + 1000 * 3.6e6 && t <= now; t += 3.6e6) { const ts = t / 1000; const btc = 80000 + 500 * Math.sin(ts / 86400); const usdt = 0.9995 + 0.0002 * Math.sin(ts / 50000); rows.push([t, '0', '0', '0', String(btc / usdt), '0']); }
      return res(rows);
    }
    if (u.host === 'raw.githubusercontent.com' && u.pathname.includes('/v2/history/')) {
      if (opts.history === false) return res({ error: 'no history' }, 404);
      const H = synthHistoryFiles(now);
      const name = u.pathname.split('/').pop();
      if (name === 'manifest.json') return res(H.manifest);
      const k = name.replace('.json.gz', '');
      if (!H.gz[k]) return res({ error: 'nf' }, 404);
      return res(opts.corrupt === k ? Buffer.concat([H.gz[k], Buffer.from('x')]) : H.gz[k]);
    }
    if (u.host === 'raw.githubusercontent.com') return res(opts.daily ? opts.daily(now) : { schema: 'brief-v2-daily/1', generatedAt: new Date(now).toISOString(), inputs: { fear_greed: { value: 50, unit: 'index 0-100', asOf: '2026-11-05', quality: 'OK' } }, errors: [] });
    if (u.host === 'btc-brief.joel-toe.workers.dev') return res({ ok: true, seq: 1, receivedAt: new Date(now).toISOString() });
    return res({ error: `unmocked ${url}` }, 404);
  };
  return { fetch, calls };
}
module.exports = { mk };
// When preloaded with `node -r ./test/mockfetch.js cycle.js --dry-run`, replace global fetch.
if (process.env.BRIEF_V2_MOCK === '1') globalThis.fetch = mk().fetch;
