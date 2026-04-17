// ─────────────────────────────────────────────────────────────────────────────
// BTC Brief · Cloudflare Worker
// ─────────────────────────────────────────────────────────────────────────────
// Responsibilities:
//   1. Serve the latest `all_data.json` from GitHub Pages to the APK.
//   2. On the first request of each calendar day (UTC) where the cached brief
//      is stale, trigger the GitHub Actions `brief-generate` workflow via the
//      workflow_dispatch REST API. The workflow runs `brief-worker.js`, which
//      calls Anthropic and deploys a refreshed all_data.json to GitHub Pages.
//   3. Use a KV flag `triggered:YYYY-MM-DD` (TTL ~20 min) to guarantee only
//      ONE workflow run per day, even if 50 users open the APK simultaneously.
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

    return json({ error: "not found" }, 404);
  },
};

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
    ctx.waitUntil(maybeTriggerRefresh(env, todayUTC(), "pages-unreachable"));
    return json({ error: "upstream unavailable", detail: fetchError }, 502);
  }

  // 2. Check freshness. "Fresh" means the brief was generated today (UTC) AND
  //    contains a non-empty `brief` object.
  const today = todayUTC();
  const briefDate = allData.briefCachedAt
    ? allData.briefCachedAt.slice(0, 10) // "2026-04-17T..."
    : null;
  const hasBrief = allData.brief && typeof allData.brief === "object" && Object.keys(allData.brief).length > 0;
  const isFresh = briefDate === today && hasBrief;

  if (isFresh) {
    return json(allData, 200, { "Cache-Control": "public, max-age=60" });
  }

  // 3. Stale. Try to trigger a refresh, but do it in the background so the
  //    user still gets a response immediately with yesterday's brief.
  ctx.waitUntil(maybeTriggerRefresh(env, today, "stale"));

  // 4. Return the stale data with a `regenerating` flag so the APK can show
  //    a banner and poll until briefCachedAt flips to today's date.
  return json(
    { ...allData, regenerating: true, regeneratingReason: briefDate ? `brief from ${briefDate}` : "no brief yet" },
    200,
    { "Cache-Control": "no-store" }
  );
}

// ─── Trigger dispatch (idempotent per-day via KV lock) ────────────────────────
async function maybeTriggerRefresh(env, today, reason) {
  const lockKey = `triggered:${today}`;
  const existing = await env.BRIEF_KV.get(lockKey);
  if (existing) {
    // Already triggered today; another user's request beat us to it.
    console.log(`[trigger] skipped — already triggered today (reason=${reason}, at=${existing})`);
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
