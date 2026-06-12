"""API メモリキャッシュ（TTL）"""
from __future__ import annotations

import time
from datetime import datetime

from flask import jsonify

_API_CACHE: dict[str, tuple[float, dict]] = {}

# TTL（秒）
CACHE_TTL_STOCK = 12          # 株価スナップショット
CACHE_TTL_QUOTE = 15          # 軽量クォート
CACHE_TTL_MARKET = 300        # 指数・テーマ（5分）
CACHE_TTL_RANKING = 300       # 急騰急落（5分）
CACHE_TTL_FUND = 600          # ファンドスクリーナー（10分）
CACHE_TTL_SCENARIO = 180      # AI売買候補（3分）
CACHE_TTL_DAYTRADE = 180      # AI仮想デイトレ（3分）
CACHE_TTL_SEARCH = 600        # 検索インデックス補助
CACHE_TTL_IPO = 1800          # IPO（30分）


def cache_get(key: str, ttl: int) -> dict | None:
    row = _API_CACHE.get(key)
    if not row:
        return None
    ts, data = row
    if time.time() - ts > ttl:
        return None
    return data


def cache_set(key: str, data: dict) -> None:
    _API_CACHE[key] = (time.time(), data)


def json_cached(key: str, ttl: int, builder):
    """TTL キャッシュ付き JSON レスポンス"""
    hit = cache_get(key, ttl)
    if hit is not None:
        out = dict(hit)
        out["cached"] = True
        return jsonify(out)
    payload = builder()
    if isinstance(payload, dict):
        payload = dict(payload)
        payload["cached"] = False
        if "updated" not in payload:
            payload["updated"] = datetime.now().strftime("%H:%M")
        cache_set(key, payload)
        return jsonify(payload)
    return payload


def invalidate_prefix(prefix: str) -> None:
    for k in list(_API_CACHE.keys()):
        if k.startswith(prefix):
            del _API_CACHE[k]
