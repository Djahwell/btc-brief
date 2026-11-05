// ─────────────────────────────────────────────────────────────────────────────
// BTC Brief V2 · Worker routes (additive; V1 routes untouched)
// ─────────────────────────────────────────────────────────────────────────────
// STAGE2-PLAN v1.1 §3, §8.3–8.5. Receives signed snapshots from the VPS job and
// serves them with freshness computed at serve time. All V2 keys live under the
// "v2:" prefix in BRIEF_KV, so V1's keys are never read or written here.
//
//   POST /v2/snapshot   VPS push. Headers: X-Timestamp (ms), X-Signature (hex
//                       HMAC-SHA256 of `${ts}\n${path}\n${body}` with V2_PUSH_SECRET).
//   GET  /v2/snapshot   Latest snapshot + servedAt, ageSec (computed now).
//   GET  /v2/health     Small status object (age, seq, alert state).
//   scheduled()         Every 15 min: if the snapshot is older than 45 min,
//                       send ONE phone notification via ntfy (NTFY_TOPIC), and one
//                       "recovered" notification when it comes back.
//
// Secrets (wrangler secret put, use `echo -n`): V2_PUSH_SECRET, NTFY_TOPIC (optional).
// ─────────────────────────────────────────────────────────────────────────────

export const V2_KEY = "v2:snapshot";
export const V2_ALERT_KEY = "v2:alert";
export const V2_INSTALLED_KEY = "v2:installedAt";
const MAX_BODY = 256 * 1024;          // bytes
const MAX_FUTURE_MS = 2 * 60 * 1000;  // reject timestamps > 2 min ahead (clock error)
const MAX_PAST_MS = 10 * 60 * 1000;   // reject pushes signed > 10 min ago (replay)
export const STALE_ALERT_SEC = 45 * 60;

