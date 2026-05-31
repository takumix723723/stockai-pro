"""
JPX 新規上場銘柄一覧から IPO カタログを構築（参考データ + 公式一覧）
"""

from __future__ import annotations

import re
import traceback
import urllib.error
import urllib.request
from datetime import date, datetime
from html import unescape

JPX_IPO_URL = "https://www.jpx.co.jp/listing/stocks/new/index.html"
CACHE_TTL_SEC = 3600

_cache: dict | None = None

# JPX 一覧に無い詳細（BB・想定価格・事業概要など）
IPO_ENRICHMENTS: dict[str, dict] = {
    "581A": {
        "name": "GO",
        "name_full": "GO（ゴー）",
        "market": "グロース",
        "bb_start": "2026-06-02",
        "bb_end": "2026-06-05",
        "bb_period_fmt": "6/2 〜 6/5",
        "listing_date": "2026-06-16",
        "listing_date_fmt": "2026/6/16（火）",
        "price_range": "2,350円（想定）",
        "expected_price": 2350,
        "expected_price_fmt": "2,350円",
        "lead_underwriter": "野村・GS・BofA・大和",
        "sector": "情報・通信",
        "overview": "配車システム提供等モビリティ関連事業。タクシー・ハイヤー向け配車基盤を展開。",
        "business": "・配車システムSaaS\n・モビリティデータ分析\n・運行管理ソリューション",
        "offering_amount_fmt": "951.3億円（国内380.5億円）",
        "lock_up": "公募後90日（主要株主）",
        "vc_holdings": [],
        "ai_first_day_expect": {
            "score": 74,
            "label": "やや強気",
            "comment": "大型グロースIPO。需給とテーマ性に注目。",
        },
    },
    "584A": {
        "name": "LiNKX",
        "name_full": "LiNKX（リンクス）",
        "market": "グロース",
        "bb_start": "2026-06-08",
        "bb_end": "2026-06-11",
        "bb_period_fmt": "6/8 〜 6/11",
        "listing_date": "2026-06-23",
        "listing_date_fmt": "2026/6/23（火）",
        "price_range": "710円（想定）",
        "expected_price": 710,
        "expected_price_fmt": "710円",
        "lead_underwriter": "野村・SMBC日興・みずほ",
        "sector": "情報・通信",
        "overview": "金融分野を中心とした基幹システム等のモダナイゼーション事業。",
        "business": "・基幹システム刷新\n・クラウド移行支援\n・金融ITコンサル",
        "offering_amount_fmt": "約12.0億円",
        "lock_up": "公募後90日",
        "vc_holdings": [],
        "ai_first_day_expect": {
            "score": 70,
            "label": "やや強気",
            "comment": "金融ITモダナイゼーション需要。小型化需給に期待。",
        },
    },
    "589A": {
        "name": "ネイチャー",
        "name_full": "ネイチャー",
        "market": "グロース",
        "bb_start": "2026-06-24",
        "bb_end": "2026-06-27",
        "bb_period_fmt": "6/24 〜 6/27",
        "listing_date": "2026-06-30",
        "listing_date_fmt": "2026/6/30（火）",
        "price_range": "未定",
        "expected_price": None,
        "expected_price_fmt": "未定",
        "lead_underwriter": "未定",
        "sector": "情報・通信",
        "overview": "2026年6月30日上場予定（JPX公表）。",
        "business": "・事業詳細は目論見書参照",
        "offering_amount_fmt": "未定",
        "lock_up": "—",
        "vc_holdings": [],
        "ai_first_day_expect": {
            "score": 55,
            "label": "中立",
            "comment": "仮条件・需給確定前。公式情報を確認してください。",
        },
    },
}

# JPX 取得失敗時のフォールバック（実銘柄）
FALLBACK_CATALOG: list[dict] = []


def _parse_jpx_date(raw: str) -> tuple[str | None, str | None]:
    """'2026/06/16 （2026/05/14）' → (listing_iso, approval_iso)"""
    if not raw:
        return None, None
    text = unescape(re.sub(r"\s+", " ", raw)).strip()
    listing_m = re.search(r"(\d{4}/\d{2}/\d{2})", text)
    approval_m = re.search(r"[（(](\d{4}/\d{2}/\d{2})[）)]", text)
    listing = listing_m.group(1).replace("/", "-") if listing_m else None
    approval = approval_m.group(1).replace("/", "-") if approval_m else None
    return listing, approval


def _clean_name(raw: str) -> tuple[str, str]:
    text = unescape(re.sub(r"\s+", " ", raw)).strip()
    text = re.sub(r"\*+$", "", text).strip()
    text = re.sub(r"代表者インタビュー", "", text).strip()
    name_full = re.sub(r"（株）|\(株\)", "", text).strip()
    name = name_full.split("（")[0].split("(")[0].strip() or name_full
    return name, name_full


