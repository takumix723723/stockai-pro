"""Verify orderbook API structure for SBI-style board."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app

SYMBOLS = ["7203", "8035"]


def check_prices_absolute(levels, tick=1.0):
    """Prices must be absolute values, not offsets."""
    for lv in levels:
        p = lv["price"]
        if p is None or p <= 0:
            return False, f"invalid price {p}"
        if abs(p) < tick:
            return False, f"price looks like offset: {p}"
    return True, "ok"


with app.test_client() as client:
    all_ok = True
    for sym in SYMBOLS:
        resp = client.get(f"/api/orderbook?symbol={sym}")
        data = resp.get_json()
        print(f"\n=== {sym} ===")
        if data.get("status") != "ok":
            print(f"ERROR: {data.get('message')}")
            all_ok = False
            continue

        ob = data["orderbook"]
        sells = ob.get("sells") or []
        buys = ob.get("buys") or []
        depth = ob.get("depth", 0)

        checks = [
            ("depth", depth == 10),
            ("sell_count", len(sells) == 10),
            ("buy_count", len(buys) == 10),
            ("has_bid_ask", ob.get("bid") is not None and ob.get("ask") is not None),
            ("has_totals", ob.get("total_sell_qty") is not None and ob.get("total_buy_qty") is not None),
            ("has_market", ob.get("market_sell_qty") is not None and ob.get("market_buy_qty") is not None),
            ("sells_desc", all(sells[i]["price"] >= sells[i + 1]["price"] for i in range(len(sells) - 1)) if len(sells) > 1 else True),
            ("buys_desc", all(buys[i]["price"] >= buys[i + 1]["price"] for i in range(len(buys) - 1)) if len(buys) > 1 else True),
            ("current_between", (ob.get("current") or 0) >= (buys[0]["price"] if buys else 0) - 5 if buys else True),
        ]

        ok_abs_s, msg_s = check_prices_absolute(sells)
        ok_abs_b, msg_b = check_prices_absolute(buys)
        checks.append(("absolute_sell_prices", ok_abs_s))
        checks.append(("absolute_buy_prices", ok_abs_b))

        for name, ok in checks:
            status = "OK" if ok else "FAIL"
            print(f"  {name}: {status}")
            if not ok:
                all_ok = False

        if sells:
            print(f"  sell sample: {sells[0]['price']} ({sells[0]['qty']}) .. {sells[-1]['price']}")
        if buys:
            print(f"  buy sample:  {buys[0]['price']} ({buys[0]['qty']}) .. {buys[-1]['price']}")
        print(f"  current: {ob.get('current')}  bid: {ob.get('bid')}  ask: {ob.get('ask')}")

    print("\n" + ("ALL OK" if all_ok else "SOME FAILED"))
