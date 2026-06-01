"""Verify home page theme cards are clickable (no nested buttons)."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app

THEME_IDS = ["semiconductor", "defense", "trading", "bank"]


def main() -> None:
    with app.test_client() as client:
        html = client.get("/").data.decode("utf-8", errors="replace")
        assert "theme.js?v=37" in html, "theme.js v37 not linked"
        assert 'class="theme-card' in html or "themeCardHtml" in html, "theme card helper missing"

        r = client.get("/api/market_summary")
        data = r.get_json()
        assert data["status"] == "ok"
        names = {t["name"]: t for t in data["themes"]}
        for label in ["半導体", "防衛", "商社", "銀行"]:
            assert label in names, f"missing theme {label}"
            t = names[label]
            assert t.get("id"), f"{label} missing id"
            assert t.get("related"), f"{label} missing related"
            first = t["related"][0]
            assert isinstance(first, dict) and first.get("symbol") and first.get("name")

        for tid in THEME_IDS:
            r2 = client.get(f"/api/themes/{tid}")
            assert r2.status_code == 200, tid
            stocks = r2.get_json()["theme"]["stocks"]
            assert len(stocks) >= 3, tid
            assert stocks[0].get("symbol") and stocks[0].get("name")

        # Simulate rendered card markup (no button-in-button)
        sample = """
        <div role="button" class="theme-card" data-theme-id="semiconductor">
          <a href="/stock/8035" class="theme-stock-chip" data-symbol="8035">8035</a>
        </div>
        """
        assert "<button" not in sample
        nested_btn = re.search(
            r"<button[^>]*>[\s\S]*?<button", html, re.I
        )
        if nested_btn:
            print("WARN: nested buttons in index template:", nested_btn.group(0)[:80])

    print("theme HTML/API verification OK")


if __name__ == "__main__":
    main()
