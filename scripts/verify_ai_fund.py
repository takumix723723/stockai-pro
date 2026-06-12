"""Verify AI Fund API and UI."""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5070"


def api_get(path: str, timeout: int = 180) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


def main() -> int:
    results = []

    def ok(name: str, cond: bool, detail: str = ""):
        results.append(cond)
        print(f"{'OK' if cond else 'FAIL'}  {name} {detail}")

    bench = api_get("/api/ai_fund/benchmark?start=2025-01-01&end=2025-06-01")
    ok("benchmark api status", bench.get("status") == "ok")
    ok("benchmarks list", len(bench.get("benchmarks") or []) >= 2)
    names = {b.get("name") for b in bench.get("benchmarks") or []}
    ok("nikkei present", "日経平均" in names)
    ok("topix present", "TOPIX" in names)
    ok("disclaimer", "仮想" in (bench.get("disclaimer") or ""))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=120000)

        page.evaluate("""() => {
          localStorage.setItem('stockai_ai_day_trade', JSON.stringify({
            version: 2,
            daily_records: [{
              date: '2025-05-01',
              total_pnl: 12000,
              trade_count: 2,
              win_rate: 50,
              trades: [
                { symbol: '7203', final_pnl: 15000, status: 'target_hit' },
                { symbol: '8035', final_pnl: -3000, status: 'stop_hit' },
              ],
            }],
          }));
          localStorage.setItem('stockai_ai_trade_scenarios', JSON.stringify({
            version: 2,
            items: [],
            resolved: [{
              id: 'sc-test',
              symbol: '285A',
              final_pnl: 8000,
              resolved_at: '2025-05-10T12:00:00.000Z',
            }],
          }));
        }""")

        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#aiFundHome .af-home-hero", timeout=60000)
        ok("home ai fund section", page.locator("#aiFundHome .af-home-hero").count() >= 1)
        ok("home shows nav", "¥" in (page.locator("#aiFundHome .af-home-nav").inner_text() or ""))

        page.click("#openAiFundPanel")
        page.wait_for_selector("#aiFundList .af-section", timeout=60000)
        ok("panel sections", page.locator("#aiFundList .af-section").count() >= 3)
        ok("panel grade", page.locator("#aiFundList .af-grade-letter").count() >= 1)
        ok("panel vs market", "AI vs 市場" in (page.locator("#aiFundList").inner_text() or ""))
        ok("panel skill eval", "AIの実力評価" in (page.locator("#aiFundList").inner_text() or ""))

        metrics = page.evaluate("""() => {
          const s = window.AiFund.getState();
          return s.metrics;
        }""")
        ok("metrics cumulative", metrics.get("cumulative_pnl") == 20000)
        ok("metrics trade count", metrics.get("trade_count") == 3)
        ok("metrics start capital", metrics.get("start_capital") == 1000000)

        browser.close()

    passed = sum(results)
    total = len(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
