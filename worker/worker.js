// ─────────────────────────────────────────────────────────────────────────────
// BTC Brief · Cloudflare Worker
// ─────────────────────────────────────────────────────────────────────────────
// Responsibilities:
//   1. Serve the latest `all_data.json` from GitHub Pages to the APK.
//   2. When a user opens the app AND the Dune cache (`cachedAt`) is newer than
//      the last generated brief (`briefCachedAt`), trigger the GitHub Actions
//      `brief-generate` workflow via the workflow_dispatch REST API. The
//      workflow runs `brief-worker.js`, which calls Anthropic and deploys a
//      refreshed all_data.json to GitHub Pages.
//   3. Use a KV flag `triggered:<cachedAt>` (TTL ~20 min) keyed on the Dune
//      cache timestamp, so each 6h Dune refresh cycle gets exactly ONE
//      workflow run — and only if a user actually opens the app that cycle.
//      If nobody opens the app between refreshes, Anthropic is never called.
//
// Env bindings required (set via `wrangler secret put` or dashboard):
//   - GITHUB_PAT        — fine-grained PAT with `Actions: write` on the repo
//   - GITHUB_REPO       — e.g. "Djahwell/btc-brief"
//   - WORKFLOW_FILE     — e.g. "brief-generate.yml"
//   - PAGES_URL         — e.g. "https://djahwell.github.io/btc-brief/all_data.json"
//
// KV namespace binding required:
//   - BRIEF_KV          — any small KV namespace (free tier is plenty)
//
// Endpoint:
//   GET /brief  → returns all_data.json (adds { regenerating: true } if stale)
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight — APK is a webview so it sends standard CORS headers.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/brief" || url.pathname === "/") {
      return handleBrief(env, ctx);
    }

    if (url.pathname === "/qqq") {
      return handleQqq();
    }

    if (url.pathname === "/etf") {
      return handleEtf();
    }

    if (url.pathname === "/whale") {
      return handleWhale();
    }

    return json({ error: "not found" }, 404);
  },
};

