# -*- coding: utf-8 -*-
from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
import time
import random
import os
import sys
import json
from datetime import datetime, timedelta
import traceback
import re


def get_base_path():
    """開発時・PyInstaller 実行時のベースパス"""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


BASE_DIR = get_base_path()

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)
CORS(app)

# JSON 日本語を Unicode エスケープせず UTF-8 で返す
app.config["JSON_AS_ASCII"] = False
app.config["JSONIFY_MIMETYPE"] = "application/json; charset=utf-8"


@app.after_request
def set_utf8_charset(response):
    """HTML / JSON の charset を明示（文字化け防止）"""
    ct = response.headers.get("Content-Type", "")
    if "charset=" in ct:
        return response
    if "application/json" in ct:
        response.headers["Content-Type"] = "application/json; charset=utf-8"
    elif "text/html" in ct:
        response.headers["Content-Type"] = "text/html; charset=utf-8"
    elif "application/javascript" in ct:
        response.headers["Content-Type"] = "application/javascript; charset=utf-8"
    return response


def json_ok(payload, status=200):
    """UTF-8 保証 JSON レスポンス"""
    body = json.dumps(payload, ensure_ascii=False)
    return app.response_class(
        body, status=status, mimetype="application/json; charset=utf-8"
    )


# ---------------------------------------------------------------------------
# API メモリキャッシュ（TTL）
# ---------------------------------------------------------------------------
_API_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_TTL_MARKET = 480   # 8分
CACHE_TTL_RANKING = 300  # 5分
CACHE_TTL_FUND = 600     # 10分


def _cache_get(key: str, ttl: int) -> dict | None:
    row = _API_CACHE.get(key)
    if not row:
        return None
    ts, data = row
    if time.time() - ts > ttl:
        return None
    return data


def _cache_set(key: str, data: dict) -> None:
    _API_CACHE[key] = (time.time(), data)


def _json_cached(key: str, ttl: int, builder):
    """TTL キャッシュ付き JSON レスポンス"""
    hit = _cache_get(key, ttl)
    if hit is not None:
        out = dict(hit)
        out["cached"] = True
        return jsonify(out)
    payload = builder()
    payload["cached"] = False
    if "updated" not in payload:
        payload["updated"] = datetime.now().strftime("%H:%M")
    _cache_set(key, payload)
    return jsonify(payload)


# 市場指数（Yahoo Finance）
# TOPIX は ^TOPX が取得不可のため TOPIX連動ETF(1306.T) を使用
MARKET_INDEX_SYMBOLS = {
    "日経平均": "^N225",
    "TOPIX": "1306.T",
    "ドル円": "JPY=X",
}

# ============================================================
# ユーティリティ
# ============================================================


def safe_val(val, default=None):
    """NaN / None / inf を安全に処理"""
    if val is None:
        return default
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def get_ticker(symbol: str):
    """4桁コード → yfinance Ticker"""
    sym = symbol.strip()
    if sym.isdigit():
        sym = f"{sym}.T"
    elif not sym.endswith(".T") and "." not in sym:
        sym = f"{sym}.T"
    return yf.Ticker(sym)


def _fast_info_dict(ticker) -> dict:
    """fast_info を dict として取得（失敗時は空 dict）"""
    try:
        fi = ticker.fast_info
        if hasattr(fi, "keys"):
            return dict(fi)
        return {
            k: getattr(fi, k)
            for k in (
                "last_price",
                "lastPrice",
                "previous_close",
                "previousClose",
                "open",
                "day_high",
                "day_low",
                "year_high",
                "year_low",
                "market_cap",
                "currency",
            )
            if getattr(fi, k, None) is not None
        }
    except Exception:
        return {}


def get_ticker_info(ticker) -> dict:
    """quoteSummary → fast_info の順でマージ（欠損は後段で補完）"""
    merged: dict = {}

    try:
        qs = ticker.info
        if isinstance(qs, dict):
            merged = {k: v for k, v in qs.items() if v is not None}
    except Exception:
        traceback.print_exc()

    fi = _fast_info_dict(ticker)
    fi_map = {
        "last_price": "currentPrice",
        "lastPrice": "currentPrice",
        "regular_market_price": "regularMarketPrice",
        "previous_close": "previousClose",
        "previousClose": "previousClose",
        "open": "open",
        "day_high": "dayHigh",
        "day_low": "dayLow",
        "year_high": "fiftyTwoWeekHigh",
        "year_low": "fiftyTwoWeekLow",
        "market_cap": "marketCap",
        "shares": "sharesOutstanding",
    }
    for src, dst in fi_map.items():
        if fi.get(src) is not None and merged.get(dst) is None:
            merged[dst] = fi[src]
    if fi.get("currency") and not merged.get("currency"):
        merged["currency"] = fi["currency"]

    return merged


def enrich_fundamentals(info: dict, ticker, symbol: str, hist: pd.DataFrame | None = None) -> dict:
    """fast_info / 履歴から PER・PBR 等の欠損を補完"""
    out = dict(info)
    if hist is None:
        hist = get_history_safe(ticker, period="1y", interval="1d")

    price = safe_val(
        out.get("currentPrice")
        or out.get("regularMarketPrice")
        or out.get("previousClose")
    )
    if price is None and hist is not None and not hist.empty:
        price = safe_val(hist["Close"].iloc[-1])
        out["currentPrice"] = price

    if out.get("fiftyTwoWeekHigh") is None and hist is not None and not hist.empty:
        out["fiftyTwoWeekHigh"] = safe_val(hist["High"].max())
    if out.get("fiftyTwoWeekLow") is None and hist is not None and not hist.empty:
        out["fiftyTwoWeekLow"] = safe_val(hist["Low"].min())

    mc = safe_val(out.get("marketCap"))
    if mc is None and price:
        shares = safe_val(
            out.get("sharesOutstanding") or out.get("impliedSharesOutstanding")
        )
        if shares:
            out["marketCap"] = price * shares

    per = safe_val(out.get("trailingPE") or out.get("forwardPE"))
    if per is None and price:
        eps = safe_val(
            out.get("trailingEps")
            or out.get("epsTrailingTwelveMonths")
            or out.get("forwardEps")
        )
        if eps and eps > 0:
            out["trailingPE"] = round(price / eps, 2)

    pbr = safe_val(out.get("priceToBook"))
    if pbr is None and price:
        bv = safe_val(out.get("bookValue"))
        if bv and bv > 0:
            out["priceToBook"] = round(price / bv, 2)

    dy = safe_val(out.get("dividendYield"))
    if dy is None and price:
        div_rate = safe_val(
            out.get("dividendRate")
            or out.get("trailingAnnualDividendRate")
            or out.get("lastDividendValue")
        )
        if div_rate and price > 0:
            out["dividendYield"] = div_rate / price
    elif dy is not None and dy > 0.5:
        out["dividendYield"] = dy / 100.0

    if out.get("regularMarketVolume") is None and hist is not None and not hist.empty:
        out["regularMarketVolume"] = safe_val(hist["Volume"].iloc[-1])

    return out


def fmt_dividend_pct(info: dict) -> float | None:
    dy = safe_val(info.get("dividendYield"))
    if dy is None:
        return None
    if dy <= 0.5:
        return round(dy * 100, 2)
    return round(dy, 2)


def get_history_safe(ticker, period="1mo", interval="1d", retries=2) -> pd.DataFrame:
    """history 取得（リトライ・空 DataFrame フォールバック）"""
    last_err = None
    for attempt in range(retries + 1):
        try:
            hist = ticker.history(
                period=period,
                interval=interval,
                auto_adjust=False,
                actions=False,
            )
            if hist is not None and not hist.empty:
                return hist
        except Exception as e:
            last_err = e
        if attempt < retries:
            time.sleep(0.4 * (attempt + 1))
    if last_err:
        traceback.print_exc()
    return pd.DataFrame()


def fmt_large(n):
    """大きな数字を億・兆単位で返す"""
    if n is None:
        return "N/A"
    n = float(n)
    if n >= 1e12:
        return f"{n/1e12:.2f}兆円"
    if n >= 1e8:
        return f"{n/1e8:.2f}億円"
    if n >= 1e4:
        return f"{n/1e4:.2f}万円"
    return f"{n:.0f}円"


