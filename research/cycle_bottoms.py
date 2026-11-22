#!/usr/bin/env python3
"""Rebuild the figures in engine-v2/cycle-bottoms.json (CYCLE-BOTTOMS-1).

Prints, for each cycle: peak MVRV, bottom MVRV (daily close basis), realized cap at the bottom,
365-day volatility before the bottom; the size fit (bottom MVRV vs log10 realized cap) and its value today;
the exponential through the 2015/2018/2022 bottoms; and the ETF cohort (coins, average cost, lift on the
realized price) from bitbo.io's daily BTC flow totals (pass a saved copy of https://bitbo.io/treasuries/etf-flows).

Usage: python3 research/cycle_bottoms.py [bitbo_etf_flows.html]
Data: CoinMetrics community API (CapMrktCurUSD, CapMVRVCur, PriceUSD). Realized cap = market cap / MVRV.
Descriptive only: 4 completed cycles; nothing here is a tested rating.
"""
import datetime as dt, json, math, re, statistics as st, sys, urllib.request

def coinmetrics():
    u = ("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc"
         "&metrics=CapMrktCurUSD,CapMVRVCur,PriceUSD&frequency=1d&start_time=2011-01-01&page_size=10000")
    out = []
    while u:
        j = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "btc-brief-research"}), timeout=60))
        out += j["data"]; u = j.get("next_page_url")
    return {x["time"][:10]: x for x in out}

def num(x, k):
    try: return float(x[k])
    except (KeyError, TypeError, ValueError): return None

def logfit(xs, ys, x):
    l = [math.log(y) for y in ys]; mx, ml = st.mean(xs), st.mean(l)
    b = sum((a - mx) * (c - ml) for a, c in zip(xs, l)) / sum((a - mx) ** 2 for a in xs)
    return math.exp(ml + b * (x - mx))

def main():
    R = coinmetrics(); days = sorted(R)
    px = [(d, num(R[d], "PriceUSD")) for d in days]; pi = {d: i for i, (d, _) in enumerate(px)}
    # (bottom window, preceding peak window)
    cycles = [("2011-06-01", "2012-03-01", "2011-01-01", "2011-07-01"), ("2014-08-01", "2015-06-01", "2013-10-01", "2014-01-31"),
              ("2018-06-01", "2019-03-01", "2017-11-01", "2018-01-31"), ("2022-05-01", "2023-01-31", "2021-02-01", "2021-12-31"),
              ("2026-01-01", days[-1], "2024-01-01", "2025-12-31")]
    rows = []
    for a, b, pa, pb in cycles:
        w = [(d, num(R[d], "CapMVRVCur")) for d in days if a <= d <= b and num(R[d], "CapMVRVCur")]
        d, m = min(w, key=lambda t: t[1])
        peak = max(num(R[k], "CapMVRVCur") or 0 for k in days if pa <= k <= pb)
        i = pi[d]; rets = [math.log(px[j][1] / px[j - 1][1]) for j in range(max(1, i - 364), i + 1) if px[j][1] and px[j - 1][1]]
        rc = num(R[d], "CapMrktCurUSD") / m
        rows.append(dict(cycle=d[:4], date=d, bottom=m, peak=peak, realcap=rc, vol=st.stdev(rets) * math.sqrt(365)))
        print(f"{d[:4]}: peak {peak:.2f} | bottom {m:.2f} on {d} | realized cap ${rc/1e9:,.1f}B | 365d vol {rows[-1]['vol']:.0%}")
    done = [r for r in rows if r["cycle"] in ("2015", "2018", "2022")]
    last = R[days[-1]]; rc_now = num(last, "CapMrktCurUSD") / num(last, "CapMVRVCur")
    xs = [math.log10(r["realcap"]) for r in done]; ys = [r["bottom"] for r in done]
    mx, my = st.mean(xs), st.mean(ys); b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    size = my + b * (math.log10(rc_now) - mx)
    peak_pred = logfit(xs, [r["peak"] for r in done], math.log10(rc_now)); peak_now = rows[-1]["peak"]
    comp = (peak_now - 1) / (peak_pred - 1)
    print(f"\nsize fit: bottom = {my - b*mx:.3f} + {b:.3f} x log10(realized cap) -> {size:.2f} at ${rc_now/1e9:,.0f}B")
    print(f"peak: predicted {peak_pred:.2f}, actual {peak_now:.2f} -> compression {comp:.2f}; scaled bottom {1 - (1 - size) * comp:.2f}")
    print(f"exponential through 2015/2018/2022 bottoms -> {logfit([1, 2, 3], ys, 4):.2f}")
    if len(sys.argv) > 1:
        h = open(sys.argv[1], encoding="utf-8").read(); seg = h[h.find("const historyBtc"):h.find("const historyUsd")]
        flows = {}
        for ms, v in re.findall(r"getPreviousBusinessDay\((\d+)\),\s*truncate\((-?[\d.]+),", seg):
            d = (dt.datetime.fromtimestamp(int(ms) / 1000, dt.timezone.utc).date() - dt.timedelta(days=1)).isoformat()
            flows[d] = flows.get(d, 0) + float(v)
        H = K = 0.0
        for d in [k for k in days if k >= "2024-01-01"]:
            v = flows.get(d, 0.0); p = num(R[d], "PriceUSD")
            if v > 0: H += v; K += v * p
            elif v < 0 and H > 0: K *= max(H + v, 0) / H; H = max(H + v, 0)
        p = num(last, "PriceUSD"); S = num(last, "CapMrktCurUSD") / p
        rp, rp_ex = rc_now / S, (rc_now - K) / (S - H)
        print(f"\nETF cohort {days[-1]}: {H:,.0f} BTC ({H/S:.1%} of supply), average cost ${K/H:,.0f}; realized ${rp:,.0f} vs ex-ETF ${rp_ex:,.0f} (lift ${rp-rp_ex:,.0f})")

if __name__ == "__main__":
    main()
