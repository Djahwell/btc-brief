#!/usr/bin/env node
'use strict';
// Maison Toé relevance runner (§G, §M). Same gates as run.js (declaration, engine, harness and mt.js
// hashes, GO, frozen history) plus the twin-trade file's sha256 recorded in frozen.json before any join.
//   node stage4/mt-run.js <historyDir> <c0-v1.1.cmp.json> <outDir>
const fs = require('fs'); const path = require('path'); const zlib = require('zlib'); const crypto = require('crypto');
const E = require('../engine-v2/engine.js'); const V = require('../engine-v2/view.js'); const MT = require('./mt.js');
const FROZEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen.json'), 'utf8'));
const FROZEN_MT = JSON.parse(fs.readFileSync(path.join(__dirname, 'frozen-mt.json'), 'utf8'));   // mt.js, mt-run.js and the trade file, frozen before any join
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const die = m => { console.error('[stage4-mt] REFUSED: ' + m); process.exit(2); };
const [histDir, cmpFile, outDir] = process.argv.slice(2);
if (!histDir || !cmpFile || !outDir) die('usage: node stage4/mt-run.js <historyDir> <cmp.json> <outDir>');
const decl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'engine-v2', 'declaration.json'), 'utf8'));
const dh = E.declarationHash(decl); if (dh !== FROZEN.declarationHash) die('declaration hash');
for (const [f, h] of Object.entries({ ...FROZEN.codeFiles, ...FROZEN_MT.files })) if (sha(fs.readFileSync(path.join(__dirname, '..', f))) !== h) die(`${f} changed since the freeze`);
let go = ''; try { go = fs.readFileSync(path.join(__dirname, 'GO'), 'utf8').trim(); } catch { /* none */ }
if (go !== dh) die('no "go"');
const cmpBuf = fs.readFileSync(cmpFile); if (sha(cmpBuf) !== FROZEN_MT.trades) die('twin-trade file is not the frozen one');
const hist = {}; for (const [k, h] of Object.entries(FROZEN.history)) { const b = fs.readFileSync(path.join(histDir, `${k}.json.gz`)); if (sha(b) !== h) die(`history ${k}`); hist[k] = JSON.parse(zlib.gunzipSync(b)); }
const res = MT.run({ P: V.prepare(hist), hist, decl, cmp: JSON.parse(cmpBuf) });
fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'stage4-maisontoe.json'), JSON.stringify(res, null, 1));
console.log('[stage4-mt] done', res.box.trades, 'box,', res.trend.trades, 'trend trades');