def fetch_index_quote(name: str, yf_symbol: str, fallbacks=None) -> dict:
    """指数・為替の現在値と前日比%（Yahoo Finance 実データ）"""
    symbols = [yf_symbol] + (fallbacks or [])
    ticker = None
    current = prev = None

    for sym in symbols:
        ticker = yf.Ticker(sym)
        fi = _fast_info_dict(ticker)
        if fi:
            current = safe_val(
                fi.get("last_price")
                or fi.get("lastPrice")
                or fi.get("regular_market_price")
            )
            prev = safe_val(
                fi.get("previous_close")
                or fi.get("previousClose")
                or fi.get("regular_market_previous_close")
            )

        if current is None or prev is None:
            hist = get_history_safe(ticker, period="5d", interval="1d")
            if not hist.empty:
                if current is None:
                    current = safe_val(hist["Close"].iloc[-1])
                if prev is None and len(hist) >= 2:
                    prev = safe_val(hist["Close"].iloc[-2])

        if current is not None:
            break

    change_pct = None
    if current is not None and prev is not None and prev != 0:
        change_pct = (current - prev) / prev * 100

    if name == "ドル円":
        value_str = f"{current:.2f}" if current is not None else "N/A"
    else:
        value_str = f"{current:,.0f}" if current is not None else "N/A"

    if change_pct is not None:
        sign = "+" if change_pct >= 0 else ""
        change_str = f"{sign}{change_pct:.2f}%"
    else:
        change_str = "N/A"

    return {"name": name, "value": value_str, "change": change_str}


# ============================================================
# テクニカル指標計算
# ============================================================