def _parse_price_range(raw: str) -> tuple[str, int | None, str]:
    text = unescape(raw).strip()
    if not text or text in ("-", "—", "未定"):
        return "未定", None, "未定"
    if "円" in text:
        return text, None, text.replace("（想定）", "").strip()
    nums = re.findall(r"[\d,]+", text)
    if len(nums) >= 2:
        lo = int(nums[0].replace(",", ""))
        hi = int(nums[1].replace(",", ""))
        mid = (lo + hi) // 2
        fmt = f"{lo:,}〜{hi:,}円"
        return fmt, mid, f"{mid:,}円"
    if len(nums) == 1:
        v = int(nums[0].replace(",", ""))
        fmt = f"{v:,}円"
        return fmt, v, fmt
    return text, None, text


def _parse_offering(raw: str) -> str:
    text = unescape(raw).strip()
    if not text or text in ("-", "—"):
        return "未定"
    if "億" in text:
        return text
    try:
        val = float(text.replace(",", ""))
        return f"{val}億円"
    except ValueError:
        return text


def _compute_status(
    listing_iso: str | None,
    bb_start: str | None,
    bb_end: str | None,
    today: date | None = None,
) -> tuple[str, str]:
    """
    IPOフェーズ判定（上場済みは呼び出し元で除外）
    applying         = BB期間中（申込中）
    awaiting_listing = BB終了〜上場前（上場待ち）
    scheduled        = BB開始前（予定）
    """
    today = today or date.today()

    if bb_start and bb_end:
        start_d = date.fromisoformat(bb_start)
        end_d = date.fromisoformat(bb_end)
        if start_d <= today <= end_d:
            return "applying", "申込中"
        if today < start_d:
            return "scheduled", "予定"
        if today > end_d:
            if listing_iso and date.fromisoformat(listing_iso) > today:
                return "awaiting_listing", "上場待ち"

    if listing_iso and date.fromisoformat(listing_iso) > today:
        return "scheduled", "予定"

    return "scheduled", "予定"


def _is_listed(listing_iso: str | None, today: date | None = None) -> bool:
    """上場日 <= 今日 なら上場済み（一覧除外）"""
    today = today or date.today()
    if not listing_iso:
        return False
    return date.fromisoformat(listing_iso) <= today


