"""Verify search for company names and codes (JPX master)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app, get_search_index, search_stocks

CASES = [
    ("日本製鉄", ["5401"], "exact"),
    ("日本CMK", ["6958"], "exact"),
    ("キオクシア", ["285A"], "exact"),
    ("285A", ["285A"], "exact"),
    ("285a", ["285A"], "code"),
    ("153A", ["153A"], "code"),
    ("東京エレクトロン", ["8035"], "exact"),
    ("信越化学", ["4063"], "partial"),
    ("トヨタ", ["7203"], "partial"),
    ("toyota", ["7203"], "partial"),
    ("キオ", ["285A"], "partial"),
    ("日本", ["5401", "6958"], "multi"),
    ("CMK", ["6958"], "partial"),
]

all_ok = True
idx = get_search_index()
print(f"search index size: {len(idx)}")
assert len(idx) > 4000, f"expected JPX master, got {len(idx)}"

for query, expect_syms, mode in CASES:
    results = search_stocks(query, limit=10)
    found = [r["symbol"] for r in results]
    if mode == "exact":
        ok = found and found[0] == expect_syms[0]
    elif mode == "code":
        ok = expect_syms[0] in found[:3]
    elif mode == "multi":
        ok = all(s in found for s in expect_syms)
    else:
        ok = expect_syms[0] in found
    if not ok:
        all_ok = False
    print(f"{'OK' if ok else 'FAIL'}  {query!r} -> top3={found[:3]} expect={expect_syms}")

with app.test_client() as client:
    r = client.get("/api/search?q=" + "キオクシア")
    data = r.get_json()
    assert data["results"][0]["symbol"] == "285A"
    r2 = client.get("/")
    html = r2.data.decode("utf-8")
    assert "search.js?v=41" in html
    assert 'data-search-ui="v41"' in html
    print("API + index.html OK")

print("\n" + ("ALL OK" if all_ok else "SOME FAILED"))
if not all_ok:
    sys.exit(1)
