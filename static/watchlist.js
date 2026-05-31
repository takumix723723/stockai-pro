/**
 * フォルダ型登録銘柄 — ストア + UI
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

    getExpandedSymbols() {
      return WatchlistStore.load().folders
        .filter((f) => !f.collapsed)
        .flatMap((f) => f.symbols || []);
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

    reorderFolders(fromId, toId) {
      const data = WatchlistStore.load();
      const folders = data.folders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const fromIdx = folders.findIndex((f) => f.id === fromId);
      const toIdx = folders.findIndex((f) => f.id === toId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      const [moved] = folders.splice(fromIdx, 1);
      folders.splice(toIdx, 0, moved);
      folders.forEach((f, i) => { f.order = i; });
      data.folders = folders;
      WatchlistStore.save(data);
    },

    toggleCollapsed(id, collapsed) {
      const data = WatchlistStore.load();
      const f = data.folders.find((x) => x.id === id);
      if (!f) return;
      f.collapsed = collapsed;
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
    drag: { type: null, folderId: null, symbol: null },

    init() {
      WatchlistStore.migrateFromLegacy();
    },

    destroy() {
      Object.keys(WatchlistUI.watchCache).forEach((k) => delete WatchlistUI.watchCache[k]);
      WatchlistUI.mounted = false;
      WatchlistUI.drag = { type: null, folderId: null, symbol: null };
    },

    mountTab() {
      const list = document.getElementById('watchFolderList');
      if (!list) return;
      WatchlistUI.mounted = true;
      WatchlistUI.renderFolders(false);
    },

    renderFolders(silent) {
      const list = document.getElementById('watchFolderList');
      if (!list) return Promise.resolve();

      if (silent && list.querySelector('.wf-card')) {
        return WatchlistUI.refreshExpandedPrices();
      }

      const data = WatchlistStore.load();
      const folders = [...data.folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      if (!folders.length) {
        list.innerHTML = `
          <div class="wf-empty card-premium">
            <span class="wf-empty-icon">📁</span>
            <p>フォルダがありません</p>
            <p class="wf-empty-hint">半導体・商社・監視中 などテーマ別に整理できます</p>
            <button type="button" class="add-watch-btn-lg" id="wfEmptyCreateBtn">＋ フォルダを作成</button>
          </div>
        `;
        document.getElementById('wfEmptyCreateBtn')?.addEventListener('click', () => WatchlistUI.openFolderModal());
        return Promise.resolve();
      }

      list.innerHTML = folders.map((f) => WatchlistUI.folderCardHtml(f)).join('');
      WatchlistUI.bindFolderEvents(list);

      const expanded = folders.filter((f) => !f.collapsed);
      if (!expanded.length) return Promise.resolve();

      if (silent) {
        return WatchlistUI.refreshExpandedPrices();
      }
      return WatchlistUI.loadExpandedPricesStaggered(expanded);
    },

    folderCardHtml(f) {
      const count = (f.symbols || []).length;
      const open = !f.collapsed;
      const body = open
        ? (count
          ? (f.symbols || []).map((sym) => WatchlistUI.symbolRowHtml(f.id, sym)).join('')
          : '<div class="wf-empty-folder">銘柄がありません — 「＋銘柄」から追加</div>')
        : '';

      return `
        <div class="wf-card card-premium" data-folder-id="${WatchlistUI.esc(f.id)}">
          <div class="wf-header">
            <span class="wf-drag-handle" draggable="true" data-drag="folder" title="並び替え">☰</span>
            <button type="button" class="wf-toggle" data-folder-id="${WatchlistUI.esc(f.id)}" aria-expanded="${open}">
              <span class="wf-chevron ${open ? 'is-open' : ''}">▶</span>
              <span class="wf-name">${WatchlistUI.esc(f.name)}</span>
              <span class="wf-count">${count}</span>
            </button>
            <div class="wf-actions">
              <button type="button" class="wf-action-btn" data-action="add-symbol" data-folder-id="${WatchlistUI.esc(f.id)}" title="銘柄追加">＋</button>
              <button type="button" class="wf-action-btn" data-action="rename" data-folder-id="${WatchlistUI.esc(f.id)}" title="名前変更">✎</button>
              <button type="button" class="wf-action-btn wf-action-danger" data-action="delete" data-folder-id="${WatchlistUI.esc(f.id)}" title="削除">✕</button>
            </div>
          </div>
          <div class="wf-body" data-folder-body="${WatchlistUI.esc(f.id)}" ${open ? '' : 'hidden'}>${body}</div>
        </div>
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

    refreshFolderBody(folderId) {
      const f = WatchlistStore.getFolder(folderId);
      const body = document.querySelector(`[data-folder-body="${folderId}"]`);
      if (!f || !body || f.collapsed) return;
      body.innerHTML = (f.symbols || []).length
        ? (f.symbols || []).map((sym) => WatchlistUI.symbolRowHtml(folderId, sym)).join('')
        : '<div class="wf-empty-folder">銘柄がありません — 「＋銘柄」から追加</div>';
      WatchlistUI.bindSymbolEvents(body, folderId);
    },

    bindFolderEvents(list) {
      list.querySelectorAll('.wf-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.folderId;
          const f = WatchlistStore.getFolder(id);
          if (!f) return;
          const next = !f.collapsed;
          WatchlistStore.toggleCollapsed(id, !next);
          const card = list.querySelector(`[data-folder-id="${id}"]`);
          const body = card?.querySelector(`[data-folder-body="${id}"]`);
          const chevron = btn.querySelector('.wf-chevron');
          if (body) {
            if (next) {
              body.hidden = false;
              WatchlistUI.refreshFolderBody(id);
              WatchlistUI.loadFolderPrices(id);
            } else {
              body.hidden = true;
              body.innerHTML = '';
            }
          }
          btn.setAttribute('aria-expanded', String(next));
          chevron?.classList.toggle('is-open', next);
        });
      });

      list.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const folderId = btn.dataset.folderId;
          if (action === 'add-symbol') WatchlistUI.openSymbolModal(folderId);
          else if (action === 'rename') WatchlistUI.openFolderModal(folderId);
          else if (action === 'delete') WatchlistUI.confirmDeleteFolder(folderId);
        });
      });

      list.querySelectorAll('.wf-card').forEach((card) => {
        WatchlistUI.bindFolderDrag(card);
        const folderId = card.dataset.folderId;
        const f = WatchlistStore.getFolder(folderId);
        if (f && !f.collapsed) {
          const body = card.querySelector(`[data-folder-body="${folderId}"]`);
          if (body) WatchlistUI.bindSymbolEvents(body, folderId);
        }
      });
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
          WatchlistUI.renderFolders(false);
          global.updateWatchlistBadge?.();
        });
      });
    },

    bindFolderDrag(card) {
      const folderId = card.dataset.folderId;
      const handle = card.querySelector('.wf-drag-handle');
      if (!handle) return;
      handle.addEventListener('dragstart', (e) => {
        WatchlistUI.drag = { type: 'folder', folderId, symbol: null };
        card.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', folderId);
      });
      handle.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        document.querySelectorAll('.wf-card.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
        WatchlistUI.drag = { type: null, folderId: null, symbol: null };
      });
      card.addEventListener('dragover', (e) => {
        if (WatchlistUI.drag.type !== 'folder') return;
        e.preventDefault();
        if (WatchlistUI.drag.folderId !== folderId) card.classList.add('is-drop-target');
      });
      card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('is-drop-target');
        if (WatchlistUI.drag.type === 'folder' && WatchlistUI.drag.folderId !== folderId) {
          WatchlistStore.reorderFolders(WatchlistUI.drag.folderId, folderId);
          WatchlistUI.renderFolders(false);
        }
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
          WatchlistUI.refreshFolderBody(folderId);
        }
      });
    },

    async loadWatchItem(sym, batch) {
      try {
        const fetchFn = global.fetchSilent || fetch;
        const res = await fetchFn(`/api/stock?symbol=${encodeURIComponent(sym)}`);
        const data = await res.json();
        if (data.status !== 'ok') return;
        WatchlistUI.watchCache[sym] = data.data;
        if (!batch) WatchlistUI.updateSymbolRows(sym);
      } catch (e) {
        console.error(e);
      }
    },

    updateSymbolRows(sym) {
      document.querySelectorAll(`.wf-symbol-row[data-symbol="${sym}"]`).forEach((row) => {
        const folderId = row.dataset.folderId;
        const parent = row.parentElement;
        if (parent) {
          const idx = [...parent.querySelectorAll('.wf-symbol-row')].indexOf(row);
          const tmp = document.createElement('div');
          tmp.innerHTML = WatchlistUI.symbolRowHtml(folderId, sym);
          const newRow = tmp.firstElementChild;
          row.replaceWith(newRow);
          WatchlistUI.bindSymbolEvents(parent, folderId);
        }
      });
    },

    async loadFolderPrices(folderId) {
      const f = WatchlistStore.getFolder(folderId);
      if (!f || f.collapsed) return;
      for (let i = 0; i < (f.symbols || []).length; i += 1) {
        const sym = f.symbols[i];
        await WatchlistUI.loadWatchItem(sym, true);
        WatchlistUI.updateSymbolRows(sym);
        if (i < f.symbols.length - 1) await new Promise((r) => setTimeout(r, 100));
      }
    },

    async loadExpandedPricesStaggered(folders) {
      for (const f of folders) {
        await WatchlistUI.loadFolderPrices(f.id);
      }
    },

    async refreshExpandedPrices() {
      const symbols = WatchlistStore.getExpandedSymbols();
      await Promise.allSettled(symbols.map((sym) => WatchlistUI.loadWatchItem(sym, true)));
      symbols.forEach((sym) => WatchlistUI.updateSymbolRows(sym));
    },

    refresh(opts = {}) {
      if (!WatchlistUI.mounted) return Promise.resolve();
      return WatchlistUI.renderFolders(!!opts.silent);
    },

    openFolderModal(editId) {
      const modal = document.getElementById('folderModal');
      const input = document.getElementById('folderNameInput');
      const title = document.getElementById('folderModalTitle');
      if (!modal || !input) return;
      modal.dataset.editId = editId || '';
      if (editId) {
        const f = WatchlistStore.getFolder(editId);
        title.textContent = 'フォルダ名を変更';
        input.value = f?.name || '';
      } else {
        title.textContent = 'フォルダを作成';
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
        global.showToast?.('フォルダ名を入力してください');
        return;
      }
      const editId = modal?.dataset.editId;
      if (editId) {
        WatchlistStore.renameFolder(editId, name);
        global.showToast?.('フォルダ名を変更しました');
      } else {
        WatchlistStore.createFolder(name);
        global.showToast?.(`「${name}」を作成しました`);
      }
      WatchlistUI.closeFolderModal();
      WatchlistUI.renderFolders(false);
      global.updateWatchlistBadge?.();
    },

    confirmDeleteFolder(folderId) {
      const f = WatchlistStore.getFolder(folderId);
      if (!f) return;
      if (!confirm(`「${f.name}」を削除しますか？\n（中の銘柄も削除されます）`)) return;
      (f.symbols || []).forEach((s) => delete WatchlistUI.watchCache[s]);
      WatchlistStore.deleteFolder(folderId);
      WatchlistUI.renderFolders(false);
      global.updateWatchlistBadge?.();
      global.showToast?.('フォルダを削除しました');
    },

    openSymbolModal(folderId) {
      const modal = document.getElementById('watchModal');
      const select = document.getElementById('watchFolderSelect');
      const input = document.getElementById('watchInput');
      if (!modal || !select) return;
      const data = WatchlistStore.load();
      select.innerHTML = data.folders.map((f) =>
        `<option value="${WatchlistUI.esc(f.id)}" ${f.id === folderId ? 'selected' : ''}>${WatchlistUI.esc(f.name)}</option>`
      ).join('');
      if (!data.folders.length) {
        global.showToast?.('先にフォルダを作成してください');
        WatchlistUI.openFolderModal();
        return;
      }
      modal.dataset.prefFolder = folderId || '';
      input.value = '';
      modal.style.display = 'flex';
      input.focus();
    },

    closeSymbolModal() {
      document.getElementById('watchModal').style.display = 'none';
    },

    addSymbolFromModal() {
      const select = document.getElementById('watchFolderSelect');
      const input = document.getElementById('watchInput');
      const folderId = select?.value;
      const val = input?.value.trim();
      if (!folderId) {
        global.showToast?.('フォルダを選択してください');
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
      const f = WatchlistStore.getFolder(folderId);
      if (f) WatchlistStore.toggleCollapsed(folderId, false);
      WatchlistUI.renderFolders(false);
      global.updateWatchlistBadge?.();
      global.showToast?.(`${val} を追加しました`);
    },

    esc(str) {
      return global.escapeHtml ? global.escapeHtml(str) : String(str ?? '');
    },
  };

  global.WatchlistStore = WatchlistStore;
  global.WatchlistUI = WatchlistUI;
})(window);
