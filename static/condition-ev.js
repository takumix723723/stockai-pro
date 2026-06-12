/**
 * 条件別期待値分析 — デイトレ・シナリオの検証結果を統合
 */
(function (global) {
  const DAY_TRADE_KEY = 'stockai_ai_day_trade';
  const SCENARIO_KEY = 'stockai_ai_trade_scenarios';
  const TERMINAL_DT = new Set(['target_hit', 'stop_hit', 'close_settlement']);

  const CONDITION_DEFS = [
    { key: 'ma5_up', label: '5分足上昇', pattern: 'ma5_up' },
    { key: 'ma15_up', label: '15分足上昇', pattern: 'ma15_up' },
    { key: 'volume_surge', label: '出来高急増', pattern: 'volume_surge' },
    { key: 'rsi_rebound', label: 'RSI反発', pattern: 'rsi_rebound' },
    { key: 'surge_chase', label: '急騰追随', pattern: 'surge_chase' },
  ];

  const THEME_BUCKETS = ['半導体', '商社', '銀行', '防衛', 'AI'];

  function parseStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function tradePnlRate(trade) {
    if (trade.final_pnl_rate != null && !Number.isNaN(trade.final_pnl_rate)) {
      return trade.final_pnl_rate;
    }
    const shares = trade.shares || 100;
    if (trade.buy_price && trade.final_pnl != null && trade.buy_price > 0) {
      const cap = trade.buy_price * shares;
      return Math.round((trade.final_pnl / cap) * 10000) / 100;
    }
    const pnl = trade.final_pnl || 0;
    if (pnl > 0) return 1;
    if (pnl < 0) return -1;
    return 0;
  }

  function inferSignals(trade) {
    const s = trade.signals || {};
    const r = trade.reason || trade.selection_reasons?.join?.(' ') || '';
    return {
      ma5_up: !!(s.ma5_up || r.includes('5分足')),
      ma15_up: !!(s.ma15_up || r.includes('15分足')),
      volume_surge: !!(s.volume_surge || r.includes('出来高')),
      rsi_rebound: !!(s.rsi_rebound || r.includes('反発') || r.includes('RSI')),
      surge_chase: !!(s.surge_chase || (trade.change_pct != null && trade.change_pct >= 3)),
    };
  }

  function collectAllTrades() {
    const trades = [];
    const dt = parseStore(DAY_TRADE_KEY, { daily_records: [] });
    (dt.daily_records || []).forEach((rec) => {
      (rec.trades || []).forEach((t) => {
        if (t.final_pnl == null && !TERMINAL_DT.has(t.status)) return;
        trades.push({ ...t, source: 'daytrade', record_date: rec.date });
      });
    });

    const sc = parseStore(SCENARIO_KEY, { resolved: [] });
    (sc.resolved || []).forEach((r) => {
      if (r.final_pnl == null) return;
      trades.push({
        ...r,
        source: 'scenario',
        record_date: (r.resolved_at || r.saved_at || '').slice(0, 10),
      });
    });
    return trades;
  }

  function bucketEV(trades, matchFn) {
    const matched = trades.filter(matchFn);
    if (!matched.length) return null;

    const wins = matched.filter((t) => (t.final_pnl || 0) > 0);
    const losses = matched.filter((t) => (t.final_pnl || 0) < 0);
    const judged = wins.length + losses.length;
    if (!judged) return null;

    const profitRates = wins.map(tradePnlRate);
    const lossRates = losses.map(tradePnlRate);
    const avgProfit = wins.length
      ? Math.round((profitRates.reduce((a, b) => a + b, 0) / wins.length) * 10) / 10
      : null;
    const avgLoss = losses.length
      ? Math.round((lossRates.reduce((a, b) => a + b, 0) / losses.length) * 10) / 10
      : null;
    const wr = wins.length / judged;
    const ev = wr * (avgProfit || 0) + (1 - wr) * (avgLoss || 0);

    return {
      count: matched.length,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: Math.round(wr * 1000) / 10,
      avg_profit_pct: avgProfit,
      avg_loss_pct: avgLoss,
      expected_value_pct: Math.round(ev * 10) / 10,
    };
  }

  function computeAllConditionStats(trades) {
    const byKey = {};
    const rows = [];

    CONDITION_DEFS.forEach((def) => {
      const stats = bucketEV(trades, (t) => inferSignals(t)[def.key]);
      if (!stats) return;
      byKey[def.key] = { ...stats, label: def.label, kind: 'condition' };
      rows.push({ key: def.key, label: def.label, kind: 'condition', ...stats });
    });

    THEME_BUCKETS.forEach((theme) => {
      const key = `theme_${theme}`;
      const stats = bucketEV(trades, (t) =>
        (t.themes || []).some((th) => th.includes(theme) || theme.includes(th))
      );
      if (!stats) return;
      byKey[key] = { ...stats, label: `${theme}テーマ`, kind: 'theme' };
      rows.push({ key, label: `${theme}テーマ`, kind: 'theme', ...stats });
    });

    const ranked = [...rows].sort((a, b) => (b.expected_value_pct || 0) - (a.expected_value_pct || 0));
    return { byKey, rows, ranked };
  }

  function buildLearningHintsFromEV(stats) {
    const hints = {
      condition_ev: stats.byKey,
      boost_patterns: [],
      penalize_patterns: [],
      boost_themes: [],
      penalize_themes: [],
    };

    stats.rows.forEach((row) => {
      const ev = row.expected_value_pct;
      if (ev == null || row.count < 2) return;
      if (row.kind === 'condition') {
        if (ev >= 0.8) hints.boost_patterns.push(row.key);
        else if (ev <= -0.5) hints.penalize_patterns.push(row.key);
      } else if (row.kind === 'theme') {
        const theme = row.label.replace(/テーマ$/, '');
        if (ev >= 0.8) hints.boost_themes.push(theme);
        else if (ev <= -0.5) hints.penalize_themes.push(theme);
      }
    });

    hints.boost_patterns = [...new Set(hints.boost_patterns)].slice(0, 4);
    hints.penalize_patterns = [...new Set(hints.penalize_patterns)].slice(0, 4);
    hints.boost_themes = [...new Set(hints.boost_themes)].slice(0, 4);
    hints.penalize_themes = [...new Set(hints.penalize_themes)].slice(0, 3);
    return hints;
  }

  function fmtPct(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }

  function evCls(ev) {
    if (ev == null) return '';
    if (ev > 0) return 'up';
    if (ev < 0) return 'down';
    return 'neutral';
  }

  function evCardHtml(row) {
    const cls = evCls(row.expected_value_pct);
    return `
      <div class="dt-ev-card">
        <div class="dt-ev-head">
          <span class="dt-ev-label">${row.label}</span>
          <span class="dt-ev-val ${cls}">${fmtPct(row.expected_value_pct)}</span>
        </div>
        <div class="dt-ev-meta">
          勝率 ${row.win_rate != null ? row.win_rate + '%' : '—'}
          · 平均利益 ${fmtPct(row.avg_profit_pct)}
          · 平均損失 ${fmtPct(row.avg_loss_pct)}
          · ${row.count}件
        </div>
      </div>`;
  }

  function evRankingHtml(ranked) {
    if (!ranked.length) return '<p class="dt-empty">データなし</p>';
    return `<ol class="dt-ev-ranking">${ranked.map((row, i) => {
      const cls = evCls(row.expected_value_pct);
      return `<li class="dt-ev-rank-item">
        <span class="dt-ev-rank-num">${i + 1}位</span>
        <span class="dt-ev-rank-label">${row.label}</span>
        <span class="dt-ev-rank-val ${cls}">${fmtPct(row.expected_value_pct)}</span>
      </li>`;
    }).join('')}</ol>`;
  }

  function insightBulletsFromEV(stats) {
    const bullets = [];
    if (!stats.rows.length) {
      return ['取引履歴が増えると、条件別期待値がここに表示されます'];
    }
    const top = stats.ranked.filter((r) => r.count >= 2 && (r.expected_value_pct || 0) >= 0.8).slice(0, 3);
    const bottom = [...stats.ranked].reverse().filter((r) => r.count >= 2 && (r.expected_value_pct || 0) <= -0.5).slice(0, 2);

    top.forEach((r) => {
      bullets.push(`${r.label}は期待値${fmtPct(r.expected_value_pct)} — 加点対象`);
    });
    bottom.forEach((r) => {
      bullets.push(`${r.label}は期待値${fmtPct(r.expected_value_pct)} — 減点対象`);
    });

    stats.rows.forEach((r) => {
      if (r.count < 2) return;
      if (r.win_rate >= 60 && (r.expected_value_pct || 0) < 0) {
        bullets.push(`${r.label}は勝率${r.win_rate}%だが期待値マイナス — 見送り学習`);
      }
      if (r.win_rate < 45 && (r.expected_value_pct || 0) > 0.5) {
        bullets.push(`${r.label}は勝率${r.win_rate}%でも期待値プラス — 評価継続`);
      }
    });

    if (!bullets.length) bullets.push('条件別期待値を蓄積して学習精度を高めます');
    return [...new Set(bullets)].slice(0, 6);
  }

  const ConditionEV = {
    CONDITION_DEFS,
    THEME_BUCKETS,
    collectAllTrades,
    inferSignals,
    bucketEV,
    computeAllConditionStats,
    buildLearningHintsFromEV,
    evCardHtml,
    evRankingHtml,
    insightBulletsFromEV,
    fmtPct,
    evCls,
  };

  global.ConditionEV = ConditionEV;
})(typeof window !== 'undefined' ? window : globalThis);
