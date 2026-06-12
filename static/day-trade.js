/**
 * AI仮想デイトレ検証 — 実注文なし・シミュレーション専用
 *
 * localStorage スキーマ v1:
 * {
 *   version: 1,
 *   today: { date, trades[], finalized },
 *   daily_records: [{ date, total_pnl, trade_count, win_count, loss_count, win_rate, max_profit, max_loss, trades, learning }],
 *   learning_logs: [{ date, total_pnl, good_points, bad_points, improvements }]
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

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : { version: 1, today: null, daily_records: [], learning_logs: [] };
      data.version = 1;
      if (!data.daily_records) data.daily_records = [];
      if (!data.learning_logs) data.learning_logs = [];
      return data;
    } catch {
      return { version: 1, today: null, daily_records: [], learning_logs: [] };
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
    return {
      total_pnl: total,
      trade_count: trades.length,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: judged ? Math.round((wins.length / judged) * 1000) / 10 : null,
      max_profit: wins.length ? Math.max(...wins.map((t) => t.final_pnl || 0)) : null,
      max_loss: losses.length ? Math.min(...losses.map((t) => t.final_pnl || 0)) : null,
    };
  }

  function panelTabsHtml(active) {
    return (
      '<div class="dt-tabs">' +
      `<button type="button" class="dt-tab${active === 'today' ? ' active' : ''}" data-dt-mode="today">今日の仮想デイトレ</button>` +
      `<button type="button" class="dt-tab${active === 'daily' ? ' active' : ''}" data-dt-mode="daily">日別成績</button>` +
      `<button type="button" class="dt-tab${active === 'learning' ? ' active' : ''}" data-dt-mode="learning">AI学習ログ</button>` +
      '</div>'
    );
  }

  function tradeDetailHtml(trade, opts = {}) {
    const sym = global.escapeHtml ? global.escapeHtml(trade.symbol) : trade.symbol;
    const name = global.escapeHtml ? global.escapeHtml(trade.name || '') : (trade.name || '');
    const reason = global.escapeHtml ? global.escapeHtml(trade.reason || '') : (trade.reason || '');
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
        ${reason ? `<p class="dt-reason"><span>理由：</span>${reason}</p>` : ''}
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
          store = DayTrade.ensureTodayTrades(apiData);
        }
        store = await DayTrade.updateLiveStatuses(store);
        const quotes = {};
        const symbols = store.today.trades.map((t) => t.symbol);
        const fresh = await DayTrade.refreshQuotes(symbols);
        Object.assign(quotes, fresh);
        store.today.trades.forEach((t) => {
          if (!quotes[t.symbol]) quotes[t.symbol] = { current: t.last_current };
        });
        host.innerHTML = homeTodayHtml(store, quotes)
          + `<p class="dt-disclaimer">${global.escapeHtml ? global.escapeHtml(DayTrade.disclaimer) : DayTrade.disclaimer}</p>`;
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
          store = await DayTrade.updateLiveStatuses(store);
          const html = store.today.trades.map((t) => tradeDetailHtml(t, { showLink: true })).join('');
          host.innerHTML = panelTabsHtml('today') + '<div class="dt-list">' + html + '</div>'
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
  };

  global.DayTrade = DayTrade;
})(window);