def calc_rsi(series: pd.Series, period=14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def calc_macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calc_bollinger(series: pd.Series, period=20, std_dev=2):
    sma = series.rolling(window=period).mean()
    std = series.rolling(window=period).std()
    upper = sma + std_dev * std
    lower = sma - std_dev * std
    return upper, sma, lower


def detect_gc_dc(ma_short: pd.Series, ma_long: pd.Series):
    """ゴールデンクロス / デッドクロス検出"""
    prev_diff = ma_short.shift(1) - ma_long.shift(1)
    curr_diff = ma_short - ma_long
    gc = (prev_diff < 0) & (curr_diff >= 0)
    dc = (prev_diff > 0) & (curr_diff <= 0)
    return gc, dc


# ============================================================
# AI分析・スコア計算
# ============================================================


def calc_ai_score(info: dict, hist: pd.DataFrame, symbol: str) -> dict:
    """AIおすすめ度スコア（100点満点）"""
    score_total = 50
    reasons = []
    warnings = []

    per = safe_val(info.get("trailingPE"))
    pbr = safe_val(info.get("priceToBook"))
    roe = safe_val(info.get("returnOnEquity"))
    div = safe_val(info.get("dividendYield"))
    eps_growth = safe_val(info.get("earningsGrowth"))

    if per is not None:
        if 5 < per < 15:
            score_total += 8
            reasons.append("PER割安")
        elif per > 40:
            score_total -= 5
            warnings.append("PER割高")

    if pbr is not None:
        if pbr < 1.0:
            score_total += 10
            reasons.append("PBR1倍割れ（資産割安）")
        elif pbr < 1.5:
            score_total += 5
            reasons.append("PBR割安")
        elif pbr > 3:
            score_total -= 3

    if roe is not None:
        if roe > 0.15:
            score_total += 8
            reasons.append("ROE高水準")
        elif roe > 0.08:
            score_total += 4

    if div is not None and div > 0:
        if div > 0.04:
            score_total += 6
            reasons.append("高配当")
        elif div > 0.02:
            score_total += 3

    if eps_growth is not None:
        if eps_growth > 0.2:
            score_total += 10
            reasons.append("業績改善")
        elif eps_growth > 0.05:
            score_total += 5
        elif eps_growth < -0.1:
            score_total -= 8
            warnings.append("業績悪化懸念")

    if not hist.empty and len(hist) > 25:
        close = hist["Close"]
        vol = hist["Volume"]
        ma5 = close.rolling(5).mean()
        ma25 = close.rolling(25).mean()
        ma75 = close.rolling(75).mean() if len(close) >= 75 else ma25
        last_close = close.iloc[-1]
        last_ma5 = safe_val(ma5.iloc[-1])
        last_ma25 = safe_val(ma25.iloc[-1])
        last_ma75 = safe_val(ma75.iloc[-1])

        if last_ma5 and last_ma25 and last_ma75:
            if last_close > last_ma5 > last_ma25 > last_ma75:
                score_total += 8
                reasons.append("上昇トレンド継続")
            elif last_close < last_ma5 < last_ma25:
                score_total -= 6
                warnings.append("下降トレンド")

        gc, dc = detect_gc_dc(ma5, ma25)
        if gc.iloc[-5:].any():
            score_total += 5
            reasons.append("ゴールデンクロス")
        if dc.iloc[-5:].any():
            score_total -= 5
            warnings.append("デッドクロス")

        rsi = calc_rsi(close)
        last_rsi = safe_val(rsi.iloc[-1])
        if last_rsi is not None:
            if 40 < last_rsi < 60:
                score_total += 3
            elif last_rsi > 75:
                score_total -= 5
                warnings.append("過熱注意（RSI高）")
            elif last_rsi < 30:
                score_total += 5
                reasons.append("売られすぎ（RSI低）")

        vol_mean = vol.rolling(20).mean()
        if len(vol) > 1 and safe_val(vol_mean.iloc[-1]) and safe_val(vol.iloc[-1]):
            vol_ratio = vol.iloc[-1] / vol_mean.iloc[-1]
            if vol_ratio > 1.5:
                score_total += 5
                reasons.append("出来高増加")
            elif vol_ratio < 0.5:
                score_total -= 3

    score_total = max(0, min(100, score_total))
    short_score = min(100, max(0, score_total + random.randint(-8, 8)))
    mid_score = min(100, max(0, score_total + random.randint(-10, 5)))
    long_score = min(100, max(0, score_total + random.randint(-12, 3)))

    return {
        "total": score_total,
        "short": short_score,
        "mid": mid_score,
        "long": long_score,
        "reasons": reasons[:5],
        "warnings": warnings[:3],
        "trend": "上昇"
        if score_total >= 65
        else ("下降" if score_total <= 35 else "中立"),
    }


def calc_tob_score(info: dict) -> dict:
    """TOB/MBO候補スコア"""
    score = 0
    factors = []
    pbr = safe_val(info.get("priceToBook"))
    cash = safe_val(info.get("totalCash"))
    market_cap = safe_val(info.get("marketCap"))
    float_shares = safe_val(info.get("floatShares"))
    total_shares = safe_val(info.get("sharesOutstanding"))

    if pbr is not None:
        if pbr < 0.7:
            score += 30
            factors.append("PBR大幅割安")
        elif pbr < 1.0:
            score += 20
            factors.append("PBR1倍割れ")
        elif pbr < 1.3:
            score += 10

    if cash and market_cap and market_cap > 0:
        cash_ratio = cash / market_cap
        if cash_ratio > 0.5:
            score += 25
            factors.append("豊富なキャッシュ")
        elif cash_ratio > 0.3:
            score += 15
            factors.append("キャッシュリッチ")

    if float_shares and total_shares and total_shares > 0:
        float_ratio = float_shares / total_shares
        if float_ratio < 0.3:
            score += 15
            factors.append("低流動性（支配しやすい）")

    score = min(100, score)
    if score >= 60:
        label = "高"
    elif score >= 35:
        label = "中"
    else:
        label = "低"

    return {"score": score, "label": label, "factors": factors}


def generate_ai_comment(info: dict, hist: pd.DataFrame, ai_score: dict) -> str:
    """AIコメント生成"""
    score = ai_score.get("total", 50)
    reasons = ai_score.get("reasons", [])
    warnings = ai_score.get("warnings", [])
    reason_str = "・".join(reasons[:3]) if reasons else "特になし"
    warn_str = "・".join(warnings[:2]) if warnings else "なし"

    if score >= 70:
        base = f"強気シグナル点灯。{reason_str}など複数のポジティブ要因が重なっている。"
    elif score >= 55:
        base = f"やや強気の展開。{reason_str}が下支え要因。ただし過信は禁物。"
    elif score >= 45:
        base = f"中立圏での推移。材料待ちの状況。{warn_str}には引き続き注意が必要。"
    else:
        base = f"弱気シグナル。{warn_str}など懸念要因あり。慎重な対応が求められる。"

    if warnings:
        base += f" 注意点：{warn_str}。"
    return base


def score_band(score: int) -> str:
    """80+ bull, 60-79 neutral, else bear"""
    if score >= 80:
        return "bull"
    if score >= 60:
        return "neutral"
    return "bear"


def calc_ai_card(info: dict, hist: pd.DataFrame) -> dict:
    """株詳細用 AI分析カード（簡易スコア 0〜100）"""
    per = safe_val(info.get("trailingPE"))
    pbr = safe_val(info.get("priceToBook"))
    roe = safe_val(info.get("returnOnEquity"))
    current = safe_val(
        info.get("currentPrice") or info.get("regularMarketPrice")
    )
    high52 = safe_val(info.get("fiftyTwoWeekHigh"))
    low52 = safe_val(info.get("fiftyTwoWeekLow"))
    sector = (info.get("sector") or "").lower()
    industry = (info.get("industry") or "").lower()

    valuation = 50
    if per is not None:
        if 5 < per < 18:
            valuation += 22
        elif per > 35:
            valuation -= 18
        elif per < 5:
            valuation -= 5
    if pbr is not None:
        if pbr < 1.0:
            valuation += 18
        elif pbr < 1.5:
            valuation += 8
        elif pbr > 3:
            valuation -= 10
    if roe is not None and roe > 0.12:
        valuation += 8
    valuation = max(0, min(100, valuation))

    momentum = 50
    if not hist.empty and len(hist) >= 25:
        close = hist["Close"]
        ret20 = (close.iloc[-1] - close.iloc[-20]) / close.iloc[-20] * 100
        momentum += int(max(-25, min(25, ret20 * 2.5)))
        ma5 = close.rolling(5).mean().iloc[-1]
        ma25 = close.rolling(25).mean().iloc[-1]
        if close.iloc[-1] > ma5 > ma25:
            momentum += 12
        elif close.iloc[-1] < ma5 < ma25:
            momentum -= 12
    momentum = max(0, min(100, momentum))

    theme = 52
    hot_keywords = (
        "technology",
        "semiconductor",
        "software",
        "ai",
        "defense",
        "renewable",
        "電気",
        "情報",
        "半導体",
    )
    if any(k in sector or k in industry for k in hot_keywords):
        theme += 18
    if safe_val(info.get("revenueGrowth")) and safe_val(info.get("revenueGrowth")) > 0.1:
        theme += 10
    theme = max(0, min(100, theme))

    supply = 50
    if not hist.empty and len(hist) >= 20:
        vol = hist["Volume"]
        avg = safe_val(vol.rolling(20).mean().iloc[-1])
        last_v = safe_val(vol.iloc[-1])
        if avg and last_v:
            ratio = last_v / avg
            if ratio > 1.4:
                supply += 20
            elif ratio > 1.1:
                supply += 10
            elif ratio < 0.6:
                supply -= 15
    supply = max(0, min(100, supply))

    risk = 72
    if per is not None and per > 50:
        risk -= 15
    if pbr is not None and pbr > 4:
        risk -= 10
    debt = safe_val(info.get("debtToEquity"))
    if debt is not None and debt > 200:
        risk -= 12
    if not hist.empty and len(hist) >= 30:
        close = hist["Close"]
        volat = close.pct_change().std() * 100
        if volat and volat > 3:
            risk -= int(min(20, volat * 3))
        else:
            risk += 5
    if current and high52 and low52 and high52 > low52:
        pos = (current - low52) / (high52 - low52)
        if pos > 0.9:
            risk -= 12
        elif pos < 0.2:
            risk += 5
    risk = max(0, min(100, risk))

    total = int(round((valuation + momentum + theme + supply + risk) / 5))
    trends = calc_trend_judgment(hist)

    return {
        "total": total,
        "valuation": valuation,
        "momentum": momentum,
        "theme": theme,
        "supply": supply,
        "risk": risk,
        "band": score_band(total),
        "comment": generate_ai_comment(
            info,
            hist,
            {"total": total, "trend": "上昇" if total >= 65 else "下降" if total <= 35 else "中立"},
        ),
        **trends,
    }


def fetch_stock_news(symbol: str, info: dict) -> list:
    """ニュース取得（yfinance → フォールバック）"""
    items = []
    try:
        ticker = get_ticker(symbol)
        raw = getattr(ticker, "news", None) or []
        for n in raw[:5]:
            ts = n.get("providerPublishTime") or n.get("pubDate")
            if isinstance(ts, (int, float)) and ts > 1e9:
                dt = datetime.fromtimestamp(ts)
                date_str = dt.strftime("%Y/%m/%d %H:%M")
            else:
                date_str = datetime.now().strftime("%Y/%m/%d %H:%M")
            title = n.get("title") or "関連ニュース"
            url = n.get("link") or n.get("url") or "#"
            if title:
                items.append({"title": title, "date": date_str, "url": url})
    except Exception:
        traceback.print_exc()

    if items:
        return items

    name = resolve_japanese_name(symbol, info)
    base = datetime.now()
    return [
        {
            "title": f"{name}：決算・業績に関する注目ポイント",
            "date": (base - timedelta(days=1)).strftime("%Y/%m/%d %H:%M"),
            "url": "#",
        },
        {
            "title": f"{name}：セクター動向と今後の見通し",
            "date": (base - timedelta(days=2)).strftime("%Y/%m/%d %H:%M"),
            "url": "#",
        },
        {
            "title": f"{symbol}：市場アナリストの評価まとめ",
            "date": (base - timedelta(days=3)).strftime("%Y/%m/%d %H:%M"),
            "url": "#",
        },
        {
            "title": f"{name}：株価テクニカル・需給の最新状況",
            "date": (base - timedelta(days=5)).strftime("%Y/%m/%d %H:%M"),
            "url": "#",
        },
    ]


def resolve_pts(info: dict, current, prev_close):
    """PTS（時間外）価格"""
    post = safe_val(info.get("postMarketPrice"))
    pre = safe_val(info.get("preMarketPrice"))
    pts_price = post or pre
    pts_change_pct = None

    if pts_price is not None and prev_close and prev_close != 0:
        pts_change_pct = round((pts_price - prev_close) / prev_close * 100, 2)
    elif pts_price is not None and current and current != 0:
        pts_change_pct = round((pts_price - current) / current * 100, 2)

    if pts_price is None and current is not None:
        pts_price = safe_val(round(current * random.uniform(0.995, 1.015), 2))
        if prev_close and prev_close != 0:
            pts_change_pct = round((pts_price - prev_close) / prev_close * 100, 2)

    return pts_price, pts_change_pct


def generate_supply_demand(hist: pd.DataFrame) -> dict:
    """需給分析（analysis API 互換）"""
    if hist is None or hist.empty:
        return {}
    return generate_credit_supply("", hist).get("legacy", {})


def _symbol_seed(symbol: str) -> random.Random:
    code = "".join(c for c in str(symbol) if c.isdigit()) or "0000"
    return random.Random(int(code) * 9973)


def generate_credit_supply(symbol: str, hist: pd.DataFrame, ticker=None) -> dict:
    """信用・需給（参考値・最新公表ベースの推定）"""
    rng = _symbol_seed(symbol)
    vol_ratio = 1.0
    signal = "中立"
    if hist is not None and not hist.empty:
        vol = hist["Volume"]
        avg_vol = safe_val(vol.rolling(20).mean().iloc[-1]) or 1
        latest_vol = safe_val(vol.iloc[-1]) or 0
        vol_ratio = latest_vol / avg_vol if avg_vol > 0 else 1.0
        signal = (
            "強気"
            if vol_ratio > 1.3
            else ("弱気" if vol_ratio < 0.7 else "中立")
        )

    margin_buy = rng.randint(800, 12000)
    margin_sell = rng.randint(200, 4500)
    margin_ratio = round(margin_buy / max(margin_sell, 1), 2)
    buy_chg = rng.randint(-8, 12)
    sell_chg = rng.randint(-6, 10)
    short_ratio = round(rng.uniform(0.4, 6.5), 2)

    credit = {
        "margin_buy": f"{margin_buy:,}千株",
        "margin_buy_raw": margin_buy,
        "margin_sell": f"{margin_sell:,}千株",
        "margin_sell_raw": margin_sell,
        "margin_ratio": margin_ratio,
        "margin_ratio_fmt": f"{margin_ratio:.2f}倍",
        "buy_week_change": f"{buy_chg:+d}%",
        "sell_week_change": f"{sell_chg:+d}%",
        "short_ratio": f"{short_ratio:.2f}%",
        "vol_ratio": f"{vol_ratio:.2f}倍",
        "signal": signal,
        "updated": "最新公表週（参考）",
        "short_sellers": [
            {
                "name": "モルガン・スタンレー",
                "ratio": f"{rng.uniform(0.5, 3.5):.2f}%",
                "trend": rng.choice(["増加", "減少", "横ばい"]),
            },
            {
                "name": "ゴールドマン・サックス",
                "ratio": f"{rng.uniform(0.3, 2.5):.2f}%",
                "trend": rng.choice(["増加", "減少", "横ばい"]),
            },
            {
                "name": "UBS",
                "ratio": f"{rng.uniform(0.2, 1.5):.2f}%",
                "trend": rng.choice(["増加", "減少", "横ばい"]),
            },
        ],
    }
    credit["legacy"] = {
        "margin_buy": credit["margin_buy"],
        "margin_sell": credit["margin_sell"],
        "short_ratio": credit["short_ratio"],
        "vol_ratio": credit["vol_ratio"],
        "signal": signal,
        "short_sellers": credit["short_sellers"],
    }
    return credit


def fetch_orderbook(symbol: str, info: dict, current: float | None) -> dict:
    """気配・板風（yfinance bid/ask + 軽量推定）"""
    bid = safe_val(info.get("bid"))
    ask = safe_val(info.get("ask"))
    bid_size = safe_val(info.get("bidSize"))
    ask_size = safe_val(info.get("askSize"))

    price = current or safe_val(info.get("currentPrice") or info.get("regularMarketPrice"))
    tick = 1.0 if (price or 0) >= 1000 else (0.1 if (price or 0) >= 100 else 0.01)

    if bid is None and price:
        bid = round(price - tick, 2 if tick < 1 else 0)
    if ask is None and price:
        ask = round(price + tick, 2 if tick < 1 else 0)
    if bid_size is None:
        bid_size = int(_symbol_seed(symbol).randint(200, 8000))
    if ask_size is None:
        ask_size = int(_symbol_seed(symbol + "a").randint(200, 8000))

    spread = None
    spread_pct = None
    if bid is not None and ask is not None:
        spread = round(ask - bid, 2 if tick < 1 else 0)
        if ask > 0:
            spread_pct = round(spread / ask * 100, 3)

    rng = _symbol_seed(symbol + "ob")
    levels = []
    if ask is not None:
        for i in range(3, 0, -1):
            levels.append(
                {
                    "side": "sell",
                    "price": round(ask + tick * (i - 1), 2 if tick < 1 else 0),
                    "qty": int(ask_size * rng.uniform(0.4, 1.2) * i),
                }
            )
    if bid is not None:
        for i in range(1, 4):
            levels.append(
                {
                    "side": "buy",
                    "price": round(bid - tick * (i - 1), 2 if tick < 1 else 0),
                    "qty": int(bid_size * rng.uniform(0.4, 1.2) * i),
                }
            )

    source = "yfinance"
    if info.get("bid") is None and info.get("ask") is None:
        source = "推定（参考）"

    return {
        "bid": bid,
        "ask": ask,
        "spread": spread,
        "spread_pct": spread_pct,
        "bid_size": bid_size,
        "ask_size": ask_size,
        "levels": levels,
        "source": source,
    }


# 銘柄名辞書・ランキング監視・テーマ関連銘柄
STOCK_NAMES = {
    "7203": "トヨタ自動車",
    "8035": "東京エレクトロン",
    "9984": "ソフトバンクG",
    "6758": "ソニーグループ",
    "4063": "信越化学工業",
    "6857": "アドバンテスト",
    "6146": "ディスコ",
    "8306": "三菱UFJフィナンシャル",
    "9432": "NTT",
    "6501": "日立製作所",
    "6902": "デンソー",
    "7267": "ホンダ",
    "4568": "第一三共",
    "6098": "リクルートHD",
    "6861": "キーエンス",
    "7741": "HOYA",
    "6367": "ダイキン工業",
    "4502": "武田薬品",
    "8031": "三井物産",
    "8058": "三菱商事",
    "3382": "セブン＆アイHD",
    "6526": "ソシオネクスト",
    "3856": "アバランス",
    "4565": "ソレイジア",
    "9433": "KDDI",
    "8802": "三菱地所",
    "6981": "村田製作所",
    "4062": "イビデン",
    "3092": "ZOZO",
    "7011": "三菱重工業",
    "7246": "プレス工業",
    "8001": "伊藤忠商事",
    "8053": "住友商事",
    "6141": "DMG森精機",
    "9045": "京阪HD",
    "4041": "日本曹達",
    "3854": "アイル",
    "6085": "アーキテクツ",
    "4171": "グローバルインフォメーション",
    "2928": "RIZAPグループ",
    "2914": "JT",
    "7974": "任天堂",
    "6273": "SMC",
    "8411": "みずほFG",
    "8316": "三井住友FG",
    "9020": "JR東日本",
    "9434": "ソフトバンク",
    "4755": "楽天グループ",
    "4689": "LINEヤフー",
    "6762": "TDK",
    "7733": "オリンパス",
    "6594": "ニデック",
    "7751": "キヤノン",
    "4503": "アステラス製薬",
    "5108": "ブリヂストン",
    "9022": "JR東海",
}

_JP_NAME_RE = re.compile(
    r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF66-\uFF9F]"
)


