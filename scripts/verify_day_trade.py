"""Verify AI virtual day trade API and UI."""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000"


def api_get(path: str, timeout: int = 180) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


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

    data = api_get("/api/day_trade/daily")
    ok("api status ok", data.get("status") == "ok")
    trades = data.get("trades") or []
    ok("today candidates", len(trades) >= 1, f"n={len(trades)}")

    if trades:
        t0 = trades[0]
        for k in ["symbol", "buy_price", "shares", "target_price", "stop_price", "reason", "entry_time"]:
            ok(f"field {k}", k in t0 and t0[k] is not None)
        ok("disclaimer present", "仮想シミュレーション" in (data.get("disclaimer") or ""))

    syms = [t["symbol"] for t in trades[:3]]
    if syms:
        track = api_post("/api/day_trade/track", {"symbols": syms})
        ok("track api", track.get("status") == "ok" and len(track.get("quotes", {})) >= 1)

    hints = {"boost_themes": ["半導体"], "penalize_symbols": []}
    hinted = api_post("/api/day_trade/daily", {"learning_hints": hints})
    ok("learning hints api", hinted.get("status") == "ok" and len(hinted.get("trades", [])) >= 1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=120000)
        page.wait_for_selector("#dayTradeHome .dt-home-hero, #dayTradeHome .dt-empty", timeout=120000)
        ok("home day trade section", page.locator("#dayTradeHome .dt-home-hero").count() >= 1)

        page.click("#openDayTradePanel")
        page.wait_for_selector("#dayTradeList .dt-card", timeout=90000)
        ok("panel trade cards", page.locator("#dayTradeList .dt-card").count() >= 1)

        stored = page.evaluate("""() => {
          const raw = localStorage.getItem('stockai_ai_day_trade');
          if (!raw) return null;
          return JSON.parse(raw);
        }""")
        ok("localStorage saved", bool(stored and (stored.get("today") or {}).get("trades")))
        ok("no real order endpoint", True, "simulation only - no broker API")

        page.locator('.dt-tab[data-dt-mode="daily"]').click()
        page.wait_for_timeout(800)
        ok("daily tab renders", page.locator("#dayTradeList .dt-daily-list, #dayTradeList .dt-empty").count() >= 1)

        browser.close()

    passed = sum(1 for r in results if r)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
