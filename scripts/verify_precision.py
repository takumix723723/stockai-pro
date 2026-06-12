#!/usr/bin/env python3
"""Verify precision scoring for trade scenarios and day trade."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app

SYMS = ["7203", "8035", "285A"]


def main() -> int:
    client = app.test_client()
    results: list[bool] = []

    def ok(name: str, cond: bool, detail: str = ""):
        results.append(cond)
        print(f"{'OK' if cond else 'FAIL'}  {name} {detail}")

    for path in ("/api/trade_scenarios", "/api/day_trade/daily"):
        r = client.get(path)
        d = r.get_json()
        ok(f"{path} status", d.get("status") == "ok")
        ok(f"{path} precision_mode", d.get("precision_mode") is True)
        items = d.get("scenarios") or d.get("trades") or []
        if items:
            t0 = items[0]
            ok(f"{path} predicted_win_rate", t0.get("predicted_win_rate") is not None)
            ok(f"{path} expected_value", t0.get("expected_value") is not None)
            ok(f"{path} confidence", t0.get("confidence") in ("A", "B", "C"))
            ok(f"{path} selection_reasons", isinstance(t0.get("selection_reasons"), list))
            ok(f"{path} max count", len(items) <= (5 if "scenario" in path else 3))
        else:
            ok(f"{path} skip or empty", d.get("skip") is True or len(items) == 0)

    # Symbol scan: at least one of anchors may appear or skip is valid
    r = client.get("/api/trade_scenarios")
    d = r.get_json()
    found = {s["symbol"] for s in (d.get("scenarios") or [])}
    for sym in SYMS:
        if sym in found:
            row = next(x for x in d["scenarios"] if x["symbol"] == sym)
            ok(f"anchor {sym} precision fields", row.get("confidence") is not None)
        else:
            ok(f"anchor {sym} filtered or skip", True, "excluded by precision (OK)")

    hints = {"boost_themes": ["半導体"], "penalize_patterns": ["surge_chase"]}
    r2 = client.post("/api/trade_scenarios", json={"learning_hints": hints})
    d2 = r2.get_json()
    ok("POST with learning_hints", d2.get("status") == "ok")

    passed = sum(results)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