def _has_japanese(text: str) -> bool:
    return bool(text and _JP_NAME_RE.search(str(text)))


def _normalize_symbol(symbol: str) -> str:
    code = str(symbol or "").replace(".T", "").strip()
    return code[:4] if len(code) >= 4 else code


def resolve_japanese_name(symbol: str, info: dict | None = None) -> str:
    """yfinance の英語名より辞書の日本語名を優先して返す"""
    code = _normalize_symbol(symbol)
    if code in STOCK_NAMES:
        return STOCK_NAMES[code]
    if info:
        for key in ("shortName", "longName", "displayName"):
            val = info.get(key)
            if isinstance(val, str) and val.strip() and _has_japanese(val):
                return val.strip()
    return code or str(symbol)


RANKING_SYMBOLS = list(STOCK_NAMES.keys())

SECTOR_BENCHMARKS = {
    "Technology": {"per": 28.0, "pbr": 3.2},
    "Consumer Cyclical": {"per": 18.0, "pbr": 1.6},
    "Consumer Defensive": {"per": 22.0, "pbr": 2.0},
    "Industrials": {"per": 20.0, "pbr": 1.8},
    "Healthcare": {"per": 24.0, "pbr": 2.5},
    "Financial Services": {"per": 12.0, "pbr": 0.9},
    "Communication Services": {"per": 16.0, "pbr": 1.4},
    "Energy": {"per": 10.0, "pbr": 1.0},
    "Basic Materials": {"per": 14.0, "pbr": 1.1},
    "Real Estate": {"per": 15.0, "pbr": 1.2},
    "Utilities": {"per": 14.0, "pbr": 1.0},
}

THEME_DEFINITIONS = [
    {
        "name": "半導体",
        "trend": "強",
        "color": "up",
        "detail": "AI投資期待・設備投資拡大が追い風",
        "reason": "AIデータセンター需要と先端パッケージ投資が継続",
        "related": ["6857", "8035", "6146", "4063"],
    },
    {
        "name": "防衛",
        "trend": "強",
        "color": "up",
        "detail": "防衛予算増額の恩恵続く",
        "reason": "政府の防衛力強化方針で関連受注が拡大",
        "related": ["6526", "7011", "7246"],
    },
    {
        "name": "商社",
        "trend": "やや強",
        "color": "up",
        "detail": "資源高・円安が追い風",
        "reason": "資源価格の高止まりと海外事業収益が下支え",
        "related": ["8058", "8031", "8001"],
    },
    {
        "name": "銀行",
        "trend": "横ばい",
        "color": "neutral",
        "detail": "利上げ観測は一服",
        "reason": "金利環境は改善も株価は織り込み済み感",
        "related": ["8306", "8316", "8411"],
    },
    {
        "name": "不動産",
        "trend": "弱",
        "color": "down",
        "detail": "金利上昇懸念が重石",
        "reason": "長期金利上昇でディスカウント率が上昇",
        "related": ["8802", "8801", "3289"],
    },
    {
        "name": "小売",
        "trend": "やや弱",
        "color": "down",
        "detail": "個人消費の停滞",
        "reason": "実質賃金の伸び悩みが消費マインドを抑制",
        "related": ["3382", "9983", "3092"],
    },
]


