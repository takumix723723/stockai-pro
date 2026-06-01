"""Verify theme API and semiconductor stock list."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app, THEME_CATALOG

with app.test_client() as client:
    print("=== /api/themes ===")
    r = client.get("/api/themes")
    data = r.get_json()
    assert data["status"] == "ok"
    print(f"themes count: {len(data['themes'])}")
    ids = {t["id"] for t in data["themes"]}
    assert ids == set(THEME_CATALOG.keys())
    print("ALL theme ids OK")

    print("\n=== /api/themes/semiconductor ===")
    r2 = client.get("/api/themes/semiconductor")
    theme = r2.get_json()["theme"]
    symbols = [s["symbol"] for s in theme["stocks"]]
    print(f"name: {theme['name']}")
    print(f"stocks: {len(symbols)}")
    for s in theme["stocks"][:5]:
        print(f"  {s['symbol']} {s['name']} price={s.get('current')} chg={s.get('change_pct')}%")
    assert "8035" in symbols
    assert "6857" in symbols
    assert theme["stocks"][0]["name"]
    print("8035 in list: OK")

    print("\n=== /api/themes/defense (404 check) ===")
    r3 = client.get("/api/themes/unknown")
    assert r3.status_code == 404
    print("404 for unknown: OK")

    print("\nALL OK")
