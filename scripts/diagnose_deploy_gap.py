"""Compare local working tree vs origin/main (what Render deploys)."""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app


def git_show(path: str) -> str:
    r = subprocess.run(
        ["git", "show", f"origin/main:{path}"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return r.stdout if r.returncode == 0 else ""


def check_html(label: str, html: str, must: list, must_not: list) -> None:
    print(f"\n--- {label} ---")
    for s in must:
        ok = s in html
        print(f"  {'OK' if ok else 'MISSING'} must contain: {s!r}")
    for s in must_not:
        ok = s not in html
        print(f"  {'OK' if ok else 'STILL HAS'} must NOT contain: {s!r}")


print("=" * 60)
print("LOCAL working tree (uncommitted fixes)")
print("=" * 60)
with app.test_client() as c:
    home = c.get("/").data.decode("utf-8", errors="replace")
    stock = c.get("/stock/7203").data.decode("utf-8", errors="replace")
    check_html(
        "LOCAL index.html",
        home,
        ["search.js?v=41", "theme.js", 'data-search-ui="v41"'],
        ["4桁の銘柄コードを入力"],
    )
    check_html(
        "LOCAL stock.html",
        stock,
        ['data-period="5m"', "1ヶ月", "stock-chart-periods.js", 'data-period-ui="v39"'],
        ['data-period="1mo"', 'data-period="3mo"', "1月</button>"],
    )
    r = c.get("/api/search?q=285A").get_json()
    print(f"\n  search 285A -> {r['results'][0]['symbol'] if r.get('results') else 'NONE'}")
    r2 = c.get("/api/search?q=キオクシア").get_json()
    print(f"  search キオクシア -> {r2['results'][0]['symbol'] if r2.get('results') else 'NONE'}")
    ch = c.get("/api/chart?symbol=7203&period=5m").get_json()
    print(f"  chart 5m interval={ch.get('interval')} candles={len(ch.get('candles', []))}")

print("\n" + "=" * 60)
print("REMOTE origin/main (Render production source)")
print("=" * 60)
remote_index = git_show("templates/index.html")
remote_stock = git_show("templates/stock.html")
remote_app_snip = git_show("app.py")
check_html(
    "REMOTE index.html",
    remote_index,
    ["function doSearch"],
    [],  # we expect old behavior inside
)
print(f"  has 4digit error: {'4桁' in remote_index and 'doSearch' in remote_index}")
print(f"  has theme.js: {'theme.js' in remote_index}")
print(f"  has search.js: {'search.js' in remote_index}")
print(f"  theme-card only div: {'theme-card' in remote_index and 'openThemePanel' not in remote_index}")

check_html(
    "REMOTE stock.html",
    remote_stock,
    ['data-period="1mo"', 'data-period="3mo"'],
    ['data-period="5m"'],
)
print(f"  has CHART_PERIOD_MAP in app: {'CHART_PERIOD_MAP' in remote_app_snip}")
print(f"  has period_map 1d->5m fake: {'\"1d\": (\"1d\", \"5m\")' in remote_app_snip}")

missing_on_remote = []
for f in ["static/search.js", "static/theme.js", "static/stock-chart-periods.js", "data/jpx_stocks.json"]:
    content = git_show(f)
    missing_on_remote.append((f, len(content) == 0))
print("\n--- Files absent on origin/main ---")
for f, absent in missing_on_remote:
    print(f"  {'ABSENT' if absent else 'present'}: {f}")
