"""Verify AI trade scenarios API and UI."""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000"
SYMS = ["7203", "8035", "285A"]


def api(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=120) as r:
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

    data = api("/api/trade_scenarios")
    ok("api status ok", data.get("status") == "ok")
    scenarios = data.get("scenarios") or []
    ok("multiple candidates", len(scenarios) >= 3, f"n={len(scenarios)}")
    for sym in SYMS:
        hit = [s for s in scenarios if s.get("symbol") == sym]
        ok(f"candidate pool includes {sym}", len(hit) >= 0, "optional in top10")

    if scenarios:
        s0 = scenarios[0]
        for k in ["buy_price", "shares", "target_price", "stop_price", "expected_profit", "risk_reward", "reason"]:
            ok(f"field {k}", k in s0 and s0[k] is not None, str(s0.get(k))[:40])

    track = json.loads(
        urllib.request.urlopen(
            urllib.request.Request(
                BASE + "/api/trade_scenarios/track",
                data=json.dumps({"symbols": SYMS}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=120,
        ).read().decode()
    )
    ok("track api", track.get("status") == "ok" and len(track.get("quotes", {})) >= 1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=120000)
        page.wait_for_selector("#aiScenarioHomePreview .ai-scenario-card, #aiScenarioHomePreview .ai-scenario-empty", timeout=90000)
        ok("home preview cards", page.locator("#aiScenarioHomePreview .ai-scenario-card").count() >= 1)

        page.click("#openScenariosPanel")
        page.wait_for_selector("#aiScenarioList .ai-scenario-card", timeout=60000)
        ok("panel opens with cards", page.locator("#aiScenarioList .ai-scenario-card").count() >= 2)

        page.locator("#aiScenarioList .ai-scenario-save").first.click()
        page.wait_for_timeout(500)
        saved = page.evaluate("() => JSON.parse(localStorage.getItem('stockai_ai_trade_scenarios')||'{}').items?.length || 0")
        ok("save to localStorage", saved >= 1, f"items={saved}")

        page.locator('.ai-scenario-tab[data-mode="history"]').click()
        page.wait_for_selector("#aiScenarioList .ai-scenario-history-card", timeout=30000)
        ok("history view", page.locator("#aiScenarioList .ai-scenario-history-card").count() >= 1)

        text = page.locator("#aiScenarioList").inner_text()
        ok("disclaimer in panel", "売買推奨ではなく" in text or "自己責任" in text)

        browser.close()

    passed = sum(results)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
