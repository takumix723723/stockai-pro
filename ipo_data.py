"""
IPO / PO カタログ
IPO: JPX 公式一覧 + 詳細エンリッチメント
PO:  参考データ（将来 DB / 外部API 差し替え可能）
"""

from __future__ import annotations

from datetime import datetime

from ipo_fetcher import fetch_ipo_catalog, get_cached_ipo_by_id

IPO_STATUS_ORDER = {
    "applying": 0,
    "awaiting_listing": 1,
    "scheduled": 2,
}

PO_CATALOG: list[dict] = [
    {
        "id": "po_sample_hd_2026",
        "type": "po",
        "name": "サンプルホールディングス",
        "code": "9980",
        "market": "プライム",
        "discount_rate": "15.2%",
        "discount_rate_raw": 15.2,
        "settlement_date": "2026-06-20",
        "settlement_date_fmt": "2026/6/20",
        "shares_fmt": "850万股",
        "short_term_impact": "供給増で初日〜1週間は調整警戒。割引率は同業平均並み。",
        "status": "open",
        "status_label": "受付中",
        "notify_events": [
            {"type": "po_settlement", "at": "2026-06-20T09:00:00", "label": "受渡日"},
        ],
    },
    {
        "id": "po_tech_venture_2026",
        "type": "po",
        "name": "テックベンチャー",
        "code": "3456",
        "market": "グロース",
        "discount_rate": "22.5%",
        "discount_rate_raw": 22.5,
        "settlement_date": "2026-06-05",
        "settlement_date_fmt": "2026/6/5",
        "shares_fmt": "320万股",
        "short_term_impact": "大口売り出し。VC退出案件でボラティリティ上昇リスク。",
        "status": "open",
        "status_label": "受付中",
        "notify_events": [
            {"type": "po_settlement", "at": "2026-06-05T09:00:00", "label": "受渡日"},
        ],
    },
    {
        "id": "po_industrial_2026",
        "type": "po",
        "name": "インダストリアルパーツ",
        "code": "5678",
        "market": "スタンダード",
        "discount_rate": "8.0%",
        "discount_rate_raw": 8.0,
        "settlement_date": "2026-05-28",
        "settlement_date_fmt": "2026/5/28",
        "shares_fmt": "120万股",
        "short_term_impact": "割引率低め。需給への影響は限定的の見込み。",
        "status": "closed",
        "status_label": "終了",
        "notify_events": [],
    },
]


def _list_fields_ipo(item: dict) -> dict:
    return {
        "id": item["id"],
        "type": item["type"],
        "name": item["name"],
        "name_full": item.get("name_full", item["name"]),
        "code": item["code"],
        "market": item.get("market", "—"),
        "bb_period_fmt": item.get("bb_period_fmt", "—"),
        "listing_date_fmt": item.get("listing_date_fmt", "—"),
        "price_range": item.get("price_range", "未定"),
        "expected_price_fmt": item.get("expected_price_fmt", "未定"),
        "lead_underwriter": item.get("lead_underwriter", "—"),
        "status": item["status"],
        "status_label": item["status_label"],
        "sector": item.get("sector", ""),
        "notify_events": item.get("notify_events", []),
    }


def _list_fields_po(item: dict) -> dict:
    return {
        "id": item["id"],
        "type": item["type"],
        "name": item["name"],
        "code": item["code"],
        "market": item.get("market", ""),
        "discount_rate": item["discount_rate"],
        "settlement_date_fmt": item["settlement_date_fmt"],
        "shares_fmt": item.get("shares_fmt", ""),
        "short_term_impact": item["short_term_impact"],
        "status": item["status"],
        "status_label": item["status_label"],
        "notify_events": item.get("notify_events", []),
    }


def get_ipo_list(status: str | None = None) -> list[dict]:
    items, _ = fetch_ipo_catalog()
    valid = {"applying", "awaiting_listing", "scheduled"}
    if status in valid:
        items = [i for i in items if i["status"] == status]
    items = sorted(
        items,
        key=lambda x: (
            IPO_STATUS_ORDER.get(x["status"], 9),
            x.get("listing_date") or "",
        ),
    )
    return [_list_fields_ipo(i) for i in items]


def get_ipo_detail(ipo_id: str) -> dict | None:
    return get_cached_ipo_by_id(ipo_id)


def get_po_list(status: str | None = None) -> list[dict]:
    items = PO_CATALOG
    if status == "open":
        items = [i for i in items if i["status"] == "open"]
    elif status == "closed":
        items = [i for i in items if i["status"] == "closed"]
    return [_list_fields_po(i) for i in items]


def get_ipo_po_meta() -> dict:
    _, ipo_meta = fetch_ipo_catalog()
    return {
        "updated": ipo_meta.get("updated") or datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": ipo_meta.get("source", "JPX（東証）"),
        "ipo_count": ipo_meta.get("ipo_count", 0),
        "applying_ipo_count": ipo_meta.get("applying_ipo_count", 0),
        "awaiting_ipo_count": ipo_meta.get("awaiting_ipo_count", 0),
        "scheduled_ipo_count": ipo_meta.get("scheduled_ipo_count", 0),
        "open_ipo_count": ipo_meta.get("applying_ipo_count", 0),
        "po_count": len(PO_CATALOG),
        "open_po_count": sum(1 for i in PO_CATALOG if i["status"] == "open"),
    }
