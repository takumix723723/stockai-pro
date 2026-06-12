"""精度重視スコアリング — 売買シナリオ / 仮想デイトレ共通"""
from __future__ import annotations

import traceback
from dataclasses import dataclass, field

MIN_POSITIVE_SCENARIO = 3
MIN_POSITIVE_DAYTRADE = 4
SCENARIO_RESULT_LIMIT = 5
DAY_TRADE_PICK_LIMIT = 3


@dataclass
class MarketContext:
    symbol: str
    current: float
    change_pct: float | None = None
    rsi: float | None = None
    vol_ratio: float | None = None
    vol_today: float | None = None
    ma5_up: bool = False
    ma5_pct: float | None = None
    ma15_up: bool = False
    ma15_pct: float | None = None
    ma20_up: bool = False
    prev_big_bear: bool = False
    atr_pct: float | None = None
    spread_pct: float | None = None
    hist_days: int = 0
    intraday_conflict: bool = False
    opening_spike_only: bool = False


@dataclass
class PrecisionEval:
    passed: bool
    precision_score: float
    positive_count: int
    predicted_win_rate: float
    expected_value: int
    confidence: str
    selection_reasons: list[str] = field(default_factory=list)
    exclusion_reasons: list[str] = field(default_factory=list)
    backtest: dict = field(default_factory=dict)
    signals: dict = field(default_factory=dict)


def _check_interval(
    ticker, get_history_safe, safe_val, interval: str, bars: int, threshold: float,
) -> tuple[bool, float | None]:
    try:
        hist = get_history_safe(ticker, period="1d", interval=interval)
        if hist.empty or len(hist) < bars:
            return False, None
        recent = hist["Close"].iloc[-bars:]
        a, b = safe_val(recent.iloc[0]), safe_val(recent.iloc[-1])
        if a and b and a != 0:
            pct = round((b - a) / a * 100, 2)
            return pct >= threshold, pct
    except Exception:
        pass
    return False, None


def gather_market_context(symbol: str, deps: dict) -> MarketContext | None:
    try:
        get_ticker = deps["get_ticker"]
        get_ticker_info = deps["get_ticker_info"]
        enrich_fundamentals = deps["enrich_fundamentals"]
        get_history_safe = deps["get_history_safe"]
        safe_val = deps["safe_val"]
        calc_rsi = deps["calc_rsi"]

        ticker = get_ticker(symbol)
        info = enrich_fundamentals(get_ticker_info(ticker), ticker, symbol)
        hist = get_history_safe(ticker, period="3mo", interval="1d")
        current = safe_val(info.get("currentPrice") or info.get("regularMarketPrice"))
        if current is None and not hist.empty:
            current = safe_val(hist["Close"].iloc[-1])
        if current is None or current <= 0:
            return None

        prev = safe_val(info.get("previousClose"))
        change_pct = round((current - prev) / prev * 100, 2) if prev and prev != 0 else None

        rsi = vol_ratio = vol_today = None
        ma20_up = prev_big_bear = False
        atr_pct = None
        hist_days = len(hist) if not hist.empty else 0

        if not hist.empty and hist_days >= 14:
            rsi = safe_val(calc_rsi(hist["Close"]).iloc[-1])
            if hist_days >= 20:
                vol = hist["Volume"]
                vol_mean = vol.rolling(20).mean()
                if safe_val(vol.iloc[-1]) and safe_val(vol_mean.iloc[-1]):
                    vol_today = float(vol.iloc[-1])
                    vol_ratio = float(vol.iloc[-1]) / float(vol_mean.iloc[-1])
                closes = hist["Close"]
                ma20 = closes.rolling(20).mean()
                if safe_val(closes.iloc[-1]) and safe_val(ma20.iloc[-1]):
                    ma20_up = float(closes.iloc[-1]) > float(ma20.iloc[-1])
            if hist_days >= 2:
                c0 = safe_val(hist["Close"].iloc[-2])
                c1 = safe_val(hist["Open"].iloc[-2])
                if c0 and c1 and c1 != 0:
                    prev_day_chg = (c0 - c1) / c1 * 100
                    prev_big_bear = prev_day_chg < -3.0
            if hist_days >= 10:
                hl = hist["High"] - hist["Low"]
                atr = hl.rolling(10).mean()
                if safe_val(atr.iloc[-1]) and current:
                    atr_pct = round(float(atr.iloc[-1]) / current * 100, 2)

        ma5_up, ma5_pct = _check_interval(ticker, get_history_safe, safe_val, "5m", 6, 0.25)
        ma15_up, ma15_pct = _check_interval(ticker, get_history_safe, safe_val, "15m", 4, 0.2)

        intraday_conflict = (ma5_up and not ma15_up and (ma15_pct or 0) < -0.1) or (
            not ma5_up and ma15_up and (ma5_pct or 0) < -0.1
        )
        opening_spike_only = (
            change_pct is not None
            and change_pct >= 2.0
            and ma5_up
            and not ma15_up
            and (vol_ratio or 0) < 1.25
        )

        bid = safe_val(info.get("bid"))
        ask = safe_val(info.get("ask"))
        spread_pct = None
        if bid and ask and bid > 0:
            spread_pct = round((ask - bid) / ((ask + bid) / 2) * 100, 3)

        return MarketContext(
            symbol=symbol,
            current=current,
            change_pct=change_pct,
            rsi=rsi,
            vol_ratio=vol_ratio,
            vol_today=vol_today,
            ma5_up=ma5_up,
            ma5_pct=ma5_pct,
            ma15_up=ma15_up,
            ma15_pct=ma15_pct,
            ma20_up=ma20_up,
            prev_big_bear=prev_big_bear,
            atr_pct=atr_pct,
            spread_pct=spread_pct,
            hist_days=hist_days,
            intraday_conflict=intraday_conflict,
            opening_spike_only=opening_spike_only,
        )
    except Exception:
        traceback.print_exc()
        return None


