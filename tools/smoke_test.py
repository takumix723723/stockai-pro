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

html = c.get("/").data.decode("utf-8", errors="ignore")
for needle in ["data-tab-nav=\"ipo\"", "ipo.js", "homeMarketBarHost", "syncHomeOnlyChrome"]:
    print(f"{'OK' if needle in html else 'MISSING'} index contains: {needle}")