// ─── /qqq handler — proxy Yahoo Finance QQQ chart for APK + brief-worker ─────
// Yahoo and Stooq both block GitHub Actions runners and CORS-gate browser
// fetches, so neither brief-worker.js (GHA) nor the APK webview can reach them
// directly. Cloudflare edge IPs don't hit the Yahoo block, and we can add CORS
// headers here so the APK can consume the response. Cached at the edge for 1h.
async function handleQqq() {
  const YF_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const yahooHosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastErr = null;
  for (const host of yahooHosts) {
    try {
      const url = `https://${host}/v8/finance/chart/QQQ?interval=1d&range=120d`;
      const r = await fetch(url, {
        headers: { "User-Agent": YF_UA, "Accept": "application/json" },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!r.ok) { lastErr = `Yahoo ${host} HTTP ${r.status}`; continue; }
      const data = await r.json();
      // Return in a canonical shape the JSX already knows how to parse.
      const result0 = data?.chart?.result?.[0];
      const timestamps = result0?.timestamp || [];
      const closes = (result0?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
      if (closes.length < 21) { lastErr = `Yahoo ${host} thin payload (${closes.length} closes)`; continue; }
      const dates = timestamps.map(t => new Date(t * 1000).toISOString().slice(0, 10));
      return json(
        { source: `yahoo-${host}`, dates, closes, count: closes.length },
        200,
        { "Cache-Control": "public, max-age=3600" }
      );
    } catch (e) {
      lastErr = `${host} ${e.message}`;
    }
  }
  // Stooq fallback — CSV, parsed here so the APK gets a uniform JSON response.
  try {
    const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    const from = new Date(Date.now() - 120 * 86400000);
    const to = new Date();
    const r = await fetch(
      `https://stooq.com/q/d/l/?s=qqq.us&d1=${fmt(from)}&d2=${fmt(to)}&i=d`,
      { headers: { "User-Agent": YF_UA }, cf: { cacheTtl: 3600, cacheEverything: true } }
    );
    if (!r.ok) throw new Error(`Stooq HTTP ${r.status}`);
    const csv = await r.text();
    const rows = csv.trim().split("\n").slice(1);
    const dates = [], closes = [];
    for (const line of rows) {
      const parts = line.split(",");
      const dt = (parts[0] || "").trim();
      const cl = parseFloat(parts[4]);
      if (dt && cl > 0) { dates.push(dt); closes.push(cl); }
    }
    if (closes.length < 21) throw new Error(`Stooq thin payload (${closes.length})`);
    return json(
      { source: "stooq", dates, closes, count: closes.length },
      200,
      { "Cache-Control": "public, max-age=3600" }
    );
  } catch (e) {
    return json({ error: "qqq-unavailable", detail: `${lastErr || "yahoo failed"}; ${e.message}` }, 502);
  }
}

// ─── /etf handler — proxy SoSoValue ETF flow for APK + dune-worker ───────────
// Farside (primary source) is behind Cloudflare anti-bot that blocks headless
// Chrome and GitHub Actions IPs. Cloudflare Worker edge IPs are not blocked by
// SoSoValue, so we proxy through here. Cached at edge for 1h (data is daily).
// Returns: { total_million_usd, date, source } or { error }
async function handleEtf() {
  const YF_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const sosoEndpoints = [
    "https://sosovalue.com/api/etf/us-btc-spot/fund-flow?type=total",
    "https://sosovalue.com/api/etf/us-btc-spot/net-asset?type=total",
    "https://sosovalue.com/api/index/indexDailyHistory?code=US-BTC-SPOT-ETF&range=1",
  ];
  let lastErr = null;

  for (const ep of sosoEndpoints) {
    try {
      const r = await fetch(ep, {
        headers: { "User-Agent": YF_UA, "Accept": "application/json", "Referer": "https://sosovalue.com/" },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      if (!r.ok) { lastErr = `SoSoValue ${ep} HTTP ${r.status}`; continue; }
      const data = await r.json();
      const ssvData = data?.data;
      if (!ssvData) { lastErr = `SoSoValue ${ep} — no data field`; continue; }
      const row = Array.isArray(ssvData) ? ssvData[ssvData.length - 1] : ssvData;
      const netM = row?.totalNetInflow ?? row?.netInflow ?? row?.net_inflow ?? row?.totalFlow ?? null;
      if (netM == null) { lastErr = `SoSoValue ${ep} — no flow field`; continue; }
      // SoSoValue returns $M values; guard against raw-dollar responses
      const netUSD = Math.abs(netM) > 1e6 ? netM : netM * 1e6;
      const dateStr = row?.date || row?.time || new Date().toISOString().slice(0, 10);
      return json(
        { total_million_usd: netUSD / 1e6, date: dateStr, source: "SoSoValue" },
        200,
        { "Cache-Control": "public, max-age=3600" }
      );
    } catch (e) {
      lastErr = `${ep}: ${e.message}`;
    }
  }

  // Last resort: Yahoo Finance IBIT daily OHLCV (volume proxy, not actual flows)
  try {
    const r = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/IBIT?interval=1d&range=5d",
      {
        headers: { "User-Agent": YF_UA, "Accept": "application/json" },
        cf: { cacheTtl: 3600, cacheEverything: true },
      }
    );
    if (!r.ok) throw new Error(`Yahoo IBIT HTTP ${r.status}`);
    const data = await r.json();
    const result0 = data?.chart?.result?.[0];
    const meta = result0?.meta;
    const closes = result0?.indicators?.quote?.[0]?.close ?? [];
    const volumes = result0?.indicators?.quote?.[0]?.volume ?? [];
    const timestamps = result0?.timestamp ?? [];
    // Most recent non-null close + volume
    let close = null, vol = null, ts = null;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null && volumes[i] != null && volumes[i] > 0) {
        close = closes[i]; vol = volumes[i]; ts = timestamps[i]; break;
      }
    }
    close = close ?? meta?.regularMarketPrice;
    vol   = vol   ?? meta?.regularMarketVolume;
    ts    = ts    ?? meta?.regularMarketTime;
    if (close && vol && close > 0 && vol > 0) {
      const dollarVol = close * vol;
      const dateStr = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      // Return as a volume proxy — mark clearly so the brief doesn't treat it as actual flows
      return json(
        { total_million_usd: null, ibit_volume_usd: dollarVol, date: dateStr, source: "Yahoo IBIT vol (proxy — NOT actual flows)" },
        200,
        { "Cache-Control": "public, max-age=3600" }
      );
    }
    throw new Error("IBIT OHLCV empty");
  } catch (e) {
    lastErr = `Yahoo IBIT: ${e.message}`;
  }

  return json({ error: "etf-unavailable", detail: lastErr }, 502);
}

// ─── /whale handler — 24h taker buy/sell pressure via Binance ticker + klines ──
// ticker/24hr  → accurate rolling 24h BTC volume (not cache-distorted)
// klines 1d    → today's taker buy ratio (only field ticker/24hr lacks)
// Combined     → real 24h taker buy/sell split for the daily brief
// Binance blocks GitHub Actions IPs; Cloudflare edge IPs are not blocked.
// No edge cache (ticker/24hr is already a live rolling window).
async function handleWhale() {
  const UA = "Mozilla/5.0";
  let ticker, kline;

  try {
    // Fetch both in parallel — no CF edge cache so we always get live data
    const [tickerRes, klineRes] = await Promise.all([
      fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
            { headers: { "User-Agent": UA } }),
      fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1",
            { headers: { "User-Agent": UA } }),
    ]);
    if (!tickerRes.ok) throw new Error(`ticker/24hr HTTP ${tickerRes.status}`);
    if (!klineRes.ok)  throw new Error(`klines/1d HTTP ${klineRes.status}`);
    ticker = await tickerRes.json();
    const klines = await klineRes.json();
    // kline fields: [openTime,o,h,l,c, volume, closeTime, quoteVol,
    //                trades, takerBuyBaseVol, takerBuyQuoteVol, ignore]
    kline = klines[0];
    if (!kline) throw new Error("Empty klines response");
  } catch (e) {
    return json({ error: "whale-unavailable", detail: e.message }, 502);
  }

  // Rolling 24h volume from ticker (most accurate — live window, not cached)
  const totalBTC24h  = parseFloat(ticker.volume);       // BTC traded in last 24h
  const tradeCount   = parseInt(ticker.count, 10);      // number of trades

  // Taker buy ratio from today's 1d candle (since UTC midnight)
  const todayTotal   = parseFloat(kline[5]);            // BTC volume today
  const todayTakerBuy= parseFloat(kline[9]);            // taker buy BTC today
  const buyRatio     = todayTotal > 0
    ? parseFloat((todayTakerBuy / todayTotal).toFixed(4))
    : 0.5; // neutral fallback

  // Apply today's ratio to the accurate 24h rolling volume
  const takerBuyBTC  = parseFloat((totalBTC24h * buyRatio).toFixed(2));
  const takerSellBTC = parseFloat((totalBTC24h * (1 - buyRatio)).toFixed(2));
  const netBTC       = parseFloat((takerBuyBTC - takerSellBTC).toFixed(2));

  // Pressure: net buy > 1% of 24h volume = BUY signal
  const threshold = totalBTC24h * 0.01;
  const pressure  = netBTC > threshold ? "BUY" : netBTC < -threshold ? "SELL" : "NEUTRAL";

  return json(
    {
      taker_buy_btc:    takerBuyBTC,
      taker_sell_btc:   takerSellBTC,
      net_taker_btc:    netBTC,
      total_volume_btc: parseFloat(totalBTC24h.toFixed(2)),
      buy_ratio:        buyRatio,
      trade_count:      tradeCount,
      span_hours:       24,
      pressure,
      source:           "Binance ticker/24hr + 1d kline taker ratio (via CF Worker)",
      date:             new Date().toISOString().slice(0, 10),
    },
    200,
    { "Cache-Control": "public, max-age=900" }  // 15 min cache — brief runs every 6h
  );
}

