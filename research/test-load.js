// sealing check: no design row may carry an outcome that uses a bar after 2024-06-30
const { loadDesign } = require('./load.js');
const rows = loadDesign(process.argv[2], process.argv[3]);
const last = rows[rows.length - 1];
if (rows.some(r => r.d > '2024-06-24')) { console.error('SEAL BROKEN'); process.exit(1); }
console.log('design rows', rows.length, rows[0].d, '→', last.d, 'with outcome', rows.filter(r => r.y).length);