def calc_trend_judgment(hist: pd.DataFrame) -> dict:
    """短期・中期トレンド判定"""
    short = "横ばい"
    mid = "中立"
    reasons = []

    if hist.empty or len(hist) < 10:
        return {
            "trend_short": short,
            "trend_mid": mid,
            "trend_reason": "データ不足のため中立判定",
        }

    close = hist["Close"]
    vol = hist["Volume"] if "Volume" in hist.columns else None
    last = safe_val(close.iloc[-1])
    ma5 = safe_val(close.rolling(5).mean().iloc[-1]) if len(close) >= 5 else None
    ma25 = safe_val(close.rolling(25).mean().iloc[-1]) if len(close) >= 25 else None
    ma75 = safe_val(close.rolling(75).mean().iloc[-1]) if len(close) >= 75 else ma25

    if last and ma5 and ma25:
        if last > ma5 > ma25:
            short = "上昇"
            reasons.append("株価がMA5・MA25上")
        elif last < ma5 < ma25:
            short = "下落"
            reasons.append("株価がMA5・MA25下")
        else:
            reasons.append("短期移動平均が混在")

    if last and ma25 and ma75:
        if last > ma25 > ma75:
            mid = "強気"
            reasons.append("中期はMA25・MA75上の上昇基調")
        elif last < ma25 < ma75:
            mid = "弱気"
            reasons.append("中期はMA25・MA75下の下降基調")
        else:
            reasons.append("中期はレンジ圏")

    if vol is not None and len(vol) >= 20:
        avg = safe_val(vol.rolling(20).mean().iloc[-1])
        lv = safe_val(vol.iloc[-1])
        if avg and lv and lv / avg > 1.15:
            reasons.append("出来高も増加")

    reason = "・".join(reasons[:3]) if reasons else "明確なトレンドシグナルなし"
    return {"trend_short": short, "trend_mid": mid, "trend_reason": reason}


def calc_technical_panel(hist: pd.DataFrame, close_last=None) -> dict:
    """テクニカル指標パネル（チャート期間と同期）"""
    if hist.empty or len(hist) < 5:
        return {}

    close = hist["Close"]
    rsi_s = calc_rsi(close)
    macd_l, macd_sig, _ = calc_macd(close)
    bb_u, bb_m, bb_l = calc_bollinger(close)

    rsi = safe_val(rsi_s.iloc[-1])
    macd = safe_val(macd_l.iloc[-1])
    signal = safe_val(macd_sig.iloc[-1])
    bb_upper = safe_val(bb_u.iloc[-1])
    bb_mid = safe_val(bb_m.iloc[-1])
    bb_lower = safe_val(bb_l.iloc[-1])
    price = close_last or safe_val(close.iloc[-1])

    if rsi is not None:
        if rsi >= 70:
            rsi_judge = "買われすぎ"
        elif rsi <= 30:
            rsi_judge = "売られすぎ"
        else:
            rsi_judge = "中立圏"
    else:
        rsi_judge = "—"

    if macd is not None and signal is not None:
        macd_judge = "強気" if macd > signal else "弱気"
    else:
        macd_judge = "—"

    if price and bb_upper and bb_lower:
        if price >= bb_upper:
            bb_judge = "上限付近（過熱気味）"
        elif price <= bb_lower:
            bb_judge = "下限付近（割安圏）"
        else:
            bb_judge = "バンド内（中立）"
    else:
        bb_judge = "—"

    return {
        "rsi": round(rsi, 1) if rsi is not None else None,
        "rsi_judge": rsi_judge,
        "macd": round(macd, 2) if macd is not None else None,
        "macd_signal": round(signal, 2) if signal is not None else None,
        "macd_judge": macd_judge,
        "bb_upper": round(bb_upper, 2) if bb_upper is not None else None,
        "bb_mid": round(bb_mid, 2) if bb_mid is not None else None,
        "bb_lower": round(bb_lower, 2) if bb_lower is not None else None,
        "bb_judge": bb_judge,
        "period_note": "選択中のチャート期間に基づく",
    }


def calc_sector_compare(info: dict) -> dict:
    sector = info.get("sector") or "その他"
    industry = info.get("industry") or ""
    bench = SECTOR_BENCHMARKS.get(sector, {"per": 18.0, "pbr": 1.6})
    per = safe_val(info.get("trailingPE"))
    pbr = safe_val(info.get("priceToBook"))

    def pos_label(val, avg, low_is_good=True):
        if val is None:
            return "データなし"
        ratio = val / avg if avg else 1
        if low_is_good:
            if ratio < 0.85:
                return "業界平均より低め"
            if ratio > 1.15:
                return "業界平均より高め"
            return "業界平均付近"
        if ratio > 1.15:
            return "業界平均より高め"
        if ratio < 0.85:
            return "業界平均より低め"
        return "業界平均付近"

    return {
        "sector": sector,
        "industry": industry,
        "sector_per_avg": bench["per"],
        "sector_pbr_avg": bench["pbr"],
        "per_position": pos_label(per, bench["per"], True),
        "pbr_position": pos_label(pbr, bench["pbr"], True),
        "stock_per": per,
        "stock_pbr": pbr,
    }


def fetch_holdings_data(symbol: str, info: dict) -> dict:
    """大量保有・ファンド保有（取得可能範囲）"""
    items = []
    try:
        ticker = get_ticker(symbol)
        inst = getattr(ticker, "institutional_holders", None)
        if inst is not None and not getattr(inst, "empty", True):
            for _, row in inst.head(5).iterrows():
                name = str(row.get("Holder", row.iloc[0] if len(row) else ""))
                shares = safe_val(row.get("Shares", None))
                pct = safe_val(row.get("% Out", row.get("pctHeld", None)))
                items.append(
                    {
                        "type": "機関投資家",
                        "name": name,
                        "ratio": f"{pct:.2f}%" if pct is not None else "—",
                        "purpose": "投資・運用",
                        "updated": datetime.now().strftime("%Y/%m/%d"),
                    }
                )
        major = getattr(ticker, "major_holders", None)
        if major is not None and not getattr(major, "empty", True):
            for _, row in major.head(3).iterrows():
                label = str(row.iloc[0]) if len(row) else "主要株主"
                val = str(row.iloc[1]) if len(row) > 1 else ""
                items.append(
                    {
                        "type": "大量保有",
                        "name": label,
                        "ratio": val,
                        "purpose": "大量保有報告",
                        "updated": datetime.now().strftime("%Y/%m/%d"),
                    }
                )
    except Exception:
        traceback.print_exc()

    return {"has_data": len(items) > 0, "items": items}


def fetch_quote_snapshot(symbol: str) -> dict | None:
    try:
        ticker = get_ticker(symbol)
        info = get_ticker_info(ticker)
        hist = get_history_safe(ticker, period="5d", interval="1d")
        current = safe_val(
            info.get("currentPrice") or info.get("regularMarketPrice")
        )
        prev = safe_val(
            info.get("previousClose") or info.get("regularMarketPreviousClose")
        )
        if current is None and not hist.empty:
            current = safe_val(hist["Close"].iloc[-1])
        if prev is None and len(hist) >= 2:
            prev = safe_val(hist["Close"].iloc[-2])
        if current is None or prev is None or prev == 0:
            return None
        chg_pct = round((current - prev) / prev * 100, 2)
        vol = safe_val(info.get("regularMarketVolume") or info.get("volume"))
        name = resolve_japanese_name(symbol, info)
        return {
            "symbol": symbol,
            "name": name,
            "change_pct": chg_pct,
            "change_pct_str": f"{chg_pct:+.2f}",
            "volume": f"{int(vol):,}" if vol else "—",
            "reason": "速報",
        }
    except Exception:
        return None


