"""AI売買シナリオ生成（精度重視・ルールベース）"""
from __future__ import annotations

import time
import traceback
from datetime import datetime

from services.cache import CACHE_TTL_RANKING, cache_get
from services.precision_scoring import (
    SCENARIO_RESULT_LIMIT,
    attach_precision_fields,
    build_skip_payload,
    evaluate_precision,
    gather_market_context,
)

SCENARIO_SCAN_LIMIT = 14
ANCHOR_SYMBOLS = ("7203", "8035", "285A")


def _symbol_theme_names(symbol: str, theme_catalog: dict) -> list[str]:
    return [t["name"] for t in theme_catalog.values() if symbol in t.get("symbols", [])]


def _default_scenario_shares(buy_price: float) -> int:
    if not buy_price or buy_price <= 0:
        return 100
    lots = max(1, round(300_000 / buy_price / 100))
    return lots * 100


def _build_scenario_levels(
    current: float,
    change_pct: float | None,
    rsi: float | None,
    verdict: str,
) -> dict:
    buy = round(current)
    if verdict == "反発狙い" or (rsi is not None and rsi < 35):
        target_pct, stop_pct = 5.0, -2.5
    elif change_pct is not None and change_pct < -3:
        target_pct, stop_pct = 4.5, -3.0
    elif change_pct is not None and change_pct > 3:
        target_pct, stop_pct = 3.5, -2.0
    else:
        target_pct, stop_pct = 3.0, -2.5

    target = round(buy * (1 + target_pct / 100))
    stop = round(buy * (1 + stop_pct / 100))
    shares = _default_scenario_shares(buy)
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
        "risk_reward": rr,
    }


def _verdict_from_ctx(ctx, rsi) -> str:
    if ctx.change_pct is not None and ctx.change_pct <= -3:
        return "反発狙い"
    if rsi is not None and rsi < 35:
        return "反発狙い"
    if ctx.ma5_up and ctx.ma15_up:
        return "短期狙い"
    return "中期狙い"


def collect_scenario_symbols(theme_catalog: dict) -> list[str]:
    symbols: set[str] = {
        "7203", "8035", "285A", "9984", "6758", "8058", "6525", "5401", "4063",
        "3854", "7246", "6141", "8053", "6526",
    }
    for theme in theme_catalog.values():
        symbols.update(theme.get("symbols", [])[:3])
    ranking = cache_get("ranking", CACHE_TTL_RANKING)
    if ranking:
        for row in ranking.get("gainers", []) + ranking.get("losers", []):
            sym = str(row.get("symbol", "")).strip().upper()
            if sym:
                symbols.add(sym)
    return [s for s in symbols if s][:SCENARIO_SCAN_LIMIT]


def analyze_trade_scenario(symbol: str, deps: dict, learning_hints: dict | None = None) -> dict | None:
    try:
        get_ticker = deps["get_ticker"]
        get_history_safe = deps["get_history_safe"]
        calc_ai_score = deps["calc_ai_score"]
        calc_rsi = deps["calc_rsi"]
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
        rsi = ctx.rsi

        verdict = _verdict_from_ctx(ctx, rsi)
        levels = _build_scenario_levels(ctx.current, ctx.change_pct, rsi, verdict)
        ev = evaluate_precision(
            ctx, levels, themes, ai_score, learning_hints, mode="scenario", hist=hist
        )
        if not ev or not ev.passed:
            return None

        row = {
            "id": f"{symbol}-{datetime.now().strftime('%Y%m%d')}",
            "symbol": symbol,
            "name": resolve_japanese_name(symbol, info_row),
            "current": ctx.current,
            "change_pct": ctx.change_pct,
            "ai_score": ai_score.get("total"),
            "scenario_score": ev.precision_score,
            "buy_price": levels["buy_price"],
            "shares": levels["shares"],
            "capital": levels["capital"],
            "target_price": levels["target_price"],
            "stop_price": levels["stop_price"],
            "expected_profit": levels["expected_profit"],
            "expected_loss": levels["expected_loss"],
            "risk_reward": levels["risk_reward"],
            "verdict": verdict,
            "themes": themes[:2],
        }
        return attach_precision_fields(row, ev)
    except Exception:
        traceback.print_exc()
        return None


def build_trade_scenarios_payload(deps: dict, learning_hints: dict | None = None) -> dict:
    symbols = collect_scenario_symbols(deps["theme_catalog"])
    rows: list[dict] = []
    for sym in symbols:
        row = analyze_trade_scenario(sym, deps, learning_hints)
        if row:
            rows.append(row)
        time.sleep(0.02)

    _rank = {"A": 4, "B": 3, "C": 2, "D": 1}
    rows.sort(
        key=lambda x: (
            _rank.get(x.get("confidence"), 0),
            x.get("expected_value", 0),
            x.get("precision_score", 0),
        ),
        reverse=True,
    )
    top = rows[:SCENARIO_RESULT_LIMIT]

    payload = {
        "status": "ok",
        "scenarios": top,
        "scanned": len(symbols),
        "generated_at": datetime.now().isoformat(),
        "disclaimer": "※これは売買推奨ではなく、株価データに基づく損益シミュレーションです。実際の投資判断は自己責任で行ってください。",
        "precision_mode": True,
    }

    if not top:
        skip = build_skip_payload("scenario", len(symbols), [
            "出来高・トレンド・リスクリワードが基準未満",
            "3つ以上の条件が一致する銘柄がありませんでした",
        ])
        payload.update(skip)
        payload["scenarios"] = []

    return payload
