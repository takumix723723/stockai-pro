/**
 * AI仮想デイトレ検証 — 実注文なし・シミュレーション専用
 *
 * localStorage スキーマ v2:
 * {
 *   version: 2,
 *   today, daily_records, learning_logs,
 *   growth_snapshots: [{ date, month_key, win_rate, avg_profit, avg_loss, risk_reward, month_pnl }],
 *   self_evaluations: [{ date, good, bad, tomorrow, text }]
 * }
 */
(function (global) {
  const STORAGE_KEY = 'stockai_ai_day_trade';
  const TERMINAL = new Set(['target_hit', 'stop_hit', 'close_settlement']);
  const STATUS_LABEL = {
    watching: '監視中',
    entered: 'エントリー済み',
    target_hit: '利確',
    stop_hit: '損切り',
    close_settlement: '引け決済',
  };

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

  function fmtPct(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }

  function fmtNum(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('ja-JP');
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dateLabel(iso) {
    if (!iso) return '—';
    const p = iso.split('-');
    return p.length === 3 ? `${+p[1]}/${+p[2]}` : iso;
  }

  function isMarketClose() {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    return h > 15 || (h === 15 && m >= 30);
  }

  const THEME_BUCKETS = ['半導体', '商社', '銀行', '防衛', 'AI'];
  const CONDITION_DEFS = [
    { key: 'ma5_up', label: '5分足上昇' },
    { key: 'ma15_up', label: '15分足上昇' },
    { key: 'volume_surge', label: '出来高急増' },
    { key: 'rsi_rebound', label: 'RSI反発' },
    { key: 'surge_chase', label: '急騰追随' },
  ];

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : { version: 2, today: null, daily_records: [], learning_logs: [], growth_snapshots: [], self_evaluations: [] };
      data.version = 2;
      if (!data.daily_records) data.daily_records = [];
      if (!data.learning_logs) data.learning_logs = [];
      if (!data.growth_snapshots) data.growth_snapshots = [];
      if (!data.self_evaluations) data.self_evaluations = [];
      return data;
    } catch {
      return { version: 2, today: null, daily_records: [], learning_logs: [], growth_snapshots: [], self_evaluations: [] };
    }
  }

  function saveStore(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (_) { /* ignore */ }
  }

  function calcPnl(trade, current) {
    if (current == null || !trade.buy_price || !trade.shares) return null;
    const pnl = (current - trade.buy_price) * trade.shares;
    const rate = ((current - trade.buy_price) / trade.buy_price) * 100;
    return { pnl: Math.round(pnl), rate: Math.round(rate * 100) / 100, current };
  }

  function resolveTradeStatus(trade, current) {
    if (trade.status && TERMINAL.has(trade.status)) return trade.status;
    if (current != null && trade.target_price != null && current >= trade.target_price) return 'target_hit';
    if (current != null && trade.stop_price != null && current <= trade.stop_price) return 'stop_hit';
    if (isMarketClose()) return 'close_settlement';
    return trade.status || 'entered';
  }

  function finalizeTrade(trade, current) {
    const status = resolveTradeStatus(trade, current);
    if (!TERMINAL.has(status)) return { ...trade, status: status === 'entered' ? 'entered' : status };

    let exitPrice = current ?? trade.last_current ?? trade.buy_price;
    let outcome = 'draw';
    if (status === 'target_hit') {
      exitPrice = trade.target_price;
      outcome = 'win';
    } else if (status === 'stop_hit') {
      exitPrice = trade.stop_price;
      outcome = 'loss';
    } else {
      const pnl = (exitPrice - trade.buy_price) * trade.shares;
      outcome = pnl > 0 ? 'win' : (pnl < 0 ? 'loss' : 'draw');
    }
    const pnl = Math.round((exitPrice - trade.buy_price) * trade.shares);
    const now = new Date();
    return {
      ...trade,
      status,
      outcome,
      exit_price: exitPrice,
      exit_time: trade.exit_time || now.toTimeString().slice(0, 5),
      final_pnl: pnl,
      final_pnl_rate: trade.buy_price ? Math.round(((exitPrice - trade.buy_price) / trade.buy_price) * 10000) / 100 : 0,
      resolved_at: now.toISOString(),
      last_current: exitPrice,
    };
  }

  function buildLearningLog(trades, totalPnl) {
    const wins = trades.filter((t) => (t.final_pnl || 0) > 0);
    const losses = trades.filter((t) => (t.final_pnl || 0) < 0);
    const stops = trades.filter((t) => t.status === 'stop_hit');

    const goodParts = [];
    const badParts = [];
    const improveParts = [];

    if (wins.length) {
      const themes = wins.flatMap((t) => t.themes || []).filter(Boolean);
      if (themes.length) goodParts.push(`${themes[0]}テーマと出来高増加の組み合わせが有効だった`);
      else goodParts.push('エントリー後の上昇トレンドを捉えられた');
    }
    if (losses.length) {
      badParts.push('エントリー後の反落に損切りが間に合わなかったケースがあった');
    }
    if (stops.length >= 2) {
      badParts.push('損切り到達が多く、エントリー条件の見直しが必要');
      improveParts.push('出来高が維持されない銘柄はエントリー見送り');
    }
    const earlyTargets = wins.filter((t) => t.status === 'target_hit');
    if (earlyTargets.length && wins.length) {
      badParts.push('利確が早すぎて後半の上昇を取り逃した可能性');
      improveParts.push('出来高が維持されている場合は利確ラインを少し伸ばす');
    }
    if (!improveParts.length) {
      improveParts.push('勝率の高いテーマを優先し、損切り条件を厳守する');
    }
    if (!goodParts.length) goodParts.push('リスク管理の観点で損切りラインを守れた');
    if (!badParts.length && totalPnl < 0) badParts.push('全体としてマイナス — エントリー銘柄数を絞る');

    return {
      total_pnl: totalPnl,
      good_points: goodParts.join('。') + '。',
      bad_points: badParts.join('。') + (badParts.length ? '。' : ''),
      improvements: improveParts.join('。') + '。',
    };
  }

  function extractLearningHints(store) {
    const hints = {
      boost_themes: [],
      penalize_themes: [],
      penalize_symbols: [],
      boost_patterns: [],
      extend_target: false,
    };
    const logs = store.learning_logs || [];
    const records = store.daily_records || [];

    logs.slice(0, 7).forEach((log) => {
      if ((log.total_pnl || 0) > 0 && log.good_points) {
        ['半導体', 'AI', '防衛', '商社', '銀行', '量子', '宇宙'].forEach((t) => {
          if (log.good_points.includes(t) && !hints.boost_themes.includes(t)) hints.boost_themes.push(t);
        });
      }
      if ((log.total_pnl || 0) < 0 && log.bad_points) {
        if (log.bad_points.includes('利確が早すぎ')) hints.extend_target = true;
      }
    });

    records.slice(0, 14).forEach((rec) => {
      (rec.trades || []).forEach((t) => {
        if (t.status === 'stop_hit') {
          if (!hints.penalize_symbols.includes(t.symbol)) hints.penalize_symbols.push(t.symbol);
          (t.themes || []).forEach((th) => {
            if (!hints.penalize_themes.includes(th)) hints.penalize_themes.push(th);
          });
        }
        if (t.status === 'target_hit' && (t.themes || []).length) {
          t.themes.forEach((th) => {
            if (!hints.boost_themes.includes(th)) hints.boost_themes.push(th);
          });
        }
      });
    });

    hints.boost_themes = hints.boost_themes.slice(0, 4);
    hints.penalize_themes = hints.penalize_themes.slice(0, 3);
    hints.penalize_symbols = hints.penalize_symbols.slice(0, 5);
    return hints;
  }

  function summarizeDay(trades) {
    const pnls = trades.map((t) => t.final_pnl || 0);
    const total = pnls.reduce((a, b) => a + b, 0);
    const wins = trades.filter((t) => (t.final_pnl || 0) > 0);
    const losses = trades.filter((t) => (t.final_pnl || 0) < 0);
    const judged = wins.length + losses.length;
    const avgProfit = wins.length ? Math.round(wins.reduce((s, t) => s + (t.final_pnl || 0), 0) / wins.length) : null;
    const avgLoss = losses.length ? Math.round(losses.reduce((s, t) => s + (t.final_pnl || 0), 0) / losses.length) : null;
    let riskReward = null;
    if (avgProfit != null && avgLoss != null && avgLoss < 0) {
      riskReward = Math.round((avgProfit / Math.abs(avgLoss)) * 100) / 100;
    }
    return {
      total_pnl: total,
      trade_count: trades.length,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: judged ? Math.round((wins.length / judged) * 1000) / 10 : null,
      avg_profit: avgProfit,
      avg_loss: avgLoss,
      risk_reward: riskReward,
      max_profit: wins.length ? Math.max(...wins.map((t) => t.final_pnl || 0)) : null,
      max_loss: losses.length ? Math.min(...losses.map((t) => t.final_pnl || 0)) : null,
    };
  }

  function monthKeyFromDate(dateStr) {
    if (!dateStr) return '';
    return dateStr.slice(0, 7);
  }

  function prevMonthKey(key) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function currentMonthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function collectResolvedTrades(store) {
    const out = [];
    (store.daily_records || []).forEach((rec) => {
      (rec.trades || []).forEach((t) => {
        if (t.final_pnl == null && !TERMINAL.has(t.status)) return;
        out.push({ ...t, record_date: rec.date });
      });
    });
    return out;
  }

  function inferSignals(trade) {
    const s = trade.signals || {};
    const r = trade.reason || '';
    return {
      ma5_up: !!(s.ma5_up || r.includes('5分足')),
      ma15_up: !!(s.ma15_up || r.includes('15分足')),
      volume_surge: !!(s.volume_surge || r.includes('出来高')),
      rsi_rebound: !!(s.rsi_rebound || r.includes('反発') || r.includes('RSI')),
      surge_chase: !!(s.surge_chase || (trade.change_pct != null && trade.change_pct >= 3)),
    };
  }

  function computePeriodStats(trades) {
    const wins = trades.filter((t) => (t.final_pnl || 0) > 0);
    const losses = trades.filter((t) => (t.final_pnl || 0) < 0);
    const judged = wins.length + losses.length;
    const avgProfit = wins.length ? Math.round(wins.reduce((s, t) => s + (t.final_pnl || 0), 0) / wins.length) : null;
    const avgLoss = losses.length ? Math.round(losses.reduce((s, t) => s + (t.final_pnl || 0), 0) / losses.length) : null;
    let riskReward = null;
    if (avgProfit != null && avgLoss != null && avgLoss < 0) {
      riskReward = Math.round((avgProfit / Math.abs(avgLoss)) * 100) / 100;
    }
    const rrTrades = trades.filter((t) => t.risk_reward != null);
    const avgPlannedRr = rrTrades.length
      ? Math.round(rrTrades.reduce((s, t) => s + t.risk_reward, 0) / rrTrades.length * 100) / 100
      : riskReward;
    return {
      trade_count: trades.length,
      win_rate: judged ? Math.round((wins.length / judged) * 1000) / 10 : null,
      avg_profit: avgProfit,
      avg_loss: avgLoss,
      risk_reward: avgPlannedRr ?? riskReward,
      total_pnl: trades.reduce((s, t) => s + (t.final_pnl || 0), 0),
    };
  }

  function compareMetric(prev, curr, higherIsBetter, fmtFn) {
    if (curr == null && prev == null) return { prev: '—', curr: '—', delta: '', improved: null };
    const p = prev ?? 0;
    const c = curr ?? 0;
    const diff = c - p;
    const improved = higherIsBetter ? diff > 0 : diff < 0;
    const flat = Math.abs(diff) < (higherIsBetter && String(fmtFn).includes('Pct') ? 0.05 : 1);
    let delta = '';
    if (!flat && prev != null && curr != null) {
      if (higherIsBetter) {
        delta = diff >= 0 ? `(+${fmtFn(diff)}改善)` : `(${fmtFn(diff)}悪化)`;
      } else {
        delta = diff <= 0 ? `(${fmtFn(Math.abs(diff))}改善)` : `(${fmtFn(diff)}悪化)`;
      }
    }
    return {
      prev: prev != null ? fmtFn(prev) : '—',
      curr: curr != null ? fmtFn(curr) : '—',
      delta,
      improved: flat ? null : improved,
    };
  }

  function overallVerdict(comparisons) {
    const scored = comparisons.filter((c) => c.improved != null);
    if (!scored.length) return { label: 'データ蓄積中', cls: 'neutral' };
    const wins = scored.filter((c) => c.improved).length;
    const ratio = wins / scored.length;
    if (ratio >= 0.6) return { label: '改善中', cls: 'up' };
    if (ratio <= 0.35) return { label: '要改善', cls: 'down' };
    return { label: '横ばい', cls: 'neutral' };
  }

  function bucketWinRate(trades, matchFn) {
    const matched = trades.filter(matchFn);
    if (!matched.length) return null;
    const wins = matched.filter((t) => (t.final_pnl || 0) > 0).length;
    const judged = matched.filter((t) => (t.final_pnl || 0) !== 0).length || matched.length;
    return Math.round((wins / judged) * 1000) / 10;
  }

  function generateLearnedInsights(store) {
    const trades = collectResolvedTrades(store);
    const bullets = [];
    if (!trades.length) return ['取引履歴が増えると、AIの学習内容がここに表示されます'];

    THEME_BUCKETS.forEach((theme) => {
      const wr = bucketWinRate(trades, (t) => (t.themes || []).some((th) => th.includes(theme) || theme.includes(th)));
      if (wr == null) return;
      if (wr >= 55) bullets.push(`${theme}テーマの勝率が高い（${wr}%）`);
      else if (wr < 40) bullets.push(`${theme}株のデイトレ勝率は低い（${wr}%）`);
    });

    const surgeWr = bucketWinRate(trades, (t) => inferSignals(t).surge_chase);
    if (surgeWr != null && surgeWr < 45) bullets.push('急騰銘柄の飛び乗りは成績が悪い');

    const volWr = bucketWinRate(trades, (t) => inferSignals(t).volume_surge);
    if (volWr != null && volWr >= 55) bullets.push('寄り付き後の出来高増加は有効');

    const ma5Wr = bucketWinRate(trades, (t) => inferSignals(t).ma5_up);
    if (ma5Wr != null && ma5Wr >= 55) bullets.push('5分足の上昇トレンド一致は有効');

    const rsiWr = bucketWinRate(trades, (t) => inferSignals(t).rsi_rebound);
    if (rsiWr != null && rsiWr >= 50) bullets.push('RSI反発からのエントリーは安定');

    if (!bullets.length) bullets.push('引き続き条件別の成績を蓄積して学習精度を高めます');
    return bullets.slice(0, 6);
  }

  function buildSelfEvaluation(trades, totalPnl) {
    const wins = trades.filter((t) => (t.final_pnl || 0) > 0);
    const losses = trades.filter((t) => (t.final_pnl || 0) < 0);
    const stops = trades.filter((t) => t.status === 'stop_hit');
    const winThemes = wins.flatMap((t) => t.themes || []).filter(Boolean);
    const surgeLosses = losses.filter((t) => inferSignals(t).surge_chase);

    const goodParts = [];
    const badParts = [];
    const tomorrowParts = [];

    if (winThemes.length) {
      goodParts.push(`${winThemes[0]}銘柄の選定は良好だった`);
    } else if (wins.length) {
      goodParts.push('エントリー後の上昇を捉えられた場面があった');
    }
    if (stops.length) {
      badParts.push('損切りが増え、エントリーの厳選が必要だった');
    }
    if (surgeLosses.length) {
      badParts.push('急騰銘柄への追随が早すぎて損切りが増えた');
    }
    if (!badParts.length && totalPnl < 0) {
      badParts.push('全体としてマイナス — リスク管理の見直しが必要');
    }
    if (!goodParts.length) goodParts.push('損切りラインの遵守はできた');

    const volWins = wins.filter((t) => inferSignals(t).volume_surge);
    if (volWins.length) tomorrowParts.push('出来高継続性を重視する');
    if (surgeLosses.length) tomorrowParts.push('急騰直後の飛び乗りは控える');
    if (winThemes.length) tomorrowParts.push(`${winThemes[0]}テーマを優先する`);
    if (!tomorrowParts.length) tomorrowParts.push('勝率の高い条件だけに絞ってエントリーする');

    const good = goodParts.join('。') + '。';
    const bad = badParts.join('。') + (badParts.length ? '。' : '');
    const tomorrow = tomorrowParts.join('。') + '。';
    const text = [good, bad, `明日は${tomorrow}`].filter(Boolean).join('\n');
    return { good, bad, tomorrow, text };
  }

  function recordGrowthArtifacts(store, date, trades, summary) {
    const monthKey = monthKeyFromDate(date);
    const monthTrades = collectResolvedTrades(store).filter((t) => monthKeyFromDate(t.record_date) === monthKey);
    const monthStats = computePeriodStats(monthTrades);
    const snapshot = {
      date,
      month_key: monthKey,
      win_rate: summary.win_rate,
      avg_profit: summary.avg_profit,
      avg_loss: summary.avg_loss,
      risk_reward: summary.risk_reward,
      month_pnl: monthStats.total_pnl,
      trade_count: summary.trade_count,
    };
    store.growth_snapshots = [snapshot, ...(store.growth_snapshots || []).filter((s) => s.date !== date)];

    const selfEval = buildSelfEvaluation(trades, summary.total_pnl);
    store.self_evaluations = [
      { date, ...selfEval },
      ...(store.self_evaluations || []).filter((e) => e.date !== date),
    ];
    return store;
  }

  function growthCompareRow(label, cmp) {
    const cls = cmp.improved == null ? '' : (cmp.improved ? 'up' : 'down');
    return `
      <div class="dt-growth-row">
        <span class="dt-growth-label">${label}</span>
        <div class="dt-growth-values">
          <span class="dt-growth-prev">${cmp.prev}</span>
          <span class="dt-growth-arrow">→</span>
          <span class="dt-growth-curr ${cls}">${cmp.curr}</span>
          ${cmp.delta ? `<span class="dt-growth-delta ${cls}">${cmp.delta}</span>` : ''}
        </div>
      </div>`;
  }

  function statBarHtml(label, wr, count) {
    if (wr == null) return '';
    const cls = wr >= 55 ? 'up' : (wr < 45 ? 'down' : 'neutral');
    const width = Math.min(100, Math.max(4, wr));
    return `
      <div class="dt-stat-bar-row">
        <div class="dt-stat-bar-head">
          <span>${label}</span>
          <span class="dt-stat-bar-pct ${cls}">${wr}%</span>
        </div>
        <div class="dt-stat-bar-track"><div class="dt-stat-bar-fill ${cls}" style="width:${width}%"></div></div>
        <span class="dt-stat-bar-meta">${count}件</span>
      </div>`;
  }

  function growthReportHtml(store) {
    const allTrades = collectResolvedTrades(store);
    const thisKey = currentMonthKey();
    const lastKey = prevMonthKey(thisKey);
    const thisTrades = allTrades.filter((t) => monthKeyFromDate(t.record_date) === thisKey);
    const lastTrades = allTrades.filter((t) => monthKeyFromDate(t.record_date) === lastKey);
    const thisStats = computePeriodStats(thisTrades);
    const lastStats = computePeriodStats(lastTrades);

    const cmpWin = compareMetric(lastStats.win_rate, thisStats.win_rate, true, (v) => v.toFixed(1) + '%');
    const cmpProfit = compareMetric(lastStats.avg_profit, thisStats.avg_profit, true, (v) => fmtSignedYen(v));
    const cmpLoss = compareMetric(lastStats.avg_loss, thisStats.avg_loss, true, (v) => fmtSignedYen(v));
    const cmpRr = compareMetric(lastStats.risk_reward, thisStats.risk_reward, true, (v) => v.toFixed(2));
    const cmpPnl = compareMetric(lastStats.total_pnl, thisStats.total_pnl, true, (v) => fmtSignedYen(v));
    const verdict = overallVerdict([cmpWin, cmpProfit, cmpLoss, cmpRr, cmpPnl]);

    const insights = generateLearnedInsights(store);
    const latestSelf = (store.self_evaluations || [])[0];

    const themeBars = THEME_BUCKETS.map((theme) => {
      const matched = allTrades.filter((t) => (t.themes || []).some((th) => th.includes(theme) || theme.includes(th)));
      const wr = bucketWinRate(allTrades, (t) => (t.themes || []).some((th) => th.includes(theme) || theme.includes(th)));
      return statBarHtml(theme, wr, matched.length);
    }).join('');

    const condBars = CONDITION_DEFS.map((def) => {
      const matched = allTrades.filter((t) => inferSignals(t)[def.key]);
      const wr = bucketWinRate(allTrades, (t) => inferSignals(t)[def.key]);
      return statBarHtml(def.label, wr, matched.length);
    }).join('');

    return `
      <div class="dt-growth-hero card-premium">
        <h3 class="dt-growth-title">AI成長レポート</h3>
        <p class="dt-growth-sub">先月（${lastKey}）→ 今月（${thisKey}）</p>
        ${growthCompareRow('勝率', cmpWin)}
        ${growthCompareRow('平均利益', cmpProfit)}
        ${growthCompareRow('平均損失', cmpLoss)}
        ${growthCompareRow('リスクリワード', cmpRr)}
        ${growthCompareRow('月間損益', cmpPnl)}
        <div class="dt-growth-verdict">
          <span>総合評価</span>
          <strong class="dt-growth-verdict-val ${verdict.cls}">${verdict.label}</strong>
        </div>
      </div>

      <div class="dt-growth-section card-premium">
        <h4 class="dt-growth-section-title">最近学習した内容</h4>
        <ul class="dt-insight-list">
          ${insights.map((b) => `<li>${global.escapeHtml ? global.escapeHtml(b) : b}</li>`).join('')}
        </ul>
      </div>

      <div class="dt-growth-section card-premium">
        <h4 class="dt-growth-section-title">テーマ別勝率</h4>
        ${themeBars || '<p class="dt-empty">データなし</p>'}
      </div>

      <div class="dt-growth-section card-premium">
        <h4 class="dt-growth-section-title">条件別成績</h4>
        ${condBars || '<p class="dt-empty">データなし</p>'}
      </div>

      ${latestSelf ? `
      <div class="dt-growth-section card-premium dt-self-eval">
        <h4 class="dt-growth-section-title">今日の自己評価 <span class="dt-self-date">${dateLabel(latestSelf.date)}</span></h4>
        <p class="dt-self-text">${global.escapeHtml ? global.escapeHtml(latestSelf.text || '') : (latestSelf.text || '')}</p>
      </div>` : '<p class="dt-empty">引け後にAI自己評価が記録されます</p>'}`;
  }

  function growthTeaserHtml(store) {
    const allTrades = collectResolvedTrades(store);
    if (!allTrades.length) return '';
    const thisKey = currentMonthKey();
    const lastKey = prevMonthKey(thisKey);
    const thisStats = computePeriodStats(allTrades.filter((t) => monthKeyFromDate(t.record_date) === thisKey));
    const lastStats = computePeriodStats(allTrades.filter((t) => monthKeyFromDate(t.record_date) === lastKey));
    const cmpWin = compareMetric(lastStats.win_rate, thisStats.win_rate, true, (v) => v.toFixed(1) + '%');
    const verdict = overallVerdict([cmpWin]);
    return `
      <div class="dt-growth-teaser card-premium" role="button" tabindex="0" id="dayTradeGrowthTeaserBtn">
        <span class="dt-growth-teaser-label">AI成長レポート</span>
        <span class="dt-growth-teaser-val ${verdict.cls}">${verdict.label}</span>
        <span class="dt-growth-teaser-meta">勝率 ${cmpWin.prev} → ${cmpWin.curr}</span>
      </div>`;
  }

  function panelTabsHtml(active) {
    return (
      '<div class="dt-tabs">' +
      `<button type="button" class="dt-tab${active === 'today' ? ' active' : ''}" data-dt-mode="today">今日の仮想デイトレ</button>` +
      `<button type="button" class="dt-tab${active === 'daily' ? ' active' : ''}" data-dt-mode="daily">日別成績</button>` +
      `<button type="button" class="dt-tab${active === 'learning' ? ' active' : ''}" data-dt-mode="learning">AI学習ログ</button>` +
      `<button type="button" class="dt-tab${active === 'growth' ? ' active' : ''}" data-dt-mode="growth">AI成長レポート</button>` +
      '</div>'
    );
  }

  function skipDayTradeHtml(data) {
    const label = data.skip_label || '本日のAI判断：見送り';
    const reason = data.skip_reason || '出来高・トレンド・リスクリワードが基準未満';
    return `
      <div class="dt-skip-card card-premium">
        <div class="dt-skip-title">${global.escapeHtml ? global.escapeHtml(label) : label}</div>
        <p class="dt-skip-reason">${global.escapeHtml ? global.escapeHtml(reason) : reason}</p>
        <p class="dt-skip-meta">スキャン ${data.scanned || 0}銘柄 · 精度重視（最大3件）</p>
      </div>`;
  }

  function precisionMetricsHtml(item) {
    const wr = item.predicted_win_rate != null ? item.predicted_win_rate.toFixed(1) + '%' : '—';
    const ev = item.expected_value != null ? fmtSignedYen(item.expected_value) : '—';
    const conf = item.confidence || '—';
    const evCls = (item.expected_value || 0) >= 0 ? 'up' : 'down';
    return `
      <div class="dt-precision-grid">
        <div class="dt-kv"><span>予想勝率</span><strong>${wr}</strong></div>
        <div class="dt-kv"><span>期待値</span><strong class="${evCls}">${ev}</strong></div>
        <div class="dt-kv"><span>信頼度</span><strong class="dt-conf-badge">${conf}</strong></div>
      </div>`;
  }

  function selectionReasonsHtml(item) {
    const reasons = item.selection_reasons || (item.reason ? [item.reason] : []);
    if (!reasons.length) return '';
    return `<div class="dt-reasons-block"><span>選定理由</span><ul>${reasons.map((r) => `<li>${global.escapeHtml ? global.escapeHtml(r) : r}</li>`).join('')}</ul></div>`;
  }

  function tradeDetailHtml(trade, opts = {}) {
    const sym = global.escapeHtml ? global.escapeHtml(trade.symbol) : trade.symbol;
    const name = global.escapeHtml ? global.escapeHtml(trade.name || '') : (trade.name || '');
    const status = trade.status || 'entered';
    const statusLabel = STATUS_LABEL[status] || status;
    const pnl = trade.final_pnl != null ? trade.final_pnl : (trade.unrealized_pnl != null ? trade.unrealized_pnl : null);
    const pnlCls = pnl == null ? '' : (pnl >= 0 ? 'up' : 'down');
    const outcome = trade.outcome === 'win' ? '勝ち' : (trade.outcome === 'loss' ? '負け' : (pnl != null && TERMINAL.has(status) ? (pnl >= 0 ? '勝ち' : '負け') : '—'));
    const dateLabelStr = trade.trade_date ? trade.trade_date.replace(/-/g, '/') : '';

    return `
      <article class="dt-card card-premium">
        <div class="dt-card-head">
          <div>
            <span class="dt-date">${dateLabelStr} AI仮想デイトレ</span>
            <div class="dt-symbol-row">
              <a href="/stock/${encodeURIComponent(trade.symbol)}" class="dt-symbol">${sym}</a>
              <span class="dt-name">${name}</span>
            </div>
          </div>
          <span class="dt-status dt-status-${status}">${statusLabel}</span>
        </div>
        ${precisionMetricsHtml(trade)}
        <div class="dt-grid">
          <div class="dt-kv"><span>仮想買い</span><strong>${fmtNum(trade.shares)}株</strong></div>
          <div class="dt-kv"><span>買値</span><strong>${fmtYen(trade.buy_price)}</strong></div>
          <div class="dt-kv"><span>利確ライン</span><strong class="up">${fmtYen(trade.target_price)}</strong></div>
          <div class="dt-kv"><span>損切りライン</span><strong class="down">${fmtYen(trade.stop_price)}</strong></div>
          ${trade.entry_time ? `<div class="dt-kv"><span>エントリー</span><strong>${trade.entry_time}</strong></div>` : ''}
          ${trade.exit_time ? `<div class="dt-kv"><span>決済</span><strong>${trade.exit_time}</strong></div>` : ''}
          ${pnl != null ? `<div class="dt-kv"><span>結果</span><strong class="${pnlCls}">${fmtSignedYen(pnl)}</strong></div>` : ''}
          ${TERMINAL.has(status) ? `<div class="dt-kv"><span>判定</span><strong class="${pnlCls}">${outcome}</strong></div>` : ''}
        </div>
        ${selectionReasonsHtml(trade)}
        ${opts.showLink ? `<a href="/stock/${encodeURIComponent(trade.symbol)}" class="dt-link">銘柄詳細 →</a>` : ''}
      </article>`;
  }

  function homeTodayHtml(store, quotes) {
    const today = store.today;
    if (!today || !today.trades || !today.trades.length) {
      return '<p class="dt-empty">本日の仮想デイトレを読み込み中...</p>';
    }

    let totalUnrealized = 0;
    let totalRealized = 0;
    const holding = [];
    const closed = [];

    today.trades.forEach((t) => {
      const q = quotes[t.symbol];
      const current = q?.current ?? t.last_current;
      const status = resolveTradeStatus(t, current);
      if (TERMINAL.has(status)) {
        const fin = t.final_pnl != null ? t : finalizeTrade(t, current);
        totalRealized += fin.final_pnl || 0;
        closed.push(fin);
      } else {
        const pnlData = calcPnl(t, current);
        totalUnrealized += pnlData?.pnl || 0;
        holding.push({ ...t, unrealized_pnl: pnlData?.pnl, last_current: current, status });
      }
    });

    const total = totalRealized + totalUnrealized;
    const totalCls = total >= 0 ? 'up' : 'down';

    let body = `
      <div class="dt-home-hero card-premium">
        <div class="dt-home-title">今日AIに任せた場合</div>
        <div class="dt-home-pnl ${totalCls}">現在 ${fmtSignedYen(total)}</div>
        <div class="dt-home-meta">仮想シミュレーション · ${today.trades.length}銘柄</div>
      </div>`;

    if (holding.length) {
      body += '<div class="dt-home-section-title">保有中想定</div>';
      holding.forEach((t) => {
        const cls = (t.unrealized_pnl || 0) >= 0 ? 'up' : 'down';
        body += `<div class="dt-home-row card-premium">
          <span class="dt-home-sym">${t.symbol} ${t.name || ''}</span>
          <span class="dt-home-shares">${fmtNum(t.shares)}株</span>
          <span class="dt-home-pnl-sm ${cls}">${fmtSignedYen(t.unrealized_pnl)}</span>
        </div>`;
      });
    }
    if (closed.length) {
      body += '<div class="dt-home-section-title">決済済み</div>';
      closed.forEach((t) => {
        const cls = (t.final_pnl || 0) >= 0 ? 'up' : 'down';
        const label = STATUS_LABEL[t.status] || t.status;
        body += `<div class="dt-home-row card-premium">
          <span class="dt-home-sym">${t.symbol} ${t.name || ''}</span>
          <span class="dt-home-shares">${label} ${fmtNum(t.shares)}株</span>
          <span class="dt-home-pnl-sm ${cls}">${fmtSignedYen(t.final_pnl)}</span>
        </div>`;
      });
    }

    return body;
  }

  function dailyRecordsHtml(records) {
    if (!records.length) return '<p class="dt-empty">日別成績はまだありません</p>';
    const sorted = [...records].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const monthTotal = sorted.reduce((s, r) => s + (r.total_pnl || 0), 0);
    const monthCls = monthTotal >= 0 ? 'up' : 'down';

    const rows = sorted.map((r) => {
      const cls = (r.total_pnl || 0) >= 0 ? 'up' : 'down';
      return `<div class="dt-daily-row">
        <span class="dt-daily-date">${dateLabel(r.date)}</span>
        <span class="dt-daily-pnl ${cls}">${fmtSignedYen(r.total_pnl)}</span>
        <span class="dt-daily-meta">${r.trade_count || 0}件 · 勝率${r.win_rate != null ? r.win_rate + '%' : '—'}</span>
      </div>`;
    }).join('');

    return `
      <div class="dt-month-total card-premium">
        <span>月間累計</span>
        <strong class="${monthCls}">${fmtSignedYen(monthTotal)}</strong>
      </div>
      <div class="dt-daily-list">${rows}</div>`;
  }

  function learningLogsHtml(logs) {
    if (!logs.length) return '<p class="dt-empty">学習ログはまだありません。日次決済後に自動記録されます。</p>';
    return logs.slice(0, 20).map((log) => `
      <article class="dt-learning-card card-premium">
        <div class="dt-learning-head">${dateLabel(log.date)} 学習ログ</div>
        <div class="dt-learning-result">結果：<strong class="${(log.total_pnl || 0) >= 0 ? 'up' : 'down'}">${fmtSignedYen(log.total_pnl)}</strong></div>
        <p class="dt-learning-good"><span>良かった点：</span>${global.escapeHtml ? global.escapeHtml(log.good_points || '') : (log.good_points || '')}</p>
        <p class="dt-learning-bad"><span>悪かった点：</span>${global.escapeHtml ? global.escapeHtml(log.bad_points || '') : (log.bad_points || '')}</p>
        <p class="dt-learning-improve"><span>次回改善：</span>${global.escapeHtml ? global.escapeHtml(log.improvements || '') : (log.improvements || '')}</p>
      </article>
    `).join('');
  }

  let _homeInitStarted = false;

  const DayTrade = {
    disclaimer: '',
    skipInfo: null,

    getStore() {
      return loadStore();
    },

    async fetchDaily(hints) {
      const init = {
        method: hints ? 'POST' : 'GET',
        headers: hints ? { 'Content-Type': 'application/json' } : undefined,
        body: hints ? JSON.stringify({ learning_hints: hints }) : undefined,
      };
      let data;
      if (global.ApiCache && !hints) {
        data = await global.ApiCache.fetchJsonCached('/api/day_trade/daily', { ttl: 120000 });
      } else {
        const res = await fetch('/api/day_trade/daily', init);
        data = await res.json();
      }
      if (data.status !== 'ok') throw new Error('day_trade failed');
      DayTrade.disclaimer = data.disclaimer || '';
      DayTrade.skipInfo = data.skip ? data : null;
      return data;
    },

    async refreshQuotes(symbols) {
      if (!symbols.length) return {};
      let data;
      if (global.ApiCache) {
        data = await global.ApiCache.postJsonCached('/api/day_trade/track', { symbols }, { ttl: 30000 });
      } else {
        const res = await fetch('/api/day_trade/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols }),
        });
        data = await res.json();
      }
      return data.quotes || {};
    },

    ensureTodayTrades(apiData) {
      const store = loadStore();
      const date = todayStr();
      if (store.today && store.today.date === date && store.today.trades?.length) {
        return store;
      }
      const trades = (apiData.trades || []).map((t) => ({
        ...t,
        status: 'entered',
        created_at: new Date().toISOString(),
      }));
      store.today = { date, trades, finalized: false };
      saveStore(store);
      return store;
    },

    async updateLiveStatuses(store) {
      if (!store.today?.trades?.length) return store;
      const symbols = store.today.trades.map((t) => t.symbol);
      const quotes = await DayTrade.refreshQuotes(symbols);
      const updated = store.today.trades.map((t) => {
        const current = quotes[t.symbol]?.current ?? t.last_current;
        const status = resolveTradeStatus(t, current);
        if (TERMINAL.has(status)) {
          return finalizeTrade({ ...t, last_current: current }, current);
        }
        const pnlData = calcPnl(t, current);
        return {
          ...t,
          status,
          last_current: current,
          unrealized_pnl: pnlData?.pnl,
          last_checked_at: new Date().toISOString(),
        };
      });
      store.today.trades = updated;

      const allDone = updated.every((t) => TERMINAL.has(t.status));
      if (allDone || (isMarketClose() && !store.today.finalized)) {
        store = DayTrade.finalizeDay(store);
      }
      saveStore(store);
      return store;
    },

    finalizeDay(store) {
      if (!store.today || store.today.finalized) return store;
      const trades = store.today.trades.map((t) =>
        TERMINAL.has(t.status) ? t : finalizeTrade(t, t.last_current)
      );
      const summary = summarizeDay(trades);
      const learning = buildLearningLog(trades, summary.total_pnl);
      const date = store.today.date;

      const record = {
        date,
        ...summary,
        trades,
        learning,
      };
      store.daily_records = [record, ...(store.daily_records || []).filter((r) => r.date !== date)];
      store.learning_logs = [
        { date, ...learning },
        ...(store.learning_logs || []).filter((l) => l.date !== date),
      ];
      store = recordGrowthArtifacts(store, date, trades, summary);
      store.today = { ...store.today, trades, finalized: true };
      saveStore(store);
      return store;
    },

    renderHome(hostId) {
      const host = document.getElementById(hostId);
      if (!host) return;
      const store = loadStore();
      if (!store.today?.trades?.length) {
        host.innerHTML = '<div class="dt-home-skeleton"><div class="skeleton-card"></div></div>';
        return;
      }
      const quotes = {};
      store.today.trades.forEach((t) => { quotes[t.symbol] = { current: t.last_current }; });
      host.innerHTML = homeTodayHtml(store, quotes)
        + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
    },

    async initHome() {
      const host = document.getElementById('dayTradeHome');
      if (!host || _homeInitStarted) return;
      _homeInitStarted = true;
      try {
        let store = loadStore();
        const date = todayStr();
        if (!store.today || store.today.date !== date || !store.today.trades?.length) {
          const hints = extractLearningHints(store);
          const apiData = await DayTrade.fetchDaily(
            Object.keys(hints).some((k) => (hints[k] || []).length || hints.extend_target) ? hints : null
          );
          if (apiData.skip) {
            host.innerHTML = skipDayTradeHtml(apiData)
              + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
            return;
          }
          store = DayTrade.ensureTodayTrades(apiData);
        }
        if (DayTrade.skipInfo) {
          host.innerHTML = skipDayTradeHtml(DayTrade.skipInfo)
            + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
          return;
        }
        store = await DayTrade.updateLiveStatuses(store);
        const quotes = {};
        const symbols = store.today.trades.map((t) => t.symbol);
        const fresh = await DayTrade.refreshQuotes(symbols);
        Object.assign(quotes, fresh);
        store.today.trades.forEach((t) => {
          if (!quotes[t.symbol]) quotes[t.symbol] = { current: t.last_current };
        });
        if (DayTrade.skipInfo) {
          host.innerHTML = skipDayTradeHtml(DayTrade.skipInfo)
            + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
          return;
        }
        const teaser = growthTeaserHtml(store);
        host.innerHTML = homeTodayHtml(store, quotes)
          + (teaser || '')
          + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
        document.getElementById('dayTradeGrowthTeaserBtn')?.addEventListener('click', () => {
          if (global.openSubPanel) global.openSubPanel('daytrade');
          setTimeout(() => DayTrade.loadPanel('dayTradeList', 'growth'), 400);
        });
      } catch (e) {
        console.error(e);
        host.innerHTML = '<p class="dt-empty">AI仮想デイトレの読み込みに失敗しました</p>';
      }
    },

    async loadPanel(listId, mode) {
      const host = document.getElementById(listId);
      if (!host) return;
      host.innerHTML = '<div class="dt-loading">読み込み中...</div>';
      try {
        let store = loadStore();
        const date = todayStr();
        if (mode === 'today' && (!store.today || store.today.date !== date || !store.today.trades?.length)) {
          const hints = extractLearningHints(store);
          const apiData = await DayTrade.fetchDaily(
            Object.keys(hints).some((k) => (hints[k] || []).length || hints.extend_target) ? hints : null
          );
          store = DayTrade.ensureTodayTrades(apiData);
        }
        if (mode === 'today') {
          if (DayTrade.skipInfo) {
            host.innerHTML = panelTabsHtml('today') + skipDayTradeHtml(DayTrade.skipInfo)
              + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
            DayTrade.bindPanelTabs(host);
            return;
          }
          store = await DayTrade.updateLiveStatuses(store);
          const html = store.today.trades.map((t) => tradeDetailHtml(t, { showLink: true })).join('');
          host.innerHTML = panelTabsHtml('today') + '<div class="dt-list">' + (html || skipDayTradeHtml({ skip_label: '本日のAI判断：見送り', skip_reason: '精度基準未満', scanned: 0 })) + '</div>'
            + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
          DayTrade.bindPanelTabs(host);
          return;
        }
        if (mode === 'daily') {
          host.innerHTML = panelTabsHtml('daily') + dailyRecordsHtml(store.daily_records || [])
            + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
          DayTrade.bindPanelTabs(host);
          return;
        }
        if (mode === 'growth') {
          host.innerHTML = panelTabsHtml('growth') + growthReportHtml(store)
            + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
          DayTrade.bindPanelTabs(host);
          return;
        }
        host.innerHTML = panelTabsHtml('learning') + learningLogsHtml(store.learning_logs || [])
          + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
        DayTrade.bindPanelTabs(host);
      } catch (e) {
        console.error(e);
        host.innerHTML = '<p class="dt-empty">読み込みに失敗しました</p>';
      }
    },

    bindPanelTabs(root) {
      root.querySelectorAll('.dt-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          const body = root.closest('.sub-panel-body') || root;
          DayTrade.loadPanel(body.id, tab.dataset.dtMode);
        });
      });
    },

    computePeriodStats,
    generateLearnedInsights,
    buildSelfEvaluation,
    growthReportHtml,
  };

  global.DayTrade = DayTrade;
})(window);
