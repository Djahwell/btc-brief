// ─────────────────────────────────────────────────────────────────────────────
// BTC Brief V2 · Claude paragraph (STAGE3-PLAN §5, D-6 = C: on demand, max once a day)
// Pure helpers (payload + checks) and the Worker handler. Claude receives ONLY numbers and fixed
// band labels from the snapshot (no source strings, errors or free text), no tools, capped output.
// The paragraph is published only if every check passes:
//   - every number in the text matches a payload number (units normalised, rounding allowed)
//   - no numbers written as words
//   - direction words agree with the scores
// ─────────────────────────────────────────────────────────────────────────────

const BANDS = ["Strong bull", "Bull", "Neutral", "Bear", "Strong bear"];
const fin = x => typeof x === "number" && Number.isFinite(x);
const r2 = x => (fin(x) ? Math.round(x * 100) / 100 : null);

export function buildPayload(snap) {
  const e = snap && snap.engine;
  if (!e || !e.scores || !e.primary) return null;
  const card = c => (c && !c.withheld && fin(c.score) && BANDS.includes(c.band) ? { score: c.score, band: c.band, active: c.active, of: c.of } : { withheld: true });
  const fam = {};
  for (const [k, v] of Object.entries(e.families || {})) if (v && fin(v.score)) fam[k] = v.score;
  const inp = snap.inputs || {}, di = (snap.daily && snap.daily.inputs) || {};
  const F = e.families || {};
  const raw = {
    fear_greed: fin(di.fear_greed?.value) ? di.fear_greed.value : null,
    mvrv: r2(di.mvrv?.value),
    perp_premium_8h_pct: inp.perp_premium_binance_8h?.quality === "OK" ? Math.round(inp.perp_premium_binance_8h.value * 1e4) / 1e4 : null,
    coinbase_premium_z: inp.coinbase_premium_adj?.quality === "OK" ? r2(inp.coinbase_premium_adj.z30) : null,
    open_interest_btc: fin(inp.oi_btc_total?.value) ? Math.round(inp.oi_btc_total.value) : null,
    last_daily_close_usd: fin(F.E1?.levels?.close) ? Math.round(F.E1.levels.close) : null,
    value_area_high_usd: fin(F.E2?.vah) ? F.E2.vah : null,
    point_of_control_usd: fin(F.E2?.poc) ? F.E2.poc : null,
    value_area_low_usd: fin(F.E2?.val) ? F.E2.val : null,
    sma50_usd: fin(F.E1?.levels?.sma50) ? Math.round(F.E1.levels.sma50) : null,
    sma200_usd: fin(F.T3?.levels?.sma200) ? Math.round(F.T3.levels.sma200) : null,
    volatility_percentile: fin(F.E6?.pct) ? Math.round(F.E6.pct) : null,
  };
  for (const k of Object.keys(raw)) if (raw[k] == null) delete raw[k];
  return {
    entry_1_to_7_days: card(e.scores[e.primary.entry]),
    tendency_3_to_9_months: card(e.scores[e.primary.tendency]),
    family_scores: fam,
    readings: raw,
    scale: { min: -10, max: 10 },
    horizons: { entry_days: [1, 7], tendency_months: [3, 9] },
  };
}

function payloadNumbers(p) {
  const out = [];
  const walk = x => { if (fin(x)) out.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); };
  walk(p);
  return out;
}

// True when every occurrence of the direction word is directly negated ("not bearish", "not yet bearish").
function onlyNegated(sent, root) {
  const all = (sent.match(new RegExp(`\\b${root}(ish)?\\b`, 'g')) || []).length;
  const neg = (sent.match(new RegExp(`\\bnot\\s+(?:\\w+\\s+)?${root}(ish)?\\b`, 'g')) || []).length;
  return all > 0 && all === neg;
}

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half|quarter|double|twice|triple)\b/i;

