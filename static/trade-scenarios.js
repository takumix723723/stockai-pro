/**
 * AI売買シナリオ — 候補・保存・損益追跡・AI成績表
 *
 * localStorage スキーマ v2（DB移行しやすい構造）:
 * {
 *   version: 2,
 *   items: ScenarioRecord[],      // 監視中
 *   resolved: ResolvedScenario[]  // 検証完了（目標/損切り/期限切れ）
 * }
 */
(function (global) {
  const STORAGE_KEY = 'stockai_ai_trade_scenarios';
  const EXPIRE_DAYS = 7;
  const TERMINAL_STATUSES = new Set(['target_hit', 'stop_hit', 'expired']);

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

  function uuid() {
    return 'sc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function migrateStore(raw) {
    const data = raw || { version: 1, items: [] };
    if (!data.items) data.items = [];
    if (!data.resolved) data.resolved = [];
    data.version = 2;
    return data;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return migrateStore(raw ? JSON.parse(raw) : null);
    } catch {
      return migrateStore(null);
    }
  }

  function saveHistory(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrateStore(data)));
    } catch (_) { /* ignore */ }
  }

  function daysBetween(a, b) {
    const ms = Math.abs(new Date(b) - new Date(a));
    return Math.floor(ms / 86400000);
  }

  function calcPnl(item, current) {
    if (current == null || !item.buy_price || !item.shares) return null;
    const pnl = (current - item.buy_price) * item.shares;
    const rate = ((current - item.buy_price) / item.buy_price) * 100;
    return { pnl, rate, current };
  }

  function resolveStatus(item, current) {
    if (!item) return 'watching';
    if (item.resolved_status && TERMINAL_STATUSES.has(item.resolved_status)) {
      return item.resolved_status;
    }
    const expires = item.expires_at || item.expiresAt;
    if (expires && new Date() > new Date(expires)) return 'expired';
    if (current != null && item.target_price != null && current >= item.target_price) return 'target_hit';
    if (current != null && item.stop_price != null && current <= item.stop_price) return 'stop_hit';
    const saved = item.saved_at || item.savedAt || item.created_at || item.createdAt;
    if (saved && daysBetween(saved, new Date()) >= 1) return 'holding';
    return item.status === 'expired' ? 'expired' : (item.status || 'watching');
  }

  function finalizeScenario(item, current) {
    const status = resolveStatus(item, current);
    if (!TERMINAL_STATUSES.has(status)) return null;

    let finalPrice = current ?? item.last_current ?? item.buy_price;
    let outcome = 'draw';
    let finalPnl;

    if (status === 'target_hit') {
      finalPrice = item.target_price;
      finalPnl = (item.target_price - item.buy_price) * item.shares;
      outcome = 'win';
    } else if (status === 'stop_hit') {
      finalPrice = item.stop_price;
      finalPnl = (item.stop_price - item.buy_price) * item.shares;
      outcome = 'loss';
    } else {
      finalPnl = (finalPrice - item.buy_price) * item.shares;
      outcome = finalPnl > 0 ? 'win' : (finalPnl < 0 ? 'loss' : 'draw');
    }

    const savedAt = item.saved_at || item.created_at;
    const resolvedAt = new Date().toISOString();
    const holdingDays = savedAt ? daysBetween(savedAt, resolvedAt) : 0;
    const finalPnlRate = item.buy_price
      ? ((finalPrice - item.buy_price) / item.buy_price) * 100
      : 0;

    return {
      ...item,
      status,
      resolved_status: status,
      resolved_at: resolvedAt,
      final_price: finalPrice,
      final_pnl: Math.round(finalPnl),
      final_pnl_rate: Math.round(finalPnlRate * 100) / 100,
      holding_days: holdingDays,
      outcome,
      verify_mode: true,
      last_current: finalPrice,
      last_checked_at: resolvedAt,
    };
  }

  function processVerification(store) {
    const active = [];
    const resolved = [...(store.resolved || [])];
    const resolvedIds = new Set(resolved.map((r) => r.id));

    for (const item of store.items || []) {
      const status = resolveStatus(item, item.last_current);
      if (TERMINAL_STATUSES.has(status)) {
        const fin = finalizeScenario(item, item.last_current);
        if (fin && !resolvedIds.has(fin.id)) {
          resolved.unshift(fin);
          resolvedIds.add(fin.id);
        }
      } else {
        active.push({ ...item, status });
      }
    }

    store.items = active;
    store.resolved = resolved;
    return store;
  }

  function computeStats(resolved) {
    const rows = resolved || [];
    const wins = rows.filter((r) => r.outcome === 'win');
    const losses = rows.filter((r) => r.outcome === 'loss');
    const judged = wins.length + losses.length;
    const totalProfit = wins.reduce((s, r) => s + (r.final_pnl || 0), 0);
    const totalLoss = losses.reduce((s, r) => s + Math.abs(r.final_pnl || 0), 0);
    const cumulative = rows.reduce((s, r) => s + (r.final_pnl || 0), 0);
    const holdingDays = rows.map((r) => r.holding_days || 0);

    return {
      total: rows.length,
      wins: wins.length,
      losses: losses.length,
      draws: rows.length - judged,
      win_rate: judged ? (wins.length / judged) * 100 : null,
      total_profit: totalProfit,
      total_loss: totalLoss,
      cumulative_pnl: cumulative,
      avg_profit: wins.length ? totalProfit / wins.length : null,
      avg_loss: losses.length ? -totalLoss / losses.length : null,
      avg_holding_days: holdingDays.length
        ? holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length
        : null,
      max_profit: wins.length ? Math.max(...wins.map((r) => r.final_pnl || 0)) : null,
      max_loss: losses.length ? Math.min(...losses.map((r) => r.final_pnl || 0)) : null,
    };
  }

  function computeRankings(resolved) {
    const rows = [...(resolved || [])];

    const byProfit = [...rows].sort((a, b) => (b.final_pnl_rate || 0) - (a.final_pnl_rate || 0));

    const byRr = [...rows]
      .filter((r) => r.risk_reward != null)
      .sort((a, b) => (b.risk_reward || 0) - (a.risk_reward || 0));

    const symMap = {};
    rows.forEach((r) => {
      if (!symMap[r.symbol]) {
        symMap[r.symbol] = { symbol: r.symbol, name: r.name, wins: 0, total: 0, pnl: 0 };
      }
      symMap[r.symbol].total += 1;
      if (r.outcome === 'win') symMap[r.symbol].wins += 1;
      symMap[r.symbol].pnl += r.final_pnl || 0;
    });
    const byWinRate = Object.values(symMap)
      .map((s) => ({
        ...s,
        win_rate: s.total ? (s.wins / s.total) * 100 : 0,
        final_pnl_rate: s.pnl,
      }))
      .sort((a, b) => b.win_rate - a.win_rate);

    return { byProfit, byWinRate, byRr };
  }

  const STATUS_LABEL = {
    watching: '監視中',
    holding: '保有中想定',
    target_hit: '目標到達',
    stop_hit: '損切り到達',
    expired: '期限切れ',
  };

  function panelTabsHtml(active) {
    return (
      '<div class="ai-scenario-tabs">' +
      `<button type="button" class="ai-scenario-tab${active === 'candidates' ? ' active' : ''}" data-mode="candidates">今日の候補</button>` +
      `<button type="button" class="ai-scenario-tab${active === 'history' ? ' active' : ''}" data-mode="history">保存履歴</button>` +
      `<button type="button" class="ai-scenario-tab${active === 'scoreboard' ? ' active' : ''}" data-mode="scoreboard">AI成績表</button>` +
      '</div>'
    );
  }

  function statsGridHtml(stats) {
    return `
      <div class="ai-score-stats card-premium">
        <h3 class="ai-score-title">AI実績</h3>
        <div class="ai-score-hero">
          <div class="ai-score-hero-item">
            <span class="ai-score-hero-k">勝率</span>
            <strong class="ai-score-hero-v">${stats.win_rate != null ? stats.win_rate.toFixed(1) + '%' : '—'}</strong>
          </div>
          <div class="ai-score-hero-item">
            <span class="ai-score-hero-k">累計損益</span>
            <strong class="ai-score-hero-v ${stats.cumulative_pnl >= 0 ? 'up' : 'down'}">${fmtSignedYen(stats.cumulative_pnl)}</strong>
          </div>
        </div>
        <div class="ai-score-grid">
          <div class="ai-score-kv"><span>総シナリオ数</span><strong>${fmtNum(stats.total)}</strong></div>
          <div class="ai-score-kv"><span>勝ち</span><strong class="up">${fmtNum(stats.wins)}</strong></div>
          <div class="ai-score-kv"><span>負け</span><strong class="down">${fmtNum(stats.losses)}</strong></div>
          <div class="ai-score-kv"><span>総利益</span><strong class="up">${fmtSignedYen(stats.total_profit)}</strong></div>
          <div class="ai-score-kv"><span>総損失</span><strong class="down">${fmtYen(-stats.total_loss)}</strong></div>
          <div class="ai-score-kv"><span>平均利益</span><strong class="up">${stats.avg_profit != null ? fmtSignedYen(stats.avg_profit) : '—'}</strong></div>
          <div class="ai-score-kv"><span>平均損失</span><strong class="down">${stats.avg_loss != null ? fmtYen(stats.avg_loss) : '—'}</strong></div>
          <div class="ai-score-kv"><span>平均保有日数</span><strong>${stats.avg_holding_days != null ? stats.avg_holding_days.toFixed(1) + '日' : '—'}</strong></div>
          <div class="ai-score-kv"><span>最大利益</span><strong class="up">${stats.max_profit != null ? fmtSignedYen(stats.max_profit) : '—'}</strong></div>
          <div class="ai-score-kv"><span>最大損失</span><strong class="down">${stats.max_loss != null ? fmtYen(stats.max_loss) : '—'}</strong></div>
        </div>
        <p class="ai-score-verify-note">AI検証モード: 目標到達・損切り到達・期限切れのシナリオを自動集計しています。</p>
      </div>
    `;
  }

  function rankingListHtml(title, rows, valueKey, fmtValue) {
    if (!rows.length) {
      return `<div class="ai-rank-block"><h4 class="ai-rank-title">${title}</h4><p class="ai-scenario-empty">データがありません</p></div>`;
    }
    const list = rows.slice(0, 10).map((r, i) => {
      const sym = global.escapeHtml ? global.escapeHtml(r.symbol) : r.symbol;
      const name = global.escapeHtml ? global.escapeHtml(r.name || '') : (r.name || '');
      const val = fmtValue(r);
      const cls = (r.final_pnl_rate || r.final_pnl || 0) >= 0 ? 'up' : 'down';
      return `
        <div class="ai-rank-row">
          <span class="ai-rank-pos">${i + 1}位</span>
          <div class="ai-rank-body">
            <span class="ai-rank-symbol">${sym}</span>
            <span class="ai-rank-name">${name}</span>
          </div>
          <strong class="ai-rank-val ${cls}">${val}</strong>
        </div>
      `;
    }).join('');
    return `<div class="ai-rank-block card-premium"><h4 class="ai-rank-title">${title}</h4>${list}</div>`;
  }

  function rankingsHtml(rankings) {
    return (
      '<div class="ai-rankings">' +
      rankingListHtml('利益順ランキング', rankings.byProfit, 'final_pnl_rate', (r) => fmtPct(r.final_pnl_rate)) +
      rankingListHtml('勝率順ランキング（銘柄別）', rankings.byWinRate, 'win_rate', (r) => r.win_rate.toFixed(1) + '%') +
      rankingListHtml('リスクリワード順', rankings.byRr, 'risk_reward', (r) => (r.risk_reward != null ? r.risk_reward.toFixed(2) + '倍' : '—')) +
      '</div>'
    );
  }

  function homeScoreHtml(stats) {
    return `
      <div class="ai-score-home card-premium" id="aiScoreHomeCard">
        <div class="ai-score-home-head">
          <span class="ai-score-home-label">📈 AI成績</span>
          <button type="button" class="section-link-btn" id="openScoreboardBtn">成績表を見る</button>
        </div>
        <div class="ai-score-home-metrics">
          <div class="ai-score-home-metric">
            <span>勝率</span>
            <strong>${stats.win_rate != null ? stats.win_rate.toFixed(1) + '%' : '—'}</strong>
          </div>
          <div class="ai-score-home-metric">
            <span>累計損益</span>
            <strong class="${stats.cumulative_pnl >= 0 ? 'up' : 'down'}">${fmtSignedYen(stats.cumulative_pnl)}</strong>
          </div>
          <div class="ai-score-home-metric">
            <span>検証済み</span>
            <strong>${fmtNum(stats.total)}件</strong>
          </div>
        </div>
      </div>
    `;
  }

  function scenarioCardHtml(s, opts = {}) {
    const compact = !!opts.compact;
    const showSave = opts.showSave !== false;
    const sym = global.escapeHtml ? global.escapeHtml(s.symbol) : s.symbol;
    const name = global.escapeHtml ? global.escapeHtml(s.name || '') : (s.name || '');
    const reason = global.escapeHtml ? global.escapeHtml(s.reason || '') : (s.reason || '');
    const verdict = global.escapeHtml ? global.escapeHtml(s.verdict || '') : (s.verdict || '');
    const profitCls = (s.expected_profit || 0) >= 0 ? 'up' : 'down';
    const lossCls = (s.expected_loss || 0) < 0 ? 'down' : 'up';
    const rr = s.risk_reward != null ? s.risk_reward.toFixed(2) + '倍' : '—';

    return `
      <article class="ai-scenario-card card-premium" data-symbol="${sym}">
        <div class="ai-scenario-head">
          <a href="/stock/${encodeURIComponent(s.symbol)}" class="ai-scenario-symbol">${sym}</a>
          <span class="ai-scenario-name">${name}</span>
          <span class="ai-scenario-verdict">${verdict}</span>
        </div>
        <div class="ai-scenario-grid">
          <div class="ai-scenario-kv"><span>買い</span><strong>${fmtNum(s.shares)}株</strong></div>
          <div class="ai-scenario-kv"><span>買値</span><strong>${fmtYen(s.buy_price)}</strong></div>
          <div class="ai-scenario-kv"><span>目標</span><strong class="up">${fmtYen(s.target_price)}</strong></div>
          <div class="ai-scenario-kv"><span>損切り</span><strong class="down">${fmtYen(s.stop_price)}</strong></div>
          <div class="ai-scenario-kv"><span>想定利益</span><strong class="${profitCls}">${fmtSignedYen(s.expected_profit)}</strong></div>
          <div class="ai-scenario-kv"><span>想定損失</span><strong class="${lossCls}">${fmtYen(s.expected_loss)}</strong></div>
        </div>
        <div class="ai-scenario-rr">
          <span>リスクリワード</span>
          <strong class="ai-scenario-rr-val">${rr}</strong>
        </div>
        ${compact ? '' : `<p class="ai-scenario-reason">${reason}</p>`}
        <div class="ai-scenario-actions">
          ${showSave ? `<button type="button" class="ai-scenario-btn ai-scenario-save" data-save-symbol="${sym}">保存</button>` : ''}
          <a href="/stock/${encodeURIComponent(s.symbol)}" class="ai-scenario-btn ai-scenario-link">銘柄詳細</a>
        </div>
      </article>
    `;
  }

  function historyCardHtml(item, quote) {
    const current = quote?.current ?? item.last_current;
    const pnlData = calcPnl(item, current);
    const status = resolveStatus(item, current);
    const statusLabel = STATUS_LABEL[status] || status;
    const statusCls = status === 'target_hit' ? 'up' : (status === 'stop_hit' ? 'down' : '');
    const sym = global.escapeHtml ? global.escapeHtml(item.symbol) : item.symbol;
    const name = global.escapeHtml ? global.escapeHtml(item.name || '') : (item.name || '');
    const elapsed = daysBetween(item.saved_at || item.created_at, new Date());
    const pnlCls = pnlData && pnlData.pnl >= 0 ? 'up' : 'down';

    let statusNote = '';
    if (status === 'target_hit') statusNote = '目標株価ライン到達 → AI検証に集計されます';
    else if (status === 'stop_hit') statusNote = '損切りライン到達 → AI検証に集計されます';
    else if (status === 'expired') statusNote = '監視期限切れ → 終値ベースでAI検証に集計されます';

    return `
      <article class="ai-scenario-history-card card-premium" data-id="${item.id}">
        <div class="ai-scenario-history-head">
          <div>
            <span class="ai-scenario-symbol">${sym}</span>
            <span class="ai-scenario-name">${name}</span>
          </div>
          <span class="ai-scenario-status ${statusCls}">${statusLabel}</span>
        </div>
        <div class="ai-scenario-result-title">AI指示結果</div>
        <div class="ai-scenario-grid">
          <div class="ai-scenario-kv"><span>買値</span><strong>${fmtYen(item.buy_price)}</strong></div>
          <div class="ai-scenario-kv"><span>現在値</span><strong>${current != null ? fmtYen(current) : '—'}</strong></div>
          <div class="ai-scenario-kv"><span>株数</span><strong>${fmtNum(item.shares)}株</strong></div>
          <div class="ai-scenario-kv"><span>損益</span><strong class="${pnlCls}">${pnlData ? fmtSignedYen(pnlData.pnl) : '—'}</strong></div>
          <div class="ai-scenario-kv"><span>損益率</span><strong class="${pnlCls}">${pnlData ? fmtPct(pnlData.rate) : '—'}</strong></div>
          <div class="ai-scenario-kv"><span>経過</span><strong>${elapsed}日</strong></div>
        </div>
        ${statusNote ? `<p class="ai-scenario-status-note">${statusNote}</p>` : ''}
        <div class="ai-scenario-actions">
          <button type="button" class="ai-scenario-btn ai-scenario-refresh-one" data-id="${item.id}">結果を更新</button>
          <button type="button" class="ai-scenario-btn ai-scenario-remove" data-id="${item.id}">削除</button>
          <a href="/stock/${encodeURIComponent(item.symbol)}" class="ai-scenario-btn ai-scenario-link">銘柄詳細</a>
        </div>
      </article>
    `;
  }

  let _lastTrackAt = 0;
  const TRACK_MIN_MS = 60000;

  const TradeScenarios = {
    scenarios: [],
    disclaimer: '',

    getStore() {
      return loadHistory();
    },

    getStats() {
      const store = loadHistory();
      return computeStats(store.resolved || []);
    },

    async fetchScenarios(opts = {}) {
      const data = global.ApiCache
        ? await global.ApiCache.fetchJsonCached('/api/trade_scenarios', {
            ttl: 120000,
            force: !!opts.force,
          })
        : await (await fetch('/api/trade_scenarios', { cache: 'no-store' })).json();
      if (data.status !== 'ok') throw new Error('failed');
      TradeScenarios.scenarios = data.scenarios || [];
      TradeScenarios.disclaimer = data.disclaimer || '';
      return data;
    },

    saveScenario(scenario) {
      const store = loadHistory();
      const now = new Date();
      const expires = new Date(now);
      expires.setDate(expires.getDate() + EXPIRE_DAYS);
      const item = {
        id: uuid(),
        scenario_id: scenario.id,
        symbol: scenario.symbol,
        name: scenario.name,
        buy_price: scenario.buy_price,
        shares: scenario.shares,
        target_price: scenario.target_price,
        stop_price: scenario.stop_price,
        expected_profit: scenario.expected_profit,
        expected_loss: scenario.expected_loss,
        risk_reward: scenario.risk_reward,
        reason: scenario.reason,
        verdict: scenario.verdict,
        created_at: now.toISOString(),
        saved_at: now.toISOString(),
        expires_at: expires.toISOString(),
        status: 'watching',
        last_current: scenario.current,
      };
      store.items = [item, ...store.items.filter((x) => x.id !== item.id)];
      saveHistory(store);
      TradeScenarios.renderHomeScore();
      return item;
    },

    removeScenario(id) {
      const store = loadHistory();
      store.items = store.items.filter((x) => x.id !== id);
      store.resolved = (store.resolved || []).filter((x) => x.id !== id);
      saveHistory(store);
      TradeScenarios.renderHomeScore();
    },

    async refreshQuotes(items, opts = {}) {
      const symbols = [...new Set(items.map((x) => x.symbol))];
      if (!symbols.length) return {};
      const force = !!opts.force;
      if (!force && Date.now() - _lastTrackAt < TRACK_MIN_MS) {
        return {};
      }
      let data;
      if (global.ApiCache) {
        data = await global.ApiCache.postJsonCached(
          '/api/trade_scenarios/track',
          { symbols },
          { ttl: TRACK_MIN_MS, force },
        );
      } else {
        const res = await fetch('/api/trade_scenarios/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols }),
        });
        data = await res.json();
      }
      if (data.status !== 'ok') throw new Error('track failed');
      _lastTrackAt = Date.now();
      return data.quotes || {};
    },

    async updateHistoryStatuses(opts = {}) {
      let store = loadHistory();
      if (!store.items.length) {
        processVerification(store);
        saveHistory(store);
        return store;
      }
      const quotes = await TradeScenarios.refreshQuotes(store.items, opts);
      store.items = store.items.map((item) => {
        const q = quotes[item.symbol];
        const current = q?.current;
        return {
          ...item,
          last_current: current ?? item.last_current,
          status: resolveStatus(item, current),
          last_checked_at: new Date().toISOString(),
        };
      });
      store = processVerification(store);
      saveHistory(store);
      TradeScenarios.renderHomeScore();
      return store;
    },

    renderHomeScore() {
      const host = document.getElementById('aiScoreHome');
      if (!host) return;
      const stats = TradeScenarios.getStats();
      host.innerHTML = homeScoreHtml(stats);
      document.getElementById('openScoreboardBtn')?.addEventListener('click', () => {
        if (global.openSubPanel) global.openSubPanel('scenarios');
        setTimeout(() => {
          const body = document.getElementById('aiScenarioList');
          if (body) TradeScenarios.renderScoreboard(body);
        }, 400);
      });
    },

    renderPreview(hostId) {
      const host = document.getElementById(hostId);
      if (!host) return;
      const list = TradeScenarios.scenarios.slice(0, 3);
      if (!list.length) {
        host.innerHTML = '<p class="ai-scenario-empty">本日の候補を読み込めませんでした</p>';
        return;
      }
      host.innerHTML = list.map((s) => scenarioCardHtml(s, { compact: true })).join('')
        + `<p class="ai-scenario-disclaimer">${global.escapeHtml ? global.escapeHtml(TradeScenarios.disclaimer) : TradeScenarios.disclaimer}</p>`;
      TradeScenarios.bindSaveButtons(host);
    },

    renderScoreboard(host) {
      const store = loadHistory();
      const stats = computeStats(store.resolved || []);
      const rankings = computeRankings(store.resolved || []);
      host.innerHTML =
        panelTabsHtml('scoreboard') +
        statsGridHtml(stats) +
        rankingsHtml(rankings) +
        `<p class="ai-scenario-disclaimer">※これは売買推奨ではなく、株価データに基づく損益シミュレーションです。実際の投資判断は自己責任で行ってください。</p>`;
      TradeScenarios.bindPanelTabs(host);
    },

    renderFullList(hostId) {
      const host = document.getElementById(hostId);
      if (!host) return;
      const list = TradeScenarios.scenarios;
      if (!list.length) {
        host.innerHTML = '<p class="ai-scenario-empty">候補がありません</p>';
        return;
      }
      host.innerHTML =
        panelTabsHtml('candidates') +
        '<div class="ai-scenario-list">' + list.map((s) => scenarioCardHtml(s)).join('') + '</div>' +
        `<p class="ai-scenario-disclaimer">${global.escapeHtml ? global.escapeHtml(TradeScenarios.disclaimer) : TradeScenarios.disclaimer}</p>`;
      TradeScenarios.bindSaveButtons(host);
      TradeScenarios.bindPanelTabs(host);
    },

    async renderHistory(host) {
      host.innerHTML = '<div class="ai-scenario-loading">履歴を更新中...</div>';
      try {
        const store = await TradeScenarios.updateHistoryStatuses();
        const quotes = {};
        store.items.forEach((it) => {
          quotes[it.symbol] = { current: it.last_current };
        });
        host.innerHTML =
          panelTabsHtml('history') +
          (store.items.length
            ? '<div class="ai-scenario-list">' + store.items.map((it) => historyCardHtml(it, quotes[it.symbol])).join('') + '</div>'
            : '<p class="ai-scenario-empty">監視中のシナリオはありません。候補から「保存」を押してください。</p>') +
          `<p class="ai-scenario-disclaimer">${global.escapeHtml ? global.escapeHtml(TradeScenarios.disclaimer) : TradeScenarios.disclaimer}</p>`;
        TradeScenarios.bindHistoryActions(host);
        TradeScenarios.bindPanelTabs(host);
      } catch (e) {
        host.innerHTML = '<p class="ai-scenario-empty">履歴の更新に失敗しました</p>';
      }
    },

    bindSaveButtons(root) {
      root.querySelectorAll('[data-save-symbol]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sym = btn.dataset.saveSymbol;
          const sc = TradeScenarios.scenarios.find((x) => x.symbol === sym);
          if (!sc) return;
          TradeScenarios.saveScenario(sc);
          btn.textContent = '保存済み';
          btn.disabled = true;
        });
      });
    },

    bindHistoryActions(root) {
      root.querySelectorAll('.ai-scenario-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          TradeScenarios.removeScenario(btn.dataset.id);
          TradeScenarios.renderHistory(root.closest('.sub-panel-body') || root);
        });
      });
      root.querySelectorAll('.ai-scenario-refresh-one').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await TradeScenarios.updateHistoryStatuses();
          TradeScenarios.renderHistory(root.closest('.sub-panel-body') || root);
        });
      });
    },

    bindPanelTabs(root) {
      root.querySelectorAll('.ai-scenario-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          const body = root.closest('.sub-panel-body') || root;
          const mode = tab.dataset.mode;
          if (mode === 'history') TradeScenarios.renderHistory(body);
          else if (mode === 'scoreboard') TradeScenarios.renderScoreboard(body);
          else TradeScenarios.renderFullList(body.id);
        });
      });
    },

    async initHomePreview() {
      TradeScenarios.renderHomeScore();
      const host = document.getElementById('aiScenarioHomePreview');
      if (!host) return;
      host.innerHTML = '<div class="ai-scenario-loading">候補を読み込み中...</div>';
      try {
        await TradeScenarios.fetchScenarios();
        TradeScenarios.renderPreview('aiScenarioHomePreview');
        const store = TradeScenarios.getStore();
        if (store.items.length) {
          await TradeScenarios.updateHistoryStatuses({ force: true });
          TradeScenarios.renderHomeScore();
        }
      } catch (e) {
        console.error(e);
        host.innerHTML = '<p class="ai-scenario-empty">AI売買シナリオの読み込みに失敗しました</p>';
      }
    },

    async loadPanel(listId, mode) {
      const host = document.getElementById(listId);
      if (!host) return;
      try {
        if (!TradeScenarios.scenarios.length) await TradeScenarios.fetchScenarios();
        const store = TradeScenarios.getStore();
        if (store.items.length) await TradeScenarios.updateHistoryStatuses({ force: true });
        if (mode === 'history') await TradeScenarios.renderHistory(host);
        else if (mode === 'scoreboard') TradeScenarios.renderScoreboard(host);
        else TradeScenarios.renderFullList(listId);
      } catch (e) {
        console.error(e);
        host.innerHTML = '<p class="ai-scenario-empty">読み込みに失敗しました</p>';
      }
    },

    /** テスト・検証用: 確定シナリオを手動投入 */
    _seedResolved(record) {
      const store = loadHistory();
      store.resolved = [record, ...(store.resolved || [])];
      saveHistory(store);
    },

    computeStats,
    computeRankings,
    finalizeScenario,
    processVerification,
  };

  global.TradeScenarios = TradeScenarios;
})(window);
