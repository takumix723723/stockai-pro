/**
 * AI売買シナリオ — 候補一覧・保存・損益追跡・履歴
 * localStorage キー: stockai_ai_trade_scenarios
 */
(function (global) {
  const STORAGE_KEY = 'stockai_ai_trade_scenarios';
  const EXPIRE_DAYS = 7;

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

  function uuid() {
    return 'sc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : { version: 1, items: [] };
      if (!data.items) data.items = [];
      return data;
    } catch {
      return { version: 1, items: [] };
    }
  }

  function saveHistory(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    const expires = item.expires_at || item.expiresAt;
    if (expires && new Date() > new Date(expires)) {
      return 'expired';
    }
    if (current != null && item.target_price != null && current >= item.target_price) {
      return 'target_hit';
    }
    if (current != null && item.stop_price != null && current <= item.stop_price) {
      return 'stop_hit';
    }
    const saved = item.saved_at || item.savedAt || item.created_at || item.createdAt;
    if (saved && daysBetween(saved, new Date()) >= 1) {
      return 'holding';
    }
    return item.status === 'expired' ? 'expired' : (item.status || 'watching');
  }

  const STATUS_LABEL = {
    watching: '監視中',
    holding: '保有中想定',
    target_hit: '目標到達',
    stop_hit: '損切り到達',
    expired: '期限切れ',
  };

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

  function fmtNum(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('ja-JP');
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
    if (status === 'target_hit') statusNote = '目標株価ライン到達';
    else if (status === 'stop_hit') statusNote = '損切りライン到達';
    else if (status === 'expired') statusNote = '監視期限切れ';

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

  const TradeScenarios = {
    scenarios: [],
    disclaimer: '',

    async fetchScenarios() {
      const res = await fetch('/api/trade_scenarios', { cache: 'no-store' });
      const data = await res.json();
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
      return item;
    },

    removeScenario(id) {
      const store = loadHistory();
      store.items = store.items.filter((x) => x.id !== id);
      saveHistory(store);
    },

    async refreshQuotes(items) {
      const symbols = [...new Set(items.map((x) => x.symbol))];
      if (!symbols.length) return {};
      const res = await fetch('/api/trade_scenarios/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      const data = await res.json();
      if (data.status !== 'ok') throw new Error('track failed');
      return data.quotes || {};
    },

    async updateHistoryStatuses() {
      const store = loadHistory();
      if (!store.items.length) return store;
      const quotes = await TradeScenarios.refreshQuotes(store.items);
      store.items = store.items.map((item) => {
        const q = quotes[item.symbol];
        const current = q?.current;
        const status = resolveStatus(item, current);
        return {
          ...item,
          last_current: current ?? item.last_current,
          status,
          last_checked_at: new Date().toISOString(),
        };
      });
      saveHistory(store);
      return store;
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

    renderFullList(hostId, mode) {
      const host = document.getElementById(hostId);
      if (!host) return;

      if (mode === 'history') {
        TradeScenarios.renderHistory(host);
        return;
      }

      const list = TradeScenarios.scenarios;
      if (!list.length) {
        host.innerHTML = '<p class="ai-scenario-empty">候補がありません</p>';
        return;
      }
      host.innerHTML =
        '<div class="ai-scenario-tabs">' +
        '<button type="button" class="ai-scenario-tab active" data-mode="candidates">今日の候補</button>' +
        '<button type="button" class="ai-scenario-tab" data-mode="history">保存履歴</button>' +
        '</div>' +
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
          '<div class="ai-scenario-tabs">' +
          '<button type="button" class="ai-scenario-tab" data-mode="candidates">今日の候補</button>' +
          '<button type="button" class="ai-scenario-tab active" data-mode="history">保存履歴</button>' +
          '</div>' +
          (store.items.length
            ? '<div class="ai-scenario-list">' + store.items.map((it) => historyCardHtml(it, quotes[it.symbol])).join('') + '</div>'
            : '<p class="ai-scenario-empty">保存したシナリオはまだありません。候補から「保存」を押してください。</p>') +
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
          if (tab.dataset.mode === 'history') {
            TradeScenarios.renderHistory(body);
          } else {
            TradeScenarios.renderFullList(body.id, 'candidates');
          }
        });
      });
    },

    async initHomePreview() {
      const host = document.getElementById('aiScenarioHomePreview');
      if (!host) return;
      try {
        await TradeScenarios.fetchScenarios();
        TradeScenarios.renderPreview('aiScenarioHomePreview');
      } catch (e) {
        console.error(e);
        host.innerHTML = '<p class="ai-scenario-empty">AI売買シナリオの読み込みに失敗しました</p>';
      }
    },

    async loadPanel(listId, mode) {
      const host = document.getElementById(listId);
      if (!host) return;
      try {
        if (!TradeScenarios.scenarios.length) {
          await TradeScenarios.fetchScenarios();
        }
        if (mode === 'history') {
          await TradeScenarios.renderHistory(host);
        } else {
          TradeScenarios.renderFullList(listId, 'candidates');
        }
      } catch (e) {
        console.error(e);
        host.innerHTML = '<p class="ai-scenario-empty">読み込みに失敗しました</p>';
      }
    },
  };

  global.TradeScenarios = TradeScenarios;
})(window);