// ─── /brief handler ────────────────────────────────────────────────────────────
async function handleBrief(env, ctx) {
  // 1. Fetch current all_data.json from GitHub Pages.
  //    Pages has its own edge cache (~10 min), which we accept — it means users
  //    may see a fresh brief up to 10 min after the workflow deploy.
  let allData = null;
  let fetchError = null;
  try {
    const r = await fetch(env.PAGES_URL, {
      cf: { cacheTtl: 60, cacheEverything: true },
      headers: { "User-Agent": "btc-brief-worker/1.0" },
    });
    if (!r.ok) throw new Error(`Pages HTTP ${r.status}`);
    allData = await r.json();
  } catch (e) {
    fetchError = e.message;
  }

  if (!allData) {
    // If GitHub Pages is unreachable, we still try to trigger a refresh so that
    // next opens have data, and return an error to the APK.
    ctx.waitUntil(maybeTriggerRefresh(env, `unreachable-${todayUTC()}`, "pages-unreachable"));
    return json({ error: "upstream unavailable", detail: fetchError }, 502);
  }

  // 2. Check freshness. "Fresh" means the brief was generated AFTER the latest
  //    Dune cache refresh AND contains a non-empty `brief` object. Each Dune
  //    refresh (every 6h) pushes a new `cachedAt` — the first user to open
  //    the app after that timestamp triggers a new brief. If no new Dune data
  //    has arrived, no trigger fires no matter how many times users open.
  const cacheKey = allData.cachedAt || allData.briefCachedAt || "no-cache";
  const hasBrief = allData.brief && typeof allData.brief === "object" && Object.keys(allData.brief).length > 0;
  const briefMs = allData.briefCachedAt ? Date.parse(allData.briefCachedAt) : 0;
  const cacheMs = allData.cachedAt ? Date.parse(allData.cachedAt) : 0;
  // Brief is fresh if it exists and was generated at-or-after the current
  // Dune cache timestamp. If cachedAt is missing (first-ever run), fall back
  // to "has a brief at all" so we don't spam triggers on empty state.
  const isFresh = hasBrief && (cacheMs === 0 || briefMs >= cacheMs);

  if (isFresh) {
    return json(allData, 200, { "Cache-Control": "public, max-age=60" });
  }

  // 3. Stale — new Dune data has arrived since the last brief. Try to trigger
  //    a refresh in the background so the user still gets a response with
  //    the previous brief immediately.
  ctx.waitUntil(maybeTriggerRefresh(env, cacheKey, "stale"));

  // 4. Return the stale data with a `regenerating` flag so the APK can show
  //    a banner and poll until briefCachedAt catches up to cachedAt.
  const reason = allData.briefCachedAt
    ? `brief from ${allData.briefCachedAt} older than dune cache ${allData.cachedAt || "?"}`
    : "no brief yet";
  return json(
    { ...allData, regenerating: true, regeneratingReason: reason },
    200,
    { "Cache-Control": "no-store" }
  );
}

