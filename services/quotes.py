"""軽量クォート取得（銘柄キャッシュ付き）"""
from __future__ import annotations

import time

from services.cache import CACHE_TTL_QUOTE, cache_get, cache_set

# 急騰急落スキャン対象（全107銘柄ではなく流動性の高い銘柄のみ）
RANKING_SCAN_SYMBOLS = [
    "7203", "8035", "285A", "9984", "6758", "6861", "6501", "8306", "8316",
    "8411", "8058", "8031", "8001", "4063", "5401", "6525", "6526", "6857",
    "6146", "6920", "7011", "9432", "9433", "9434", "6098", "4502", "4503",
    "7267", "6902", "7741", "6981", "6367",
]


def fetch_quote_snapshot(symbol: str, deps: dict) -> dict | None:
    """
    deps: safe_val, get_ticker, get_ticker_info, get_history_safe, resolve_japanese_name
    """
    sym = str(symbol or "").strip().upper()
    cache_key = f"quote_{sym}"
    hit = cache_get(cache_key, CACHE_TTL_QUOTE)
    if hit is not None:
        return dict(hit)

    safe_val = deps["safe_val"]
    get_ticker = deps["get_ticker"]
    get_ticker_info = deps["get_ticker_info"]
    get_history_safe = deps["get_history_safe"]
    resolve_japanese_name = deps["resolve_japanese_name"]

    try:
        ticker = get_ticker(sym)
        info = get_ticker_info(ticker)
        hist = get_history_safe(ticker, period="5d", interval="1d")
        current = safe_val(info.get("currentPrice") or info.get("regularMarketPrice"))
        prev = safe_val(info.get("previousClose") or info.get("regularMarketPreviousClose"))
        if current is None and not hist.empty:
            current = safe_val(hist["Close"].iloc[-1])
        if prev is None and len(hist) >= 2:
            prev = safe_val(hist["Close"].iloc[-2])
        if current is None or prev is None or prev == 0:
            return None
        chg_pct = round((current - prev) / prev * 100, 2)
        vol = safe_val(info.get("regularMarketVolume") or info.get("volume"))
        row = {
            "symbol": sym,
            "name": resolve_japanese_name(sym, info),
            "change_pct": chg_pct,
            "change_pct_str": f"{chg_pct:+.2f}",
            "volume": f"{int(vol):,}" if vol else "—",
            "reason": "速報",
            "current": current,
        }
        cache_set(cache_key, row)
        return row
    except Exception:
        return None


def fetch_live_ranking(top_n: int, deps: dict) -> tuple[list, list]:
    rows = []
    for sym in RANKING_SCAN_SYMBOLS:
        row = fetch_quote_snapshot(sym, deps)
        if row:
            rows.append(row)
        time.sleep(0.02)
    rows.sort(key=lambda x: x["change_pct"], reverse=True)
    gainers = rows[:top_n]
    losers = sorted(rows, key=lambda x: x["change_pct"])[:top_n]
    for g in gainers:
        g["change_pct"] = g["change_pct_str"]
    for l in losers:
        l["change_pct"] = l["change_pct_str"]
    return gainers, losers


def fetch_cached_quotes(symbols: list[str], deps: dict) -> dict[str, dict]:
    """複数銘柄の現在値（キャッシュ優先・重複排除）"""
    out: dict[str, dict] = {}
    for raw in symbols:
        sym = str(raw).strip().upper()
        if not sym or sym in out:
            continue
        row = fetch_quote_snapshot(sym, deps)
        if row:
            out[sym] = {
                "symbol": sym,
                "name": row.get("name", sym),
                "current": row.get("current"),
            }
        else:
            out[sym] = {"symbol": sym, "name": sym, "current": None}
    return out
