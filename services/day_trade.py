"""AI仮想デイトレ候補生成（ルールベース・シミュレーション専用）"""
from __future__ import annotations

import time
import traceback
from datetime import datetime

from services.cache import CACHE_TTL_RANKING, cache_get

DAY_TRADE_SCAN_LIMIT = 12
DAY_TRADE_PICK_LIMIT = 3
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
    """デイトレ向けの狭い利確/損切り"""
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
    }


def _symbol_theme_names(symbol: str, theme_catalog: dict) -> list[str]:
    return [t["name"] for t in theme_catalog.values() if symbol in t.get("symbols", [])]


def _check_intraday_uptrend(ticker, get_history_safe, safe_val) -> tuple[bool, float | None]:
    try:
        hist = get_history_safe(ticker, period="1d", interval="5m")
        if hist.empty or len(hist) < 6:
            return False, None
        recent = hist["Close"].iloc[-6:]
        a, b = safe_val(recent.iloc[0]), safe_val(recent.iloc[-1])
        if a and b and a != 0:
            pct = round((b - a) / a * 100, 2)
            return pct >= 0.25, pct
    except Exception:
        pass
    return False, None


def _apply_learning(score: float, symbol: str, themes: list[str], hints: dict | None) -> float:
    if not hints:
        return score
    for t in hints.get("boost_themes") or []:
        if t in themes:
            score += 10
    for t in hints.get("penalize_themes") or []:
        if t in themes:
            score -= 12
    if symbol in (hints.get("penalize_symbols") or []):
        score -= 18
    for pat in hints.get("boost_patterns") or []:
        if pat == "volume_surge":
            score += 4
    if hints.get("extend_target"):
        score += 3
    return score


def _score_daytrade(
    change_pct,
    ai_score,
    themes,
    rsi,
    vol_ratio,
    intraday_up,
    intraday_pct,
) -> tuple[float, str]:
    score = 0.0
    parts: list[str] = []

    total = ai_score.get("total") or 50
    if total >= 60:
        score += 16
        parts.extend(ai_score.get("reasons", [])[:1])
    elif total >= 52:
        score += 8

    if change_pct is not None:
        if change_pct >= 1.5:
            score += 14
            parts.append("寄り付き後の上昇")
        elif change_pct <= -2:
            score += 10
            parts.append("押し目からの反発狙い")

    if vol_ratio is not None and vol_ratio > 1.35:
        score += 14
        parts.append("出来高増加")

    if intraday_up:
        score += 16
        parts.append(f"5分足上昇トレンド({intraday_pct:+.1f}%)" if intraday_pct else "5分足上昇トレンド")

    if themes:
        score += 10
        parts.append(f"{themes[0]}テーマが強い")

    if rsi is not None:
        if 40 <= rsi <= 68:
            score += 6
        elif rsi > 75:
            score -= 6
            parts.append("買われすぎ注意")

    deduped: list[str] = []
    for p in parts:
        if p and p not in deduped:
            deduped.append(p)
    reason = "、".join(deduped[:3]) if deduped else "デイトレ向けルールスコアで選定"
    return score, reason


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

        intraday_up, intraday_pct = _check_intraday_uptrend(ticker, get_history_safe, safe_val)
        levels = _build_daytrade_levels(current, change_pct, rsi)
        score, reason = _score_daytrade(
            change_pct, ai_score, themes, rsi, vol_ratio, intraday_up, intraday_pct
        )
        score = _apply_learning(score, symbol, themes, hints)
        if score < 22:
            return None

        trade_date = datetime.now().strftime("%Y-%m-%d")
        return {
            "id": f"{symbol}-{trade_date.replace('-', '')}",
            "symbol": symbol,
            "name": resolve_japanese_name(symbol, info),
            "current": current,
            "change_pct": change_pct,
            "ai_score": ai_score.get("total"),
            "daytrade_score": round(score, 1),
            "buy_price": levels["buy_price"],
            "shares": levels["shares"],
            "target_price": levels["target_price"],
            "stop_price": levels["stop_price"],
            "expected_profit": levels["expected_profit"],
            "expected_loss": levels["expected_loss"],
            "entry_time": _entry_time_jst(),
            "exit_time": None,
            "status": "entered",
            "reason": reason,
            "themes": themes[:2],
            "trade_date": trade_date,
        }
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
    rows.sort(key=lambda x: x.get("daytrade_score", 0), reverse=True)
    trade_date = datetime.now().strftime("%Y-%m-%d")
    return {
        "status": "ok",
        "date": trade_date,
        "date_label": datetime.now().strftime("%Y/%m/%d"),
        "trades": rows[:DAY_TRADE_PICK_LIMIT],
        "scanned": len(symbols),
        "generated_at": datetime.now().isoformat(),
        "disclaimer": DISCLAIMER,
    }
