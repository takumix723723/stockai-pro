/**
 * AIファンド — 仮想100万円運用・市場比較・実力評価（実注文なし）
 *
 * デイトレ daily_records とシナリオ resolved を統合して NAV を算出
 */
(function (global) {
  const START_CAPITAL = 1000000;
  const DAY_TRADE_KEY = 'stockai_ai_day_trade';
  const SCENARIO_KEY = 'stockai_ai_trade_scenarios';
  const TERMINAL_DT = new Set(['target_hit', 'stop_hit', 'close_settlement']);

  function fmtYen(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n < 0 ? '-' : '';
    return sign + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  }

  function fmtSignedYen(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '-';
    return sign + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  }

  function fmtPct(n, digits = 1) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(digits) + '%';
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function parseStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function collectTrades() {
    const trades = [];
    const dt = parseStore(DAY_TRADE_KEY, { daily_records: [] });
    (dt.daily_records || []).forEach((rec) => {
      (rec.trades || []).forEach((t) => {
        if (t.final_pnl == null && !TERMINAL_DT.has(t.status)) return;
        trades.push({
          date: rec.date,
          pnl: t.final_pnl || 0,
          source: 'daytrade',
          symbol: t.symbol,
        });
      });
    });

    const sc = parseStore(SCENARIO_KEY, { resolved: [] });
    (sc.resolved || []).forEach((r) => {
      const date = (r.resolved_at || r.saved_at || '').slice(0, 10);
      if (!date || r.final_pnl == null) return;
      trades.push({
        date,
        pnl: r.final_pnl,
        source: 'scenario',
        symbol: r.symbol,
      });
    });

    return trades;
  }

  function buildDailyPnl(trades) {
    const byDate = {};
    trades.forEach((t) => {
      byDate[t.date] = (byDate[t.date] || 0) + t.pnl;
    });
    return byDate;
  }

  function buildNavCurve(dailyPnl) {
    const dates = Object.keys(dailyPnl).sort();
    if (!dates.length) {
      return [{ date: todayStr(), nav: START_CAPITAL, dailyPnl: 0 }];
    }

    const curve = [{ date: dates[0], nav: START_CAPITAL, dailyPnl: 0 }];
    let nav = START_CAPITAL;
    dates.forEach((d) => {
      const pnl = dailyPnl[d] || 0;
      nav += pnl;
      curve.push({ date: d, nav, dailyPnl: pnl });
    });
    return curve;
  }

  function calcMaxDrawdown(curve) {
    let peak = curve[0]?.nav || START_CAPITAL;
    let maxDd = 0;
    for (let i = 1; i < curve.length; i++) {
      peak = Math.max(peak, curve[i].nav);
      const dd = ((curve[i].nav - peak) / peak) * 100;
      maxDd = Math.min(maxDd, dd);
    }
    return Math.round(maxDd * 10) / 10;
  }

  function calcSharpe(curve) {
    if (curve.length < 3) return null;
    const rets = [];
    for (let i = 1; i < curve.length; i++) {
      const prev = curve[i - 1].nav;
      if (prev > 0) rets.push((curve[i].nav - prev) / prev);
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
    const std = Math.sqrt(variance);
    if (!std) return null;
    return Math.round((mean / std) * Math.sqrt(252) * 100) / 100;
  }

  function computeMetrics(trades, curve) {
    const pnls = trades.map((t) => t.pnl);
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const judged = wins.length + losses.length;
    const currentNav = curve[curve.length - 1]?.nav || START_CAPITAL;
    const cumulative = currentNav - START_CAPITAL;
    const returnPct = (cumulative / START_CAPITAL) * 100;
    const avgProfit = wins.length
      ? Math.round(wins.reduce((s, t) => s + t.pnl, 0) / wins.length)
      : null;
    const avgLoss = losses.length
      ? Math.round(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)
      : null;
    const expectedValue = pnls.length
      ? Math.round(pnls.reduce((a, b) => a + b, 0) / pnls.length)
      : 0;

    const dates = [...new Set(trades.map((t) => t.date))].sort();
    const firstDate = dates[0] || null;
    const lastDate = dates[dates.length - 1] || null;
    let operatingDays = dates.length;
    if (firstDate && lastDate) {
      const d0 = new Date(firstDate);
      const d1 = new Date(lastDate);
      operatingDays = Math.max(dates.length, Math.round((d1 - d0) / 86400000) + 1);
    }

    return {
      start_capital: START_CAPITAL,
      current_nav: currentNav,
      cumulative_pnl: cumulative,
      return_pct: Math.round(returnPct * 10) / 10,
      operating_days: operatingDays,
      trade_count: trades.length,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: judged ? Math.round((wins.length / judged) * 1000) / 10 : null,
      avg_profit: avgProfit,
      avg_loss: avgLoss,
      expected_value: expectedValue,
      expected_value_label: expectedValue > 0 ? 'プラス' : expectedValue < 0 ? 'マイナス' : '中立',
      max_profit: wins.length ? Math.max(...wins.map((t) => t.pnl)) : null,
      max_loss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : null,
      max_drawdown: calcMaxDrawdown(curve),
      sharpe_like: calcSharpe(curve),
      first_date: firstDate,
      last_date: lastDate,
      daytrade_trades: trades.filter((t) => t.source === 'daytrade').length,
      scenario_trades: trades.filter((t) => t.source === 'scenario').length,
    };
  }

  function computeGrade(metrics, beatsMarket) {
    if (metrics.trade_count < 3) {
      return { grade: 'C', label: 'データ蓄積中', score: 0 };
    }

    let score = 0;
    const r = metrics.return_pct;
    if (r >= 15) score += 25;
    else if (r >= 8) score += 20;
    else if (r >= 3) score += 12;
    else if (r >= 0) score += 5;
    else if (r >= -5) score += 0;
    else score -= 10;

    const wr = metrics.win_rate;
    if (wr != null) {
      if (wr >= 65) score += 20;
      else if (wr >= 58) score += 15;
      else if (wr >= 50) score += 8;
    }

    if (metrics.expected_value > 0) score += 10;
    else if (metrics.expected_value < 0) score -= 5;

    const dd = metrics.max_drawdown;
    if (dd >= -5) score += 15;
    else if (dd >= -10) score += 8;
    else if (dd >= -15) score += 3;

    const sh = metrics.sharpe_like;
    if (sh != null) {
      if (sh >= 1.5) score += 15;
      else if (sh >= 1) score += 10;
      else if (sh >= 0.5) score += 5;
    }

    if (beatsMarket) score += 15;

    let grade = 'D';
    let label = '要改善';
    if (score >= 85) { grade = 'S'; label = '優秀'; }
    else if (score >= 70) { grade = 'A'; label = '好調'; }
    else if (score >= 50) { grade = 'B'; label = '安定'; }
    else if (score >= 30) { grade = 'C'; label = '様子見'; }

    return { grade, label, score };
  }

  function buildFundState() {
    const trades = collectTrades();
    const dailyPnl = buildDailyPnl(trades);
    const curve = buildNavCurve(dailyPnl);
    const metrics = computeMetrics(trades, curve);
    return { trades, dailyPnl, curve, metrics };
  }

  async function fetchBenchmark(startDate, endDate) {
    const params = new URLSearchParams();
    if (startDate) params.set('start', startDate);
    if (endDate) params.set('end', endDate);
    const url = '/api/ai_fund/benchmark' + (params.toString() ? '?' + params.toString() : '');
    let data;
    if (global.ApiCache) {
      data = await global.ApiCache.fetchJsonCached(url, { ttl: 300000 });
    } else {
      const res = await fetch(url);
      data = await res.json();
    }
    return data.status === 'ok' ? data : null;
  }

  function marketVerdict(aiReturn, benchmarks) {
    const valid = (benchmarks || []).filter((b) => b.change_pct != null);
    if (!valid.length || aiReturn == null) return { beats: null, text: '比較データ不足' };
    const beatsAll = valid.every((b) => aiReturn > b.change_pct);
    const beatsAny = valid.some((b) => aiReturn > b.change_pct);
    if (beatsAll) return { beats: true, text: '市場を上回っています' };
    if (!beatsAny) return { beats: false, text: '市場を下回っています' };
    return { beats: false, text: '一部指数を下回っています' };
  }

  function metricRow(label, value, cls) {
    return `<div class="af-metric-row">
      <span class="af-metric-label">${label}</span>
      <span class="af-metric-value${cls ? ' ' + cls : ''}">${value}</span>
    </div>`;
  }

  function gradeClass(grade) {
    return 'af-grade-' + (grade || 'c').toLowerCase();
  }

  function homeHtml(state, bench, verdict) {
    const m = state.metrics;
    const cls = m.cumulative_pnl >= 0 ? 'up' : 'down';
    const grade = computeGrade(m, verdict?.beats);
    const benchLine = (bench?.benchmarks || [])
      .map((b) => `<span>${b.name} ${fmtPct(b.change_pct)}</span>`)
      .join(' · ');

    if (!m.trade_count) {
      return `
        <div class="af-home-hero card-premium">
          <div class="af-home-title">AIファンド</div>
          <div class="af-home-nav">${fmtYen(START_CAPITAL)}</div>
          <div class="af-home-meta">仮想資金100万円 · 実注文なし</div>
          <p class="af-home-empty">デイトレ・シナリオの検証結果が蓄積されると、長期成績が表示されます。</p>
        </div>`;
    }

    return `
      <div class="af-home-hero card-premium">
        <div class="af-home-head">
          <div class="af-home-title">AIファンド</div>
          <span class="af-grade-badge ${gradeClass(grade.grade)}">${grade.grade}</span>
        </div>
        <div class="af-home-nav">${fmtYen(m.current_nav)}</div>
        <div class="af-home-pnl ${cls}">${fmtSignedYen(m.cumulative_pnl)}（${fmtPct(m.return_pct)}）</div>
        <div class="af-home-meta">運用${m.operating_days}日 · 勝率${m.win_rate != null ? m.win_rate + '%' : '—'} · 期待値${m.expected_value_label}</div>
        ${benchLine ? `<div class="af-home-bench">${benchLine}</div>` : ''}
        ${verdict?.text ? `<div class="af-home-verdict ${verdict.beats ? 'up' : verdict.beats === false ? 'down' : ''}">${verdict.text}</div>` : ''}
      </div>`;
  }

  function panelHtml(state, bench, verdict) {
    const m = state.metrics;
    const grade = computeGrade(m, verdict?.beats);
    const pnlCls = m.cumulative_pnl >= 0 ? 'up' : 'down';
    const evCls = m.expected_value > 0 ? 'up' : m.expected_value < 0 ? 'down' : '';

    const benchRows = (bench?.benchmarks || []).map((b) => {
      const cls = b.change_pct != null && m.return_pct > b.change_pct ? 'up' : 'down';
      return metricRow(b.name, fmtPct(b.change_pct), cls);
    }).join('');

    const navRows = [...state.curve].reverse().slice(0, 14).map((p) => {
      const cls = (p.dailyPnl || 0) >= 0 ? 'up' : 'down';
      return `<div class="af-nav-row">
        <span>${p.date}</span>
        <span>${fmtYen(p.nav)}</span>
        <span class="${cls}">${fmtSignedYen(p.dailyPnl)}</span>
      </div>`;
    }).join('');

    return `
      <p class="af-disclaimer-top">※ 仮想シミュレーションです。実際の注文は一切行いません。デイトレ・シナリオの検証損益を100万円の仮想ファンドとして集計しています。</p>

      <section class="af-section card-premium">
        <h3 class="af-section-title">AIファンド</h3>
        ${metricRow('開始資金', fmtYen(m.start_capital))}
        ${metricRow('現在資産', fmtYen(m.current_nav))}
        ${metricRow('累計損益', fmtSignedYen(m.cumulative_pnl), pnlCls)}
        ${metricRow('運用日数', m.operating_days + '日')}
        ${metricRow('最大ドローダウン', fmtPct(m.max_drawdown))}
        ${metricRow('勝率', m.win_rate != null ? m.win_rate + '%' : '—')}
        ${metricRow('期待値', m.expected_value_label, evCls)}
        <div class="af-source-meta">内訳: デイトレ${m.daytrade_trades}件 · シナリオ${m.scenario_trades}件</div>
      </section>

      <section class="af-section card-premium">
        <h3 class="af-section-title">AI vs 市場</h3>
        <p class="af-period">${bench?.start_date || m.first_date || '—'} 〜 ${bench?.end_date || m.last_date || todayStr()}</p>
        ${metricRow('AIファンド', fmtPct(m.return_pct), pnlCls)}
        ${benchRows || metricRow('日経平均', '—')}
        ${verdict?.text ? `<div class="af-verdict-banner ${verdict.beats ? 'up' : verdict.beats === false ? 'down' : ''}">${verdict.text}</div>` : ''}
      </section>

      <section class="af-section card-premium">
        <h3 class="af-section-title">AIの実力評価</h3>
        <div class="af-grade-hero ${gradeClass(grade.grade)}">
          <div class="af-grade-letter">${grade.grade}</div>
          <div class="af-grade-sub">${grade.label}</div>
        </div>
        <div class="af-metrics-grid">
          ${metricRow('勝率', m.win_rate != null ? m.win_rate + '%' : '—')}
          ${metricRow('累計損益', fmtSignedYen(m.cumulative_pnl), pnlCls)}
          ${metricRow('平均利益', m.avg_profit != null ? fmtSignedYen(m.avg_profit) : '—', 'up')}
          ${metricRow('平均損失', m.avg_loss != null ? fmtSignedYen(m.avg_loss) : '—', 'down')}
          ${metricRow('期待値（1件あたり）', fmtSignedYen(m.expected_value), evCls)}
          ${metricRow('最大利益', m.max_profit != null ? fmtSignedYen(m.max_profit) : '—', 'up')}
          ${metricRow('最大損失', m.max_loss != null ? fmtSignedYen(m.max_loss) : '—', 'down')}
          ${metricRow('最大ドローダウン', fmtPct(m.max_drawdown))}
          ${metricRow('シャープレシオ風', m.sharpe_like != null ? String(m.sharpe_like) : '—')}
          ${metricRow('検証件数', m.trade_count + '件')}
        </div>
      </section>

      ${navRows ? `
      <section class="af-section card-premium">
        <h3 class="af-section-title">日次NAV推移</h3>
        <div class="af-nav-head"><span>日付</span><span>資産</span><span>日次損益</span></div>
        <div class="af-nav-list">${navRows}</div>
      </section>` : ''}

      <p class="af-disclaimer">${bench?.disclaimer || '※参考データです。投資判断の保証ではありません。'}</p>`;
  }

  let _homeStarted = false;

  const AiFund = {
    START_CAPITAL,

    getState() {
      return buildFundState();
    },

    renderHome(hostId) {
      const host = document.getElementById(hostId);
      if (!host) return;
      const state = buildFundState();
      host.innerHTML = '<div class="af-home-skeleton"><div class="skeleton-card"></div></div>';
      AiFund._renderHomeAsync(host, state);
    },

    async _renderHomeAsync(host, state) {
      try {
        const bench = state.metrics.first_date
          ? await fetchBenchmark(state.metrics.first_date, state.metrics.last_date || todayStr())
          : null;
        const verdict = marketVerdict(state.metrics.return_pct, bench?.benchmarks);
        host.innerHTML = homeHtml(state, bench, verdict);
      } catch (e) {
        console.error(e);
        host.innerHTML = homeHtml(state, null, null);
      }
    },

    async initHome() {
      const host = document.getElementById('aiFundHome');
      if (!host || _homeStarted) return;
      _homeStarted = true;
      AiFund.renderHome('aiFundHome');
    },

    async loadPanel(hostId) {
      const host = document.getElementById(hostId);
      if (!host) return;
      const state = buildFundState();
      try {
        const bench = state.metrics.first_date
          ? await fetchBenchmark(state.metrics.first_date, state.metrics.last_date || todayStr())
          : await fetchBenchmark(null, todayStr());
        const verdict = marketVerdict(state.metrics.return_pct, bench?.benchmarks);
        host.innerHTML = panelHtml(state, bench, verdict);
      } catch (e) {
        console.error(e);
        host.innerHTML = panelHtml(state, null, null);
      }
    },
  };

  global.AiFund = AiFund;
})(typeof window !== 'undefined' ? window : globalThis);
