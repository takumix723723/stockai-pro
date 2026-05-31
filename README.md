# StockAI Pro

日本株のリアルタイム分析・AIスコア・テクニカルチャートを提供する Web アプリ（PWA / Windows exe 対応）。

## 起動方法

### 開発環境

```bash
cd stock-app
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

ブラウザで http://127.0.0.1:5000 を開きます（従来通り・PWA / Render 公開もこのモード）。

### デスクトップ版（pywebview・URLバーなし）

```bash
python app.py --desktop
# または
python desktop.py
```

独立ウィンドウ（1400×900）で同じ UI を表示します。

### Windows アプリ（exe）

```bat
build.bat
```

成功すると `dist\StockAIPro.exe` が生成されます。ダブルクリックで **pywebview 独立ウィンドウ** が開きます（ブラウザは起動しません）。エントリは `desktop.py` です。

## 主な機能

- 銘柄検索・ウォッチリスト（localStorage）
- 株価・PTS・ローソクチャート（MA5/25/75、BB）
- テクニカル分析（RSI、MACD、ボリンジャー）
- AI分析カード・トレンド判定
- セクター比較・ニュース・保有情報
- 市場指数・テーマ銘柄・急騰急落ランキング
- 価格アラート（ブラウザ通知）
- PWA（ホーム画面追加・オフライン表示）

## PWA

1. Chrome / Edge / Safari でアプリを開く
2. 「StockAI Pro をインストール」バナー、またはメニューから「ホーム画面に追加」
3. スタンドアロンで起動（`manifest.json` + Service Worker）

オフライン時は `/offline` ページを表示します。

## exe 作成の要件

- Windows 10/11
- Python 3.10+
- `pip install -r requirements.txt`（pywebview / PyInstaller / Pillow 含む）

**requirements.txt 例:**

```
flask>=3.0.0
flask-cors>=4.0.0
yfinance>=0.2.40
pandas>=2.0.0
numpy>=1.24.0
pywebview>=5.0
pyinstaller>=6.3.0
pillow>=10.0.0
```

`build.bat` は UTF-8（`chcp 65001`）で実行し、`templates` / `static` をバンドルします。

## 文字コード

- ソース・テンプレート: **UTF-8**
- API: `JSON_AS_ASCII = False` + `charset=utf-8`

## ライセンス

個人利用・学習目的のサンプルプロジェクトです。株価データは Yahoo Finance（yfinance）経由で取得します。
