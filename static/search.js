/**
 * 銘柄検索 v41 — 数字コード / 英字コード(285A) / 会社名 + サジェスト
 */
(function (global) {
  const SEARCH_UI_VERSION = 'v41';
  let searchDebounce = null;

  function normalizeStockCode(val) {
    return String(val || '').replace(/\.T$/i, '').trim().toUpperCase();
  }

  /** 7203 / 285A / 153A 等 */
  function looksLikeStockCode(val) {
    return /^\d{3,4}[A-Z]?$/.test(normalizeStockCode(val));
  }

  function navigateToStock(symbol) {
    const code = normalizeStockCode(symbol);
    if (typeof global.goToStock === 'function') {
      global.goToStock(code);
    } else {
      global.location.href = `/stock/${encodeURIComponent(code)}`;
    }
  }

  function saveSearchHistory(code) {
    const hist = JSON.parse(global.localStorage.getItem('searchHistory') || '[]');
    const next = [code, ...hist.filter((c) => c !== code)].slice(0, 8);
    global.localStorage.setItem('searchHistory', JSON.stringify(next));
  }

  function renderSearchHistory(container) {
    if (!container) return;
    const hist = JSON.parse(global.localStorage.getItem('searchHistory') || '[]');
    if (!hist.length) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    container.innerHTML = '<div class="search-hist-label">検索履歴</div>' +
      hist.map((c) => `<button type="button" class="search-hist-chip" data-code="${global.escapeHtml(c)}">${global.escapeHtml(c)}</button>`).join('');
    container.querySelectorAll('.search-hist-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('searchInput');
        if (input) input.value = chip.dataset.code;
        navigateToStock(chip.dataset.code);
      });
    });
  }

  function renderSearchSuggest(list) {
    const input = document.getElementById('searchInput');
    const suggest = document.getElementById('searchSuggest');
    if (!suggest) return;
    if (!list?.length) {
      suggest.innerHTML = '';
      suggest.style.display = 'none';
      return;
    }
    suggest.style.display = 'block';
    suggest.innerHTML = list.map((r) => `
      <button type="button" class="suggest-item" data-code="${global.escapeHtml(r.symbol)}">
        <span class="suggest-code">${global.escapeHtml(r.symbol)}</span>
        <span class="suggest-name">${global.escapeHtml(r.name)}</span>
      </button>
    `).join('');
    suggest.querySelectorAll('.suggest-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        suggest.style.display = 'none';
        if (input) input.value = btn.dataset.code;
        saveSearchHistory(btn.dataset.code);
        navigateToStock(btn.dataset.code);
      });
    });
  }

  async function fetchSearchResults(query, limit) {
    const url = `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const json = global.ApiCache
      ? await global.ApiCache.fetchJsonCached(url, { ttl: 300000 })
      : await (await fetch(url)).json();
    return json.results || [];
  }

  async function doSearch() {
    const input = document.getElementById('searchInput');
    const val = input?.value.trim();
    const suggestEl = document.getElementById('searchSuggest');

    if (!val) {
      global.showToast?.('銘柄コードまたは会社名を入力してください');
      return;
    }

    const codeCandidate = normalizeStockCode(val);

    try {
      const list = await fetchSearchResults(val, 12);

      if (looksLikeStockCode(codeCandidate)) {
        const exact = list.find((r) => normalizeStockCode(r.symbol) === codeCandidate);
        if (exact) {
          if (suggestEl) suggestEl.style.display = 'none';
          saveSearchHistory(exact.symbol);
          navigateToStock(exact.symbol);
          return;
        }
        if (list.length === 1) {
          if (suggestEl) suggestEl.style.display = 'none';
          saveSearchHistory(list[0].symbol);
          navigateToStock(list[0].symbol);
          return;
        }
        if (list.length > 1) {
          renderSearchSuggest(list);
          global.showToast?.(`${list.length}件 — 候補から選択してください`);
          return;
        }
        if (suggestEl) suggestEl.style.display = 'none';
        saveSearchHistory(codeCandidate);
        navigateToStock(codeCandidate);
        return;
      }

      if (list.length === 1) {
        if (suggestEl) suggestEl.style.display = 'none';
        saveSearchHistory(list[0].symbol);
        navigateToStock(list[0].symbol);
        return;
      }
      if (list.length > 1) {
        renderSearchSuggest(list);
        global.showToast?.(`${list.length}件 — 候補から選択してください`);
        return;
      }

      if (suggestEl) suggestEl.style.display = 'none';
      global.showToast?.('銘柄が見つかりませんでした');
    } catch (e) {
      console.error(e);
      if (looksLikeStockCode(codeCandidate)) {
        navigateToStock(codeCandidate);
        return;
      }
      global.showToast?.('検索に失敗しました');
    }
  }

  function bindSearchUi() {
    const wrap = document.querySelector('.search-box-wrap');
    const input = document.getElementById('searchInput');
    const suggest = document.getElementById('searchSuggest');
    const histBox = document.getElementById('searchHistory');
    const searchBtn = document.getElementById('searchBtn');
    if (!input || input.dataset.searchUi === SEARCH_UI_VERSION) return;

    input.dataset.searchUi = SEARCH_UI_VERSION;
    if (wrap) wrap.dataset.searchUi = SEARCH_UI_VERSION;

    renderSearchHistory(histBox);

    searchBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      doSearch();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(searchDebounce);
      if (!suggest) return;
      if (q.length < 1) {
        suggest.innerHTML = '';
        suggest.style.display = 'none';
        return;
      }
      searchDebounce = setTimeout(async () => {
        try {
          renderSearchSuggest(await fetchSearchResults(q, 10));
        } catch {
          suggest.style.display = 'none';
        }
      }, 160);
    });

    input.addEventListener('focus', () => {
      renderSearchHistory(histBox);
      const q = input.value.trim();
      if (q.length >= 1) {
        fetchSearchResults(q, 10).then(renderSearchSuggest).catch(() => {});
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box-wrap') && suggest) {
        suggest.style.display = 'none';
      }
    });
  }

  function initSearchUX() {
    bindSearchUi();
  }

  global.SEARCH_UI_VERSION = SEARCH_UI_VERSION;
  global.normalizeStockCode = normalizeStockCode;
  global.looksLikeStockCode = looksLikeStockCode;
  global.doSearch = doSearch;
  global.initSearchUX = initSearchUX;
  global.renderSearchSuggest = renderSearchSuggest;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchUX);
  } else {
    initSearchUX();
  }
})(window);
