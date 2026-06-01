"""Verify chart candle intervals for 7203 and 6146."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app, CHART_PERIOD_MAP, CHART_BASELINE_BARS

SYMBOLS = ["7203", "6146"]
PERIODS = list(CHART_PERIOD_MAP.keys())
EXPECTED_GAP = {
    "5m": 300,
    "15m": 900,
    "1D": 86400,
    "1w": 604800,
    "1M": 86400,
    "6M": 86400,
    "1Y": 86400,
}
BAR_RANGES = {
    "5m": (40, 78),
    "15m": (30, 80),
    "1D": (50, 280),
    "1w": (20, 280),
    "1M": (10, 26),
    "6M": (40, 140),
    "1Y": (50, 280),
}

with app.test_client() as client:
    all_ok = True
    for sym in SYMBOLS:
        print(f"\n=== {sym} ===")
        for period in PERIODS:
            cfg = CHART_PERIOD_MAP[period]
            r = client.get(f"/api/chart?symbol={sym}&period={period}")
            j = r.get_json()
            candles = j.get("candles") or []
            n = len(candles)
            lo, hi = BAR_RANGES.get(period, (1, 9999))
            ok = (
                j.get("status") == "ok"
                and j.get("interval") == cfg["interval"]
                and j.get("label") == cfg["label"]
                and lo <= n <= hi
            )
            gap_info = ""
            if n > 1 and period in EXPECTED_GAP:
                gaps = [candles[i + 1]["time"] - candles[i]["time"] for i in range(n - 1)]
                med = sorted(gaps)[len(gaps) // 2]
                exp = EXPECTED_GAP[period]
                gap_ok = abs(med - exp) < exp * 0.25
                gap_info = f" median_gap={med} expect~{exp} {'gapOK' if gap_ok else 'gapFAIL'}"
                if not gap_ok and period in ("5m", "15m"):
                    ok = False
            vb = j.get("visible_bars")
            bb = j.get("baseline_bars")
            meta = f" visible={vb} baseline={bb}"
            print(f"  {cfg['label']:5} interval={j.get('interval')} n={n} {'OK' if ok else 'FAIL'}{gap_info}{meta}")
            if not ok:
                all_ok = False
    assert CHART_BASELINE_BARS == 52
    print("\n" + ("ALL OK" if all_ok else "SOME FAILED"))
    if not all_ok:
        sys.exit(1)
