/**
 * 登録銘柄 — カテゴリ別スワイプ切替（SBI風）
 * localStorage 保存（将来 API/DB 差し替え可能）
 */
(function (global) {
  const STORAGE_KEY = 'watchlistData';
  const LEGACY_KEY = 'watchlist';

  function generateId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function emptyData() {
    return { version: 1, folders: [], updatedAt: new Date().toISOString() };
  }

  const WatchlistStore = {
    load() {
      WatchlistStore.migrateFromLegacy();
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyData();
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.folders)) return emptyData();
        data.folders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return data;
      } catch {
        return emptyData();
      }
    },

    save(data) {
      data.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },

    migrateFromLegacy() {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return;
      let symbols = [];
      try {
        symbols = JSON.parse(legacy);
      } catch {
        localStorage.removeItem(LEGACY_KEY);
        return;
      }
      if (!Array.isArray(symbols) || !symbols.length) {
        localStorage.removeItem(LEGACY_KEY);
        return;
      }
      const data = WatchlistStore.loadRaw();
      if (data.folders.length > 0) {
        localStorage.removeItem(LEGACY_KEY);
        return;
      }
      data.folders.push({
        id: generateId('f'),
        name: '監視中',
        order: 0,
        collapsed: false,
        symbols: symbols.filter((s) => /^\d{4}$/.test(String(s))),
        createdAt: new Date().toISOString(),
      });
      WatchlistStore.save(data);
      localStorage.removeItem(LEGACY_KEY);
    },

    loadRaw() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyData();
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.folders)) return emptyData();
        return data;
      } catch {
        return emptyData();
      }
    },

    getFolders() {
      return [...WatchlistStore.load().folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },

    getFolder(id) {
      return WatchlistStore.load().folders.find((f) => f.id === id);
    },

    getTotalSymbolCount() {
      const set = new Set();
      WatchlistStore.load().folders.forEach((f) => {
        (f.symbols || []).forEach((s) => set.add(s));
      });
      return set.size;
    },

    getAllSymbols() {
      const set = new Set();
      WatchlistStore.load().folders.forEach((f) => {
        (f.symbols || []).forEach((s) => set.add(s));
      });
      return [...set];
    },

    createFolder(name) {
      const data = WatchlistStore.load();
      const maxOrder = data.folders.reduce((m, f) => Math.max(m, f.order ?? 0), -1);
      const folder = {
        id: generateId('f'),
        name: name.trim(),
        order: maxOrder + 1,
        collapsed: false,
        symbols: [],
        createdAt: new Date().toISOString(),
      };
      data.folders.push(folder);
      WatchlistStore.save(data);
      return folder;
    },

    renameFolder(id, name) {
      const data = WatchlistStore.load();
      const f = data.folders.find((x) => x.id === id);
      if (!f) return false;
      f.name = name.trim();
      WatchlistStore.save(data);
      return true;
    },

    deleteFolder(id) {
      const data = WatchlistStore.load();
      data.folders = data.folders.filter((f) => f.id !== id);
      WatchlistStore.save(data);
    },

    addSymbol(folderId, symbol) {
      const sym = String(symbol).trim();
      if (!/^\d{4}$/.test(sym)) return false;
      const data = WatchlistStore.load();
      const f = data.folders.find((x) => x.id === folderId);
      if (!f) return false;
      if (!f.symbols) f.symbols = [];
      if (f.symbols.includes(sym)) return false;
      f.symbols.push(sym);
      WatchlistStore.save(data);
      return true;
    },

    removeSymbol(folderId, symbol) {
      const data = WatchlistStore.load();
      const f = data.folders.find((x) => x.id === folderId);
      if (!f || !f.symbols) return;
      f.symbols = f.symbols.filter((s) => s !== symbol);
      WatchlistStore.save(data);
    },

    reorderSymbols(folderId, fromSym, toSym) {
      const data = WatchlistStore.load();
      const f = data.folders.find((x) => x.id === folderId);
      if (!f || !f.symbols) return;
      const fromIdx = f.symbols.indexOf(fromSym);
      const toIdx = f.symbols.indexOf(toSym);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      const [moved] = f.symbols.splice(fromIdx, 1);
      f.symbols.splice(toIdx, 0, moved);
      WatchlistStore.save(data);
    },
  };

  const WatchlistUI = {
    watchCache: {},
    mounted: false,
    activeIndex: 0,
    scrollSyncLock: false,
    drag: { type: null, folderId: null, symbol: null },

    init() {
      WatchlistStore.migrateFromLegacy();
    },

    destroy() {
      Object.keys(WatchlistUI.watchCache).forEach((k) => delete WatchlistUI.watchCache[k]);
      WatchlistUI.mounted = false;
      WatchlistUI.activeIndex = 0;
      WatchlistUI.scrollSyncLock = false;
      WatchlistUI.drag = { type: null, folderId: null, symbol: null };
    },

    getActiveFolderId() {
      const folders = WatchlistStore.getFolders();
      return folders[WatchlistUI.activeIndex]?.id || folders[0]?.id || null;
    },

    mountTab() {
      if (!document.getElementById('watchCarousel')) return;
      WatchlistUI.mounted = true;
      WatchlistUI.render(false);
    },

    render(silent) {
      const root = document.getElementById('watchSwipeRoot');
      const tabBar = document.getElementById('watchTabBar');
      const carousel = document.getElementById('watchCarousel');
      if (!root || !tabBar || !carousel) return Promise.resolve();

      if (silent && carousel.querySelector('.wl-panel')) {
        return WatchlistUI.refreshActivePanelPrices();
      }

      const folders = WatchlistStore.getFolders();
      if (WatchlistUI.activeIndex >= folders.length) {
        WatchlistUI.activeIndex = Math.max(0, folders.length - 1);
      }

      if (!folders.length) {
        root.hidden = true;
        let empty = document.getElementById('watchEmptyState');
        if (!empty) {
          empty = document.createElement('div');
          empty.id = 'watchEmptyState';
          root.parentElement?.appendChild(empty);
        }
        empty.hidden = false;
        empty.innerHTML = `
          <div class="wf-empty card-premium">
            <span class="wf-empty-icon">📋</span>
            <p>カテゴリがありません</p>
            <p class="wf-empty-hint">半導体・防衛・商社 などテーマ別に登録できます</p>
            <button type="button" class="add-watch-btn-lg" id="wfEmptyCreateBtn">＋ カテゴリを作成</button>
          </div>
        `;
        document.getElementById('wfEmptyCreateBtn')?.addEventListener('click', () => WatchlistUI.openFolderModal());
        return Promise.resolve();
      }

      root.hidden = false;
      const empty = document.getElementById('watchEmptyState');
      if (empty) empty.hidden = true;

      tabBar.innerHTML = folders.map((f, i) => `
        <button type="button" class="wl-tab${i === WatchlistUI.activeIndex ? ' active' : ''}"
          data-wl-index="${i}" data-folder-id="${WatchlistUI.esc(f.id)}" role="tab"
          aria-selected="${i === WatchlistUI.activeIndex}">
          ${WatchlistUI.esc(f.name)}
          <span class="wl-tab-count">${(f.symbols || []).length}</span>
        </button>
      `).join('');

      carousel.innerHTML = folders.map((f, i) => WatchlistUI.panelHtml(f, i)).join('');

      WatchlistUI.bindTabBar(tabBar);
      WatchlistUI.bindCarousel(carousel);
      folders.forEach((f) => {
        const body = carousel.querySelector(`[data-wl-panel-body="${f.id}"]`);
        if (body) WatchlistUI.bindSymbolEvents(body, f.id);
      });

      WatchlistUI.scrollToIndex(WatchlistUI.activeIndex, false);
      WatchlistUI.scrollTabIntoView(WatchlistUI.activeIndex);

      return WatchlistUI.ensurePanelPrices(folders[WatchlistUI.activeIndex].id);
    },

    panelHtml(f, index) {
      const count = (f.symbols || []).length;
      const body = count
        ? (f.symbols || []).map((sym) => WatchlistUI.symbolRowHtml(f.id, sym)).join('')
        : '<div class="wf-empty-folder">銘柄がありません — 「＋ 銘柄」から追加</div>';

      return `
        <section class="wl-panel" data-wl-panel="${index}" data-folder-id="${WatchlistUI.esc(f.id)}" role="tabpanel">
          <div class="wl-panel-toolbar">
            <div class="wl-panel-meta">
              <span class="wl-panel-title">${WatchlistUI.esc(f.name)}</span>
              <span class="wl-panel-count">${count}銘柄</span>
            </div>
            <div class="wl-panel-actions">
              <button type="button" class="wf-action-btn" data-action="add-symbol" data-folder-id="${WatchlistUI.esc(f.id)}" title="銘柄追加">＋</button>
              <button type="button" class="wf-action-btn" data-action="rename" data-folder-id="${WatchlistUI.esc(f.id)}" title="名前変更">✎</button>
              <button type="button" class="wf-action-btn wf-action-danger" data-action="delete" data-folder-id="${WatchlistUI.esc(f.id)}" title="削除">✕</button>
            </div>
          </div>
          <div class="wl-symbol-list" data-wl-panel-body="${WatchlistUI.esc(f.id)}">${body}</div>
        </section>
      `;
    },

    symbolRowHtml(folderId, sym) {
      const d = WatchlistUI.watchCache[sym];
      if (!d) {
        return `
          <div class="watch-item wf-symbol-row is-loading" data-symbol="${WatchlistUI.esc(sym)}" data-folder-id="${WatchlistUI.esc(folderId)}" draggable="true">
            <span class="wf-sym-drag" data-drag="symbol">☰</span>
            <div class="watch-left">
              <div class="watch-symbol">${WatchlistUI.esc(sym)}</div>
              <div class="watch-name"><span class="skeleton-line skeleton-sm" style="display:inline-block;width:72px"></span></div>
            </div>
            <div class="watch-right"><span class="watch-loading-text">…</span></div>
            <button type="button" class="watch-remove" data-symbol="${WatchlistUI.esc(sym)}" data-folder-id="${WatchlistUI.esc(folderId)}" aria-label="削除">✕</button>
          </div>
        `;
      }
      const up = (d.change_pct ?? 0) >= 0;
      const cls = up ? 'up' : 'down';
      const price = d.current != null ? `¥${Number(d.current).toLocaleString()}` : 'N/A';
      const chg = d.change != null ? `${up ? '+' : ''}${Number(d.change).toFixed(0)}` : '—';
      const pct = d.change_pct != null ? `${up ? '+' : ''}${d.change_pct.toFixed(2)}%` : '—';
      return `
        <div class="watch-item wf-symbol-row" data-symbol="${WatchlistUI.esc(sym)}" data-folder-id="${WatchlistUI.esc(folderId)}" draggable="true">
          <span class="wf-sym-drag" data-drag="symbol">☰</span>
          <div class="watch-left">
            <div class="watch-symbol">${WatchlistUI.esc(sym)}</div>
            <div class="watch-name">${WatchlistUI.esc(d.name || '')}</div>
          </div>
          <div class="watch-right">
            <div class="watch-price">${price}</div>
            <div class="watch-chg-row ${cls}"><span>${chg}</span><span class="watch-pct">${pct}</span></div>
          </div>
          <button type="button" class="watch-remove" data-symbol="${WatchlistUI.esc(sym)}" data-folder-id="${WatchlistUI.esc(folderId)}" aria-label="削除">✕</button>
        </div>
      `;
    },

    bindTabBar(tabBar) {
      tabBar.querySelectorAll('.wl-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.wlIndex);
          if (!Number.isNaN(idx)) WatchlistUI.goToIndex(idx);
        });
      });
    },

    bindCarousel(carousel) {
      carousel.onscroll = () => {
        if (WatchlistUI.scrollSyncLock) return;
        const idx = WatchlistUI.indexFromScroll(carousel);
        if (idx !== WatchlistUI.activeIndex) {
          WatchlistUI.setActiveIndex(idx, { scrollCarousel: false });
          const folders = WatchlistStore.getFolders();
          if (folders[idx]) WatchlistUI.ensurePanelPrices(folders[idx].id);
        }
      };

      carousel.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const folderId = btn.dataset.folderId;
          if (action === 'add-symbol') WatchlistUI.openSymbolModal(folderId);
          else if (action === 'rename') WatchlistUI.openFolderModal(folderId);
          else if (action === 'delete') WatchlistUI.confirmDeleteFolder(folderId);
        });
      });
    },

    indexFromScroll(carousel) {
      const w = carousel.clientWidth || 1;
      return Math.max(0, Math.round(carousel.scrollLeft / w));
    },

    goToIndex(index) {
      WatchlistUI.setActiveIndex(index, { scrollCarousel: true });
      const folders = WatchlistStore.getFolders();
      if (folders[index]) WatchlistUI.ensurePanelPrices(folders[index].id);
    },

    setActiveIndex(index, opts = {}) {
      const folders = WatchlistStore.getFolders();
      if (!folders.length) return;
      const next = Math.max(0, Math.min(index, folders.length - 1));
      WatchlistUI.activeIndex = next;

      document.querySelectorAll('.wl-tab').forEach((tab, i) => {
        const on = i === next;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      if (opts.scrollCarousel) WatchlistUI.scrollToIndex(next, true);
      WatchlistUI.scrollTabIntoView(next);
    },

    scrollToIndex(index, smooth) {
      const carousel = document.getElementById('watchCarousel');
      if (!carousel) return;
      const panel = carousel.querySelector(`[data-wl-panel="${index}"]`);
      if (!panel) return;
      WatchlistUI.scrollSyncLock = true;
      carousel.scrollTo({ left: panel.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
      window.setTimeout(() => { WatchlistUI.scrollSyncLock = false; }, smooth ? 320 : 0);
    },

    scrollTabIntoView(index) {
      const tab = document.querySelector(`.wl-tab[data-wl-index="${index}"]`);
      tab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    },

    refreshPanelBody(folderId) {
      const f = WatchlistStore.getFolder(folderId);
      const body = document.querySelector(`[data-wl-panel-body="${folderId}"]`);
      if (!f || !body) return;
      body.innerHTML = (f.symbols || []).length
        ? (f.symbols || []).map((sym) => WatchlistUI.symbolRowHtml(folderId, sym)).join('')
        : '<div class="wf-empty-folder">銘柄がありません — 「＋ 銘柄」から追加</div>';
      WatchlistUI.bindSymbolEvents(body, folderId);
      const panel = body.closest('.wl-panel');
      const countEl = panel?.querySelector('.wl-panel-count');
      if (countEl) countEl.textContent = `${(f.symbols || []).length}銘柄`;
      const tab = document.querySelector(`.wl-tab[data-folder-id="${folderId}"] .wl-tab-count`);
      if (tab) tab.textContent = String((f.symbols || []).length);
    },

    bindSymbolEvents(container, folderId) {
      container.querySelectorAll('.wf-symbol-row').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.watch-remove') || e.target.closest('.wf-sym-drag')) return;
          global.goToStock?.(row.dataset.symbol);
        });
        WatchlistUI.bindSymbolDrag(row, folderId);
      });
      container.querySelectorAll('.watch-remove').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          WatchlistStore.removeSymbol(btn.dataset.folderId, btn.dataset.symbol);
          delete WatchlistUI.watchCache[btn.dataset.symbol];
          WatchlistUI.refreshPanelBody(btn.dataset.folderId);
          global.updateWatchlistBadge?.();
        });
      });
    },

    bindSymbolDrag(row, folderId) {
      const sym = row.dataset.symbol;
      row.addEventListener('dragstart', (e) => {
        if (!e.target.closest('[data-drag="symbol"]')) {
          e.preventDefault();
          return;
        }
        WatchlistUI.drag = { type: 'symbol', folderId, symbol: sym };
        row.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', sym);
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        row.parentElement?.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
        WatchlistUI.drag = { type: null, folderId: null, symbol: null };
      });
      row.addEventListener('dragover', (e) => {
        if (WatchlistUI.drag.type !== 'symbol' || WatchlistUI.drag.folderId !== folderId) return;
        e.preventDefault();
        if (WatchlistUI.drag.symbol !== sym) row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('is-drop-target');
        if (WatchlistUI.drag.type === 'symbol' && WatchlistUI.drag.symbol !== sym) {
          WatchlistStore.reorderSymbols(folderId, WatchlistUI.drag.symbol, sym);
          WatchlistUI.refreshPanelBody(folderId);
        }
      });
    },

    async loadWatchItem(sym) {
      try {
        const fetchFn = global.fetchSilent || fetch;
        const res = await fetchFn(`/api/stock?symbol=${encodeURIComponent(sym)}`);
        const data = await res.json();
        if (data.status !== 'ok') return;
        WatchlistUI.watchCache[sym] = data.data;
        WatchlistUI.updateSymbolRows(sym);
      } catch (e) {
        console.error(e);
      }
    },

    updateSymbolRows(sym) {
      document.querySelectorAll(`.wf-symbol-row[data-symbol="${sym}"]`).forEach((row) => {
        const folderId = row.dataset.folderId;
        const parent = row.parentElement;
        if (!parent) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = WatchlistUI.symbolRowHtml(folderId, sym);
        const newRow = tmp.firstElementChild;
        row.replaceWith(newRow);
        WatchlistUI.bindSymbolEvents(parent, folderId);
      });
    },

    async loadFolderPrices(folderId) {
      const f = WatchlistStore.getFolder(folderId);
      if (!f) return;
      for (let i = 0; i < (f.symbols || []).length; i += 1) {
        const sym = f.symbols[i];
        await WatchlistUI.loadWatchItem(sym);
        if (i < f.symbols.length - 1) await new Promise((r) => setTimeout(r, 100));
      }
    },

    async ensurePanelPrices(folderId) {
      await WatchlistUI.loadFolderPrices(folderId);
    },

    async refreshActivePanelPrices() {
      const folderId = WatchlistUI.getActiveFolderId();
      if (!folderId) return;
      const f = WatchlistStore.getFolder(folderId);
      if (!f) return;
      await Promise.allSettled((f.symbols || []).map((sym) => WatchlistUI.loadWatchItem(sym)));
    },

    refresh(opts = {}) {
      if (!WatchlistUI.mounted) return Promise.resolve();
      return WatchlistUI.render(!!opts.silent);
    },

    openFolderModal(editId) {
      const modal = document.getElementById('folderModal');
      const input = document.getElementById('folderNameInput');
      const title = document.getElementById('folderModalTitle');
      if (!modal || !input) return;
      modal.dataset.editId = editId || '';
      if (editId) {
        const f = WatchlistStore.getFolder(editId);
        title.textContent = 'カテゴリ名を変更';
        input.value = f?.name || '';
      } else {
        title.textContent = 'カテゴリを作成';
        input.value = '';
      }
      modal.style.display = 'flex';
      input.focus();
    },

    closeFolderModal() {
      const modal = document.getElementById('folderModal');
      if (modal) modal.style.display = 'none';
    },

    saveFolderModal() {
      const modal = document.getElementById('folderModal');
      const input = document.getElementById('folderNameInput');
      const name = input?.value.trim();
      if (!name) {
        global.showToast?.('カテゴリ名を入力してください');
        return;
      }
      const editId = modal?.dataset.editId;
      if (editId) {
        WatchlistStore.renameFolder(editId, name);
        global.showToast?.('カテゴリ名を変更しました');
      } else {
        const folder = WatchlistStore.createFolder(name);
        WatchlistUI.activeIndex = WatchlistStore.getFolders().findIndex((f) => f.id === folder.id);
        global.showToast?.(`「${name}」を作成しました`);
      }
      WatchlistUI.closeFolderModal();
      WatchlistUI.render(false);
      global.updateWatchlistBadge?.();
    },

    confirmDeleteFolder(folderId) {
      const f = WatchlistStore.getFolder(folderId);
      if (!f) return;
      if (!confirm(`「${f.name}」を削除しますか？\n（中の銘柄も削除されます）`)) return;
      (f.symbols || []).forEach((s) => delete WatchlistUI.watchCache[s]);
      WatchlistStore.deleteFolder(folderId);
      WatchlistUI.render(false);
      global.updateWatchlistBadge?.();
      global.showToast?.('カテゴリを削除しました');
    },

    openSymbolModal(folderId) {
      const modal = document.getElementById('watchModal');
      const input = document.getElementById('watchInput');
      const hint = document.getElementById('watchModalCategory');
      if (!modal) return;
      const id = folderId || WatchlistUI.getActiveFolderId();
      const folders = WatchlistStore.getFolders();
      if (!folders.length) {
        global.showToast?.('先にカテゴリを作成してください');
        WatchlistUI.openFolderModal();
        return;
      }
      const f = WatchlistStore.getFolder(id) || folders[WatchlistUI.activeIndex];
      modal.dataset.prefFolder = f?.id || '';
      if (hint && f) hint.textContent = `追加先: ${f.name}`;
      input.value = '';
      modal.style.display = 'flex';
      input?.focus();
    },

    closeSymbolModal() {
      document.getElementById('watchModal').style.display = 'none';
    },

    addSymbolFromModal() {
      const modal = document.getElementById('watchModal');
      const input = document.getElementById('watchInput');
      const folderId = modal?.dataset.prefFolder || WatchlistUI.getActiveFolderId();
      const val = input?.value.trim();
      if (!folderId) {
        global.showToast?.('カテゴリがありません');
        return;
      }
      if (!/^\d{4}$/.test(val)) {
        global.showToast?.('4桁コードを入力してください');
        return;
      }
      if (!WatchlistStore.addSymbol(folderId, val)) {
        global.showToast?.('追加できません（重複またはエラー）');
        return;
      }
      WatchlistUI.closeSymbolModal();
      WatchlistUI.refreshPanelBody(folderId);
      global.updateWatchlistBadge?.();
      global.showToast?.(`${val} を追加しました`);
      WatchlistUI.loadWatchItem(val);
    },

    esc(str) {
      return global.escapeHtml ? global.escapeHtml(str) : String(str ?? '');
    },

    // 後方互換
    renderFolders(silent) {
      return WatchlistUI.render(silent);
    },
  };

  global.WatchlistStore = WatchlistStore;
  global.WatchlistUI = WatchlistUI;
})(window);
