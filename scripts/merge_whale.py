"""
Merge /tmp/whale.json into public/all_data.json.
Called by data-refresh.yml after fetching whale data from the Cloudflare Worker.

Renamed from dune_cache.json -> all_data.json on 2026-04-25 as part of the
lean refactor: a single all_data.json now holds every non-Claude data field
(written by data-worker.js) plus the brief (written by brief-worker.js).
"""
import json
import sys
import os

CACHE_PATH = "public/all_data.json"
WHALE_PATH = "/tmp/whale.json"

if not os.path.exists(WHALE_PATH):
    print("[warn] No whale file found — skipping merge")
    sys.exit(0)

if not os.path.exists(CACHE_PATH):
    print("[error] all_data.json not found — cannot merge")
    sys.exit(1)

with open(CACHE_PATH) as f:
    cache = json.load(f)

with open(WHALE_PATH) as f:
    whale = json.load(f)

if whale.get("error"):
    print("[warn] Whale data contains error: " + str(whale["error"]))
    sys.exit(0)

cache["binanceLargeTrades"] = whale

with open(CACHE_PATH, "w") as f:
    json.dump(cache, f, indent=2)

print(
    "[ok] all_data.json updated with whale data — "
    "net=" + str(whale.get("net_taker_btc")) +
    " BTC  ratio=" + str(whale.get("buy_ratio")) +
    "  pressure=" + str(whale.get("pressure"))
)
