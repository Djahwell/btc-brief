#!/usr/bin/env python3
"""Rebuild engine-v2/cycle-bottoms.json (CYCLE-BOTTOMS-1). Runs monthly in .github/workflows/v2-cycle-bottoms.yml.

What it computes (daily close basis, CoinMetrics community CapMrktCurUSD / CapMVRVCur / PriceUSD):
- Each cycle's peak and bottom MVRV. 2011-2022 cycles are fixed windows. Later cycles are found by rule:
  peak = highest MVRV after the last confirmed bottom; candidate bottom = lowest MVRV after that peak;
  a candidate is CONFIRMED (joins the fit) once 365 days pass with no lower MVRV.
- Band low/mid/high = the three estimates below, sorted:
  size fit (bottom MVRV vs log10 realized cap over confirmed cycles from 2015, at today's realized cap);
  scaled (size fit scaled by the current cycle's compression: actual peak excess over 1 / excess the same
  size fit predicts, applied to the bottom's distance below 1; read only once MVRV is 40% below the cycle peak);
  exponential through the confirmed bottoms from 2015.
- ETF cohort (optional): new ETF coins since Jan 2024 from bitbo.io daily BTC totals, average-cost method.
  If bitbo cannot be read, the previous ETF block is kept with its own asOf.

Usage:
  python3 research/cycle_bottoms.py                       # print only
  python3 research/cycle_bottoms.py --write [bitbo.html]   # also rewrite engine-v2/cycle-bottoms.json
Descriptive only; nothing here is a tested rating.
"""
import datetime as dt, json, math, os, re, statistics as st, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "engine-v2", "cycle-bottoms.json")
UA = {"User-Agent": "Mozilla/5.0 (btc-brief research)"}
FIXED = [  # (bottom window, preceding peak window) for cycles before rule-based detection starts
    ("2011-06-01", "2012-03-01", "2011-01-01", "2011-07-01"),
    ("2014-08-01", "2015-06-01", "2013-10-01", "2014-01-31"),
    ("2018-06-01", "2019-03-01", "2017-11-01", "2018-01-31"),
    ("2022-05-01", "2023-01-31", "2021-02-01", "2021-12-31"),
]
CONFIRM_DAYS = 365

def get(url, timeout=60):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()

def coinmetrics():
    u = ("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc"
         "&metrics=CapMrktCurUSD,CapMVRVCur,PriceUSD&frequency=1d&start_time=2011-01-01&page_size=10000")
    out = []
    while u:
        j = json.loads(get(u)); out += j["data"]; u = j.get("next_page_url")
    return {x["time"][:10]: x for x in out}

def num(x, k):
    try: return float(x[k])
    except (KeyError, TypeError, ValueError): return None

def logfit(xs, ys, x):
    l = [math.log(y) for y in ys]; mx, ml = st.mean(xs), st.mean(l)
    b = sum((a - mx) * (c - ml) for a, c in zip(xs, l)) / sum((a - mx) ** 2 for a in xs)
    return math.exp(ml + b * (x - mx))

def linfit(xs, ys):
    mx, my = st.mean(xs), st.mean(ys)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return my - b * mx, b

def cycles(R):
    days = sorted(R); mv = {d: num(R[d], "CapMVRVCur") for d in days}; px = [(d, num(R[d], "PriceUSD")) for d in days]
    pi = {d: i for i, (d, _) in enumerate(px)}
    def vol(d):
        i = pi[d]; r = [math.log(px[j][1] / px[j - 1][1]) for j in range(max(1, i - 364), i + 1) if px[j][1] and px[j - 1][1]]
        return st.stdev(r) * math.sqrt(365)
    def row(d, peak, confirmed):
        return dict(cycle=d[:4], date=d, bottom=mv[d], peak=peak, realcap=num(R[d], "CapMrktCurUSD") / mv[d], vol=vol(d), confirmed=confirmed)
    rows = []
    for a, b, pa, pb in FIXED:
        d = min((k for k in days if a <= k <= b and mv[k]), key=lambda k: mv[k])
        rows.append(row(d, max(mv[k] or 0 for k in days if pa <= k <= pb), True))
    last = rows[-1]["date"]
    while True:
        after = [k for k in days if k > last and mv[k]]
        if not after: break
        pk = max(after, key=lambda k: mv[k])
        tail = [k for k in after if k > pk]
        if not tail: break
        bd = min(tail, key=lambda k: mv[k])
        conf = (dt.date.fromisoformat(days[-1]) - dt.date.fromisoformat(bd)).days >= CONFIRM_DAYS
        rows.append(row(bd, mv[pk], conf))
        if not conf: break
        last = bd
    return rows

def etf_block(R, html):
    seg = html[html.find("const historyBtc"):html.find("const historyUsd")]
    flows = {}
    for ms, v in re.findall(r"getPreviousBusinessDay\((\d+)\),\s*truncate\((-?[\d.]+),", seg):
        d = (dt.datetime.fromtimestamp(int(ms) / 1000, dt.timezone.utc).date() - dt.timedelta(days=1)).isoformat()
        flows[d] = flows.get(d, 0) + float(v)
    if len(flows) < 300: raise ValueError(f"bitbo page parsed only {len(flows)} days")
    days = sorted(R); H = K = 0.0
    for d in [k for k in days if k >= "2024-01-01"]:
        v = flows.get(d, 0.0); p = num(R[d], "PriceUSD")
        if v > 0: H += v; K += v * p
        elif v < 0 and H > 0: K *= max(H + v, 0) / H; H = max(H + v, 0)
    last = R[days[-1]]; p = num(last, "PriceUSD"); S = num(last, "CapMrktCurUSD") / p
    RC = num(last, "CapMrktCurUSD") / num(last, "CapMVRVCur"); lift = RC / S - (RC - K) / (S - H)
    return {"asOf": days[-1], "coins_btc": round(H), "share_of_supply": round(H / S, 3), "avg_cost_usd": round(K / H),
            "lift_on_realized_usd": round(lift),
            "note": f"New ETF coins since Jan 2024 hold about {H/S:.1%} of supply at about ${K/H/1000:.1f}k average cost; "
                    f"they lift the realized price by about ${lift:,.0f} ({lift/(RC/S):.1%})."}

