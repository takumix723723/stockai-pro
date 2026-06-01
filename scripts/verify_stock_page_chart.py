import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app

EXPECTED_TABS = ["5分", "15分", "1日", "1週", "1ヶ月", "6ヶ月", "1年"]

with app.test_client() as c:
    r = c.get("/stock/7203")
    h = r.data.decode("utf-8")
    assert r.headers.get("X-Chart-Period-UI") == "v39"
    assert "chart-period-ui-v39" in h
    assert 'data-period-ui="v39"' in h

    m = re.search(r'id="periodTabs"[^>]*>(.*?)</div>', h, re.S)
    assert m, "periodTabs block missing"
    tabs = m.group(1)
    for label in EXPECTED_TABS:
        assert label in tabs, f"missing tab {label}"
    for bad in ["1mo", "3mo", 'data-period="1y"']:
        assert bad not in tabs, f"old tab in periodTabs: {bad}"
    assert tabs.count("period-btn") == 7
    print("stock page v39: 7 period tabs OK, no 1月/3月/旧1年")
