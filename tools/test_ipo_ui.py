# -*- coding: utf-8 -*-
"""IPO tab UI smoke test (Playwright)."""
import json
import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5056/?tab=ipo"


def main() -> int:
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(5000)

        meta = page.locator("#ipoPageMeta").inner_text()
        cards = page.locator(".ipo-sbi-card").count()
        codes = page.locator(".ipo-sbi-code").all_inner_texts()
        api = page.evaluate(
            """async () => {
              const r = await fetch('/api/ipo');
              const j = await r.json();
              return { status: j.status, n: j.items.length, codes: j.items.slice(0, 5).map(i => i.code) };
            }"""
        )

        result = {
            "meta": meta,
            "cards": cards,
            "codes_on_page": codes[:8],
            "api": api,
            "errors": errors,
        }
        print(json.dumps(result, ensure_ascii=True))
        browser.close()

    if errors:
        return 1
    if cards < 1:
        return 2
    if "581A" not in codes:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