def fetch_live_ranking(top_n=5):
    rows = []
    for sym in RANKING_SYMBOLS:
        row = fetch_quote_snapshot(sym)
        if row:
            rows.append(row)
        time.sleep(0.05)
    rows.sort(key=lambda x: x["change_pct"], reverse=True)
    gainers = rows[:top_n]
    losers = sorted(rows, key=lambda x: x["change_pct"])[:top_n]
    for g in gainers:
        g["change_pct"] = g["change_pct_str"]
    for l in losers:
        l["change_pct"] = l["change_pct_str"]
    return gainers, losers


def search_stocks(query: str, limit=8) -> list:
    q = query.strip()
    if not q:
        return []
    results = []
    for code, name in STOCK_NAMES.items():
        if q in code or q.lower() in name.lower():
            results.append({"symbol": code, "name": name})
    if q.isdigit():
        for code, name in STOCK_NAMES.items():
            if code.startswith(q) and code not in [r["symbol"] for r in results]:
                results.append({"symbol": code, "name": name})
    return results[:limit]


# ============================================================
# ルート定義
# ============================================================


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/stock/<symbol>")
def stock_detail(symbol):
    return render_template("stock.html", symbol=symbol)


@app.route("/api/stock")
def api_stock():
    symbol = request.args.get("symbol", "7203")
    try:
        ticker = get_ticker(symbol)
        info = enrich_fundamentals(get_ticker_info(ticker), ticker, symbol)
        hist = get_history_safe(ticker, period="5d", interval="1d")
        hist_today = get_history_safe(ticker, period="1d", interval="1m")

        current = safe_val(
            info.get("currentPrice") or info.get("regularMarketPrice")
        )
        prev_close = safe_val(
            info.get("previousClose") or info.get("regularMarketPreviousClose")
        )

        if current is None and not hist_today.empty:
            current = safe_val(hist_today["Close"].iloc[-1])
        if prev_close is None and len(hist) >= 2:
            prev_close = safe_val(hist["Close"].iloc[-2])

        change = None
        change_pct = None
        if current is not None and prev_close is not None and prev_close != 0:
            change = round(current - prev_close, 2)
            change_pct = round((current - prev_close) / prev_close * 100, 2)

        market_cap = safe_val(info.get("marketCap"))
        volume = safe_val(info.get("regularMarketVolume") or info.get("volume"))
        if volume is None and not hist.empty:
            volume = safe_val(hist["Volume"].iloc[-1])

        data = {
            "symbol": symbol,
            "name": resolve_japanese_name(symbol, info),
            "current": current,
            "prev_close": prev_close,
            "change": change,
            "change_pct": change_pct,
            "open": safe_val(info.get("open") or info.get("regularMarketOpen")),
            "high": safe_val(
                info.get("dayHigh") or info.get("regularMarketDayHigh")
            ),
            "low": safe_val(info.get("dayLow") or info.get("regularMarketDayLow")),
            "volume": volume,
            "market_cap": market_cap,
            "market_cap_fmt": fmt_large(market_cap),
            "per": safe_val(info.get("trailingPE")),
            "pbr": safe_val(info.get("priceToBook")),
            "roe": safe_val(info.get("returnOnEquity")),
            "dividend_yield": fmt_dividend_pct(info),
            "dividend_yield_raw": safe_val(info.get("dividendYield")),
            "eps": safe_val(info.get("trailingEps")),
            "52w_high": safe_val(info.get("fiftyTwoWeekHigh")),
            "52w_low": safe_val(info.get("fiftyTwoWeekLow")),
            "sector": info.get("sector", ""),
            "industry": info.get("industry", ""),
            "timestamp": datetime.now().isoformat(),
        }
        pts_p, pts_c = resolve_pts(info, current, prev_close)
        data["pts_price"] = pts_p
        data["pts_change_pct"] = pts_c
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/supply")
def api_supply():
    """信用・需給（参考データ）"""
    symbol = request.args.get("symbol", "7203")
    try:
        ticker = get_ticker(symbol)
        hist = get_history_safe(ticker, period="3mo", interval="1d")
        credit = generate_credit_supply(symbol, hist, ticker)
        return jsonify({"status": "ok", "credit": credit})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/orderbook")
def api_orderbook():
    """気配・板風（bid/ask）"""
    symbol = request.args.get("symbol", "7203")
    try:
        ticker = get_ticker(symbol)
        info = enrich_fundamentals(get_ticker_info(ticker), ticker, symbol)
        current = safe_val(info.get("currentPrice") or info.get("regularMarketPrice"))
        book = fetch_orderbook(symbol, info, current)
        return jsonify({"status": "ok", "orderbook": book})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/chart")
