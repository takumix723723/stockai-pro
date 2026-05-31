# -*- coding: utf-8 -*-
"""Smoke test for StockAI Pro routes."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

c = app.test_client()

def check(path, expect=200):
    r = c.get(path, follow_redirects=True)
    ok = r.status_code == expect
    print(f"{'OK' if ok else 'FAIL'} {path} -> {r.status_code}")
    return ok

print("=== Routes ===")
check("/")
check("/ipo")
check("/stock/7203")
check("/manifest.json")
check("/sw.js")

print("=== APIs (fast) ===")
check("/api/ipo")
check("/api/po")
j = c.get("/api/ipo").get_json()
print(f"  ipo items: {len(j.get('items', []))}")
codes = [i.get("code") for i in j.get("items", [])]
print(f"  ipo codes sample: {codes[:5]}")
for need in ("581A", "584A"):
    print(f"{'OK' if need in codes else 'MISSING'} has {need}")
print(f"  source: {j.get('meta', {}).get('source', '?')}")
print(f"  applying: {j.get('meta', {}).get('applying_ipo_count', '?')}")
print(f"  awaiting: {j.get('meta', {}).get('awaiting_ipo_count', '?')}")
print(f"  scheduled: {j.get('meta', {}).get('scheduled_ipo_count', '?')}")
ja = c.get("/api/ipo?status=applying").get_json()
print(f"  applying filter items: {len(ja.get('items', []))}")
listed = [i for i in j.get("items", []) if i.get("status") not in ("applying", "awaiting_listing", "scheduled")]
print(f"{'OK' if not listed else 'FAIL'} all items have phase status")

html = c.get("/").data.decode("utf-8", errors="ignore")
for needle in ["data-tab-nav=\"ipo\"", "ipo.js", "homeMarketBarHost", "syncHomeOnlyChrome"]:
    print(f"{'OK' if needle in html else 'MISSING'} index contains: {needle}")