def compute(R, html=None, prev=None):
    rows = cycles(R); days = sorted(R); last = R[days[-1]]
    rc_now = num(last, "CapMrktCurUSD") / num(last, "CapMVRVCur")
    fit = [r for r in rows if r["confirmed"] and r["date"] >= "2015-01-01"]
    cur = [r for r in rows if not r["confirmed"]]
    xs = [math.log10(r["realcap"]) for r in fit]; ys = [r["bottom"] for r in fit]
    a, b = linfit(xs, ys); size = a + b * math.log10(rc_now)
    peak_pred = logfit(xs, [r["peak"] for r in fit], math.log10(rc_now))
    # Compression is only read once the current cycle is clearly past its top (MVRV down 40% from the peak);
    # before that the "peak" may be a local high, so the scaled estimate falls back to the size fit.
    peak_now = cur[0]["peak"] if cur and cur[0]["bottom"] <= 0.6 * cur[0]["peak"] else None
    comp = (peak_now - 1) / (peak_pred - 1) if peak_now else 1.0
    scaled = 1 - (1 - size) * comp
    expo = logfit(list(range(1, len(ys) + 1)), ys, len(ys) + 1)
    lo, mid, hi = sorted([round(size, 2), round(scaled, 2), round(expo, 2)])
    yrs = f"{fit[0]['date'][:4]}-{fit[-1]['date'][:4]}"
    ref = {
        "id": "CYCLE-BOTTOMS-1",
        "built": dt.date.today().isoformat(),
        "dataAsOf": days[-1],
        "label": f"Descriptive reference, fitted on {len(fit)} completed cycles ({yrs}); not a tested rating and not a forecast.",
        "source": "CoinMetrics community CapMVRVCur and CapMrktCurUSD (daily close basis); ETF flows from bitbo.io daily BTC totals. Rebuilt monthly by research/cycle_bottoms.py (.github/workflows/v2-cycle-bottoms.yml).",
        "bottoms": [{"cycle": r["cycle"], "date": r["date"], "mvrv": round(r["bottom"], 2)} for r in rows if r["confirmed"]],
        "currentCycle": ({"peak_mvrv": round(cur[0]["peak"], 2), "compression_used": peak_now is not None, "lowest_mvrv_so_far": round(cur[0]["bottom"], 3), "lowest_date": cur[0]["date"],
                          "confirm_rule": f"joins the fit after {CONFIRM_DAYS} days with no lower MVRV"} if cur else None),
        "band": {
            "low": lo, "high": hi, "mid": mid,
            "size_fit": round(size, 2),
            "size_fit_why": f"bottom MVRV vs log10(realized cap), {yrs} cycles: {a:.3f} + {b:.3f} x log10(realized cap USD), at ${rc_now/1e12:.2f}T",
            "scaled": round(scaled, 2),
            "scaled_why": (f"size fit scaled by this cycle's compression: peak MVRV {peak_now:.2f} vs {peak_pred:.2f} predicted by the same size fit ({comp:.2f} of the expected excess)" if peak_now else "compression not read yet (current cycle not clearly past its top): equals the size fit"),
            "exponential": round(expo, 2),
            "exponential_why": "exponential through the confirmed cycle bottoms (" + ", ".join(f"{y:.2f}" for y in ys) + ")",
        },
        "etf": (prev or {}).get("etf"),
    }
    if html:
        try: ref["etf"] = etf_block(R, html)
        except Exception as e: print(f"ETF block kept from previous build: {e}", file=sys.stderr)
    return ref, rows

def main():
    write = "--write" in sys.argv; args = [a for a in sys.argv[1:] if a != "--write"]
    R = coinmetrics()
    html = None
    if args: html = open(args[0], encoding="utf-8").read()
    else:
        try: html = get("https://bitbo.io/treasuries/etf-flows", 30).decode("utf-8", "replace")
        except Exception as e: print(f"bitbo fetch failed: {e}", file=sys.stderr)
    prev = json.load(open(OUT)) if os.path.exists(OUT) else None
    ref, rows = compute(R, html, prev)
    for r in rows:
        print(f"{r['cycle']}: peak {r['peak']:.2f} | bottom {r['bottom']:.2f} on {r['date']} | realized cap ${r['realcap']/1e9:,.1f}B | "
              f"365d vol {r['vol']:.0%} | {'confirmed' if r['confirmed'] else 'current cycle, not confirmed'}")
    print(json.dumps(ref["band"], indent=2)); print(json.dumps(ref["etf"], indent=2))
    if write:
        b = ref["band"]
        assert 0 < b["low"] <= b["mid"] <= b["high"] < 1.5, f"band out of range: {b}"
        with open(OUT, "w", encoding="utf-8") as f: f.write(json.dumps(ref, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {OUT}")

if __name__ == "__main__":
    main()
