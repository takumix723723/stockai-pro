#!/usr/bin/env python3
"""StockAI Pro — API呼び出しパターン分析（静的）"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATTERNS = {
    "fetch /api/": re.compile(r"fetch\(['\"`](/api/[^'\"`]+)"),
    "ApiCache": re.compile(r"ApiCache\.fetchJsonCached\(['\"`]([^'\"`]+)"),
    "route": re.compile(r'@app\.route\("([^"]+)"'),
    "setInterval": re.compile(r"setInterval"),
    "createPageAutoRefresh": re.compile(r"createPageAutoRefresh"),
}


def scan_file(path: Path) -> dict[str, list[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    out: dict[str, list[str]] = {}
    for name, rx in PATTERNS.items():
        hits = rx.findall(text)
        if hits:
            out[name] = hits
    return out


def main() -> None:
    targets = [
        ROOT / "app.py",
        ROOT / "templates" / "index.html",
        ROOT / "templates" / "stock.html",
        ROOT / "static" / "trade-scenarios.js",
        ROOT / "static" / "script.js",
        ROOT / "services" / "quotes.py",
        ROOT / "services" / "trade_scenarios.py",
    ]
    print("=== StockAI Pro API Usage Analysis ===\n")
    for p in targets:
        if not p.exists():
            continue
        data = scan_file(p)
        print(f"--- {p.relative_to(ROOT)} ---")
        for k, v in data.items():
            uniq = sorted(set(v))
            print(f"  {k}: {len(v)} refs ({len(uniq)} unique)")
            for u in uniq[:12]:
                print(f"    - {u}")
            if len(uniq) > 12:
                print(f"    ... +{len(uniq) - 12} more")
        print()

    print("=== Optimizations applied ===")
    print("- Ranking scan: 107 -> 32 symbols (services/quotes.py)")
    print("- Scenario scan: 28 -> 14 symbols, ranking cache-only (services/trade_scenarios.py)")
    print("- Server TTL: stock 12s, quote 15s, market/theme 5m, ranking 5m, scenario 3m, search 10m")
    print("- Client: ApiCache dedupe + stale fallback (static/api-cache.js)")
    print("- Home: market_summary non-blocking scenarios, IPO.js lazy load")
    print("- Stock: slow refresh throttles holdings/sector/news to every 3rd tick")


if __name__ == "__main__":
    main()
