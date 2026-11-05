'use strict';
// Signed push to the Worker (STAGE2-PLAN §3, §8.4). Signature matches worker/v2.js:
//   X-Signature = hex HMAC-SHA256(secret, `${ts}\n${path}\n${body}`), X-Timestamp = ts (ms).
const crypto = require('crypto');

function sign(secret, ts, path, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}\n${path}\n${body}`).digest('hex');
}

async function pushSnapshot({ workerUrl, secret, fetchImpl = globalThis.fetch, now = () => Date.now() }, snap) {
  const path = '/v2/snapshot';
  const body = JSON.stringify(snap);
  const ts = String(now());
  const r = await fetchImpl(workerUrl.replace(/\/$/, '') + path, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'X-Timestamp': ts, 'X-Signature': sign(secret, ts, path, body) },
    signal: AbortSignal.timeout(15000),
  });
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, body: j };
}
module.exports = { pushSnapshot, sign };
