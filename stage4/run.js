#!/usr/bin/env node
'use strict';
// Stage 4 runner. Refuses to run unless (1) stage4/GO contains the frozen declarationHash (Djahwell's
// "go"), (2) the declaration, engine code and harness hashes equal STAGE4-DECLARATION §J, and (3) the
// history set equals §I (sha256 per file). Only that history set may be used (§K.8).
//   node stage4/run.js <historyDir> <outDir>
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const crypto = require('crypto');
const E = require('../engine-v2/engine.js'); const V = require('../engine-v2/view.js'); const H = require('./harness.js');
const FROZEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen.json'), 'utf8'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const die = m => { console.error('[stage4] REFUSED: ' + m); process.exit(2); };

const [histDir, outDir] = process.argv.slice(2);
if (!histDir || !outDir) die('usage: node stage4/run.js <historyDir> <outDir>');
const decl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'engine-v2', 'declaration.json'), 'utf8'));
const dh = E.declarationHash(decl);
if (dh !== FROZEN.declarationHash) die(`declaration hash ${dh} ≠ frozen ${FROZEN.declarationHash}`);
for (const [f, h] of Object.entries(FROZEN.codeFiles)) { const got = sha(fs.readFileSync(path.join(__dirname, '..', f))); if (got !== h) die(`${f} changed since the freeze`); }
let go = ''; try { go = fs.readFileSync(path.join(__dirname, 'GO'), 'utf8').trim(); } catch { /* none */ }
if (go !== dh) die('no "go" for this declaration (stage4/GO must contain the declarationHash)');
const hist = {};
for (const [k, h] of Object.entries(FROZEN.history)) {
  const buf = fs.readFileSync(path.join(histDir, `${k}.json.gz`)); if (sha(buf) !== h) die(`history ${k} is not the frozen set`);
  hist[k] = JSON.parse(zlib.gunzipSync(buf));
}
fs.mkdirSync(outDir, { recursive: true });
const P = V.prepare(hist);
console.log('[stage4] evaluating 2019-01-01 → 2026-10-31 (declared lags)…');
const evals = H.evaluateRange(P, decl, '2019-01-01', '2026-10-31');
fs.writeFileSync(path.join(outDir, 'evals.json'), JSON.stringify(evals));
console.log('[stage4] evaluating again with lag +1 (sensitivity)…');
const evalsLag = H.evaluateRange(P, H.lagPlusOneDecl(decl), '2019-01-01', '2026-10-31');
fs.writeFileSync(path.join(outDir, 'evals-lag1.json'), JSON.stringify(evalsLag));
const bars = P.bars;
const res = H.analyze({ evals, evalsLag, bars, decl });
res.identity = { declarationHash: dh, ranAt: new Date().toISOString(), history: FROZEN.history };
fs.writeFileSync(path.join(outDir, 'stage4-results.json'), JSON.stringify(res, null, 1));
console.log('[stage4] done →', path.join(outDir, 'stage4-results.json'));
