"""AI仮想デイトレ候補生成（精度重視・シミュレーション専用）"""
from __future__ import annotations

import time
import traceback
from datetime import datetime

from services.cache import CACHE_TTL_RANKING, cache_get
from services.precision_scoring import (
    DAY_TRADE_PICK_LIMIT,
    attach_precision_fields,
    build_skip_payload,
    evaluate_precision,
    gather_market_context,
)

DAY_TRADE_SCAN_LIMIT = 12
DISCLAIMER = (
    "※これは実際の売買ではなく、過去/現在データに基づく仮想シミュレーションです。"
    "投資判断は自己責任で行ってください。"
)


def _default_daytrade_shares(buy_price: float) -> int:
    if not buy_price or buy_price <= 0:
        return 100
    lots = max(1, round(200_000 / buy_price / 100))
    return lots * 100


def _build_daytrade_levels(current: float, change_pct: float | None, rsi: float | None) -> dict:
    buy = round(current)
    if change_pct is not None and change_pct >= 2:
        target_pct, stop_pct = 2.8, -1.4
    elif rsi is not None and rsi < 40:
        target_pct, stop_pct = 2.5, -1.6
    else:
        target_pct, stop_pct = 2.2, -1.5

    target = round(buy * (1 + target_pct / 100))
    stop = round(buy * (1 + stop_pct / 100))
    shares = _default_daytrade_shares(buy)
    expected_profit = (target - buy) * shares
    expected_loss = (stop - buy) * shares
    rr = (
        round(expected_profit / abs(expected_loss), 2)
        if expected_loss < 0 and expected_profit > 0
        else None
    )
    return {
        "buy_price": buy,
        "target_price": target,
        "stop_price": stop,
        "shares": shares,
        "capital": buy * shares,
        "expected_profit": expected_profit,
        "expected_loss": expected_loss,
        "target_pct": round(target_pct, 2),
        "stop_pct": round(stop_pct, 2),
        "risk_reward": rr,
    }


def _symbol_theme_names(symbol: str, theme_catalog: dict) -> list[str]:
    return [t["name"] for t in theme_catalog.values() if symbol in t.get("symbols", [])]


def collect_daytrade_symbols(theme_catalog: dict) -> list[str]:
    symbols: set[str] = {
        "8035", "6857", "6525", "7203", "9984", "6758", "4063", "285A", "6146",
    }
    for theme in theme_catalog.values():
        symbols.update(theme.get("symbols", [])[:2])
    ranking = cache_get("ranking", CACHE_TTL_RANKING)
    if ranking:
        for row in ranking.get("gainers", [])[:6]:
            sym = str(row.get("symbol", "")).strip().upper()
            if sym:
                symbols.add(sym)
    return [s for s in symbols if s][:DAY_TRADE_SCAN_LIMIT]


def _entry_time_jst() -> str:
    now = datetime.now()
    if now.hour < 9 or (now.hour == 9 and now.minute < 5):
        return "09:05"
    if now.hour >= 15 and now.minute >= 30:
        return "14:55"
    return now.strftime("%H:%M")


def analyze_daytrade_candidate(symbol: str, deps: dict, hints: dict | None = None) -> dict | None:
    try:
        get_ticker = deps["get_ticker"]
        get_history_safe = deps["get_history_safe"]
        calc_ai_score = deps["calc_ai_score"]
        resolve_japanese_name = deps["resolve_japanese_name"]
        theme_catalog = deps["theme_catalog"]

        ctx = gather_market_context(symbol, deps)
        if not ctx:
            return None

        ticker = get_ticker(symbol)
        hist = get_history_safe(ticker, period="3mo", interval="1d")
        info_row = deps["enrich_fundamentals"](
            deps["get_ticker_info"](ticker), ticker, symbol
        )
        ai_score = calc_ai_score(info_row, hist, symbol)
        themes = _symbol_theme_names(symbol, theme_catalog)

        levels = _build_daytrade_levels(ctx.current, ctx.change_pct, ctx.rsi)
        ev = evaluate_precision(
            ctx, levels, themes, ai_score, hints, mode="daytrade", hist=hist
        )
        if not ev or not ev.passed:
            return None

        trade_date = datetime.now().strftime("%Y-%m-%d")
        row = {
            "id": f"{symbol}-{trade_date.replace('-', '')}",
            "symbol": symbol,
            "name": resolve_japanese_name(symbol, info_row),
            "current": ctx.current,
            "change_pct": ctx.change_pct,
            "ai_score": ai_score.get("total"),
            "daytrade_score": ev.precision_score,
            "buy_price": levels["buy_price"],
            "shares": levels["shares"],
            "target_price": levels["target_price"],
            "stop_price": levels["stop_price"],
            "expected_profit": levels["expected_profit"],
            "expected_loss": levels["expected_loss"],
            "entry_time": _entry_time_jst(),
            "exit_time": None,
            "status": "entered",
            "themes": themes[:2],
            "trade_date": trade_date,
            "risk_reward": levels["risk_reward"],
        }
        return attach_precision_fields(row, ev)
    except Exception:
        traceback.print_exc()
        return None


def build_day_trade_payload(deps: dict, learning_hints: dict | None = None) -> dict:
    symbols = collect_daytrade_symbols(deps["theme_catalog"])
    rows: list[dict] = []
    for sym in symbols:
        row = analyze_daytrade_candidate(sym, deps, learning_hints)
        if row:
            rows.append(row)
        time.sleep(0.02)

    _rank = {"A": 4, "B": 3, "C": 2, "D": 1}
    rows.sort(
        key=lambda x: (
            _rank.get(x.get("confidence"), 0),
            x.get("expected_value", 0),
            x.get("daytrade_score", 0),
        ),
        reverse=True,
    )
    picks = rows[:DAY_TRADE_PICK_LIMIT]
    trade_date = datetime.now().strftime("%Y-%m-%d")

    payload = {
        "status": "ok",
        "date": trade_date,
        "date_label": datetime.now().strftime("%Y/%m/%d"),
        "trades": picks,
        "scanned": len(symbols),
        "generated_at": datetime.now().isoformat(),
        "disclaimer": DISCLAIMER,
        "precision_mode": True,
    }

    if not picks:
        skip = build_skip_payload("daytrade", len(symbols), [
            "出来高・トレンド・リスクリワードが基準未満",
            "4つ以上の条件が一致する銘柄がありませんでした",
        ])
        payload.update(skip)
        payload["trades"] = []

    return payload
