"""Verify condition-specific expected value analysis."""
import json
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.precision_scoring import _learning_ev_adj

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5072"


def api_post(path: str, body: dict, timeout: int = 180) -> dict:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def main() -> int:
    results = []

    def ok(name: str, cond: bool, detail: str = ""):
        results.append(cond)
        print(f"{'OK' if cond else 'FAIL'}  {name} {detail}")

    signals = {"ma5_up": True, "volume_surge": True, "surge_chase": False}
    hints_pos = {
        "condition_ev": {
            "ma5_up": {"count": 5, "expected_value_pct": 1.9, "win_rate": 64},
            "volume_surge": {"count": 4, "expected_value_pct": 3.1, "win_rate": 72},
            "surge_chase": {"count": 6, "expected_value_pct": -2.2, "win_rate": 38},
        },
        "boost_patterns": ["volume_surge", "ma5_up"],
        "penalize_patterns": ["surge_chase"],
    }
    adj_pos, notes_pos = _learning_ev_adj(signals, ["半導体"], hints_pos)
    ok("ev adj positive boost", adj_pos > 0, f"adj={adj_pos}")

    signals_bad = {"surge_chase": True, "ma5_up": False}
    hints_neg = {
        "condition_ev": {
            "surge_chase": {"count": 8, "expected_value_pct": -2.2, "win_rate": 38},
        },
        "penalize_patterns": ["surge_chase"],
    }
    adj_neg, _ = _learning_ev_adj(signals_bad, [], hints_neg)
    ok("ev adj negative penalty", adj_neg < 0, f"adj={adj_neg}")

    hints = {
        "learning_hints": {
            "condition_ev": hints_pos["condition_ev"],
            "boost_patterns": ["volume_surge"],
            "penalize_patterns": ["surge_chase"],
        }
    }
    sc = api_post("/api/trade_scenarios", hints)
    ok("scenarios api with condition_ev", sc.get("status") == "ok")
    dt = api_post("/api/day_trade/daily", hints)
    ok("daytrade api with condition_ev", dt.get("status") == "ok")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=120000)

        page.evaluate("""() => {
          localStorage.setItem('stockai_ai_day_trade', JSON.stringify({
            version: 2,
            daily_records: [{
              date: '2025-05-01',
              total_pnl: 5000,
              trades: [
                { symbol: '7203', final_pnl: 8000, final_pnl_rate: 5.2, status: 'target_hit',
                  signals: { ma5_up: true, volume_surge: true }, themes: ['半導体'] },
                { symbol: '6857', final_pnl: 6000, final_pnl_rate: 4.1, status: 'target_hit',
                  signals: { ma5_up: true, volume_surge: true }, themes: ['半導体'] },
                { symbol: '8035', final_pnl: -3000, final_pnl_rate: -2.8, status: 'stop_hit',
                  signals: { surge_chase: true } },
                { symbol: '9984', final_pnl: -2500, final_pnl_rate: -2.5, status: 'stop_hit',
                  signals: { surge_chase: true } },
                { symbol: '285A', final_pnl: 2000, final_pnl_rate: 1.4, status: 'target_hit',
                  signals: { ma15_up: true } },
                { symbol: '4063', final_pnl: 1500, final_pnl_rate: 1.2, status: 'target_hit',
                  signals: { ma15_up: true } },
              ],
            }],
          }));
          localStorage.setItem('stockai_ai_trade_scenarios', JSON.stringify({
            version: 2, items: [], resolved: [],
          }));
        }""")

        stats = page.evaluate("""() => {
          const trades = window.ConditionEV.collectAllTrades();
          return window.ConditionEV.computeAllConditionStats(trades);
        }""")
        ok("condition ev stats rows", len(stats.get("rows") or []) >= 3)
        vol = next((r for r in stats["rows"] if r["key"] == "volume_surge"), None)
        ok("volume_surge ev computed", vol and vol.get("expected_value_pct") is not None)

        page.click("#openDayTradePanel")
        page.wait_for_selector("#dayTradeList .dt-tabs", timeout=60000)
        page.locator('.dt-tab[data-dt-mode="growth"]').click()
        page.wait_for_selector("#dayTradeList .dt-ev-card", timeout=60000)
        ok("growth report ev cards", page.locator("#dayTradeList .dt-ev-card").count() >= 1)
        ok("growth report ev ranking", page.locator("#dayTradeList .dt-ev-ranking").count() >= 1)
        text = page.locator("#dayTradeList").inner_text()
        ok("growth report ev section title", "条件別期待値分析" in text)
        ok("growth report ranking title", "期待値ランキング" in text)

        hintsOut = page.evaluate("""() => {
          const store = window.DayTrade.getStore();
          return window.DayTrade.extractLearningHints(store);
        }""")
        ok("learning hints condition_ev", bool((hintsOut or {}).get("condition_ev")))
        ok("learning hints boost_patterns", len((hintsOut or {}).get("boost_patterns") or []) >= 1)

        browser.close()

    passed = sum(results)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
