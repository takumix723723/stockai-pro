"""AIファンド — 市場ベンチマーク比較（仮想運用・実注文なし）"""
from __future__ import annotations

import traceback
from datetime import datetime, timedelta

BENCHMARK_SYMBOLS = {
    "日経平均": "^N225",
    "TOPIX": "1306.T",
}


def _period_return(deps: dict, yf_symbol: str, start_date: str, end_date: str) -> dict | None:
    try:
        import yfinance as yf

        get_history_safe = deps["get_history_safe"]
        safe_val = deps["safe_val"]

        ticker = yf.Ticker(yf_symbol)
        hist = get_history_safe(ticker, period="1y", interval="1d")
        if hist.empty:
            return None

        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")

        def _close_on_or_after(target):
            for i in range(len(hist)):
                d = hist.index[i].to_pydatetime().replace(tzinfo=None)
                if d.date() >= target.date():
                    return safe_val(hist["Close"].iloc[i])
            return safe_val(hist["Close"].iloc[-1])

        def _close_on_or_before(target):
            for i in range(len(hist) - 1, -1, -1):
                d = hist.index[i].to_pydatetime().replace(tzinfo=None)
                if d.date() <= target.date():
                    return safe_val(hist["Close"].iloc[i])
            return safe_val(hist["Close"].iloc[0])

        p0 = _close_on_or_before(start_dt)
        p1 = _close_on_or_after(end_dt)
        if p0 is None or p1 is None or p0 == 0:
            return None
        chg = round((p1 - p0) / p0 * 100, 2)
        return {"start": p0, "end": p1, "change_pct": chg}
    except Exception:
        traceback.print_exc()
        return None


def build_benchmark_payload(deps: dict, start_date: str | None, end_date: str | None) -> dict:
    end = end_date or datetime.now().strftime("%Y-%m-%d")
    if not start_date:
        start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    benchmarks = []
    for name, sym in BENCHMARK_SYMBOLS.items():
        row = _period_return(deps, sym, start_date, end)
        if row:
            benchmarks.append({"name": name, "symbol": sym, **row})
        else:
            benchmarks.append({"name": name, "symbol": sym, "change_pct": None})

    return {
        "status": "ok",
        "start_date": start_date,
        "end_date": end,
        "benchmarks": benchmarks,
        "disclaimer": "※仮想シミュレーション用の市場比較です。実際の投資成果を保証するものではありません。",
    }
