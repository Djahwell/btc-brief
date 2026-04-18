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
