#!/usr/bin/env python3
"""Fetch all quant signals from the DocVault API and print a summary.

Usage:
    uv run fetch_signals.py [--base-url URL]

Defaults to http://localhost:3005. Override with --base-url for
other environments (e.g. a remote NAS).
"""

import argparse
import json
import sys
import urllib.request
import urllib.error


def fetch_json(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  WARN: {url} failed: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Fetch DocVault quant signals")
    parser.add_argument("--base-url", default="http://localhost:3005", help="API base URL")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    signals = {}

    # BTC log regression + risk
    d = fetch_json(f"{base}/api/quant/btc/log-regression")
    if d:
        signals["btcPrice"] = d["latest"]["price"]
        signals["btcRisk"] = d["risk"]["latest"]["metric"]
        signals["btcSigma"] = d["latest"]["residualSigma"]
        signals["btcBmsbState"] = d.get("bmsb", {}).get("latest", {}).get("state")

    # BTC drawdown
    d = fetch_json(f"{base}/api/quant/btc/drawdown")
    if d:
        signals["btcDrawdown"] = d["latest"]["drawdown"]
        signals["btcDaysSinceAth"] = d["latest"]["daysSinceAth"]
        signals["btcAth"] = d["latest"]["ath"]

    # Fear & Greed
    d = fetch_json(f"{base}/api/quant/btc/fear-greed")
    if d:
        signals["fearGreed"] = d["latest"]["value"]
        signals["fearGreedClassification"] = d["latest"]["classification"]
        signals["fearGreed30d"] = round(d["ma30"])
        signals["fearGreed90d"] = round(d["ma90"])

    # Hash Rate
    d = fetch_json(f"{base}/api/quant/btc/hash-rate")
    if d:
        signals["hashRibbonRegime"] = d["latest"]["regime"]
        signals["hashRateEhs"] = round(d["latest"]["hashRate"] / 1_000_000)

    # Flippening
    d = fetch_json(f"{base}/api/quant/btc/flippening")
    if d:
        signals["ethBtcRatio"] = round(d["latest"]["ratio"], 5)
        signals["flippeningProgress"] = round(d["latest"]["progressToFlippening"] * 100, 1)

    # Business Cycle
    d = fetch_json(f"{base}/api/quant/macro/business-cycle")
    if d:
        for s in d.get("series", []):
            if s["id"] == "SAHMREALTIME" and s["latest"]:
                signals["sahmRule"] = s["latest"]["value"]
            if s["id"] == "RECPROUSM156N" and s["latest"]:
                signals["recessionProb"] = s["latest"]["value"]

    # Real Rates
    d = fetch_json(f"{base}/api/quant/macro/real-rates")
    if d:
        signals["tenYearReal"] = d["latest"]["tenYear"]["real"]
        signals["tenYearRealPct"] = round(d["stats"]["tenYearPercentile10y"] * 100)
        signals["fiveYearReal"] = d["latest"]["fiveYear"]["real"]

    # Financial Conditions
    d = fetch_json(f"{base}/api/quant/macro/financial-conditions")
    if d:
        for s in d.get("series", []):
            if s["id"] == "NFCI" and s["latest"]:
                signals["nfci"] = s["latest"]["value"]

    # Fed Policy
    d = fetch_json(f"{base}/api/quant/macro/fed-policy")
    if d:
        signals["fedRate"] = f"{d['latest']['targetLower']:.2f}-{d['latest']['targetUpper']:.2f}%"
        signals["fedStance"] = d["latest"]["stance"]

    # Yield Curve
    d = fetch_json(f"{base}/api/quant/macro/yield-curve")
    if d:
        signals["yieldCurveRegime"] = d["latest"]["regime"]
        if d["latest"].get("t10y2y") is not None:
            signals["t10y2y"] = d["latest"]["t10y2y"]

    # VIX
    d = fetch_json(f"{base}/api/quant/tradfi/vix-term")
    if d:
        for s in d.get("series", []):
            if s["id"] == "^VIX" and s["latest"]:
                signals["vix"] = s["latest"]["value"]

    # SP500 Risk
    d = fetch_json(f"{base}/api/quant/tradfi/sp500-risk-metric")
    if d:
        signals["sp500Risk"] = d["latest"]["metric"]

    # Commodities — gold
    d = fetch_json(f"{base}/api/quant/tradfi/commodities")
    if d:
        for s in d.get("series", []):
            if s["id"] == "GC=F" and s["latest"]:
                signals["goldPrice"] = round(s["latest"]["value"])
                if s.get("yoyChange") is not None:
                    signals["goldYoy"] = round(s["yoyChange"], 1)

    # Inflation — headline CPI YoY
    d = fetch_json(f"{base}/api/quant/macro/inflation")
    if d:
        for s in d.get("series", []):
            if s["id"] == "CPIAUCSL" and s.get("yoyChange") is not None:
                signals["cpiYoy"] = round(s["yoyChange"], 2)
            if s["id"] == "WALCL" and s["latest"]:
                signals["walclTrillions"] = round(s["latest"]["value"] / 1_000_000, 2)

    # Output as JSON
    print(json.dumps(signals, indent=2))


if __name__ == "__main__":
    main()
