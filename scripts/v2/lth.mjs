// BTC Brief V2 — LTH supply from Bitcoin Magazine Pro (STAGE1 A1 method).
// Copied from data-worker.js (V1) so V2 has no dependency on V1 code paths.
// Full trace scraped with Playwright; dated by aligning BMP's BTC price trace to
// Kraken daily closes (BMP date labels are unreliable); 7d/30d averages.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// Date the BMP series by price alignment and compute robust LTH flow averages.
export async function deriveLTH({ lthY, btcY }) {
  const pairs = lthY.map((l, i) => ({ l, p: btcY ? btcY[i] : null })).filter(r => r.l != null && isFinite(r.l));
  if (pairs.length < 40) return { _err: `only ${pairs.length} LTH points` };
  // Kraken daily closes, completed days only, oldest → newest
  const since = Math.floor((Date.now() - 260 * 86400 * 1000) / 1000);
  const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440&since=${since}`, { signal: AbortSignal.timeout(15000) });
  const d = await r.json();
  const rows = (d.result?.XXBTZUSD || d.result?.XBTZUSD || []).slice(0, -1);   // drop in-progress day
  const kd = rows.map(r => ({ date: new Date(parseInt(r[0], 10) * 1000).toISOString().slice(0, 10), c: parseFloat(r[4]) }));
  let lastDate = null, alignErrPct = null;
  if (btcY && kd.length > 70) {
    const tailP = pairs.slice(-60).map(r => r.p);
    let best = null;
    for (let off = 0; off <= 3; off++) {                 // BMP last point = last completed day − off
      const k = kd.slice(kd.length - 60 - off, kd.length - off);
      if (k.length !== 60) continue;
      const errs = tailP.map((p, i) => (p && k[i].c) ? Math.abs(k[i].c - p) / p : null).filter(e => e != null);
      const m = errs.reduce((a, b) => a + b, 0) / errs.length;
      if (!best || m < best.m) best = { m, off };
    }
    alignErrPct = Math.round(best.m * 10000) / 100;
    if (best.m > 0.005) return { _err: `BMP price trace does not match Kraken (best ${alignErrPct}% error) — rejecting pull` };
    lastDate = kd[kd.length - 1 - best.off].date;
  }
  const ys = pairs.map(r => r.l);
  const n = ys.length - 1;
  const avg = (days) => Math.round((ys[n] - ys[n - days]) / days);
  const diffs = ys.slice(1).map((v, i) => v - ys[i]).slice(-90);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sd = Math.round(Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length));
  const net7 = avg(7);
  return {
    lth_supply_btc: Math.round(ys[n]),
    lth_net_btc:    net7,                 // = 7-day average BTC/day (was a 1-day change before 2026-11-05)
    lth_net_7d_avg: net7,
    lth_net_30d_avg: avg(30),
    lth_net_1d:     Math.round(ys[n] - ys[n - 1]),
    lth_daily_noise_sd: sd,
    lth_days_gap:   1,
    date:           lastDate,             // last completed UTC day, from price alignment
    align_err_pct:  alignErrPct,
    method:         '7-day average of daily LTH supply change; dated by BMP price trace vs Kraken closes',
    source_url:     'https://www.bitcoinmagazinepro.com/charts/long-term-holder-supply/',
  };
}


export async function fetchBMPLTHData({ full = false } = {}) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (_) { throw new Error('playwright not installed — run: npm install && npx playwright install chromium'); }

  console.log('[BMP] Launching headless Chrome via Playwright...');
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
    .catch(() => chromium.launch({ headless: true }));

  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'America/New_York' });
    const page = await context.newPage();
    console.log('[BMP] Navigating to long-term-holder-supply chart...');
    await page.goto('https://www.bitcoinmagazinepro.com/charts/long-term-holder-supply/', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });

    await page.waitForFunction(() => {
      const gd = document.querySelector('.js-plotly-plot');
      return gd && (gd._fullData || gd._data || gd.data) &&
             (gd._fullData || gd._data || gd.data).length > 0 &&
             (gd._fullData || gd._data || gd.data)[0].x?.length > 100;
    }, { timeout: 20000 }).catch(() => console.warn('[BMP] Plotly render wait timed out — trying anyway'));

    const title = await page.title();
    console.log(`[BMP] Page title: "${title}"`);

    // Stage 1 audit A1 (2026-11-05): the old method used last point − previous
    // point. Day-to-day changes have a stdev of ~27k BTC vs a mean of ~−3k, so a
    // one-day change is noise (it flipped −23k → +23k within an hour and moved
    // the score 4 points). BMP's date labels are also unreliable (one pull showed
    // 2027-08-10 for 4 Nov). Now: pull the full trace, date it by matching the
    // chart's BTC price trace to Kraken daily closes, and report 7d/30d averages.
    const raw = await page.evaluate((keepAll) => {
      const gd = document.querySelector('.js-plotly-plot');
      if (!gd) return { _err: 'no .js-plotly-plot found' };
      const traces = gd._fullData || gd._data || gd.data;
      if (!traces || !traces.length) return { _err: 'no traces on gd' };
      const lthTrace = traces.find(t => t.name && t.name.toLowerCase().includes('long term holder'));
      const btcTrace = traces.find(t => t.name && /^btc|price/i.test(t.name) && t !== lthTrace);
      if (!lthTrace) return { _err: 'LTH trace not found', traceNames: traces.map(t => t.name) };
      const tail = (a) => (keepAll ? Array.from(a || []) : Array.from(a || []).slice(-200));
      return { lthY: tail(lthTrace.y), btcY: btcTrace ? tail(btcTrace.y) : null };
    }, full);
    if (raw._err) { console.warn('[BMP] Extraction failed:', raw._err, raw); return null; }
    if (full) return raw;                 // full trace for the history file (dated by scripts/v2/lthalign.mjs)
    const result = await deriveLTH(raw);
    if (result._err) { console.warn('[BMP] Extraction failed:', result._err, result); return null; }
    return result;
  } finally {
    await browser.close();
  }
}
