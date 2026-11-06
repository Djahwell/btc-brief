// Indicator-only feasibility check (no outcomes used): effective rotations per indicator per horizon.
const S = require('../stage4/stats.js');
const { loadLong } = require('./load-long.js');
const IND = ['dist20','dist50','slope20','E1','dist200','slope200','T3','fw1Base','ret1','ret3','ret7','ret30','dd30','dd90','daysSinceHi30','E2','posVAL','posPOC','posVAH','rvPct','rvRatio','atrPct','premPct','cbZ','fng','mvrvPct','lth30','stableX','ddATH','ret90p','ret180p','daysSinceHalving','dist200w'];
for (const [h, nt] of [[30,1],[90,2],[180,1]]) {
  const rows = loadLong(process.argv[2], process.argv[3], h); const N = rows.length;
  const out = IND.map(k => { const x = rows.map(r => Number.isFinite(r[k]) ? r[k] : null); const b = Math.ceil(S.politisWhite(x)); const ms = Math.max(h, b); const eff = Math.max(0, (N - 2 * ms) / ms); return { k, b, eff: +eff.toFixed(1), minP: +(1 / (1 + eff)).toFixed(3) }; });
  const m = IND.length * nt, thr = 0.10 / m;
  const best = Math.min(...out.map(o => o.minP));
  console.log(`h=${h} N=${N} tests=${m} firstBH=${thr.toFixed(4)} bestMinP=${best} testable=${best <= thr}`);
  console.log('  ' + out.map(o => `${o.k}:b${o.b}/eff${o.eff}`).join(' '));
}
