"""AI売買シナリオ生成（ルールベース）"""
from __future__ import annotations

import time
import traceback
from datetime import datetime

from services.cache import CACHE_TTL_RANKING, cache_get

SCENARIO_SCAN_LIMIT = 14
SCENARIO_RESULT_LIMIT = 10
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


def _score_trade_scenario(
    change_pct, ai_score, themes, rsi, risk_reward, vol_ratio,
) -> tuple[float, str, str]:
    score = 0.0
    reason_parts: list[str] = []
    verdict = "中期狙い"
    total = ai_score.get("total") or 50
    if total >= 65:
        score += 18
        reason_parts.extend(ai_score.get("reasons", [])[:2])
    elif total >= 55:
        score += 10
        if ai_score.get("reasons"):
            reason_parts.append(ai_score["reasons"][0])
    if change_pct is not None:
        if change_pct >= 3:
            score += 14
            reason_parts.append("急騰局面")
            verdict = "短期狙い"
        elif change_pct <= -3:
            score += 16
            reason_parts.append("急落後のリバウンド候補")
            verdict = "反発狙い"
    if rsi is not None:
        if rsi < 35:
            score += 14
            reason_parts.append("RSIが低く、反発狙い")
            verdict = "反発狙い"
        elif rsi > 72:
            score += 6
            reason_parts.append("RSI買われすぎ（慎重）")
    if vol_ratio is not None and vol_ratio > 1.4:
        score += 10
        reason_parts.append("出来高増加")
    if themes:
        score += 8
        reason_parts.append(f"{themes[0]}テーマ")
    for tag in ai_score.get("reasons", []):
        if "上昇トレンド" in tag:
            score += 8
            reason_parts.append("短期上昇トレンド")
            verdict = "短期狙い"
            break
    if risk_reward is not None:
        if risk_reward >= 1.8:
            score += 12
        elif risk_reward >= 1.2:
            score += 6
    deduped: list[str] = []
    for r in reason_parts:
        if r and r not in deduped:
            deduped.append(r)
    reason = "＋".join(deduped[:3]) if deduped else "ルールベーススコアで選定"
    return score, reason, verdict


def collect_scenario_symbols(theme_catalog: dict) -> list[str]:
    """全銘柄再スキャンを避け、テーマ＋キャッシュ済みランキングから候補プールを構築"""
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


def analyze_trade_scenario(symbol: str, deps: dict) -> dict | None:
    try:
        get_ticker = deps["get_ticker"]
        get_ticker_info = deps["get_ticker_info"]
        enrich_fundamentals = deps["enrich_fundamentals"]
        get_history_safe = deps["get_history_safe"]
        safe_val = deps["safe_val"]
        calc_ai_score = deps["calc_ai_score"]
        calc_rsi = deps["calc_rsi"]
        resolve_japanese_name = deps["resolve_japanese_name"]
        theme_catalog = deps["theme_catalog"]

        ticker = get_ticker(symbol)
        info = enrich_fundamentals(get_ticker_info(ticker), ticker, symbol)
        hist = get_history_safe(ticker, period="1mo", interval="1d")
        current = safe_val(info.get("currentPrice") or info.get("regularMarketPrice"))
        if current is None and not hist.empty:
            current = safe_val(hist["Close"].iloc[-1])
        if current is None or current <= 0:
            return None

        prev = safe_val(info.get("previousClose"))
        change_pct = round((current - prev) / prev * 100, 2) if prev and prev != 0 else None
        ai_score = calc_ai_score(info, hist, symbol)
        themes = _symbol_theme_names(symbol, theme_catalog)

        rsi = vol_ratio = None
        if not hist.empty and len(hist) >= 14:
            rsi = safe_val(calc_rsi(hist["Close"]).iloc[-1])
            if len(hist) >= 20:
                vol = hist["Volume"]
                vol_mean = vol.rolling(20).mean()
                if safe_val(vol.iloc[-1]) and safe_val(vol_mean.iloc[-1]):
                    vol_ratio = float(vol.iloc[-1]) / float(vol_mean.iloc[-1])

        levels = _build_scenario_levels(current, change_pct, rsi, "中期狙い")
        score, reason, verdict = _score_trade_scenario(
            change_pct, ai_score, themes, rsi, levels.get("risk_reward"), vol_ratio
        )
        levels = _build_scenario_levels(current, change_pct, rsi, verdict)
        if levels.get("risk_reward") is not None and levels["risk_reward"] < 1.0:
            score -= 8
        if score < 18:
            return None

        return {
            "id": f"{symbol}-{datetime.now().strftime('%Y%m%d')}",
            "symbol": symbol,
            "name": resolve_japanese_name(symbol, info),
            "current": current,
            "change_pct": change_pct,
            "ai_score": ai_score.get("total"),
            "scenario_score": round(score, 1),
            "buy_price": levels["buy_price"],
            "shares": levels["shares"],
            "capital": levels["capital"],
            "target_price": levels["target_price"],
            "stop_price": levels["stop_price"],
            "expected_profit": levels["expected_profit"],
            "expected_loss": levels["expected_loss"],
            "risk_reward": levels["risk_reward"],
            "verdict": verdict,
            "reason": reason,
            "themes": themes[:2],
        }
    except Exception:
        traceback.print_exc()
        return None


def build_trade_scenarios_payload(deps: dict) -> dict:
    symbols = collect_scenario_symbols(deps["theme_catalog"])
    rows: list[dict] = []
    for sym in symbols:
        row = analyze_trade_scenario(sym, deps)
        if row:
            rows.append(row)
        time.sleep(0.02)
    rows.sort(key=lambda x: (x.get("scenario_score", 0), x.get("risk_reward") or 0), reverse=True)
    top = rows[:SCENARIO_RESULT_LIMIT]
    present = {r["symbol"] for r in top}
    for sym in ANCHOR_SYMBOLS:
        if sym in present:
            continue
        anchor = analyze_trade_scenario(sym, deps)
        if not anchor:
            continue
        if len(top) >= SCENARIO_RESULT_LIMIT:
            top = top[:-1] + [anchor]
        else:
            top.append(anchor)
        present.add(sym)
    top.sort(key=lambda x: (x.get("scenario_score", 0), x.get("risk_reward") or 0), reverse=True)
    return {
        "status": "ok",
        "scenarios": top[:SCENARIO_RESULT_LIMIT],
        "scanned": len(symbols),
        "generated_at": datetime.now().isoformat(),
        "disclaimer": "※これは売買推奨ではなく、株価データに基づく損益シミュレーションです。実際の投資判断は自己責任で行ってください。",
    }
