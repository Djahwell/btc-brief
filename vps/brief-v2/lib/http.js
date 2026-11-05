'use strict';
// HTTP with timeouts, NO retries, and a Binance request-weight budget shared with the
// live bot on the same IP (STAGE2-PLAN §8.2). Every raw response is handed to the vintage store.

const BUDGET = { binanceWeightLimit: 2400, maxShare: 0.20 };   // stop Binance calls above 20% of the IP limit

class Http {
  constructor({ vintage, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console } = {}) {
    this.vintage = vintage; this.fetch = fetchImpl; this.now = now; this.log = log;
    this.binanceStopped = false; this.maxWeightSeen = 0; this.calls = 0; this.errors = [];
  }
  isBinanceFutures(url) { return /^https:\/\/(fapi|dapi)\.binance\.com\//.test(url); }

  // name: vintage label; opts.store=false skips the vintage (caller stores a trimmed copy)
  async json(name, url, { timeout = 12000, store = true } = {}) {
    const fut = this.isBinanceFutures(url);
    if (fut && this.binanceStopped) throw Object.assign(new Error('binance budget guard: skipped'), { code: 'BUDGET' });
    this.calls++;
    let r;
    try {
      r = await this.fetch(url, { headers: { 'User-Agent': 'brief-v2 (personal)', Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
    } catch (e) { this.errors.push({ name, error: String(e.message || e) }); throw e; }
    if (fut) {
      const w = Number(r.headers.get('x-mbx-used-weight-1m') || r.headers.get('x-mbx-used-weight') || 0);
      if (w > this.maxWeightSeen) this.maxWeightSeen = w;
      if (w > BUDGET.binanceWeightLimit * BUDGET.maxShare) {
        this.binanceStopped = true;
        this.log.warn(`[http] Binance used weight ${w} > ${BUDGET.binanceWeightLimit * BUDGET.maxShare}: no more Binance calls this cycle`);
      }
    }
    if (r.status === 429 || r.status === 418) {
      if (fut) this.binanceStopped = true;            // never retry; next cycle tries again
      const e = Object.assign(new Error(`HTTP ${r.status} (rate limit) — not retried`), { code: 'RATE' });
      this.errors.push({ name, error: e.message }); throw e;
    }
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); this.errors.push({ name, error: e.message }); throw e; }
    const body = await r.json();
    if (store && this.vintage) this.vintage.append(name, { url, at: new Date(this.now()).toISOString(), body });
    return body;
  }
}
module.exports = { Http, BUDGET };