def _fetch_jpx_html() -> str:
    req = urllib.request.Request(
        JPX_IPO_URL,
        headers={
            "User-Agent": "StockAI-Pro/1.0 (+https://github.com/takumix723723/stockai-pro)",
            "Accept-Language": "ja,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _parse_jpx_rows(html: str) -> list[dict]:
    rows: list[dict] = []
    for tr in re.findall(r"<tr[^>]*>.*?</tr>", html, re.S):
        if not re.search(r"\d{3}[A-Z]", tr):
            continue
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) < 3:
            continue
        cells = [
            unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", td)).strip())
            for td in tds
        ]
        listing_iso, approval_iso = _parse_jpx_date(cells[0])
        name, name_full = _clean_name(cells[1])
        code = cells[2].strip().upper()
        if not re.fullmatch(r"\d{3}[A-Z]", code):
            continue

        price_range, expected_price, expected_price_fmt = _parse_price_range(
            cells[5] if len(cells) > 5 else ""
        )
        offering = _parse_offering(cells[6] if len(cells) > 6 else "")

        item: dict = {
            "id": f"ipo_{code.lower()}",
            "type": "ipo",
            "name": name,
            "name_full": name_full,
            "code": code,
            "market": "グロース",
            "listing_date": listing_iso,
            "listing_date_fmt": cells[0].split("（")[0].strip() if cells[0] else "—",
            "price_range": price_range,
            "expected_price": expected_price,
            "expected_price_fmt": expected_price_fmt,
            "offering_amount_fmt": offering,
            "lead_underwriter": "—",
            "sector": "—",
            "overview": f"{name_full}の新規上場（JPX公表）。",
            "business": "・公式目論見書をご確認ください",
            "lock_up": "—",
            "vc_holdings": [],
            "approval_date": approval_iso,
        }

        enrich = IPO_ENRICHMENTS.get(code, {})
        for k, v in enrich.items():
            if v is not None and v != "":
                item[k] = v

        if not item.get("bb_period_fmt") and item.get("bb_start") and item.get("bb_end"):
            s = date.fromisoformat(item["bb_start"])
            e = date.fromisoformat(item["bb_end"])
            item["bb_period_fmt"] = f"{s.month}/{s.day} 〜 {e.month}/{e.day}"

        if _is_listed(item.get("listing_date")):
            continue

        status, status_label = _compute_status(
            item.get("listing_date"),
            item.get("bb_start"),
            item.get("bb_end"),
        )
        item["status"] = status
        item["status_label"] = status_label

        notify: list[dict] = []
        if item.get("bb_end"):
            notify.append(
                {
                    "type": "bb_deadline",
                    "at": f"{item['bb_end']}T15:00:00",
                    "label": "BB締切",
                }
            )
        if item.get("listing_date"):
            notify.append(
                {
                    "type": "listing_date",
                    "at": f"{item['listing_date']}T09:00:00",
                    "label": "上場日",
                }
            )
        item["notify_events"] = notify

        if not item.get("ai_first_day_expect"):
            item["ai_first_day_expect"] = {
                "score": 60,
                "label": "中立",
                "comment": "JPX公表情報に基づく参考表示です。",
            }

        rows.append(item)

    rows.sort(key=lambda x: x.get("listing_date") or "", reverse=True)
    return rows


def _build_fallback_catalog() -> list[dict]:
    if FALLBACK_CATALOG:
        return [dict(x) for x in FALLBACK_CATALOG]
    items = []
    for code, enrich in IPO_ENRICHMENTS.items():
        base = {
            "id": f"ipo_{code.lower()}",
            "type": "ipo",
            "code": code,
            "listing_date": enrich.get("listing_date"),
            "listing_date_fmt": enrich.get("listing_date_fmt", "—"),
            "price_range": enrich.get("price_range", "未定"),
            "expected_price": enrich.get("expected_price"),
            "expected_price_fmt": enrich.get("expected_price_fmt", "未定"),
            "offering_amount_fmt": enrich.get("offering_amount_fmt", "未定"),
            "lead_underwriter": enrich.get("lead_underwriter", "—"),
            "sector": enrich.get("sector", "—"),
            "overview": enrich.get("overview", ""),
            "business": enrich.get("business", ""),
            "lock_up": enrich.get("lock_up", "—"),
            "vc_holdings": enrich.get("vc_holdings", []),
            "bb_start": enrich.get("bb_start"),
            "bb_end": enrich.get("bb_end"),
            "bb_period_fmt": enrich.get("bb_period_fmt", "—"),
            "name": enrich.get("name", code),
            "name_full": enrich.get("name_full", enrich.get("name", code)),
            "market": enrich.get("market", "グロース"),
            "ai_first_day_expect": enrich.get("ai_first_day_expect"),
        }
        if _is_listed(base.get("listing_date")):
            continue

        status, status_label = _compute_status(
            base.get("listing_date"),
            base.get("bb_start"),
            base.get("bb_end"),
        )
        base["status"] = status
        base["status_label"] = status_label
        notify = []
        if base.get("bb_end"):
            notify.append(
                {"type": "bb_deadline", "at": f"{base['bb_end']}T15:00:00", "label": "BB締切"}
            )
        if base.get("listing_date"):
            notify.append(
                {
                    "type": "listing_date",
                    "at": f"{base['listing_date']}T09:00:00",
                    "label": "上場日",
                }
            )
        base["notify_events"] = notify
        items.append(base)
    items.sort(key=lambda x: x.get("listing_date") or "", reverse=True)
    return items


def fetch_ipo_catalog(force: bool = False) -> tuple[list[dict], dict]:
    """JPX から IPO 一覧を取得。失敗時はフォールバック。"""
    global _cache
    now = datetime.now()

    if (
        not force
        and _cache
        and _cache.get("items")
        and _cache.get("fetched_at")
        and (now - _cache["fetched_at"]).total_seconds() < CACHE_TTL_SEC
    ):
        return _cache["items"], _cache["meta"]

    source = "JPX（東証）"
    items: list[dict] = []
    try:
        html = _fetch_jpx_html()
        items = _parse_jpx_rows(html)
        if not items:
            raise ValueError("JPX parse returned empty list")
    except Exception:
        traceback.print_exc()
        items = _build_fallback_catalog()
        source = "参考データ（オフライン）"

    # 上場済み（上場日 <= 今日）は一覧から除外
    items = [i for i in items if not _is_listed(i.get("listing_date"))]

    meta = {
        "updated": now.strftime("%Y-%m-%d %H:%M"),
        "source": source,
        "ipo_count": len(items),
        "applying_ipo_count": sum(1 for i in items if i["status"] == "applying"),
        "awaiting_ipo_count": sum(1 for i in items if i["status"] == "awaiting_listing"),
        "scheduled_ipo_count": sum(1 for i in items if i["status"] == "scheduled"),
        "open_ipo_count": sum(1 for i in items if i["status"] == "applying"),
    }
    _cache = {"items": items, "meta": meta, "fetched_at": now}
    return items, meta


def get_cached_ipo_by_id(ipo_id: str) -> dict | None:
    items, _ = fetch_ipo_catalog()
    for item in items:
        if item["id"] == ipo_id or item.get("code", "").lower() == ipo_id.lower():
            return dict(item)
    code_m = re.search(r"(\d{3}[a-z])", ipo_id, re.I)
    if code_m:
        code = code_m.group(1).upper()
        for item in items:
            if item.get("code") == code:
                return dict(item)
    return None