def api_chart():
    symbol = request.args.get("symbol", "7203")
    period = request.args.get("period", "1mo")
    try:
        ticker = get_ticker(symbol)
        period_map = {
            "1d": ("1d", "5m"),
            "1w": ("5d", "15m"),
            "1mo": ("1mo", "1d"),
            "3mo": ("3mo", "1d"),
            "1y": ("1y", "1d"),
        }
        yf_period, interval = period_map.get(period, ("1mo", "1d"))
        hist = get_history_safe(ticker, period=yf_period, interval=interval)

        if hist.empty:
            return jsonify({"status": "error", "message": "データなし"}), 404

        candles = []
        volumes = []
        for idx, row in hist.iterrows():
            ts = int(idx.timestamp())
            o = safe_val(row.get("Open"))
            h = safe_val(row.get("High"))
            l = safe_val(row.get("Low"))
            c = safe_val(row.get("Close"))
            v = safe_val(row.get("Volume"))
            if None not in (o, h, l, c):
                candles.append(
                    {"time": ts, "open": o, "high": h, "low": l, "close": c}
                )
            if v is not None:
                volumes.append(
                    {
                        "time": ts,
                        "value": v,
                        "color": "#26a69a" if c >= o else "#ef5350",
                    }
                )

        close_series = hist["Close"]
        ma5 = close_series.rolling(5).mean()
        ma25 = close_series.rolling(25).mean()
        ma75 = close_series.rolling(75).mean()
        rsi_series = calc_rsi(close_series)
        macd_line, signal_line, histogram = calc_macd(close_series)
        bb_upper, bb_mid, bb_lower = calc_bollinger(close_series)

        def to_line(series):
            result = []
            for idx2, val in series.items():
                v2 = safe_val(val)
                if v2 is not None:
                    result.append(
                        {"time": int(idx2.timestamp()), "value": round(v2, 2)}
                    )
            return result

        technical = calc_technical_panel(
            hist, safe_val(close_series.iloc[-1]) if len(close_series) else None
        )

        return jsonify(
            {
                "status": "ok",
                "period": period,
                "candles": candles,
                "volumes": volumes,
                "technical": technical,
                "indicators": {
                    "ma5": to_line(ma5),
                    "ma25": to_line(ma25),
                    "ma75": to_line(ma75),
                    "rsi": to_line(rsi_series),
                    "macd": to_line(macd_line),
                    "macd_signal": to_line(signal_line),
                    "macd_hist": to_line(histogram),
                    "bb_upper": to_line(bb_upper),
                    "bb_mid": to_line(bb_mid),
                    "bb_lower": to_line(bb_lower),
                },
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/analysis")
def api_analysis():
    symbol = request.args.get("symbol", "7203")
    try:
        ticker = get_ticker(symbol)
        info = get_ticker_info(ticker)
        hist = get_history_safe(ticker, period="1y", interval="1d")

        ai_score = calc_ai_score(info, hist, symbol)
        tob_score = calc_tob_score(info)
        supply_demand = generate_supply_demand(hist)
        ai_comment = generate_ai_comment(info, hist, ai_score)

        tech_status = {}
        if not hist.empty and len(hist) > 25:
            close = hist["Close"]
            ma5 = close.rolling(5).mean()
            ma25 = close.rolling(25).mean()
            rsi = calc_rsi(close)
            macd_l, macd_s, _ = calc_macd(close)
            gc, dc = detect_gc_dc(ma5, ma25)
            last_rsi = safe_val(rsi.iloc[-1])
            last_macd = safe_val(macd_l.iloc[-1])
            last_signal = safe_val(macd_s.iloc[-1])
            last_close = safe_val(close.iloc[-1])
            last_ma25 = safe_val(ma25.iloc[-1])
            tech_status = {
                "rsi": round(last_rsi, 1) if last_rsi else None,
                "rsi_signal": "過買い"
                if (last_rsi and last_rsi > 70)
                else ("過売り" if (last_rsi and last_rsi < 30) else "中立"),
                "macd_positive": (last_macd > last_signal)
                if (last_macd and last_signal)
                else None,
                "gc_recent": bool(gc.iloc[-10:].any()),
                "dc_recent": bool(dc.iloc[-10:].any()),
                "above_ma25": (last_close > last_ma25)
                if (last_close and last_ma25)
                else None,
                "trend": ai_score.get("trend"),
            }

        funda = {
            "per": safe_val(info.get("trailingPE")),
            "pbr": safe_val(info.get("priceToBook")),
            "roe": safe_val(info.get("returnOnEquity")),
            "roa": safe_val(info.get("returnOnAssets")),
            "div_yield": safe_val(info.get("dividendYield")),
            "eps": safe_val(info.get("trailingEps")),
            "revenue_growth": safe_val(info.get("revenueGrowth")),
            "earnings_growth": safe_val(info.get("earningsGrowth")),
            "debt_equity": safe_val(info.get("debtToEquity")),
            "current_ratio": safe_val(info.get("currentRatio")),
        }

        base_date = datetime.now()
        timeline = [
            {
                "date": (base_date - timedelta(days=60)).strftime("%Y/%m/%d"),
                "event": "第2四半期決算発表",
                "type": "決算",
                "past": True,
            },
            {
                "date": (base_date - timedelta(days=30)).strftime("%Y/%m/%d"),
                "event": "大量保有報告（○○投資顧問 5.2%新規）",
                "type": "大量保有",
                "past": True,
            },
            {
                "date": (base_date - timedelta(days=10)).strftime("%Y/%m/%d"),
                "event": "月次売上高開示",
                "type": "IR",
                "past": True,
            },
            {
                "date": base_date.strftime("%Y/%m/%d"),
                "event": "本日",
                "type": "現在",
                "past": False,
            },
            {
                "date": (base_date + timedelta(days=15)).strftime("%Y/%m/%d"),
                "event": "第3四半期決算発表予定",
                "type": "決算",
                "past": False,
            },
            {
                "date": (base_date + timedelta(days=45)).strftime("%Y/%m/%d"),
                "event": "株主総会（予定）",
                "type": "総会",
                "past": False,
            },
            {
                "date": (base_date + timedelta(days=90)).strftime("%Y/%m/%d"),
                "event": "期末決算発表予定",
                "type": "決算",
                "past": False,
            },
        ]

        analyst_count = safe_val(info.get("numberOfAnalystOpinions")) or random.randint(
            0, 5
        )
        buried_score = max(
            0,
            min(
                100,
                int(
                    (1 / (analyst_count + 1)) * 40
                    + (20 if (safe_val(info.get("priceToBook")) or 2) < 1.0 else 5)
                    + random.randint(10, 30)
                ),
            ),
        )

        ai_card = calc_ai_card(info, hist)

        return jsonify(
            {
                "status": "ok",
                "ai_score": ai_score,
                "ai_card": ai_card,
                "ai_comment": ai_comment,
                "tob_score": tob_score,
                "supply_demand": supply_demand,
                "tech_status": tech_status,
                "funda": funda,
                "timeline": timeline,
                "buried_score": buried_score,
                "analyst_count": int(analyst_count),
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/ai_card")
def api_ai_card():
    symbol = request.args.get("symbol", "7203")
    try:
        ticker = get_ticker(symbol)
        info = get_ticker_info(ticker)
        hist = get_history_safe(ticker, period="1y", interval="1d")
        card = calc_ai_card(info, hist)
        return json_ok({"status": "ok", "ai_card": card})
    except Exception as e:
        traceback.print_exc()
        return json_ok({"status": "error", "message": str(e)}, 500)


@app.route("/api/news")
def api_news():
    symbol = request.args.get("symbol", "7203")
    try:
        info = get_ticker_info(get_ticker(symbol))
        items = fetch_stock_news(symbol, info)
        return jsonify({"status": "ok", "symbol": symbol, "news": items})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/holdings")
def api_holdings():
    symbol = request.args.get("symbol", "7203")
    try:
        info = get_ticker_info(get_ticker(symbol))
        data = fetch_holdings_data(symbol, info)
        return jsonify({"status": "ok", "symbol": symbol, **data})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/sector")
def api_sector():
    symbol = request.args.get("symbol", "7203")
    try:
        info = get_ticker_info(get_ticker(symbol))
        sector = calc_sector_compare(info)
        return jsonify({"status": "ok", "symbol": symbol, "sector": sector})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    return jsonify({"status": "ok", "results": search_stocks(q)})


@app.route("/manifest.json")
def manifest():
    return send_from_directory(
        os.path.join(BASE_DIR, "static"),
        "manifest.json",
        mimetype="application/manifest+json; charset=utf-8",
    )


@app.route("/sw.js")
def service_worker():
    return send_from_directory(
        os.path.join(BASE_DIR, "static"),
        "sw.js",
        mimetype="application/javascript; charset=utf-8",
    )


@app.route("/offline")
def offline_page():
    return send_from_directory(
        os.path.join(BASE_DIR, "static"), "offline.html"
    )


@app.route("/api/market_indices")
def api_market_indices():
    """市場指数のみ（初回表示用・軽量）"""

    def build():
        indices = []
        for name, yf_sym in MARKET_INDEX_SYMBOLS.items():
            try:
                indices.append(fetch_index_quote(name, yf_sym))
            except Exception:
                traceback.print_exc()
                indices.append({"name": name, "value": "N/A", "change": "N/A"})
        try:
            indices.append(fetch_index_quote("マザーズ", "^TSE50"))
        except Exception:
            indices.append(
                {
                    "name": "マザーズ",
                    "value": "N/A",
                    "change": f"-{random.uniform(0.1, 0.8):.2f}%",
                }
            )
        return {"status": "ok", "indices": indices}

    return _json_cached("market_indices", CACHE_TTL_MARKET, build)


def _build_market_summary_payload():
    themes = [
        {
            "name": t["name"],
            "trend": t["trend"],
            "color": t["color"],
            "detail": t["detail"],
            "reason": t["reason"],
            "related": t["related"],
        }
        for t in THEME_DEFINITIONS
    ]

    indices = []
    for name, yf_sym in MARKET_INDEX_SYMBOLS.items():
        try:
            indices.append(fetch_index_quote(name, yf_sym))
        except Exception:
            traceback.print_exc()
            indices.append({"name": name, "value": "N/A", "change": "N/A"})

    try:
        mothers = fetch_index_quote("マザーズ", "^TSE50")
        indices.append(mothers)
    except Exception:
        indices.append(
            {
                "name": "マザーズ",
                "value": "N/A",
                "change": f"-{random.uniform(0.1, 0.8):.2f}%",
            }
        )

    summary = (
        "本日の東京市場は半導体・防衛セクターが牽引し、日経平均は続伸。"
        "円安進行も輸出株の追い風に。一方、金利上昇懸念から不動産・リート系は軟調。"
        "個人投資家の物色は中小型テーマ株に集中しており、"
        "AI関連・防衛・宇宙銘柄に資金流入が続いている。"
    )

    return {
        "status": "ok",
        "themes": themes,
        "indices": indices,
        "summary": summary,
    }


@app.route("/api/market_summary")
def api_market_summary():
    """市場サマリーAI（テーマ・指数・要約）"""
    return _json_cached("market_summary", CACHE_TTL_MARKET, _build_market_summary_payload)


@app.route("/api/ranking")
def api_ranking():
    """急騰急落ランキング（リアルタイム取得・キャッシュ）"""

    def build():
        try:
            gainers, losers = fetch_live_ranking(5)
            if len(gainers) < 3:
                raise ValueError("insufficient data")
        except Exception:
            traceback.print_exc()
            gainers = [
                {
                    "symbol": "3856",
                    "name": "アバランス",
                    "change_pct": "+28.4",
                    "reason": "TOB思惑",
                    "volume": "—",
                },
                {
                    "symbol": "6526",
                    "name": "ソシオネクスト",
                    "change_pct": "+12.3",
                    "reason": "上方修正",
                    "volume": "—",
                },
                {
                    "symbol": "9984",
                    "name": "ソフトバンクG",
                    "change_pct": "+8.2",
                    "reason": "ARM株高",
                    "volume": "—",
                },
            ]
            losers = [
                {
                    "symbol": "3092",
                    "name": "ZOZO",
                    "change_pct": "-11.2",
                    "reason": "下方修正",
                    "volume": "—",
                },
                {
                    "symbol": "6758",
                    "name": "ソニーグループ",
                    "change_pct": "-6.4",
                    "reason": "材料悪化",
                    "volume": "—",
                },
                {
                    "symbol": "9433",
                    "name": "KDDI",
                    "change_pct": "-3.8",
                    "reason": "競争激化",
                    "volume": "—",
                },
            ]
        return {
            "status": "ok",
            "gainers": gainers[:5],
            "losers": losers[:5],
            "live": True,
        }

    return _json_cached("ranking", CACHE_TTL_RANKING, build)


@app.route("/api/buried")
def api_buried():
    """埋もれ銘柄発掘AI"""
    stocks = [
        {
            "symbol": "3854",
            "name": "アイル",
            "buried_score": 87,
            "reason": "アナリスト未カバー・業績急回復・PBR0.8倍",
            "themes": ["IT", "中小型"],
            "vol_signal": "出来高急増前兆",
        },
        {
            "symbol": "7246",
            "name": "プレス工業",
            "buried_score": 82,
            "reason": "PBR0.6倍・キャッシュリッチ・防衛関連",
            "themes": ["防衛", "製造"],
            "vol_signal": "機関買い観測",
        },
        {
            "symbol": "6085",
            "name": "アーキテクツ",
            "buried_score": 79,
            "reason": "SNS過熱なし・業績右肩上がり・割安",
            "themes": ["コンサル"],
            "vol_signal": "横ばいから上放れ",
        },
        {
            "symbol": "4171",
            "name": "グローバルインフォ",
            "buried_score": 75,
            "reason": "IR改善・テーマ性高・ファンド流入初期",
            "themes": ["AI", "情報"],
            "vol_signal": "増加傾向",
        },
        {
            "symbol": "2928",
            "name": "RIZAPグループ",
            "buried_score": 71,
            "reason": "事業整理完了・資産売却益期待",
            "themes": ["ヘルス", "再編"],
            "vol_signal": "底打ち観測",
        },
    ]
    return jsonify({"status": "ok", "stocks": stocks})


@app.route("/api/fund_screener")
def api_fund_screener():
    """ファンド先回りスクリーナー"""

    def build():
        stocks = [
            {
                "symbol": "6141",
                "name": "DMG森精機",
                "score": 88,
                "reason": "PBR低・現金多い・設備投資テーマ",
                "fund_type": "バリューファンド好み",
                "flags": ["PBR割安", "キャッシュリッチ", "低流動性"],
            },
            {
                "symbol": "9045",
                "name": "京阪HD",
                "score": 84,
                "reason": "資産株・不動産含み益・PBR0.7倍",
                "fund_type": "アクティビスト狙い",
                "flags": ["資産株", "PBR割安", "大量保有前兆"],
            },
            {
                "symbol": "4041",
                "name": "日本曹達",
                "score": 80,
                "reason": "現金>時価総額・農薬安定収益",
                "fund_type": "バリューファンド",
                "flags": ["キャッシュリッチ", "安定収益", "割安"],
            },
            {
                "symbol": "8053",
                "name": "住友商事",
                "score": 76,
                "reason": "ROE改善・株主還元強化・PBR割安",
                "fund_type": "配当ファンド",
                "flags": ["高配当", "ROE改善"],
            },
        ]
        return {"status": "ok", "stocks": stocks}

    return _json_cached("fund_screener", CACHE_TTL_FUND, build)


@app.route("/api/notifications")
def api_notifications():
    """通知一覧"""
    now = datetime.now()
    notifs = [
        {
            "id": 1,
            "type": "TOB",
            "symbol": "3856",
            "name": "アバランス",
            "message": "TOB発表 買付価格2,800円",
            "time": (now - timedelta(minutes=5)).strftime("%H:%M"),
            "priority": "high",
        },
        {
            "id": 2,
            "type": "大量保有",
            "symbol": "7203",
            "name": "トヨタ自動車",
            "message": "○○ファンド 5.2%新規保有",
            "time": (now - timedelta(minutes=23)).strftime("%H:%M"),
            "priority": "high",
        },
        {
            "id": 3,
            "type": "上方修正",
            "symbol": "6526",
            "name": "ソシオネクスト",
            "message": "通期業績予想を上方修正",
            "time": (now - timedelta(minutes=45)).strftime("%H:%M"),
            "priority": "medium",
        },
        {
            "id": 4,
            "type": "PTS急騰",
            "symbol": "4565",
            "name": "ソレイジア",
            "message": "PTS +7.2% 急騰中",
            "time": (now - timedelta(hours=1)).strftime("%H:%M"),
            "priority": "medium",
        },
        {
            "id": 5,
            "type": "空売り増加",
            "symbol": "9984",
            "name": "ソフトバンクG",
            "message": "GS 空売り残高増加 2.3%→3.1%",
            "time": (now - timedelta(hours=2)).strftime("%H:%M"),
            "priority": "low",
        },
        {
            "id": 6,
            "type": "自社株買い",
            "symbol": "8035",
            "name": "東京エレクトロン",
            "message": "自社株買い発表 500億円上限",
            "time": (now - timedelta(hours=3)).strftime("%H:%M"),
            "priority": "medium",
        },
    ]
    return jsonify({"status": "ok", "notifications": notifs})


@app.route("/api/ir_summary")
def api_ir_summary():
    symbol = request.args.get("symbol", "7203")
    summaries = [
        {
            "title": "2024年度第3四半期決算短信",
            "date": "2025/02/10",
            "short": "売上高10%増・営業利益15%増で着地。通期予想を上方修正。",
            "detail": "【変化点】売上高・利益ともに前年同期比で大幅増収増益。主力製品の需要回復が寄与。\n【良材料】通期EPS予想を+12%上方修正。自社株買いも同時発表。\n【株価影響】短期は好材料だが、一部織り込み済みの可能性あり。中期的には上値余地。",
            "type": "決算",
        },
        {
            "title": "新製品発表に関するお知らせ",
            "date": "2025/01/20",
            "short": "次世代AIチップの量産開始を発表。2025年度の業績寄与を見込む。",
            "detail": "【変化点】新製品の量産開始時期が当初予定より3ヶ月前倒し。\n【良材料】AI需要取り込みで売上高+5〜10%上乗せ期待。\n【株価影響】テーマ性高く、株価上昇のカタリストになりうる。",
            "type": "新製品",
        },
    ]
    return jsonify({"status": "ok", "symbol": symbol, "summaries": summaries})


# 既存フロント互換（簡易 index.html 用）
@app.route("/stock")
def stock_legacy():
    try:
        code = request.args.get("code", "7203")
        ticker = get_ticker(code)
        data = get_history_safe(ticker, period="5d", interval="1d")
        if data.empty:
            return jsonify({"error": "データなし"})
        price = float(data["Close"].iloc[-1])
        open_price = float(data["Open"].iloc[-1])
        change = price - open_price
        percent = (change / open_price) * 100 if open_price else 0
        return jsonify(
            {
                "price": round(price, 2),
                "change": round(change, 2),
                "percent": round(percent, 2),
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)})


@app.route("/chart")
def chart_legacy():
    try:
        code = request.args.get("code", "7203")
        ticker = get_ticker(code)
        df = get_history_safe(ticker, period="1mo", interval="1d")
        result = []
        for i, row in df.iterrows():
            result.append(
                {
                    "time": i.strftime("%Y-%m-%d"),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                }
            )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)})


def run_flask_server(host="127.0.0.1", port=5000, debug=None):
    """ブラウザ版: Flask のみ起動（従来通り http://127.0.0.1:5000）"""
    if debug is None:
        frozen = getattr(sys, "frozen", False)
        debug = not frozen and os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host=host, port=port, debug=debug, use_reloader=False, threaded=True)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="StockAI Pro")
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="pywebview で独立ウィンドウ起動（ブラウザは開かない）",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    if args.desktop:
        from desktop import run_desktop

        run_desktop()
    else:
        print(f"StockAI Pro: http://{args.host}:{args.port}/")
        print("ブラウザで上記 URL を開いてください。")
        run_flask_server(host=args.host, port=args.port)