// ─── Trigger dispatch (idempotent per Dune-cache cycle via KV lock) ──────────
async function maybeTriggerRefresh(env, cacheKey, reason) {
  // Lock key is tied to the Dune cache timestamp (or fallback) so each 6h
  // refresh cycle gets its own lock. Multiple users opening in the same
  // cycle will share the single trigger; the next Dune refresh creates a
  // new cache timestamp and therefore a fresh (unlocked) key.
  const lockKey = `triggered:${cacheKey}`;
  const existing = await env.BRIEF_KV.get(lockKey);
  if (existing) {
    // Already triggered for this Dune cycle; another user's request beat us to it.
    console.log(`[trigger] skipped — already triggered this cycle (key=${lockKey}, reason=${reason}, at=${existing})`);
    return;
  }

  // Set the lock FIRST (TTL 20 min — longer than the workflow's worst-case run
  // time of ~5 min for brief-generate, with headroom). If the workflow fails,
  // the lock expires and the next user retries.
  const now = new Date().toISOString();
  await env.BRIEF_KV.put(lockKey, now, { expirationTtl: 1200 });

  try {
    const ghUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
    const resp = await fetch(ghUrl, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GITHUB_PAT}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "btc-brief-worker/1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[trigger] GitHub dispatch failed ${resp.status}: ${text.slice(0, 300)}`);
      // Release the lock so the next user retries.
      await env.BRIEF_KV.delete(lockKey);
      return;
    }
    console.log(`[trigger] workflow_dispatch OK (reason=${reason}, at=${now})`);
  } catch (e) {
    console.error("[trigger] error:", e.message);
    await env.BRIEF_KV.delete(lockKey);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}