const enc = new TextEncoder();

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Timestamp, X-Signature",
  };
}
function out(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(), ...extra },
  });
}
function hexToBytes(hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}
export async function sign(secret, ts, path, body) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}\n${path}\n${body}`));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function verify(secret, ts, path, body, sigHex) {
  const sig = hexToBytes(sigHex);
  if (!sig) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(`${ts}\n${path}\n${body}`)); // constant-time
}

export async function handleV2(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (!env.BRIEF_KV) return out({ error: "kv not bound" }, 500);

  if (url.pathname === "/v2/snapshot" && request.method === "POST") {
    if (!env.V2_PUSH_SECRET) return out({ error: "push not configured" }, 503);
    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > MAX_BODY) return out({ error: "too large" }, 413);
    const body = await request.text();
    if (body.length > MAX_BODY) return out({ error: "too large" }, 413);
    const ts = Number(request.headers.get("X-Timestamp"));
    if (!Number.isFinite(ts)) return out({ error: "bad timestamp" }, 400);
    if (ts > now + MAX_FUTURE_MS) return out({ error: "timestamp in the future" }, 400);
    if (ts < now - MAX_PAST_MS) return out({ error: "timestamp too old" }, 400);
    const ok = await verify(env.V2_PUSH_SECRET, String(ts), url.pathname, body, request.headers.get("X-Signature"));
    if (!ok) return out({ error: "bad signature" }, 401);
    let snap;
    try { snap = JSON.parse(body); } catch { return out({ error: "bad json" }, 400); }
    if (snap?.schema?.startsWith("brief-v2/") !== true || !Number.isInteger(snap.seq) || !snap.generatedAt) {
      return out({ error: "bad schema" }, 400);
    }
    const prev = await env.BRIEF_KV.get(V2_KEY, "json");
    if (prev && Number.isInteger(prev.snapshot?.seq) && snap.seq <= prev.snapshot.seq) {
      return out({ error: "stale seq", have: prev.snapshot.seq }, 409);
    }
    const receivedAt = new Date(now).toISOString();
    await env.BRIEF_KV.put(V2_KEY, JSON.stringify({ receivedAt, snapshot: snap }));
    return out({ ok: true, seq: snap.seq, receivedAt });
  }

  if (url.pathname === "/v2/snapshot" && request.method === "GET") {
    const rec = await env.BRIEF_KV.get(V2_KEY, "json");
    if (!rec) return out({ error: "no snapshot yet" }, 404);
    const gen = Date.parse(rec.snapshot.generatedAt);
    // Public response: internal run details (errors, disk, paths) are not exposed.
    const { runs, ...pub } = rec.snapshot;
    return out({
      servedAt: new Date(now).toISOString(),
      ageSec: Number.isFinite(gen) ? Math.round((now - gen) / 1000) : null,
      receivedAt: rec.receivedAt,
      snapshot: { ...pub, runs: runs ? { durationMs: runs.durationMs, errorCount: Array.isArray(runs.errors) ? runs.errors.length : null } : null },
    });
  }

  if (url.pathname === "/v2/health" && request.method === "GET") {
    const rec = await env.BRIEF_KV.get(V2_KEY, "json");
    const alert = await env.BRIEF_KV.get(V2_ALERT_KEY, "json");
    const gen = rec ? Date.parse(rec.snapshot.generatedAt) : NaN;
    const ageSec = Number.isFinite(gen) ? Math.round((now - gen) / 1000) : null;
    return out({ ok: ageSec != null && ageSec <= STALE_ALERT_SEC, ageSec, seq: rec?.snapshot?.seq ?? null, alerting: !!alert?.active });
  }

  return out({ error: "not found" }, 404);
}

// Cron: one notification when the snapshot goes stale (or never arrives within 1 h of the
// first cron run after deploy), one when it recovers. An alert is only marked as sent when the
// notification actually went out, so a failed ntfy call is retried on the next run.
export async function scheduledV2(env, now = Date.now(), fetchImpl = fetch) {
  if (!env.BRIEF_KV) return "no kv";
  let installedAt = await env.BRIEF_KV.get(V2_INSTALLED_KEY);
  if (!installedAt) { installedAt = new Date(now).toISOString(); await env.BRIEF_KV.put(V2_INSTALLED_KEY, installedAt); }
  const rec = await env.BRIEF_KV.get(V2_KEY, "json");
  const alert = (await env.BRIEF_KV.get(V2_ALERT_KEY, "json")) || { active: false };
  let stale, msg;
  if (!rec) {
    const waitedSec = Math.round((now - Date.parse(installedAt)) / 1000);
    if (waitedSec < 3600) return "waiting for first snapshot";
    stale = true; msg = `No VPS snapshot has arrived ${Math.round(waitedSec / 60)} min after the V2 route was deployed. Is brief-v2-cycle installed and is V2_PUSH_SECRET identical on both sides?`;
  } else {
    const ageSec = Math.round((now - Date.parse(rec.snapshot.generatedAt)) / 1000);
    stale = !(ageSec <= STALE_ALERT_SEC);
    msg = stale ? `Last VPS snapshot is ${Math.round(ageSec / 60)} min old (seq ${rec.snapshot.seq}). Check brief-v2-cycle on the VPS.` : `Snapshots flowing again (age ${ageSec}s, seq ${rec.snapshot.seq}).`;
  }
  const notify = async (title, body) => {
    if (!env.NTFY_TOPIC) return true;                       // no topic configured: nothing to send
    try {
      const r = await fetchImpl(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, { method: "POST", body, headers: { Title: title, Priority: stale ? "high" : "default" } });
      return !!r && r.ok !== false;
    } catch { return false; }
  };
  if (stale && !alert.active) {
    if (!(await notify("BTC Brief V2: data stale", msg))) return "alert send failed (will retry)";
    await env.BRIEF_KV.put(V2_ALERT_KEY, JSON.stringify({ active: true, since: new Date(now).toISOString() }));
    return "alerted";
  }
  if (!stale && alert.active) {
    if (!(await notify("BTC Brief V2: recovered", msg))) return "recovery send failed (will retry)";
    await env.BRIEF_KV.put(V2_ALERT_KEY, JSON.stringify({ active: false, since: new Date(now).toISOString() }));
    return "recovered";
  }
  return stale ? "still stale" : "ok";
}
