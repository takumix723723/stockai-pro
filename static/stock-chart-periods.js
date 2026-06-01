/**
 * チャート期間タブ v39 — 5分/15分/1日/1週/1ヶ月/6ヶ月/1年
 */
(function (global) {
  const PERIOD_UI_VERSION = 'v39';
  /** 1日チャート基準の表示本数（ローソク幅の基準） */
  const CHART_BASELINE_BARS = 52;

  const CHART_PERIOD_DEFS = [
    { id: '5m', label: '5分', intraday: true, visibleBars: 65 },
    { id: '15m', label: '15分', intraday: true, visibleBars: 65 },
    { id: '1D', label: '1日', intraday: false, visibleBars: CHART_BASELINE_BARS },
    { id: '1w', label: '1週', intraday: false, visibleBars: CHART_BASELINE_BARS },
    { id: '1M', label: '1ヶ月', intraday: false, visibleBars: 22 },
    { id: '6M', label: '6ヶ月', intraday: false, visibleBars: CHART_BASELINE_BARS },
    { id: '1Y', label: '1年', intraday: false, visibleBars: CHART_BASELINE_BARS },
  ];

  const LEGACY_PERIOD_MAP = {
    '1d': '5m',
    '1m': '5m',
    '1w': '1w',
    '1mo': '1M',
    '3mo': '6M',
    '1y': '1Y',
    '30m': '15m',
    '1h': '1D',
  };

  function periodLabels() {
    const map = {};
    CHART_PERIOD_DEFS.forEach((p) => { map[p.id] = p.label; });
    return map;
  }

  function isIntradayPeriod(period) {
    const def = CHART_PERIOD_DEFS.find((p) => p.id === period);
    return def ? !!def.intraday : false;
  }

  function migrateChartPeriod(saved) {
    if (!saved) return null;
    const resolved = LEGACY_PERIOD_MAP[saved] || saved;
    return CHART_PERIOD_DEFS.some((p) => p.id === resolved) ? resolved : null;
  }

  function isLegacyPeriodUI(host) {
    if (!host) return true;
    if (host.dataset.periodUi !== PERIOD_UI_VERSION) return true;
    if (host.querySelector('[data-period="1mo"], [data-period="3mo"], [data-period="1y"]')) return true;
    if (!host.querySelector('[data-period="5m"], [data-period="15m"]')) return true;
    return false;
  }

  function periodTabsHtml() {
    return CHART_PERIOD_DEFS.map((p) => (
      `<button type="button" class="period-btn" data-period="${p.id}" role="tab" aria-selected="false">${p.label}</button>`
    )).join('');
  }

  /** 旧UI（1月/3月/1年）を検出したら新7タブへ強制置換 */
  function ensureChartPeriodTabs(host) {
    if (!host || !isLegacyPeriodUI(host)) return false;
    host.dataset.periodUi = PERIOD_UI_VERSION;
    host.setAttribute('role', 'tablist');
    host.setAttribute('aria-label', 'チャート期間');
    host.innerHTML = periodTabsHtml();
    return true;
  }

  function renderChartPeriodTabs(host, onSelect) {
    if (!host) return;
    ensureChartPeriodTabs(host);
    host.querySelectorAll('.period-btn').forEach((btn) => {
      btn.addEventListener('click', () => onSelect(btn.dataset.period));
    });
  }

  /** 1日チャート基準のローソク幅 — SBI/TradingView風 */
  function chartBarSpacing(chartWidth) {
    const plotWidth = Math.max(240, chartWidth - 52);
    return Math.max(7, Math.min(15, plotWidth / CHART_BASELINE_BARS));
  }

  function applyChartViewport(chart, candleCount, opts = {}) {
    if (!chart || !candleCount) return;
    const width = opts.width || 400;
    const spacing = chartBarSpacing(width);
    const visible = opts.visibleBars || CHART_BASELINE_BARS;
    const intraday = !!opts.intraday;

    chart.timeScale().applyOptions({
      barSpacing: spacing,
      minBarSpacing: spacing * 0.72,
      rightOffset: 10,
      fixLeftEdge: false,
      fixRightEdge: false,
    });

    if (candleCount > visible) {
      chart.timeScale().setVisibleLogicalRange({
        from: candleCount - visible - 1,
        to: candleCount + 3,
      });
    } else if (intraday) {
      try {
        chart.timeScale().scrollToRealTime();
      } catch (_) {
        chart.timeScale().setVisibleLogicalRange({ from: -1, to: visible + 2 });
      }
    } else {
      chart.timeScale().setVisibleLogicalRange({
        from: -1,
        to: Math.max(candleCount, visible) + 2,
      });
    }
  }

  global.CHART_PERIOD_UI_VERSION = PERIOD_UI_VERSION;
  global.CHART_PERIOD_DEFS = CHART_PERIOD_DEFS;
  global.CHART_PERIOD_LABELS = periodLabels();
  global.CHART_BASELINE_BARS = CHART_BASELINE_BARS;
  global.migrateChartPeriod = migrateChartPeriod;
  global.ensureChartPeriodTabs = ensureChartPeriodTabs;
  global.renderChartPeriodTabs = renderChartPeriodTabs;
  global.isIntradayChartPeriod = isIntradayPeriod;
  global.chartBarSpacing = chartBarSpacing;
  global.applyChartViewport = applyChartViewport;

  /* 旧HTMLキャッシュ対策: スクリプト読込直後に即時チェック */
  const earlyHost = document.getElementById('periodTabs');
  if (earlyHost) ensureChartPeriodTabs(earlyHost);
})(window);