export function checkText(text, p) {
  const fails = [];
  if (typeof text !== "string" || text.length < 40 || text.length > 1200) fails.push("length");
  if (NUMBER_WORDS.test(text)) fails.push(`number written as a word: "${text.match(NUMBER_WORDS)[0]}"`);
  const nums = payloadNumbers(p);
  const re = /[-+−]?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b)?/g;
  for (const m of text.match(re) || []) {
    let s = m.replace(/[−]/g, "-").replace(/[$,\s]/g, "");
    let mult = 1, pct = false;
    if (s.endsWith("k")) { mult = 1000; s = s.slice(0, -1); }
    if (s.endsWith("%")) { pct = true; s = s.slice(0, -1); }
    const x = Math.abs(Number(s) * mult);
    if (!Number.isFinite(x)) { fails.push(`unreadable number ${m}`); continue; }
    const dec = (s.split(".")[1] || "").length;
    const tol = mult > 1 ? 500 : 0.5 * Math.pow(10, -dec) + 1e-9;
    // An explicitly signed number (+4, −2) must be one of the signed scores or signed readings, exactly.
    if (/^[-+]/.test(s)) {
      const signed = Number(s) * mult;
      const pool = [p.entry_1_to_7_days.score, p.tendency_3_to_9_months.score, ...Object.values(p.family_scores), ...Object.values(p.readings), p.scale.min, p.scale.max].filter(fin);
      if (!pool.some(v => Math.abs(v - signed) <= tol)) fails.push(`signed number not in the snapshot: ${m.trim()}`);
      continue;
    }
    const ok = nums.some(v => {
      const a = Math.abs(v);
      return Math.abs(a - x) <= tol || (pct && Math.abs(a * 100 - x) <= tol);
    });
    if (!ok) fails.push(`number not in the snapshot: ${m.trim()}`);
  }
  // Direction words are checked per sentence against the card that sentence talks about (entry,
  // tendency, or either when it names neither) — Board build review #16.
  const E = p.entry_1_to_7_days, T = p.tendency_3_to_9_months;
  const val = c => (c.withheld ? null : c.score);
  for (const sent of text.toLowerCase().split(/(?<=[.!?])\s+/)) {
    const mE = /\bentry\b/.test(sent), mT = /\btendency\b/.test(sent);
    const pool = (mE && !mT) ? [val(E)] : (mT && !mE) ? [val(T)] : [val(E), val(T)];
    const has = f => pool.some(x => x != null && f(x));
    if (/\bbull(ish)?\b|\bfavou?rable\b|\bgood time to (buy|enter|get in)\b|\bbuy signal\b/.test(sent) && !onlyNegated(sent, 'bull') && !has(x => x >= 3)) fails.push("bullish wording without a matching Bull score");
    if (/\bbear(ish)?\b|\bunfavou?rable\b|\bsell signal\b/.test(sent) && !onlyNegated(sent, 'bear') && !has(x => x <= -3)) fails.push("bearish wording without a matching Bear score");
    if (/strong bull/.test(sent) && !has(x => x >= 6)) fails.push("'strong bull' without a Strong bull score");
    if (/strong bear/.test(sent) && !has(x => x <= -6)) fails.push("'strong bear' without a Strong bear score");
  }
  if (/\b(will|going to)\b[^.]*\b(rise|fall|rally|drop|crash|pump|dump|reach|hit)\b/.test(text.toLowerCase())) fails.push("price prediction");
  return fails;
}

const SYSTEM = [
  "You write one short paragraph for a Bitcoin trader about the current reading of a scoring dashboard.",
  "Use ONLY the JSON you are given. Every number you write must appear in it, written in digits exactly as given (prices may be rounded to whole dollars).",
  "Never write numbers as words. Do not predict prices. Do not add facts, news, or reasons that are not in the JSON.",
  "The entry score covers the next 1 to 7 days and the tendency score 3 to 9 months, on a scale from -10 to +10; describe them with their band names.",
  "Say plainly that these are untested candidate scores. At most 110 words. Plain prose, no lists, no headings.",
].join(" ");

const key = d => `v2:commentary:${d}`;

export async function handleCommentary(request, env, now, fetchImpl = fetch, out) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (request.method === "GET") {
    const c = await env.BRIEF_KV.get(key(day), "json");
    return c ? out(c) : out({ error: "no commentary today", date: day }, 404);
  }
  if (request.method !== "POST") return out({ error: "method" }, 405);
  if (!env.V2_COMMENTARY_TOKEN || !env.ANTHROPIC_API_KEY) return out({ error: "commentary not configured" }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (!(await safeEqual(auth, `Bearer ${env.V2_COMMENTARY_TOKEN}`))) return out({ error: "unauthorised" }, 401);
  const existing = await env.BRIEF_KV.get(key(day), "json");
  if (existing) return out({ error: "already written today", ...existing }, 409);
  const attemptsKey = `v2:commentary-attempts:${day}`;
  const attempts = Number((await env.BRIEF_KV.get(attemptsKey)) || 0);
  if (attempts >= 3) return out({ error: "3 attempts used today" }, 429);
  await env.BRIEF_KV.put(attemptsKey, String(attempts + 1), { expirationTtl: 3 * 86400 });

  const rec = await env.BRIEF_KV.get("v2:snapshot", "json");
  const snap = rec && rec.snapshot;
  if (!snap) return out({ error: "no snapshot" }, 503);
  if ((now - Date.parse(snap.generatedAt)) / 1000 > 45 * 60) return out({ error: "snapshot older than 45 min" }, 503);
  const payload = buildPayload(snap);
  if (!payload || (payload.entry_1_to_7_days.withheld && payload.tendency_3_to_9_months.withheld)) return out({ error: "scores withheld: nothing to describe" }, 409);

  let text;
  try {
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.V2_COMMENTARY_MODEL || "claude-sonnet-5-5", max_tokens: 300, system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(payload) }] }),
    });
    const j = await r.json();
    if (!r.ok) return out({ error: `model HTTP ${r.status}` }, 502);
    text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  } catch (e) { return out({ error: "model unreachable" }, 502); }
  const fails = checkText(text, payload);
  if (fails.length) return out({ error: "checks failed — not published", fails: fails.slice(0, 5) }, 422);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snap)));
  const snapshotSha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  const sc = c => (c.withheld ? { withheld: true } : { score: c.score, band: c.band });
  const c = { date: day, text, seq: snap.seq, snapshotSha256, snapshotGeneratedAt: snap.generatedAt, declarationHash: snap.engine.declarationHash,
    scores: { entry: sc(payload.entry_1_to_7_days), tendency: sc(payload.tendency_3_to_9_months) }, writtenAt: new Date(now).toISOString() };
  await env.BRIEF_KV.put(key(day), JSON.stringify(c), { expirationTtl: 40 * 86400 });
  return out(c);
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb); let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
