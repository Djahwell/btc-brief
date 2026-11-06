'use strict';
// BTC Brief V2 page (STAGE3-PLAN §4). Display only: reads the Worker snapshot, re-checks every
// family's freshness at view time with the same rules as the engine, re-applies quorum with the
// engine's own scorecards(), and REMOVES numbers (never greys them) when anything fails.
(function () {
  const WORKER = 'https://btc-brief.joel-toe.workers.dev';
  const EVENTS_URL = 'https://raw.githubusercontent.com/Djahwell/btc-brief/v2-data/v2/events.json';
  const TRACK_URL = 'https://raw.githubusercontent.com/Djahwell/btc-brief/v2-data/v2/track.json';
  const COND_BASE_URL = 'https://raw.githubusercontent.com/Djahwell/btc-brief/v2-data/v2/condition-base.json';
  const REFRESH_MS = 30 * 60 * 1000;
  const AMBER_SEC = 45 * 60, WITHHOLD_SEC = 90 * 60;
  const E = window.BriefEngine, S = window.BriefSummary, C = window.BriefCondition;
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sgn = n => (n > 0 ? '+' + n : String(n));
  const cls = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');
  const usd = n => (Number.isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : '—');
  const ago = sec => (sec == null ? '—' : sec < 90 ? `${Math.round(sec)} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : sec < 172800 ? `${(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 86400)} d`);
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  const FAM = {
    E1: ['Trend', '20/50-day'], E2: ['Auction', '30-day value'], E3a: ['Perp premium', '8 h, contrarian'], E5a: ['Coinbase', 'US spot premium'],
    E7: ['Fear & Greed', 'extremes only'], E6: ['Volatility', 'regime, no vote'],
    T1: ['MVRV', 'valuation'], 'T2+': ['LTH flow', '30-day'], 'T2-': ['LTH flow', '30-day'], T3: ['200-day', 'trend'], T4: ['Stablecoins', 'supply growth'],
  };
  const LAG = { E1: 'daily_bars', E2: 'daily_bars', E6: 'daily_bars', T3: 'daily_bars', E7: 'fear_greed', T1: 'mvrv', 'T2+': 'lth', 'T2-': 'lth', T4: 'stablecoins' };
  const LIVE = { E3a: 'perp_premium_binance_8h', E5a: 'coinbase_premium_adj' };
  const INPUT_LABEL = {
    perp_premium_binance_8h: 'Perp premium (Binance 8 h)', funding_context: 'Funding (context)', oi_btc_total: 'Open interest (6 perps)',
    coinbase_premium_adj: 'Coinbase premium', liquidations_24h: 'Liquidations 24 h', btc_daily_close: 'Daily close (Coinbase)',
    fear_greed: 'Fear & Greed', mvrv: 'MVRV (CoinMetrics)', stablecoin_supply: 'Stablecoins (USDT+USDC)', lth_net_30d: 'LTH supply (BMP)',
    coinbase_premium_adj_repro: 'Coinbase premium (repro copy)',
  };

  let decl = null, declHash = null, fw1Hash = null, lastFetchError = null;
  let cdecl = null, cdeclHash = null, cev = null, cbase = null;
  const KNOWN_SCHEMAS = ['brief-v2/1', 'brief-v2/2'];
  // Stage 4 (5 Nov 2026, STAGE4.md): no entry or tendency candidate passed → descriptive mode (§F).
  // The page shows family readings, states and levels only; never a scorecard number or band.
  const FW1_SINCE = 'its first daily record (Nov 2026)';
  const DESCRIPTIVE = { since: '2026-11-05', reason: 'No score: neither read passed its test on 2019–2026 history (5 Nov 2026). The family readings below are shown as context.' };
  let lastView = null;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function loadDecl() {
    const r = await fetch('engine/declaration.json', { cache: 'no-store' });
    decl = await r.json();
    declHash = await sha256Hex(JSON.stringify(decl));
    try { const f = await (await fetch('engine/declaration-fw1.json', { cache: 'no-store' })).json(); fw1Hash = await sha256Hex(JSON.stringify(f)); } catch (_) { fw1Hash = null; }
    try {
      const t = await (await fetch('engine/condition-declaration.json', { cache: 'no-store' })).text(); cdecl = JSON.parse(t); cdeclHash = await sha256Hex(t);
      cev = await (await fetch('engine/condition-evidence.json', { cache: 'no-store' })).json();
    } catch (_) { cdecl = null; }
  }

  // FW1 forward candidate (FORWARD-FW1.md): shown labelled UNTESTED, only for a fresh, live snapshot
  // whose FW1 declaration hash equals this page's copy. Never shown from a cached copy.
  function fw1View(snap, now) {
    const f = snap.engine && snap.engine.fw1;
    if (!f || f.error) return { withheld: true, reason: 'the FW1 score starts when the engine runs on the VPS' };
    if (!fw1Hash || f.declarationHash !== fw1Hash) return { withheld: true, reason: 'FW1 was computed under a declaration this page does not know' };
    if (state.fromCache) return { withheld: true, reason: 'the Worker could not be reached; scores are never shown from a cached copy' };
    if ((now - Date.parse(snap.generatedAt)) / 1000 > WITHHOLD_SEC) return { withheld: true, reason: 'snapshot older than 90 min' };
    return { withheld: false, entry: f.entry, tendency: f.tendency };
  }
  async function getJSON(url, ms = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    finally { clearTimeout(t); }
  }

  // ---- view-time freshness and withholding --------------------------------------------------
  function inputAgeSec(inp, now) { return inp && inp.asOf ? (now - Date.parse(inp.asOf)) / 1000 : null; }
  function viewTimeEngine(snap, now) {
    const eng = snap.engine;
    if (!decl) return { withheld: true, reason: 'the declaration file did not load' };
    if (!KNOWN_SCHEMAS.includes(snap.schema)) return { withheld: true, reason: `unknown snapshot schema ${snap.schema}` };
    if (state.fromCache) return { withheld: true, reason: 'the Worker could not be reached; scores are never shown from a cached copy' };
    if (!eng || !eng.families || !eng.scores) return { withheld: true, reason: eng ? (eng.reason || 'engine withheld its scores') : 'scores start when the engine is installed on the VPS (on or after 19 Nov 2026)' };
    if (eng.declarationHash !== declHash) return { withheld: true, reason: 'scores were computed under a declaration this page does not know' };
    const ageSec = (now - Date.parse(snap.generatedAt)) / 1000;
    if (ageSec > WITHHOLD_SEC) return { withheld: true, reason: `snapshot is ${ago(ageSec)} old (limit 90 min)` };
    const fam = JSON.parse(JSON.stringify(eng.families)); const dropped = [];
    const D = today();
    for (const [k, f] of Object.entries(fam)) {
      if (f.score == null) continue;
      let fresh = true;
      if (LAG[k]) fresh = !!f.asOf && f.asOf >= addDays(D, -decl.lagsDays[LAG[k]] - decl.staleGraceDays);
      else if (LIVE[k]) { const inp = snap.inputs[LIVE[k]]; const a = inputAgeSec(inp, now); fresh = !!inp && inp.quality === 'OK' && a != null && a <= inp.staleAfterSec; }
      if (!fresh) { fam[k] = { ...f, score: null, reason: 'stale at view time' }; dropped.push(k); }
    }
    const scores = E.scorecards(fam, eng.warnings || {}, decl);
    return { withheld: false, families: fam, scores, primary: eng.primary, warnings: eng.warnings || {}, dropped, status: eng.status, eng };
  }

  // ---- rendering ---------------------------------------------------------------------------
  function renderCard(el, c, fallbackReason) {
    const box = el.querySelector('.score'), num = el.querySelector('.num'), band = el.querySelector('.band'), sub = el.querySelector('.sub'), mark = el.querySelector('.mark');
    if (DESCRIPTIVE && !(c && c.fw1)) {
      box.classList.add('withheld'); num.className = 'num'; num.textContent = 'Descriptive'; band.textContent = ''; mark.style.display = 'none';
      el.querySelector('.gauge').style.display = 'none'; sub.textContent = DESCRIPTIVE.reason; return;
    }
    if (c && c.fw1) {
      el.querySelector('.gauge').style.display = '';
      if (c.withheld || c.score == null) { box.classList.add('withheld'); num.className = 'num'; num.textContent = 'Withheld'; band.textContent = ''; mark.style.display = 'none'; sub.textContent = c.reason || ''; return; }
      box.classList.remove('withheld'); num.className = 'num ' + cls(c.score); num.textContent = sgn(c.score);
      band.className = 'band ' + cls(c.score); band.textContent = c.band; mark.style.display = 'block'; mark.style.left = `${(c.score + 10) * 5}%`;
      sub.innerHTML = `<strong>FW1 · Untested</strong> — forward test since ${esc(FW1_SINCE)}. ` + esc((c.parts || []).map(p => `${p.label} ${p.pts > 0 ? '+' : ''}${p.pts}`).join(' · ')) + (c.volatilityHalved ? ' · halved (high volatility)' : '');
      return;
    }
    if (!c || c.withheld || c.score == null) {
      box.classList.add('withheld'); num.className = 'num'; num.textContent = 'Withheld'; band.textContent = ''; mark.style.display = 'none';
      sub.textContent = (c && c.reason) || fallbackReason || ''; return;
    }
    box.classList.remove('withheld');
    num.className = 'num ' + cls(c.score); num.textContent = sgn(c.score);
    band.className = 'band ' + cls(c.score); band.textContent = c.band;
    mark.style.display = 'block'; mark.style.left = `${(c.score + 10) * 5}%`;
    sub.textContent = `${c.active}/${c.of} families fresh`;
  }

  function famRow(k, f) {
    const [name, hint] = FAM[k] || [k, ''];
    const on = f && f.score != null;
    const s = on ? f.score : 0;
    const w = Math.min(50, Math.abs(s) * 5);
    const fill = on && s !== 0 ? `<div class="fill" style="left:${s > 0 ? 50 : 50 - w}%;width:${w}%;background:var(--${s > 0 ? 'bull' : 'bear'})"></div>` : '';
    const what = on ? S.phrase(k, f) : (k === 'E6' && f && f.pct != null ? `${f.topDecile ? 'top decile — scores halve in variant b' : 'normal'} (percentile ${Math.round(f.pct)})` : `withheld: ${esc((f && f.reason) || 'no data')}`);
    return `<div class="fam ${on ? '' : 'off'}"><div class="name">${esc(name)}<small>${esc(hint)}</small></div><div class="bar">${fill}</div><div class="val ${on ? cls(s) : ''}">${on ? sgn(s) : '—'}</div><div class="what">${esc(what || '')}</div></div>`;
  }

  function renderFamilies(v) {
    if (v.withheld) { $('#families').innerHTML = `<p class="muted">${esc(v.reason)}</p>`; return; }
    const t2 = v.primary.tendency.endsWith('T2-') ? 'T2-' : 'T2+';
    const entry = decl.scorecards.entry.families.map(k => famRow(k, v.families[k])).join('') + famRow('E6', v.families.E6);
    const tend = ['T1', t2, 'T3', 'T4'].map(k => famRow(k, v.families[k])).join('');
    $('#families').innerHTML = `<div class="group">Entry</div>${entry}<div class="group">Tendency</div>${tend}`;
  }

  function renderLevels(snap, v) {
    const f = snap.engine && snap.engine.families;
    if (!f) { $('#levels').innerHTML = '<p class="muted">Levels appear with the scores.</p>'; return; }
    const mark = markPrice(snap);
    const rows = [];
    if (f.E2 && f.E2.vah != null) rows.push(['Value area high (30 d)', f.E2.vah], ['Point of control', f.E2.poc], ['Value area low (30 d)', f.E2.val]);
    if (f.E1 && f.E1.levels) rows.push(['20-day average', f.E1.levels.sma20], ['50-day average', f.E1.levels.sma50]);
    if (f.T3 && f.T3.levels) rows.push(['200-day average', f.T3.levels.sma200]);
    if (Number.isFinite(mark)) rows.push(['Now (perp mark)', mark, true]);
    rows.sort((a, b) => b[1] - a[1]);
    const atr = f.E1 && f.E1.levels && f.E1.levels.atr14;
    $('#levels').innerHTML = rows.map(([k, x, p]) => `<div class="row ${p ? 'price' : ''}"><span class="k">${esc(k)}</span><span>${usd(x)}</span></div>`).join('') +
      (Number.isFinite(atr) ? `<p class="fine">Daily range (ATR 14): ${usd(atr)}. Levels use completed daily bars to ${esc(f.E1.asOf || '—')}.</p>` : '');
  }

  function markPrice(snap) {
    const b = snap.inputs && snap.inputs.oi_btc_total && snap.inputs.oi_btc_total.byVenue;
    const m = b && b.binance && b.binance.BTCUSDT && b.binance.BTCUSDT.mark;
    return Number.isFinite(m) ? m : null;
  }

  function renderHealth(snap, now) {
    const items = [];
    for (const [k, inp] of Object.entries(snap.inputs || {})) {
      const a = inputAgeSec(inp, now);
      const st = inp.quality !== 'OK' ? (inp.quality === 'STALE' ? 'stale' : 'missing') : (a != null && inp.staleAfterSec && a > inp.staleAfterSec ? 'stale' : 'ok');
      items.push([INPUT_LABEL[k] || k, st, a]);
    }
    for (const [k, inp] of Object.entries((snap.daily && snap.daily.inputs) || {})) {
      if (k === 'coinbase_premium_adj_repro') continue;
      const a = inp.asOf ? (now - Date.parse(inp.asOf.length === 10 ? inp.asOf + 'T00:00:00Z' : inp.asOf)) / 1000 : null;
      const st = inp.quality !== 'OK' ? (inp.quality === 'STALE' ? 'stale' : 'missing') : (a != null && inp.staleAfterSec && a > inp.staleAfterSec + 86400 ? 'stale' : 'ok');
      items.push([INPUT_LABEL[k] || k, st, a]);
    }
    $('#health').innerHTML = items.map(([l, st, a]) => `<li><span class="dot ${st}"></span><span class="lbl">${esc(l)}</span><span class="ago">${ago(a)}</span></li>`).join('');
  }

  function renderSummary(v) {
    if (v.withheld) { $('#summary').innerHTML = `<p class="muted">No summary while scores are withheld.</p>`; $('#why').innerHTML = ''; $('#notes').textContent = ''; return; }
    const s = S.summarize({ families: v.families, scores: v.scores, primary: v.primary }, decl);
    $('#summary').innerHTML = DESCRIPTIVE ? `<p class="muted">Readings, not a verdict: the strongest families are listed under "Why". No entry or tendency score is given (descriptive mode).</p>` : `<p>${esc(s.entry)}</p><p>${esc(s.tendency)}</p>`;
    $('#why').innerHTML = s.why.length ? s.why.map(w => `<li>${esc(w)}</li>`).join('') : '<li class="muted">No family is away from neutral.</li>';
    $('#notes').textContent = s.notes.join(' ');
  }

  function renderDetail(snap, now) {
    const rows = [];
    const add = (k, inp, via) => {
      let v = inp.value;
      if (v && typeof v === 'object') v = Object.keys(v).length + ' fields';
      else if (typeof v === 'number') v = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : +v.toPrecision(4);
      const dl = [['Value', `${v ?? '—'} ${inp.unit || ''}`], ['Window', inp.window], ['Data as of', inp.asOf], ['Fetched', inp.fetchedAt], ['Quality', inp.quality + (inp.carriedForward ? ' (carried forward)' : '')], ['Source', inp.source], ['Scope', inp.scope], ['Via', via]]
        .filter(([, x]) => x != null && x !== '').map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('');
      rows.push(`<details class="val"><summary>${esc(INPUT_LABEL[k] || k)}<span class="v">${esc(v ?? '—')}</span></summary><dl>${dl}</dl></details>`);
    };
    for (const [k, inp] of Object.entries(snap.inputs || {})) add(k, inp, 'VPS cycle');
    for (const [k, inp] of Object.entries((snap.daily && snap.daily.inputs) || {})) add(k, inp, 'GitHub daily job');
    $('#detail').innerHTML = rows.join('');
  }

  // Scheduled events (context only, never part of a score). Times shown in the device's time zone.
  async function renderEvents() {
    const box = $('#events');
    try {
      const j = await getJSON(EVENTS_URL + '?t=' + Math.floor(Date.now() / 6e5));
      const now = Date.now(), h48 = now + 48 * 3600e3, d7 = now + 7 * 86400e3;
      const up = (j.events || []).filter(e => Date.parse(e.t) >= now - 3600e3 && Date.parse(e.t) <= d7);
      const soon = up.filter(e => e.impact === 'high' && Date.parse(e.t) <= h48);
      const fmt = t => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const src = j.sources || {}; const notes = [];
      for (const [k, v] of Object.entries(src)) { if (!v.ok) notes.push(`${k}: unavailable`); else if (v.mode) notes.push(`${k}: official schedule read ${v.readAt}${v.stale ? ', needs extending' : ''}`); }
      box.innerHTML = `<div class="evflag ${soon.length ? 'on' : ''}">${soon.length ? `High-impact event within 48 h (${soon.length})` : 'No high-impact event in the next 48 h'}</div>` +
        (up.length ? `<ul class="evlist">${up.map(e => `<li><span class="when">${esc(fmt(e.t))}</span><span class="${e.impact === 'high' ? 'hi' : ''}">${esc(e.label)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing scheduled in the next 7 days.</p>') +
        `<p class="fine">FOMC from federalreserve.gov, CPI and payrolls from bls.gov, BTC options expiries by Deribit's last-Friday rule. Context only: never part of a score. ${esc(notes.join(' · '))}</p>`;
    } catch (_) { box.innerHTML = '<p class="muted">Event calendar unavailable.</p>'; }
  }

  async function renderTrack() {
    if (DESCRIPTIVE) { $('#track').innerHTML = `<p class="muted">No forecast is shown. The Stage 4 candidates and FW1 (untested, trend-led) keep recording every day in the background; FW1's forward test continues from ${esc(FW1_SINCE)} (FORWARD-FW1.md).</p>`; return; }
    try {
      const t = await getJSON(TRACK_URL + '?t=' + Math.floor(Date.now() / 6e5));
      const b = t.entry && t.entry.byBand;
      if (!b || !Object.keys(b).length) throw new Error('empty');
      const order = ['Strong bull', 'Bull', 'Neutral', 'Bear', 'Strong bear'];
      const rows = order.filter(k => b[k]).map(k => { const r = b[k]; return `<tr><td>${esc(k)}</td><td>${r.days}</td><td>${r.done}</td><td class="${cls(r.meanRet7d || 0)}">${r.meanRet7d == null ? '—' : (r.meanRet7d * 100).toFixed(1) + '%'}</td><td>${r.meanMae7d == null ? '—' : (r.meanMae7d * 100).toFixed(1) + '%'}</td></tr>`; }).join('');
      $('#track').innerHTML = `<table><thead><tr><th>Entry band</th><th>Days</th><th>Closed</th><th>7-day return</th><th>7-day worst</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="fine">${t.entry.withheldDays || 0} withheld and ${t.entry.missingDays || 0} missing days counted. Live rows only (Stage 4 reconstruction is reported separately). Updated ${esc(t.generatedAt || '')}.</p>`;
    } catch (_) {
      $('#track').innerHTML = '<p class="muted">The live record starts with the first frozen daily snapshot after the engine is installed; each day closes 7 days later.</p>';
    }
  }

  // The paragraph is shown only for the snapshot it was written for, or while the two scorecards and
  // the declaration are unchanged since then (it is labelled with its snapshot time). Never while the
  // scores are withheld, never across a declaration change.
  async function renderCommentary(snap) {
    const box = $('#claude-text'), btn = $('#claude-btn');
    const v = lastView;
    if (DESCRIPTIVE) { box.innerHTML = '<span class="muted">The daily Claude paragraph returns once its checker is rebuilt for the condition read (it was built to describe scores).</span>'; btn.hidden = true; return; }
    if (!v || v.withheld) { box.innerHTML = '<span class="muted">No commentary while scores are withheld.</span>'; btn.hidden = true; return; }
    try {
      const c = await getJSON(`${WORKER}/v2/commentary`);
      if (c && c.text && c.date === today()) {
        const now = { entry: v.scores[v.primary.entry], tendency: v.scores[v.primary.tendency] };
        const same = k => c.scores && c.scores[k] && !now[k].withheld && c.scores[k].score === now[k].score && c.scores[k].band === now[k].band;
        const ok = c.declarationHash === snap.engine.declarationHash && (c.seq === snap.seq || (same('entry') && same('tendency')));
        const hhmm = t => new Date(t).toUTCString().slice(17, 22);
        box.innerHTML = ok
          ? `${esc(c.text)}<span class="stamp">Claude, written ${esc(hhmm(c.writtenAt))} UTC from the ${esc(hhmm(c.snapshotGeneratedAt))} UTC snapshot${c.seq !== snap.seq ? '; both scores unchanged since, other readings may have moved' : ''}.</span>`
          : `<span class="muted">Today's paragraph described the ${esc(hhmm(c.snapshotGeneratedAt))} UTC reading; the scores have changed since, so it is not shown.</span>`;
        btn.hidden = true; return;
      }
      box.textContent = ''; btn.hidden = false; btn.disabled = false;
    } catch (_) { box.innerHTML = '<span class="muted">No commentary.</span>'; btn.hidden = true; }
  }
  async function askClaude() {
    let token = store.get('v2token');
    if (!token) { token = window.prompt('Commentary token (asked once on this device):'); if (!token) return; store.set('v2token', token.trim()); token = token.trim(); }
    const btn = $('#claude-btn'); btn.disabled = true; btn.textContent = 'Writing…';
    try {
      const r = await fetch(`${WORKER}/v2/commentary`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { store.set('v2token', null); throw new Error('token refused'); }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    } catch (e) { $('#claude-text').innerHTML = `<span class="muted">No commentary: ${esc(e.message)}</span>`; }
    btn.textContent = "Write today's paragraph";
    if (state.snap) renderCommentary(state.snap);
  }


  // ---- market condition (STAGE-C-PLAN, COND-1) -----------------------------------------------
  const pctTxt = p => (Number.isFinite(p) ? `${Math.round(p)}th pct` : '—');
  const pp = (x, d = 0) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '—');
  const CONV = { supportive: ['sup', 'supportive (by convention)'], headwind: ['head', 'headwind (by convention)'], neutral: ['neu', 'neutral'] };
  function condBaseFresh() {
    if (!cbase || !cbase.barDate) return null;
    return cbase.barDate >= addDays(today(), -3) ? cbase : null;           // completed bar to D-1, allow 2 late days
  }
  function evidenceLine(k, st) {
    const e = cev && cev.rows && cev.rows[k] && cev.rows[k][st];
    if (!e) return '';
    const lead = 'History 2019–26, not a tested link to later price:';
    const nh = cev.noHistory && cev.noHistory[`${k}.${st}`];
    if (nh) return `<p class="cev">${lead} no history, this state ${esc(nh)}.</p>`;
    if (e.suppressed) return `<p class="cev">${lead} too few days in this state to describe (${e.windows} windows of 90 days).</p>`;
    return `<p class="cev">${lead} next 90 days median ${pp(e.medianRet)} (10–90% range ${pp(e.p10)} to ${pp(e.p90)}), up ${Math.round(e.upShare * 100)}% of the time, typical dip ${pp(e.medianDip)}. ${e.windows} windows of 90 days${e.episodes >= 2 ? `, ${e.episodes} separate episodes` : ''}. All days: median ${pp(cev.allDays.medianRet)}, up ${Math.round(cev.allDays.upShare * 100)}%.</p>`;
  }
  function condReadings(snap, v) {
    const fam = v.families, f = snap.engine || {};
    const fw = f.fw1 && f.fw1.entry && !f.fw1.entry.withheld && f.fw1.entry.parts && f.fw1.entry.parts[0];
    const oi = snap.inputs && snap.inputs.oi_btc_total, fu = snap.inputs && snap.inputs.funding_context, lq = snap.inputs && snap.inputs.liquidations_24h;
    const now = Date.now(); const ok = inp => inp && inp.quality === 'OK' && inputAgeSec(inp, now) <= inp.staleAfterSec;
    const atr = fam.E1 && fam.E1.levels && fam.E1.levels.atr14, close = fam.E1 && fam.E1.levels && fam.E1.levels.close;
    return C.readingsFromFamilies(fam, condBaseFresh(), {
      fw1Base: fw && fw.k === 'trend' ? fw.pts : null,
      oiChg7d: ok(oi) && Number.isFinite(oi.chg7d_pct) ? oi.chg7d_pct : null,
      funding: ok(fu) ? fu.value : null,
      atrPct: Number.isFinite(atr) && Number.isFinite(close) ? atr / close : null,
      liq: ok(lq) && lq.value ? { ...lq.value, pct: lq.pct_of_oi } : null,
    });
  }
  function readingText(k, o, R, snap, fam) {
    const mark = markPrice(snap);
    switch (k) {
      case 'value': {
        const b = condBaseFresh(); const rp = b && b.realized && b.realized.v;
        return `MVRV ${pctTxt(R.mvrvPct)}${fam.T1 && Number.isFinite(fam.T1.raw) ? ` (${fam.T1.raw.toFixed(2)})` : ''} · vs 200-week average ${pctTxt(R.pctW200)}${b ? ` (${pp(b.w200)})` : ''} · nearness to high ${pctTxt(R.pctNearATH)}${b ? ` (${pp(b.nearATH)} from the all-time high)` : ''}${rp ? ` · realized price ${usd(rp)}` : ''}${b ? '' : ' · daily bar readings unavailable'}`;
      }
      case 'trend200': {
        const sma = fam.T3 && fam.T3.levels && fam.T3.levels.sma200;
        return `200-day average ${usd(sma)}${Number.isFinite(mark) && Number.isFinite(sma) ? `, price ${pp(mark / sma - 1, 1)} from it` : ''}; average ${R.slope200 > 0 ? 'rising' : R.slope200 < 0 ? 'falling' : 'flat'} over 20 days`;
      }
      case 'structure': {
        const L = fam.E1 && fam.E1.levels; const auc = o.auction ? cdecl.rows.structure.auction[o.auction] : null;
        return `20-day ${usd(L && L.sma20)}, 50-day ${usd(L && L.sma50)}${auc ? ` · price ${auc}` : ''}`;
      }
      case 'leverage': {
        const fu = o.funding && Number.isFinite(o.funding.binance) ? ` · funding Binance ${(o.funding.binance * 100).toFixed(4)}%/8 h` : '';
        return `perp premium ${pctTxt(o.pct)}${fam.E3a && Number.isFinite(fam.E3a.raw) ? ` (${(fam.E3a.raw * 100).toFixed(3)}%)` : ''} · open interest 7-day change ${Number.isFinite(o.oiChg7d) ? pp(o.oiChg7d / 100, 1) : 'not yet available'}${fu}`;
      }
      case 'spot': return `Coinbase premium z ${o.z.toFixed(2)} against its last 30 days`;
      case 'liquidity': return `30-day supply growth ${pp(o.x, 1)} versus its usual pace`;
      case 'holders': return `${Math.round(o.x).toLocaleString('en-US')} BTC net over 30 days`;
      case 'sentiment': return `Fear & Greed ${Math.round(o.x)}`;
      case 'volatility': return `30-day realized volatility ${pctTxt(o.pct)}${Number.isFinite(o.atrPct) ? ` · daily range ${(o.atrPct * 100).toFixed(1)}% of price` : ''}`;
      case 'liquidations': { const c = o.context; if (!c) return 'no data'; return `longs ${Math.round(c.long_btc).toLocaleString('en-US')} BTC${c.pct ? ` (${c.pct.long.toFixed(2)}% of OI)` : ''}, shorts ${Math.round(c.short_btc).toLocaleString('en-US')} BTC${c.pct ? ` (${c.pct.short.toFixed(2)}%)` : ''}`; }
    }
    return '';
  }
  function renderCondition(snap, v) {
    if (!cdecl || !C) { $('#cond-rows').innerHTML = '<p class="muted">Condition files did not load.</p>'; return; }
    if (v.withheld) { $('#cond-summary').innerHTML = ''; $('#cond-rows').innerHTML = `<p class="muted">No condition read: ${esc(v.reason)}.</p>`; return; }
    const R = condReadings(snap, v); const S2 = C.states(R, cdecl);
    renderCondScore(C.score(S2, cdecl));
    $('#cond-summary').innerHTML = C.summary(S2, cdecl).map((l, i, a) => `<p class="${i === a.length - 1 ? 'fine' : ''}">${esc(l)}</p>`).join('');
    let html = '', grp = null;
    for (const [k, def] of Object.entries(cdecl.rows)) {
      const o = S2[k];
      if (def.group !== grp) { grp = def.group; html += `<div class="group">${esc(grp)}</div>`; }
      const has = o.state != null || (k === 'liquidations' && o.context);
      const [c, word] = o.state == null ? ['nod', 'no data'] : o.convention ? CONV[o.convention] : ['unc', 'not coloured'];
      const chip = k === 'liquidations' ? (o.context ? '<span class="chip unc">context</span>' : '<span class="chip nod">no data</span>') : `<span class="chip ${c}">${esc(o.label || 'No data')}${o.state != null && o.convention !== 'neutral' ? ` · ${esc(word)}` : ''}</span>`;
      html += `<div class="crow"><div class="chead"><span class="clabel">${esc(def.label)}</span>${chip}</div>` +
        (has ? `<div class="cread">${esc(readingText(k, o, R, snap, v.families))}</div>` : '') +
        (o.meaning ? `<p class="cmean">${esc(o.meaning)}</p>` : '') + (def.note ? `<p class="cnote">${esc(def.note)}</p>` : '') +
        (o.state != null ? evidenceLine(k, o.state) : '') + '</div>';
    }
    $('#cond-rows').innerHTML = html;
    const b = condBaseFresh();
    $('#cond-asof').textContent = b ? `daily bars to ${b.barDate}` : '';
    $('#cond-foot').textContent = `Describes conditions, not the next move. Supportive / headwind is a stated financial convention, fixed before build and never fitted to prices. Declaration ${cdecl.id} · ${cdeclHash ? cdeclHash.slice(0, 10) : '—'} · evidence ${cev ? cev.period : '—'}.`;
  }
  function renderCondScore(sc) {
    const el = $('#cond-score'), num = el.querySelector('.num'), band = el.querySelector('.band'), mark = el.querySelector('.mark'), sub = el.querySelector('.sub');
    if (sc.withheld) { num.className = 'num'; num.textContent = 'Withheld'; band.textContent = ''; mark.style.display = 'none'; sub.textContent = sc.reason; renderBandHistory(null); return; }
    num.className = 'num'; num.textContent = (sc.score > 0 ? '+' : '') + sc.score;            // neutral colour (Board): not a buy/sell light
    band.className = 'band'; band.textContent = sc.band + ' condition';
    mark.style.display = 'block'; mark.style.left = `${(sc.score + 10) * 5}%`;
    const g = Object.entries(sc.groups).map(([k, x]) => `${k} ${x == null ? 'no data' : (x > 0 ? '+' : '') + x}`).join(' · ');
    sub.textContent = `Financial condition by stated convention: how supportive today's figures are, not a price call and not a tested forecast. Votes: ${g}. Leverage is shown below but not scored (no open-interest history).`;
    renderBandHistory(sc.band);
  }
  function renderBandHistory(now) {
    let box = $('#cond-bands'); if (!box) { box = document.createElement('div'); box.id = 'cond-bands'; box.className = 'track cbands'; $('#cond-score').appendChild(box); }
    if (!cev || !cev.score) { box.innerHTML = ''; return; }
    const B = ['Strong bull', 'Bull', 'Neutral', 'Bear', 'Strong bear'];
    const rows = B.map(b => { const e = cev.score[b]; const cur = b === now ? ' class="cur"' : '';
      return e.suppressed ? `<tr${cur}><td>${esc(b)}</td><td colspan="3" class="muted">too few days (${e.windows} windows)</td><td>${e.windows}</td></tr>`
        : `<tr${cur}><td>${esc(b)}</td><td>${pp(e.medianRet)}</td><td>${Math.round(e.upShare * 100)}%</td><td>${pp(e.medianDip)}</td><td>${e.windows}</td></tr>`; }).join('') +
      `<tr><td>All days</td><td>${pp(cev.allDays.medianRet)}</td><td>${Math.round(cev.allDays.upShare * 100)}%</td><td>${pp(cev.allDays.medianDip)}</td><td></td></tr>`;
    box.innerHTML = `<table><thead><tr><th>Condition, 2019–26</th><th>Next 90 d median</th><th>Up</th><th>Typical dip</th><th>Windows</th></tr></thead><tbody>${rows}</tbody></table><p class="fine">What followed each band in 2019–26, side by side. Descriptive, not a tested forecast; the score has no forward test.</p>`;
  }
  async function loadCondBase() { try { cbase = await getJSON(COND_BASE_URL + '?t=' + Math.floor(Date.now() / 6e5)); } catch (_) { cbase = null; } }

  // ---- main loop -----------------------------------------------------------------------------
  const state = { snap: null, fetchedAt: null, fromCache: false };
  function render() {
    const snap = state.snap; const now = Date.now();
    if (!snap) { $('#age').textContent = lastFetchError ? 'offline' : 'loading…'; return; }
    const ageSec = (now - Date.parse(snap.generatedAt)) / 1000;
    const ageEl = $('#refresh');
    ageEl.className = 'age' + (ageSec > WITHHOLD_SEC ? ' red' : ageSec > AMBER_SEC ? ' amber' : '');
    $('#age').textContent = `data ${ago(ageSec)} old`;
    const mark = markPrice(snap); $('#price').textContent = Number.isFinite(mark) ? usd(mark) : '';
    let v;
    try { v = viewTimeEngine(snap, now); } catch (e) { v = { withheld: true, reason: 'the scores could not be checked on this device' }; }
    lastView = v;
    const banner = [];
    if (v.withheld) banner.push(`<strong>Readings withheld:</strong> ${esc(v.reason)}.`);
    if (!v.withheld && v.dropped.length) banner.push(`Stale at view time, shown as "no data": ${esc(v.dropped.map(k => (FAM[k] || [k])[0]).join(', '))}.`);
    if (state.fromCache) banner.push(`Offline: showing the copy fetched ${ago((now - state.fetchedAt) / 1000)} ago${lastFetchError ? ` (last error: ${esc(lastFetchError)})` : ''}.`);
    else if (lastFetchError) banner.push(`Last refresh failed: ${esc(lastFetchError)}.`);
    $('#banner').innerHTML = banner.join('<br>'); $('#banner').hidden = !banner.length;
    renderHealth(snap, now); renderCondition(snap, v); renderLevels(snap, v); renderDetail(snap, now);
    $('#foot').textContent = `Snapshot ${snap.seq} · ${snap.codeVersion}${snap.engine && snap.engine.declarationHash ? ' · declaration ' + snap.engine.declarationHash.slice(0, 10) : ''}`;
  }

  async function refresh() {
    try {
      const r = await getJSON(`${WORKER}/v2/snapshot`);
      if (!r || !r.snapshot) throw new Error('no snapshot');
      state.snap = r.snapshot; state.fetchedAt = Date.now(); state.fromCache = false; lastFetchError = null;
      store.set('v2snap', { snap: r.snapshot, fetchedAt: state.fetchedAt });
    } catch (e) {
      lastFetchError = e.name === 'AbortError' ? 'timed out' : e.message;
      const c = store.get('v2snap');
      if (c && c.snap && !state.snap) { state.snap = c.snap; state.fetchedAt = c.fetchedAt; state.fromCache = true; }
      else if (state.snap) state.fromCache = true;
    }
    render();
    if (state.snap) renderCommentary(state.snap);
    renderTrack();
    renderEvents();
    loadCondBase().then(() => { if (state.snap) render(); });
  }

  async function start() {
    $('#refresh').addEventListener('click', refresh);
    $('#claude-btn').addEventListener('click', askClaude);
    try { await loadDecl(); } catch (e) { lastFetchError = 'declaration file missing'; }
    await loadCondBase();
    await refresh();
    setInterval(refresh, REFRESH_MS);
    setInterval(render, 60 * 1000);                      // ages and view-time withholding move with the clock
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (state.fetchedAt || 0) > 5 * 60 * 1000) refresh(); });
  }
  start();
})();
