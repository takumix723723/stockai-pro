"""Verify trade simulator on stock pages."""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5055"
SYMBOLS = ["7203", "285A", "8035"]


def api(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=90) as r:
        return json.loads(r.read().decode())


def main() -> int:
    results = []

    def ok(name: str, cond: bool, detail: str = ""):
        results.append(cond)
        line = f"{'OK' if cond else 'FAIL'}  {name} {detail}"
        try:
            print(line)
        except UnicodeEncodeError:
            print(line.encode("ascii", errors="replace").decode("ascii"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        for sym in SYMBOLS:
            page.goto(f"{BASE}/stock/{sym}", wait_until="domcontentloaded", timeout=120000)
            page.wait_for_selector("#tradeSimulator #simBuy", timeout=60000)
            page.wait_for_function(
                "() => { const v = document.getElementById('simBuy')?.value; return v && Number(v) > 0; }",
                timeout=90000,
            )

            stock = api(f"/api/stock?symbol={sym}")
            current = stock.get("data", {}).get("current")
            ok(f"{sym} simulator mounted", page.locator("#simBuy").is_visible())

            buy_val = page.input_value("#simBuy")
            ok(f"{sym} buy prefilled", buy_val and float(buy_val) > 0, f"buy={buy_val} api={current}")

            shares = page.input_value("#simShares")
            ok(f"{sym} default shares", shares == "100", f"shares={shares}")

            html = page.locator("#simResults").inner_text()
            ok(f"{sym} required capital shown", "必要資金" in html)
            ok(f"{sym} risk reward shown", "リスクリワード比" in html)
            ok(f"{sym} bull scenario", "強気シナリオ" in html)
            ok(f"{sym} bear scenario", "弱気シナリオ" in html)
            ok(f"{sym} disclaimer", "売買推奨ではなく" in page.locator(".sim-disclaimer").inner_text())
            ok(f"{sym} ai comment", page.locator(".sim-ai-comment p").count() == 1)

            page.fill("#simTarget", "")
            page.fill("#simStop", "")
            page.fill("#simBuy", "3000")
            page.fill("#simShares", "100")
            page.fill("#simTarget", "3300")
            page.fill("#simStop", "2850")
            page.dispatch_event("#simStop", "input")

            profit_text = page.locator(".sim-metric-v.up").first.inner_text()
            rr_text = page.evaluate(
                """() => {
                  const nodes = [...document.querySelectorAll('.sim-metric')];
                  const row = nodes.find(n => n.textContent.includes('リスクリワード'));
                  return row ? row.querySelector('.sim-metric-v')?.textContent || '' : '';
                }"""
            )
            ok(f"{sym} target profit calc", "30,000" in profit_text, profit_text)
            ok(f"{sym} rr ~2", "2.00" in rr_text, rr_text)

            ls_key = page.evaluate(
                """(sym) => localStorage.getItem('stockai_trade_sim_' + sym.toUpperCase())""",
                sym,
            )
            ok(f"{sym} localStorage saved", ls_key is not None and '"buy":3000' in ls_key.replace(" ", ""), ls_key)

        browser.close()

    passed = sum(results)
    total = len(results)
    print(f"\n{passed}/{total} passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
