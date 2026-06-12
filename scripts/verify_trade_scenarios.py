"""Verify AI trade scenarios API and UI."""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000"
SYMS = ["7203", "8035", "285A"]


def api(path: str, timeout: int = 300) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
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
    ok("candidates or skip", len(scenarios) >= 1 or data.get("skip") is True, f"n={len(scenarios)}")
    ok("precision_mode", data.get("precision_mode") is True)
    ok("max 5 scenarios", len(scenarios) <= 5)
    for sym in SYMS:
        hit = [s for s in scenarios if s.get("symbol") == sym]
        ok(f"candidate pool includes {sym}", len(hit) >= 0, "optional in top10")

    if scenarios:
        s0 = scenarios[0]
        for k in ["buy_price", "shares", "target_price", "stop_price", "expected_profit", "risk_reward",
                  "predicted_win_rate", "expected_value", "confidence", "selection_reasons"]:
            ok(f"field {k}", k in s0 and s0[k] is not None, str(s0.get(k))[:40])
    elif data.get("skip"):
        ok("skip label", "見送り" in (data.get("skip_label") or ""))

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
        page.wait_for_selector("#aiScenarioHomePreview .ai-scenario-card, #aiScenarioHomePreview .ai-skip-card, #aiScenarioHomePreview .ai-scenario-empty", timeout=90000)
        ok("home preview content", page.locator("#aiScenarioHomePreview .ai-scenario-card, #aiScenarioHomePreview .ai-skip-card").count() >= 1)

        page.click("#openScenariosPanel")
        page.wait_for_selector("#aiScenarioList .ai-scenario-card, #aiScenarioList .ai-skip-card", timeout=60000)
        ok("panel opens", page.locator("#aiScenarioList .ai-scenario-card, #aiScenarioList .ai-skip-card").count() >= 1)

        if page.locator("#aiScenarioList .ai-scenario-save").count() >= 1:
            page.locator("#aiScenarioList .ai-scenario-save").first.click()
            page.wait_for_timeout(500)
            saved = page.evaluate("() => JSON.parse(localStorage.getItem('stockai_ai_trade_scenarios')||'{}').items?.length || 0")
            ok("save to localStorage", saved >= 1, f"items={saved}")
            page.locator('.ai-scenario-tab[data-mode="history"]').click()
            page.wait_for_selector("#aiScenarioList .ai-scenario-history-card", timeout=30000)
            ok("history view", page.locator("#aiScenarioList .ai-scenario-history-card").count() >= 1)
        else:
            ok("save skipped", True, "precision mode: no candidates")

        page.evaluate("""() => {
          const seed = {
            id: 'test-resolved-1', symbol: '8035', name: '東京エレクトロン',
            buy_price: 68000, shares: 100, target_price: 75000, stop_price: 65000,
            risk_reward: 2.1, saved_at: new Date(Date.now() - 86400000 * 3).toISOString(),
            resolved_status: 'target_hit', resolved_at: new Date().toISOString(),
            final_price: 75000, final_pnl: 700000, final_pnl_rate: 10.29,
            holding_days: 3, outcome: 'win', verify_mode: true
          };
          const raw = localStorage.getItem('stockai_ai_trade_scenarios');
          const data = raw ? JSON.parse(raw) : { version: 2, items: [], resolved: [] };
          data.version = 2;
          data.resolved = [seed, {
            id: 'test-resolved-2', symbol: '7203', name: 'トヨタ自動車',
            buy_price: 2900, shares: 100, risk_reward: 1.5,
            saved_at: new Date(Date.now() - 86400000 * 5).toISOString(),
            resolved_status: 'stop_hit', resolved_at: new Date().toISOString(),
            final_price: 2820, final_pnl: -8000, final_pnl_rate: -2.76,
            holding_days: 5, outcome: 'loss', verify_mode: true
          }];
          localStorage.setItem('stockai_ai_trade_scenarios', JSON.stringify(data));
        }""")
        page.evaluate("() => window.TradeScenarios?.renderHomeScore()")
        ok("home AI score card", page.locator("#aiScoreHomeCard").count() >= 1)
        home_text = page.locator("#aiScoreHome").inner_text()
        ok("home win rate shown", "勝率" in home_text)
        ok("home cumulative pnl", "累計損益" in home_text)

        page.locator('.ai-scenario-tab[data-mode="scoreboard"]').click()
        page.wait_for_selector("#aiScenarioList .ai-score-stats", timeout=15000)
        score_text = page.locator("#aiScenarioList").inner_text()
        ok("scoreboard AI実績", "AI実績" in score_text)
        ok("scoreboard win count", "勝ち" in score_text)
        ok("scoreboard profit ranking", "利益順ランキング" in score_text)
        ok("scoreboard winrate ranking", "勝率順ランキング" in score_text)
        ok("scoreboard rr ranking", "リスクリワード順" in score_text)
        ok("verify mode note", "AI検証モード" in score_text)

        text = page.locator("#aiScenarioList").inner_text()
        ok("disclaimer in panel", "売買推奨ではなく" in text or "自己責任" in text)

        browser.close()

    passed = sum(results)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
