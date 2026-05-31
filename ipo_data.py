"""
IPO / PO カタログ（参考データ）
将来: DB / 外部API 差し替え可能な構造
notify_events: BB締切・上場日通知用
"""

from __future__ import annotations

from datetime import date, datetime

IPO_CATALOG: list[dict] = [
    {
        "id": "ipo_techgrowth_2026",
        "type": "ipo",
        "name": "テックグロース",
        "name_full": "テックグロース株式会社",
        "code": "123A",
        "market": "グロース",
        "bb_start": "2026-05-20",
        "bb_end": "2026-05-27",
        "bb_period_fmt": "5/20 〜 5/27",
        "listing_date": "2026-06-15",
        "listing_date_fmt": "2026/6/15（月）",
        "price_range": "1,200〜1,400円",
        "expected_price": 1300,
        "expected_price_fmt": "1,300円",
        "lead_underwriter": "野村・GS",
        "status": "open",
        "status_label": "募集中",
        "sector": "情報・通信",
        "overview": "クラウド基盤とAI解析SaaSを提供。国内中堅製造業向けに需要拡大中。",
        "business": "・クラウド型生産管理SaaS\n・AI需要予測エンジン\n・データ分析コンサル",
        "offering_amount_fmt": "15.6億円",
        "lock_up": "公募後90日（機関50%・VC30%）",
        "vc_holdings": [
            {"name": "ジャフコ", "ratio": "12.5%", "lock": "180日"},
            {"name": "グローバル・ブレイン", "ratio": "8.2%", "lock": "90日"},
        ],
        "ai_first_day_expect": {
            "score": 72,
            "label": "やや強気",
            "comment": "成長セクター人気・需給良好。ただし仮条件上限付近の可能性。",
        },
        "notify_events": [
            {"type": "bb_deadline", "at": "2026-05-27T15:00:00", "label": "BB締切"},
            {"type": "listing_date", "at": "2026-06-15T09:00:00", "label": "上場日"},
        ],
    },
    {
        "id": "ipo_greenenergy_2026",
        "type": "ipo",
        "name": "グリーンエナジーHD",
        "name_full": "グリーンエナジーホールディングス",
        "code": "456B",
        "market": "プライム",
        "bb_start": "2026-05-25",
        "bb_end": "2026-06-03",
        "bb_period_fmt": "5/25 〜 6/3",
        "listing_date": "2026-06-20",
        "listing_date_fmt": "2026/6/20（金）",
        "price_range": "2,800〜3,200円",
        "expected_price": 3000,
        "expected_price_fmt": "3,000円",
        "lead_underwriter": "大和・みずほ",
        "status": "open",
        "status_label": "募集中",
        "sector": "エネルギー",
        "overview": "再生可能エネルギー発電所の開発・運営。FIT終了後もPPA契約で安定収益。",
        "business": "・太陽光・風力発電所運営\n・蓄電池事業\n・エネルギー管理システム",
        "offering_amount_fmt": "42.0億円",
        "lock_up": "公募後120日（主要株主全員）",
        "vc_holdings": [
            {"name": "INCJ", "ratio": "15.0%", "lock": "180日"},
        ],
        "ai_first_day_expect": {
            "score": 65,
            "label": "中立",
            "comment": "インフラ株として安定感。初値は仮条件中位〜上限想定。",
        },
        "notify_events": [
            {"type": "bb_deadline", "at": "2026-06-03T15:00:00", "label": "BB締切"},
            {"type": "listing_date", "at": "2026-06-20T09:00:00", "label": "上場日"},
        ],
    },
    {
        "id": "ipo_medtech_2026",
        "type": "ipo",
        "name": "メドテック・ラボ",
        "name_full": "メドテック・ラボラトリーズ",
        "code": "789C",
        "market": "グロース",
        "bb_start": "2026-06-01",
        "bb_end": "2026-06-08",
        "bb_period_fmt": "6/1 〜 6/8",
        "listing_date": "2026-06-25",
        "listing_date_fmt": "2026/6/25（水）",
        "price_range": "800〜950円",
        "expected_price": 875,
        "expected_price_fmt": "875円",
        "lead_underwriter": "SMBC日興",
        "status": "open",
        "status_label": "募集中",
        "sector": "医薬品",
        "overview": "体外診断機器と検査試薬の開発。アジア展開で成長加速フェーズ。",
        "business": "・POCT診断機器\n・検査試薬製造\n・海外ライセンス",
        "offering_amount_fmt": "8.2億円",
        "lock_up": "公募後90日",
        "vc_holdings": [
            {"name": "UTEC", "ratio": "18.3%", "lock": "90日"},
            {"name": "WiL", "ratio": "6.1%", "lock": "90日"},
        ],
        "ai_first_day_expect": {
            "score": 78,
            "label": "強気",
            "comment": "医療テックテーマ。小型化需給で初値高期待。",
        },
        "notify_events": [
            {"type": "bb_deadline", "at": "2026-06-08T15:00:00", "label": "BB締切"},
            {"type": "listing_date", "at": "2026-06-25T09:00:00", "label": "上場日"},
        ],
    },
    {
        "id": "ipo_retailai_2026",
        "type": "ipo",
        "name": "リテールAI",
        "name_full": "リテールAIソリューションズ",
        "code": "234D",
        "market": "スタンダード",
        "bb_start": "2026-04-15",
        "bb_end": "2026-04-22",
        "bb_period_fmt": "4/15 〜 4/22",
        "listing_date": "2026-05-10",
        "listing_date_fmt": "2026/5/10（土→5/12）",
        "price_range": "1,500〜1,700円",
        "expected_price": 1600,
        "expected_price_fmt": "1,600円",
        "lead_underwriter": "SBI",
        "status": "closed",
        "status_label": "終了",
        "sector": "情報・通信",
        "overview": "小売向けAI在庫最適化。既に黒字化、大型小売チェーン導入実績多数。",
        "business": "・需要予測AI\n・店舗オペレーション支援\n・EC連携プラットフォーム",
        "offering_amount_fmt": "22.0億円",
        "lock_up": "公募後60日",
        "vc_holdings": [],
        "ai_first_day_expect": {
            "score": 58,
            "label": "やや弱気",
            "comment": "BB終了済。上場後の値動きに注目。",
        },
        "notify_events": [
            {"type": "listing_date", "at": "2026-05-12T09:00:00", "label": "上場日"},
        ],
    },
]

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
        "market": item["market"],
        "bb_period_fmt": item["bb_period_fmt"],
        "listing_date_fmt": item["listing_date_fmt"],
        "price_range": item["price_range"],
        "expected_price_fmt": item["expected_price_fmt"],
        "lead_underwriter": item["lead_underwriter"],
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
    items = IPO_CATALOG
    if status == "open":
        items = [i for i in items if i["status"] == "open"]
    elif status == "closed":
        items = [i for i in items if i["status"] == "closed"]
    open_first = sorted(items, key=lambda x: (x["status"] != "open", x.get("bb_end", "")))
    return [_list_fields_ipo(i) for i in open_first]


def get_ipo_detail(ipo_id: str) -> dict | None:
    for item in IPO_CATALOG:
        if item["id"] == ipo_id:
            return dict(item)
    return None


def get_po_list(status: str | None = None) -> list[dict]:
    items = PO_CATALOG
    if status == "open":
        items = [i for i in items if i["status"] == "open"]
    elif status == "closed":
        items = [i for i in items if i["status"] == "closed"]
    return [_list_fields_po(i) for i in items]


def get_ipo_po_meta() -> dict:
    return {
        "updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": "参考データ（StockAI Pro）",
        "ipo_count": len(IPO_CATALOG),
        "po_count": len(PO_CATALOG),
        "open_ipo_count": sum(1 for i in IPO_CATALOG if i["status"] == "open"),
    }
