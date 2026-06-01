"""JPX上場銘柄一覧を取得し data/jpx_stocks.json を生成する。"""
from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "jpx_stocks.json"
JPX_URL = (
    "https://www.jpx.co.jp/markets/statistics-equities/misc/"
    "tvdivq0000001vg2-att/data_j.xls"
)
CODE_RE = re.compile(r"^\d{3,4}[A-Z]?$", re.I)


def fetch_jpx_master() -> dict[str, str]:
    req = urllib.request.Request(JPX_URL, headers={"User-Agent": "StockAIPro/1.0"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        raw = resp.read()
    df = pd.read_excel(io.BytesIO(raw))
    code_col, name_col = df.columns[1], df.columns[2]
    out: dict[str, str] = {}
    for _, row in df.iterrows():
        code = str(row[code_col]).strip().upper()
        if not CODE_RE.fullmatch(code):
            continue
        name = str(row[name_col]).strip()
        if not name or name.lower() == "nan":
            continue
        out[code] = name
    return out


def main() -> None:
    master = fetch_jpx_master()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(master, ensure_ascii=False, indent=0, sort_keys=True),
        encoding="utf-8",
    )
    print(f"Wrote {len(master)} symbols -> {OUT_PATH}")
    for code in ("285A", "5401", "7203", "6958", "8035"):
        print(f"  {code}: {master.get(code, 'MISSING')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