def _simple_backtest(hist, vol_ratio: float | None) -> dict:
    """日足ベース簡易バックテスト（出来高増＋上昇日の翌日勝率）"""
    out = {"wins": 0, "total": 0, "win_rate": None, "avg_profit_pct": None, "avg_loss_pct": None}
    try:
        if hist is None or hist.empty or len(hist) < 25:
            return out
        vol = hist["Volume"]
        vol_mean = vol.rolling(20).mean()
        wins = losses = 0
        profit_pcts: list[float] = []
        loss_pcts: list[float] = []
        for i in range(20, len(hist) - 1):
            v = vol.iloc[i]
            vm = vol_mean.iloc[i]
            if not v or not vm or vm == 0:
                continue
            ratio = float(v) / float(vm)
            if ratio < 1.35:
                continue
            c0, c1 = hist["Close"].iloc[i], hist["Close"].iloc[i + 1]
            if c0 is None or c1 is None or c0 == 0:
                continue
            chg = (float(c1) - float(c0)) / float(c0) * 100
            out["total"] += 1
            if chg > 0:
                wins += 1
                profit_pcts.append(chg)
            elif chg < 0:
                losses += 1
                loss_pcts.append(chg)
        out["wins"] = wins
        if out["total"]:
            out["win_rate"] = round(wins / out["total"] * 100, 1)
        if profit_pcts:
            out["avg_profit_pct"] = round(sum(profit_pcts) / len(profit_pcts), 2)
        if loss_pcts:
            out["avg_loss_pct"] = round(sum(loss_pcts) / len(loss_pcts), 2)
    except Exception:
        pass
    return out


def _learning_theme_win_adj(themes: list[str], hints: dict | None) -> tuple[float, list[str]]:
    adj = 0.0
    notes: list[str] = []
    if not hints:
        return adj, notes
    for t in hints.get("boost_themes") or []:
        if any(t in th or th in t for th in themes):
            adj += 6
            notes.append(f"{t}テーマの過去勝率が高い")
    for t in hints.get("penalize_themes") or []:
        if any(t in th or th in t for th in themes):
            adj -= 8
            notes.append(f"{t}テーマの過去勝率が低い")
    if hints.get("penalize_patterns") and "surge_chase" in (hints.get("penalize_patterns") or []):
        adj -= 5
    for pat in hints.get("boost_patterns") or []:
        if pat == "volume_surge":
            adj += 4
            notes.append("出来高急増＋上昇の過去成績が良好")
    return adj, notes


