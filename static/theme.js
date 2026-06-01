/**
 * テーマ関連銘柄 — スワイプ切替・リスト/ボード表示（SBI風）
 */
(function (global) {
  const VIEW_KEY = 'themeViewMode';

  const ThemeUI = {
    themes: [],
    activeIndex: 0,
    viewMode: 'list',
    scrollSyncLock: false,
    mounted: false,

    esc(s) {
      return global.escapeHtml ? global.escapeHtml(String(s ?? '')) : String(s ?? '');
    },

    async open(themeId) {
      ThemeUI.viewMode = localStorage.getItem(VIEW_KEY) || 'list';
      const host = document.getElementById('subPanelHost');
      if (!host) return;

      host.classList.add('is-open');
      host.innerHTML = `
        <div class="sub-panel theme-sub-panel">
          <div class="sub-panel-header">
            <button type="button" class="sub-panel-back" id="themePanelBack">← ホーム</button>
            <h2 class="sub-panel-title">📊 テーマ関連銘柄</h2>
          </div>
          <p class="sub-panel-desc">テーマを選んで関連銘柄を発掘 — スワイプで切替</p>
          <div class="theme-panel-root" id="themePanelRoot">
            <div class="skeleton-list"><div class="skeleton-card-row"></div><div class="skeleton-card-row"></div></div>
          </div>
        </div>`;

      document.body.classList.add('sub-panel-open');
      document.getElementById('mainTabArea')?.classList.add('is-behind');
      document.getElementById('themePanelBack')?.addEventListener('click', () => ThemeUI.close());
      window.scrollTo(0, 0);

      await ThemeUI.loadThemes(themeId);
      ThemeUI.mounted = true;
      global.activeSubPanel = 'theme';
    },

    close() {
      ThemeUI.mounted = false;
      ThemeUI.themes = [];
      ThemeUI.activeIndex = 0;
      global.activeSubPanel = null;
      global.closeSubPanel?.(false);
    },

    async loadThemes(initialId) {
      const root = document.getElementById('themePanelRoot');
      if (!root) return;
      try {
        const fetchFn = global.fetchSilent || fetch;
        const res = await fetchFn('/api/themes');
        const data = await res.json();
        if (data.status !== 'ok') throw new Error('failed');
        ThemeUI.themes = data.themes || [];
        const idx = ThemeUI.themes.findIndex((t) => t.id === initialId);
        ThemeUI.activeIndex = idx >= 0 ? idx : 0;
        ThemeUI.renderShell();
        await ThemeUI.loadActivePanel();
      } catch (e) {
        console.error(e);
        root.innerHTML = '<p class="theme-error">テーマの読み込みに失敗しました</p>';
      }
    },

    renderShell() {
      const root = document.getElementById('themePanelRoot');
      if (!root || !ThemeUI.themes.length) return;

      root.innerHTML = `
        <div class="theme-toolbar">
          <div class="theme-view-toggle" role="group" aria-label="表示切替">
            <button type="button" class="theme-view-btn${ThemeUI.viewMode === 'list' ? ' active' : ''}" data-view="list">リスト</button>
            <button type="button" class="theme-view-btn${ThemeUI.viewMode === 'board' ? ' active' : ''}" data-view="board">ボード</button>
          </div>
          <button type="button" class="theme-action-btn" id="themeAddCategoryBtn" title="テーマ名でカテゴリ作成">＋ カテゴリ</button>
          <button type="button" class="theme-action-btn theme-action-primary" id="themeAddAllBtn" title="表示中テーマの銘柄を一括登録">全て登録</button>
        </div>
        <div class="theme-tab-bar wl-tab-bar" id="themeTabBar" role="tablist"></div>
        <div class="theme-carousel wl-carousel" id="themeCarousel"></div>`;

      const tabBar = document.getElementById('themeTabBar');
      const carousel = document.getElementById('themeCarousel');

      tabBar.innerHTML = ThemeUI.themes.map((t, i) => `
        <button type="button" class="wl-tab theme-tab${i === ThemeUI.activeIndex ? ' active' : ''}"
          data-theme-index="${i}" data-theme-id="${ThemeUI.esc(t.id)}" role="tab"
          aria-selected="${i === ThemeUI.activeIndex}">
          ${ThemeUI.esc(t.name)}
          <span class="wl-tab-count">${t.symbol_count || 0}</span>
        </button>
      `).join('');

      carousel.innerHTML = ThemeUI.themes.map((t, i) => ThemeUI.panelShell(t, i)).join('');

      tabBar.querySelectorAll('.theme-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.themeIndex);
          if (!Number.isNaN(idx)) ThemeUI.goToIndex(idx);
        });
      });

      carousel.onscroll = () => {
        if (ThemeUI.scrollSyncLock) return;
        const idx = ThemeUI.indexFromScroll(carousel);
        if (idx !== ThemeUI.activeIndex) {
          ThemeUI.setActiveIndex(idx, { scrollCarousel: false });
          ThemeUI.loadActivePanel();
        }
      };

      root.querySelectorAll('.theme-view-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          ThemeUI.viewMode = btn.dataset.view;
          localStorage.setItem(VIEW_KEY, ThemeUI.viewMode);
          root.querySelectorAll('.theme-view-btn').forEach((b) => b.classList.toggle('active', b === btn));
          ThemeUI.refreshActiveView();
        });
      });

      document.getElementById('themeAddCategoryBtn')?.addEventListener('click', () => ThemeUI.createCategoryFromTheme());
      document.getElementById('themeAddAllBtn')?.addEventListener('click', () => ThemeUI.addAllToWatchlist());

      ThemeUI.scrollToIndex(ThemeUI.activeIndex, false);
      ThemeUI.scrollTabIntoView(ThemeUI.activeIndex);
    },

    panelShell(theme, index) {
      return `
        <section class="theme-panel wl-panel" data-theme-panel="${index}" data-theme-id="${ThemeUI.esc(theme.id)}" role="tabpanel">
          <div class="theme-panel-head">
            <div class="theme-panel-title-row">
              <span class="theme-panel-name">${ThemeUI.esc(theme.name)}</span>
              <span class="theme-panel-trend ${ThemeUI.esc(theme.color)}">${ThemeUI.esc(theme.trend)}</span>
            </div>
            <p class="theme-panel-reason" data-theme-reason="${ThemeUI.esc(theme.id)}">${ThemeUI.esc(theme.detail || '')}</p>
          </div>
          <div class="theme-stock-body" data-theme-body="${ThemeUI.esc(theme.id)}">
            <div class="skeleton-list">${Array.from({ length: 4 }, () => '<div class="skeleton-card-row"></div>').join('')}</div>
          </div>
        </section>`;
    },

    indexFromScroll(carousel) {
      const w = carousel.clientWidth || 1;
      return Math.max(0, Math.round(carousel.scrollLeft / w));
    },

    goToIndex(index) {
      ThemeUI.setActiveIndex(index, { scrollCarousel: true });
      ThemeUI.loadActivePanel();
    },

    setActiveIndex(index, opts = {}) {
      if (!ThemeUI.themes.length) return;
      const next = Math.max(0, Math.min(index, ThemeUI.themes.length - 1));
      ThemeUI.activeIndex = next;
      document.querySelectorAll('.theme-tab').forEach((tab, i) => {
        const on = i === next;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (opts.scrollCarousel) ThemeUI.scrollToIndex(next, true);
      ThemeUI.scrollTabIntoView(next);
    },

    scrollToIndex(index, smooth) {
      const carousel = document.getElementById('themeCarousel');
      if (!carousel) return;
      const panel = carousel.querySelector(`[data-theme-panel="${index}"]`);
      if (!panel) return;
      ThemeUI.scrollSyncLock = true;
      carousel.scrollTo({ left: panel.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
      window.setTimeout(() => { ThemeUI.scrollSyncLock = false; }, smooth ? 320 : 0);
    },

    scrollTabIntoView(index) {
      document.querySelector(`.theme-tab[data-theme-index="${index}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    },

    getActiveThemeId() {
      return ThemeUI.themes[ThemeUI.activeIndex]?.id || null;
    },

    async loadActivePanel() {
      const themeId = ThemeUI.getActiveThemeId();
      if (!themeId) return;
      const body = document.querySelector(`[data-theme-body="${themeId}"]`);
      if (!body || body.dataset.loaded === '1') {
        ThemeUI.refreshActiveView();
        return;
      }
      try {
        const fetchFn = global.fetchSilent || fetch;
        const res = await fetchFn(`/api/themes/${encodeURIComponent(themeId)}`);
        const data = await res.json();
        if (data.status !== 'ok' || !data.theme) throw new Error('failed');
        body.dataset.loaded = '1';
        body.dataset.stocks = JSON.stringify(data.theme.stocks || []);
        const reasonEl = document.querySelector(`[data-theme-reason="${themeId}"]`);
        if (reasonEl && data.theme.reason) reasonEl.textContent = data.theme.reason;
        body.innerHTML = ThemeUI.renderStocks(data.theme.stocks || []);
        ThemeUI.bindStockEvents(body, data.theme);
      } catch (e) {
        console.error(e);
        body.innerHTML = '<p class="theme-error">銘柄データの取得に失敗しました</p>';
      }
    },

    refreshActiveView() {
      const themeId = ThemeUI.getActiveThemeId();
      const body = document.querySelector(`[data-theme-body="${themeId}"]`);
      if (!body || !body.dataset.stocks) return;
      try {
        const stocks = JSON.parse(body.dataset.stocks);
        body.innerHTML = ThemeUI.renderStocks(stocks);
        const theme = ThemeUI.themes[ThemeUI.activeIndex];
        ThemeUI.bindStockEvents(body, { id: themeId, name: theme?.name, stocks });
      } catch (_) { /* ignore */ }
    },

    renderStocks(stocks) {
      if (!stocks.length) return '<p class="theme-empty">関連銘柄がありません</p>';
      if (ThemeUI.viewMode === 'board') {
        return `<div class="theme-board-grid">${stocks.map((s) => ThemeUI.boardCardHtml(s)).join('')}</div>`;
      }
      return `<div class="theme-stock-list">${stocks.map((s) => ThemeUI.listRowHtml(s)).join('')}</div>`;
    },

    fmtPrice(n) {
      if (n == null || Number.isNaN(n)) return '—';
      return '¥' + Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    },

    chgHtml(s) {
      const up = (s.change_pct ?? 0) >= 0;
      const cls = up ? 'up' : 'down';
      const chg = s.change != null ? `${up ? '+' : ''}${Number(s.change).toFixed(0)}` : '—';
      const pct = s.change_pct != null ? `${up ? '+' : ''}${Number(s.change_pct).toFixed(2)}%` : '—';
      return `<span class="theme-chg ${cls}">${chg}</span><span class="theme-pct ${cls}">${pct}</span>`;
    },

    listRowHtml(s) {
      return `
        <div class="theme-stock-row watch-item card-premium" data-symbol="${ThemeUI.esc(s.symbol)}">
          <div class="watch-left">
            <div class="watch-symbol">${ThemeUI.esc(s.symbol)}</div>
            <div class="watch-name">${ThemeUI.esc(s.name || '')}</div>
          </div>
          <div class="watch-right">
            <div class="watch-price">${ThemeUI.fmtPrice(s.current)}</div>
            <div class="watch-chg-row">${ThemeUI.chgHtml(s)}</div>
          </div>
          <button type="button" class="theme-add-btn" data-symbol="${ThemeUI.esc(s.symbol)}" aria-label="登録銘柄に追加">＋</button>
        </div>`;
    },

    boardCardHtml(s) {
      const up = (s.change_pct ?? 0) >= 0;
      const cls = up ? 'up' : 'down';
      return `
        <div class="theme-board-card card-premium ${cls}" data-symbol="${ThemeUI.esc(s.symbol)}">
          <div class="theme-board-top">
            <span class="theme-board-sym">${ThemeUI.esc(s.symbol)}</span>
            <button type="button" class="theme-add-btn theme-add-btn-sm" data-symbol="${ThemeUI.esc(s.symbol)}" aria-label="追加">＋</button>
          </div>
          <div class="theme-board-name">${ThemeUI.esc(s.name || '')}</div>
          <div class="theme-board-price">${ThemeUI.fmtPrice(s.current)}</div>
          <div class="theme-board-chg ${cls}">${ThemeUI.chgHtml(s)}</div>
        </div>`;
    },

    bindStockEvents(container, theme) {
      container.querySelectorAll('.theme-stock-row, .theme-board-card').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.theme-add-btn')) return;
          global.goToStock?.(row.dataset.symbol);
        });
      });
      container.querySelectorAll('.theme-add-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          ThemeUI.addSymbolToWatchlist(btn.dataset.symbol, theme?.name);
        });
      });
    },

    findOrCreateFolder(name) {
      const store = global.WatchlistStore;
      if (!store) return null;
      const trimmed = String(name || '').trim();
      if (!trimmed) return null;
      let folder = store.getFolders().find((f) => f.name === trimmed);
      if (!folder) folder = store.createFolder(trimmed);
      return folder;
    },

    addSymbolToWatchlist(symbol, folderName) {
      const store = global.WatchlistStore;
      if (!store) {
        global.showToast?.('登録銘柄機能が利用できません');
        return;
      }
      const folders = store.getFolders();
      let folder;
      if (folderName) {
        folder = ThemeUI.findOrCreateFolder(folderName);
      } else if (folders.length) {
        folder = folders[global.WatchlistUI?.activeIndex ?? 0] || folders[0];
      } else {
        global.showToast?.('先にカテゴリを作成します');
        global.WatchlistUI?.openFolderModal();
        return;
      }
      if (!folder) return;
      if (store.addSymbol(folder.id, symbol)) {
        global.showToast?.(`${symbol} を「${folder.name}」に追加`);
        global.updateWatchlistBadge?.();
      } else {
        global.showToast?.(`${symbol} は既に登録済みです`);
      }
    },

    createCategoryFromTheme() {
      const theme = ThemeUI.themes[ThemeUI.activeIndex];
      if (!theme) return;
      const store = global.WatchlistStore;
      if (!store) return;
      const existing = store.getFolders().find((f) => f.name === theme.name);
      if (existing) {
        global.showToast?.(`「${theme.name}」カテゴリは既にあります`);
        global.WatchlistUI?.goToIndex(store.getFolders().findIndex((f) => f.id === existing.id));
        global.switchTab?.('watchlist');
        ThemeUI.close();
        return;
      }
      store.createFolder(theme.name);
      global.showToast?.(`「${theme.name}」カテゴリを作成しました`);
      global.updateWatchlistBadge?.();
      global.WatchlistUI?.render(false);
    },

    async addAllToWatchlist() {
      const themeId = ThemeUI.getActiveThemeId();
      const body = document.querySelector(`[data-theme-body="${themeId}"]`);
      const theme = ThemeUI.themes[ThemeUI.activeIndex];
      if (!body?.dataset.stocks || !theme) {
        await ThemeUI.loadActivePanel();
        return ThemeUI.addAllToWatchlist();
      }
      const stocks = JSON.parse(body.dataset.stocks);
      const folder = ThemeUI.findOrCreateFolder(theme.name);
      if (!folder) return;
      let added = 0;
      stocks.forEach((s) => {
        if (global.WatchlistStore?.addSymbol(folder.id, s.symbol)) added += 1;
      });
      global.showToast?.(`${added}銘柄を「${folder.name}」に追加`);
      global.updateWatchlistBadge?.();
    },
  };

  global.ThemeUI = ThemeUI;
  global.openThemePanel = (themeId) => ThemeUI.open(themeId);
})(window);
