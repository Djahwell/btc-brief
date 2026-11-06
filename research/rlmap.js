'use strict';
// RLC-1 descriptive map (rlc-declaration.json "descriptive"): every indicator x horizon on 2019-2026.
// No significance claim; sign, size, halves, quintile means with independent-window counts (<4 suppressed).
const fs = require('fs'); const S = require('../stage4/stats.js'); const { loadLong } = require('./load-long.js');
const IND = ['dist20','dist50','slope20','E1','dist200','slope200','T3','fw1Base','ret1','ret3','ret7','ret30','dd30','dd90','daysSinceHi30','E2','posVAL','posPOC','posVAH','rvPct','rvRatio','atrPct','premPct','cbZ','fng','mvrvPct','lth30','stableX','ddATH','ret90p','ret180p','daysSinceHalving','dist200w'];
function ranks(v){const idx=v.map((x,i)=>[x,i]).filter(p=>p[0]!=null).sort((a,b)=>a[0]-b[0]);const r=new Array(v.length).fill(null);for(let i=0;i<idx.length;){let j=i;while(j+1<idx.length&&idx[j+1][0]===idx[i][0])j++;for(let k=i;k<=j;k++)r[idx[k][1]]=(i+j)/2+1;i=j+1;}return r;}
function pearson(a,b){let n=0,sa=0,sb=0;for(let i=0;i<a.length;i++)if(a[i]!=null&&b[i]!=null){n++;sa+=a[i];sb+=b[i];}if(n<30)return NaN;const ma=sa/n,mb=sb/n;let x=0,y=0,z=0;for(let i=0;i<a.length;i++)if(a[i]!=null&&b[i]!=null){x+=(a[i]-ma)*(b[i]-mb);y+=(a[i]-ma)**2;z+=(b[i]-mb)**2;}return y&&z?x/Math.sqrt(y*z):NaN;}
const sp=(x,y,m)=>pearson(ranks(m?x.map((v,i)=>m[i]?v:null):x),ranks(m?y.map((v,i)=>m[i]?v:null):y));
const [hist, ff, out] = process.argv.slice(2); const rep = {};
for (const [h, t] of [[30,'ret30'],[90,'ret90'],[90,'dd90'],[180,'ret180']]) {
  const R = loadLong(hist, ff, h, '2026-10-31'); const y = R.map(r => r.y[t] ?? null); const N = R.length; const half = R.map(r => r.d < '2023-01-01');
  rep[t] = IND.map(k => {
    const x = R.map(r => Number.isFinite(r[k]) ? r[k] : null); const s = Math.max(h, Math.ceil(S.politisWhite(x)));
    const obs = sp(x, y); let ge = 0, n = 0; for (let j = s; j <= N - s; j += s) { const v = sp(S.rotate(x, j), y); if (!Number.isFinite(v)) continue; n++; if (Math.abs(v) >= Math.abs(obs)) ge++; }
    const xs = x.filter(v => v != null).sort((a, b) => a - b); const e = [0.2,0.4,0.6,0.8].map(q => S.quantile(xs, q)); const qo = v => v == null ? null : e.filter(z => v > z).length;
    const qs = [0,1,2,3,4].map(q => { const v = y.filter((z, i) => z != null && qo(x[i]) === q); const w = v.length / h; return { q: q + 1, lo: q ? e[q-1] : null, hi: q < 4 ? e[q] : null, windows: +w.toFixed(1), mean: w >= 4 && v.length ? S.mean(v) : null, median: w >= 4 && v.length ? S.quantile(v.slice().sort((a,b)=>a-b), 0.5) : null }; });
    return { ind: k, r: obs, shiftP: (1 + ge) / (1 + n), rotations: n, halves: [sp(x, y, half), sp(x, y, half.map(v => !v))], quintiles: qs };
  });
  rep[t].alwaysLong = S.mean(y.filter(v => v != null)); rep[t].N = N;
}
fs.writeFileSync(out, JSON.stringify(rep, null, 1)); console.log('ok');