def evaluate_precision(
    ctx: MarketContext,
    levels: dict,
    themes: list[str],
    ai_score: dict,
    learning_hints: dict | None,
    mode: str = "scenario",
    hist=None,
) -> PrecisionEval | None:
    """精度評価。ハード除外時は None"""
    exclusions: list[str] = []
    positives: list[str] = []

    if ctx.hist_days < 20:
        exclusions.append("上場・データ期間が短い")
    if ctx.vol_ratio is not None and ctx.vol_ratio < 0.5:
        exclusions.append("出来高が少ない")
    if ctx.vol_today is not None and ctx.current and ctx.vol_today * ctx.current < 30_000_000:
        exclusions.append("売買代金が薄い（板が薄い）")
    if ctx.rsi is not None and ctx.rsi > 78:
        exclusions.append("RSI過熱")
    if ctx.change_pct is not None and ctx.change_pct > 7:
        exclusions.append("直近で急騰しすぎ")
    if ctx.intraday_conflict:
        exclusions.append("5分足と15分足の方向が逆")
    if ctx.opening_spike_only:
        exclusions.append("寄り付き直後だけの一時的上昇")
    if ctx.prev_big_bear and ctx.change_pct is not None and ctx.change_pct > 1:
        exclusions.append("前日大陰線後の追いかけ")
    if ctx.atr_pct is not None and ctx.atr_pct > 4.5:
        exclusions.append("値動きが荒すぎる")
    if ctx.spread_pct is not None and ctx.spread_pct > 0.25:
        exclusions.append("スプレッドが広い")
    if ctx.change_pct is not None and ctx.change_pct > 4 and (ctx.vol_ratio or 0) < 1.2:
        exclusions.append("ニュース材料なしの急騰疑い")

    if exclusions:
        return None

    rr = levels.get("risk_reward")
    exp_profit = levels.get("expected_profit") or 0
    exp_loss = levels.get("expected_loss") or 0
    ai_total = ai_score.get("total") or 50

    if ctx.ma5_up:
        positives.append("5分足上昇" + (f"({ctx.ma5_pct:+.1f}%)" if ctx.ma5_pct else ""))
    if ctx.ma15_up:
        positives.append("15分足上昇" + (f"({ctx.ma15_pct:+.1f}%)" if ctx.ma15_pct else ""))
    if ctx.vol_ratio is not None and ctx.vol_ratio >= 1.5:
        positives.append(f"出来高が20日平均の{ctx.vol_ratio:.1f}倍")
    if themes:
        positives.append(f"{themes[0]}テーマ")
    if ctx.ma20_up:
        positives.append("日足トレンド良好（20日線上）")
    if rr is not None and rr >= 1.5:
        positives.append(f"リスクリワード {rr:.1f}倍")
    if 35 <= (ctx.rsi or 50) <= 68:
        positives.append("RSIが健全圏")
    if ai_total >= 58:
        positives.append(f"AIスコア {ai_total}")

    learn_adj, learn_notes = _learning_theme_win_adj(themes, learning_hints)
    positives.extend(learn_notes)

    positive_count = len(positives)
    min_pos = MIN_POSITIVE_DAYTRADE if mode == "daytrade" else MIN_POSITIVE_SCENARIO
    if positive_count < min_pos:
        return None

    backtest = _simple_backtest(hist, ctx.vol_ratio)
    base_wr = 48.0
    if backtest.get("win_rate") is not None:
        base_wr = backtest["win_rate"]
    base_wr += min(positive_count - min_pos, 3) * 3
    base_wr += learn_adj
    if rr is not None and rr >= 1.8:
        base_wr += 4
    if ctx.ma5_up and ctx.ma15_up and (ctx.vol_ratio or 0) >= 1.5:
        base_wr += 5
    predicted_wr = max(35.0, min(72.0, round(base_wr, 1)))

    wr_frac = predicted_wr / 100
    expected_value = round(wr_frac * exp_profit + (1 - wr_frac) * exp_loss)

    if rr is not None and rr >= 1.8 and positive_count >= 5 and predicted_wr >= 62:
        confidence = "A"
    elif rr is not None and rr >= 1.5 and positive_count >= 4 and predicted_wr >= 55:
        confidence = "B"
    elif rr is not None and rr >= 1.3 and positive_count >= min_pos and predicted_wr >= 50:
        confidence = "C"
    else:
        confidence = "D"

    precision_score = (
        positive_count * 10
        + predicted_wr * 0.5
        + (rr or 0) * 8
        + expected_value / 5000
        + learn_adj
    )

    signals = {
        "ma5_up": ctx.ma5_up,
        "ma15_up": ctx.ma15_up,
        "volume_surge": (ctx.vol_ratio or 0) >= 1.5,
        "rsi_rebound": ctx.rsi is not None and ctx.rsi < 40,
        "surge_chase": ctx.change_pct is not None and ctx.change_pct >= 3,
        "daily_trend_up": ctx.ma20_up,
    }

    if mode == "daytrade":
        passed = confidence in ("A", "B") and expected_value > 0
    else:
        passed = confidence in ("A", "B", "C") and expected_value > 0

    return PrecisionEval(
        passed=passed,
        precision_score=round(precision_score, 1),
        positive_count=positive_count,
        predicted_win_rate=predicted_wr,
        expected_value=expected_value,
        confidence=confidence,
        selection_reasons=positives[:6],
        exclusion_reasons=exclusions,
        backtest=backtest,
        signals=signals,
    )


def build_skip_payload(mode: str, scanned: int, skip_reasons: list[str]) -> dict:
    label = "本日のAI判断：見送り"
    reason = skip_reasons[0] if skip_reasons else "出来高・トレンド・リスクリワードが基準未満"
    return {
        "skip": True,
        "skip_label": label,
        "skip_reason": reason,
        "skip_reasons": skip_reasons[:5],
        "scanned": scanned,
    }


def attach_precision_fields(row: dict, ev: PrecisionEval, reason_join: str = "、") -> dict:
    row["reason"] = reason_join.join(ev.selection_reasons[:4]) if ev.selection_reasons else row.get("reason", "")
    row["selection_reasons"] = ev.selection_reasons
    row["predicted_win_rate"] = ev.predicted_win_rate
    row["expected_value"] = ev.expected_value
    row["confidence"] = ev.confidence
    row["precision_score"] = ev.precision_score
    row["positive_conditions"] = ev.positive_count
    row["backtest"] = ev.backtest
    row["signals"] = ev.signals
    return row
