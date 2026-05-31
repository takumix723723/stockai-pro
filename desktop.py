# -*- coding: utf-8 -*-
"""
StockAI Pro デスクトップ版（pywebview + WebView2）
Flask をバックグラウンドで起動し、メインスレッドで独立ウィンドウを表示する。
"""
from __future__ import annotations

import multiprocessing
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

HOST = "127.0.0.1"
PORT = 5000
# desktop=1 … pywebview 向け（SW登録をフロントでスキップ可能）
APP_URL = f"http://{HOST}:{PORT}/?desktop=1"
WINDOW_TITLE = "StockAI Pro"
WINDOW_SIZE = (1400, 900)
WINDOW_MIN_SIZE = (1000, 700)

_flask_server = None
_server_ready = threading.Event()
_server_failed: Exception | None = None


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def _icon_path() -> str | None:
    path = os.path.join(_base_dir(), "static", "icons", "app.ico")
    return path if os.path.isfile(path) else None


def _port_is_open(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _http_responds(url: str, timeout: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "StockAIPro-Desktop/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except urllib.error.HTTPError as err:
        return err.code < 500
    except (urllib.error.URLError, OSError, TimeoutError, ValueError):
        return False


def _wait_for_server(timeout_sec: float = 60.0) -> bool:
    """ソケット接続 → HTTP 200 系の順で待機"""
    deadline = time.time() + timeout_sec

    while time.time() < deadline:
        if _server_failed is not None:
            return False
        if _port_is_open(HOST, PORT):
            break
        time.sleep(0.1)

    while time.time() < deadline:
        if _server_failed is not None:
            return False
        if _http_responds(APP_URL):
            return True
        time.sleep(0.15)

    return False


def _run_flask() -> None:
    global _flask_server, _server_failed
    try:
        from werkzeug.serving import make_server

        from app import app

        _flask_server = make_server(HOST, PORT, app, threaded=True)
        _server_ready.set()
        _flask_server.serve_forever()
    except Exception as exc:
        _server_failed = exc
        _server_ready.set()


def _start_webview_window() -> None:
    """メインスレッドで pywebview を起動（Windows は edgechromium / WebView2）"""
    import webview

    window = webview.create_window(
        WINDOW_TITLE,
        APP_URL,
        width=WINDOW_SIZE[0],
        height=WINDOW_SIZE[1],
        min_size=WINDOW_MIN_SIZE,
        resizable=True,
        text_select=True,
    )

    icon = _icon_path()
    start_kwargs: dict = {"debug": False}
    if sys.platform == "win32":
        start_kwargs["gui"] = "edgechromium"
    if icon:
        start_kwargs["icon"] = icon

    # メインスレッドでブロック → ウィンドウ表示（google.com テストと同じ流れ）
    webview.start(**start_kwargs)


def run_desktop() -> None:
    global _server_failed, _flask_server

    _server_ready.clear()
    _server_failed = None
    _flask_server = None

    server_thread = threading.Thread(
        target=_run_flask, daemon=True, name="stockai-flask"
    )
    server_thread.start()

    if not _server_ready.wait(timeout=30):
        raise RuntimeError("Flask スレッドの起動がタイムアウトしました")

    if _server_failed is not None:
        raise RuntimeError(f"Flask の起動に失敗しました: {_server_failed}") from _server_failed

    if not _wait_for_server():
        raise RuntimeError(
            f"Flask サーバー ({APP_URL}) が応答しません。"
            "ポート 5000 が他プロセスで使用されていないか確認してください。"
        )

    _start_webview_window()


def main() -> None:
    run_desktop()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as exc:
        import traceback

        traceback.print_exc()
        if sys.platform == "win32" and getattr(sys, "frozen", False):
            import ctypes

            ctypes.windll.user32.MessageBoxW(  # type: ignore[attr-defined]
                0,
                str(exc),
                WINDOW_TITLE,
                0x10,
            )
        raise SystemExit(1) from exc
