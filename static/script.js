/**
 * StockAI Pro - 共通ユーティリティ
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, duration = 2800) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    showToast(next === 'light' ? 'ライトモード' : 'ダークモード');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initPriceAlerts();
  initSearchUX();
  initAlertToggleUI();
  initAppSplash();
  initPwaInstall();
});

let progressCount = 0;

function showProgress() {
  progressCount += 1;
  const el = document.getElementById('globalProgress');
  if (el) el.classList.add('active');
}

function hideProgress() {
  progressCount = Math.max(0, progressCount - 1);
  if (progressCount === 0) {
    const el = document.getElementById('globalProgress');
    if (el) el.classList.remove('active');
  }
}

async function fetchWithProgress(url, options) {
  showProgress();
  try {
    return await fetch(url, options);
  } finally {
    hideProgress();
  }
}

/** 自動更新用（プログレスバー非表示） */
async function fetchSilent(url, options) {
  return fetch(url, options);
}

const _autoRetryState = {};

function resetAutoRetry(key) {
  const s = _autoRetryState[key];
  if (s?.timer) clearTimeout(s.timer);
  delete _autoRetryState[key];
}

function getRetryDelay(attempt) {
  return Math.min(2000 * 2 ** attempt, 8000);
}

function showConnRetryHint(containerEl, message) {
  if (!containerEl) return;
  containerEl.innerHTML = `<span class="conn-retry-hint">${escapeHtml(message || '接続再試行中…')}</span>`;
}

/**
 * 通信失敗時の指数バックオフ自動再試行（2s → 4s → 8s）
 * @param {string} key
 * @param {() => Promise<boolean>} task
 * @param {{ containerEl?: Element, silent?: boolean }} opts
 */
function scheduleAutoRetry(key, task, opts = {}) {
  if (document.hidden) return;

  if (!_autoRetryState[key]) {
    _autoRetryState[key] = { attempt: 0, timer: null };
  }
  const state = _autoRetryState[key];
  if (state.timer) return;

  const delay = getRetryDelay(state.attempt);
  if (!opts.silent && opts.containerEl) {
    showConnRetryHint(opts.containerEl);
  }

  state.timer = setTimeout(async () => {
    state.timer = null;
    state.attempt += 1;
    try {
      const ok = await task();
      if (ok) {
        resetAutoRetry(key);
      } else {
        scheduleAutoRetry(key, task, opts);
      }
    } catch {
      scheduleAutoRetry(key, task, opts);
    }
  }, delay);
}

function formatLiveTime(date = new Date()) {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s} 更新`;
}

function setLiveSyncStatus(elementId, text, pulsing) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-pulse', !!pulsing);
  if (pulsing) {
    clearTimeout(el._pulseTimer);
    el._pulseTimer = setTimeout(() => el.classList.remove('is-pulse'), 800);
  }
}

function flashPriceElement(el, direction) {
  if (!el || !direction) return;
  el.classList.remove('price-flash-up', 'price-flash-down');
  void el.offsetWidth;
  el.classList.add(direction === 'up' ? 'price-flash-up' : 'price-flash-down');
}

/** ページ種別ごとの更新間隔（ms） */
const REFRESH_MS = {
  INDEX: 45000,
  HOME_MARKET: 30000,
  RANKING: 30000,
  STOCK_SLOW: 12000,
  STOCK_FAST: 4000,
  WATCHLIST: 15000,
};

window.REFRESH_MS = REFRESH_MS;

function pulseLiveSync(elementId, durationMs = 350) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.add('is-pulse');
  clearTimeout(el._pulseTimer);
  el._pulseTimer = setTimeout(() => el.classList.remove('is-pulse'), durationMs);
}

/**
 * Page Visibility 対応の自動更新タイマー
 * 非表示時は停止、再表示時に即1回更新してタイマー再開
 */
function createPageAutoRefresh(options) {
  const intervalMs = options.intervalMs || REFRESH_MS.INDEX;
  const onRefresh = options.onRefresh || (() => {});
  const allowOverlap = !!options.allowOverlap;
  let timerId = null;
  let started = false;
  let running = false;

  function isVisible() {
    return !document.hidden;
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  async function tick(immediate) {
    if (!isVisible()) return;
    if (running && !allowOverlap) return;
    running = true;
    try {
      await onRefresh(!!immediate);
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    if (!isVisible()) return;
    started = true;
    timerId = setInterval(() => tick(false), intervalMs);
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stop();
    } else if (started) {
      tick(true);
      start();
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start() {
      started = true;
      if (options.leading !== false && isVisible()) {
        tick(true);
      }
      start();
    },
    stop() {
      started = false;
      stop();
    },
    destroy() {
      this.stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
    refreshNow() {
      return tick(true);
    },
  };
}

function getAlertSettings() {
  return {
    enabled: localStorage.getItem('alertEnabled') === 'true',
    threshold: parseFloat(localStorage.getItem('alertThreshold') || '3'),
  };
}

function getAlertPrices() {
  try {
    return JSON.parse(localStorage.getItem('alertPrices') || '{}');
  } catch {
    return {};
  }
}

function setAlertPrice(symbol, price) {
  const map = getAlertPrices();
  map[symbol] = price;
  localStorage.setItem('alertPrices', JSON.stringify(map));
}

async function checkWatchAlerts() {
  if (document.hidden) return;
  const { enabled, threshold } = getAlertSettings();
  if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const list = typeof WatchlistStore !== 'undefined'
    ? WatchlistStore.getAllSymbols()
    : JSON.parse(localStorage.getItem('watchlist') || '[]');
  for (const sym of list) {
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(sym)}`);
      const json = await res.json();
      if (json.status !== 'ok' || !json.data) continue;

      const d = json.data;
      const current = d.current;
      const prev = getAlertPrices()[sym];
      if (current == null) continue;

      if (prev != null && prev > 0) {
        const pct = ((current - prev) / prev) * 100;
        if (Math.abs(pct) >= threshold) {
          const dir = pct > 0 ? '上昇' : '下落';
          new Notification(`StockAI: ${sym}`, {
            body: `${d.name || sym} が ${pct.toFixed(2)}% ${dir}（基準価格比）`,
            icon: '/static/icons/icon-192.png',
          });
        }
      }
      setAlertPrice(sym, current);
    } catch {
      /* ignore */
    }
  }
}

function initPriceAlerts() {
  checkWatchAlerts();
  setInterval(checkWatchAlerts, 5 * 60 * 1000);
}

function initAlertToggleUI() {
  const toggle = document.getElementById('alertToggle');
  const thresholdInput = document.getElementById('alertThreshold');
  if (!toggle) return;

  const { enabled, threshold } = getAlertSettings();
  toggle.checked = enabled;
  if (thresholdInput) thresholdInput.value = String(threshold);

  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      if (!('Notification' in window)) {
        showToast('このブラウザは通知に非対応です');
        toggle.checked = false;
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('通知が許可されていません');
        toggle.checked = false;
        return;
      }
      localStorage.setItem('alertEnabled', 'true');
      showToast('価格アラート ON');
      checkWatchAlerts();
    } else {
      localStorage.setItem('alertEnabled', 'false');
      showToast('価格アラート OFF');
    }
  });

  thresholdInput?.addEventListener('change', () => {
    const v = parseFloat(thresholdInput.value) || 3;
    localStorage.setItem('alertThreshold', String(v));
    showToast(`アラート閾値: ${v}%`);
  });
}

function saveSearchHistory(code) {
  const hist = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  const next = [code, ...hist.filter((c) => c !== code)].slice(0, 8);
  localStorage.setItem('searchHistory', JSON.stringify(next));
}

function renderSearchHistory(container) {
  if (!container) return;
  const hist = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  if (!hist.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  container.innerHTML = '<div class="search-hist-label">検索履歴</div>' +
    hist.map((c) => `<button type="button" class="search-hist-chip" data-code="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  container.querySelectorAll('.search-hist-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('searchInput');
      if (input) input.value = chip.dataset.code;
      if (typeof window.goToStock === 'function') window.goToStock(chip.dataset.code);
    });
  });
}

let searchDebounce = null;

function initSearchUX() {
  const input = document.getElementById('searchInput');
  const suggest = document.getElementById('searchSuggest');
  const histBox = document.getElementById('searchHistory');
  if (!input) return;

  renderSearchHistory(histBox);

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
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        const list = json.results || [];
        if (!list.length) {
          suggest.style.display = 'none';
          return;
        }
        suggest.style.display = 'block';
        suggest.innerHTML = list.map((r) => `
          <button type="button" class="suggest-item" data-code="${escapeHtml(r.symbol)}">
            <span class="suggest-code">${escapeHtml(r.symbol)}</span>
            <span class="suggest-name">${escapeHtml(r.name)}</span>
          </button>
        `).join('');
        suggest.querySelectorAll('.suggest-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            input.value = btn.dataset.code;
            suggest.style.display = 'none';
            if (typeof window.doSearch === 'function') window.doSearch();
          });
        });
      } catch {
        suggest.style.display = 'none';
      }
    }, 200);
  });

  input.addEventListener('focus', () => renderSearchHistory(histBox));
}

let installUiReady = false;
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (document.getElementById('pwaInstallBtn')) {
    const tab = new URLSearchParams(window.location.search).get('tab');
    updatePwaInstallUi({ onHome: !tab || tab === 'home' });
  }
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updatePwaInstallUi({ onHome: true });
  showToast('StockAI Pro をインストールしました');
});

const INSTALL_DISMISS_KEY = 'installGuideClosed';

/** PWA（ホーム画面追加）起動判定 */
function isStandalonePwa() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isInstallGuideClosed() {
  return localStorage.getItem(INSTALL_DISMISS_KEY) === 'true';
}

/** iPhone Safari ブラウザ（standalone 以外） */
function isIphoneSafariBrowser() {
  if (isStandalonePwa()) return false;
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function canOfferPwaInstall() {
  if (isStandalonePwa()) return false;
  if (isDesktopApp()) return false;
  if (isInstallGuideClosed()) return false;
  return !!(deferredInstallPrompt || isIphoneSafariBrowser());
}

function isDesktopApp() {
  return (
    new URLSearchParams(window.location.search).get('desktop') === '1' ||
    typeof window.pywebview !== 'undefined'
  );
}

const IOS_SHARE_ICON_SVG =
  '<svg class="ios-share-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
  '<path d="M12 4v10M8.5 7.5L12 4l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

function buildInstallGuideModal() {
  if (installUiReady) return;
  if (isStandalonePwa()) return;

  const modal = document.createElement('div');
  modal.id = 'installGuideModal';
  modal.className = 'install-guide-modal';
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-labelledby', 'installGuideTitle');
  modal.innerHTML =
    '<div class="install-guide-backdrop" id="installGuideBackdrop"></div>' +
    '<div class="install-guide-sheet">' +
    '<div class="install-guide-title" id="installGuideTitle">📱 StockAI Pro をホーム画面に追加</div>' +
    '<ol class="install-guide-steps">' +
    '<li><span class="install-step-num">1</span><span class="install-step-body">Safari 下部の<strong>共有</strong>ボタン ' +
    IOS_SHARE_ICON_SVG + '（□↑）を押す</span></li>' +
    '<li><span class="install-step-num">2</span><span class="install-step-body"><strong>「ホーム画面に追加」</strong>を選択</span></li>' +
    '<li><span class="install-step-num">3</span><span class="install-step-body"><strong>追加</strong>でアプリ化完了</span></li>' +
    '</ol>' +
    '<div class="install-guide-actions">' +
    '<button type="button" id="installGuideLater" class="install-guide-btn-secondary">あとで</button>' +
    '<button type="button" id="installGuideOk" class="install-guide-btn-primary">わかった</button>' +
    '</div></div>';

  document.body.appendChild(modal);
  installUiReady = true;

  document.getElementById('installGuideLater')?.addEventListener('click', () => {
    dismissInstallGuide();
  });

  document.getElementById('installGuideOk')?.addEventListener('click', () => {
    closeInstallGuideModal();
  });

  document.getElementById('installGuideBackdrop')?.addEventListener('click', () => {
    closeInstallGuideModal();
  });
}

function openInstallGuideModal() {
  buildInstallGuideModal();
  const modal = document.getElementById('installGuideModal');
  if (modal) modal.classList.add('is-open');
}

function closeInstallGuideModal() {
  const modal = document.getElementById('installGuideModal');
  if (modal) modal.classList.remove('is-open');
}

function dismissInstallGuide() {
  localStorage.setItem(INSTALL_DISMISS_KEY, 'true');
  closeInstallGuideModal();
  document.getElementById('installGuideBar')?.remove();
  updatePwaInstallUi();
}

async function handlePwaInstallClick() {
  if (isStandalonePwa()) return;

  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredInstallPrompt = null;
        showToast('インストールを開始しました');
      }
    } catch (e) {
      console.error(e);
      showToast('インストールダイアログを表示できませんでした');
    }
    updatePwaInstallUi();
    return;
  }

  if (isIphoneSafariBrowser()) {
    openInstallGuideModal();
    return;
  }

  showToast('ブラウザメニューから「アプリをインストール」を選択してください');
}

function updatePwaInstallUi(opts = {}) {
  const onHome = opts.onHome !== false;
  const btn = document.getElementById('pwaInstallBtn');
  const show = onHome && canOfferPwaInstall();
  if (btn) btn.hidden = !show;
}

/* standalone: 案内UIを生成・表示しない */
if (isStandalonePwa()) {
  document.documentElement.classList.add('is-standalone');
  document.getElementById('installGuideBar')?.remove();
  document.getElementById('installGuideModal')?.remove();
  document.getElementById('installBanner')?.remove();
  document.getElementById('iosInstallModal')?.remove();
  document.getElementById('pwaInstallBtn')?.remove();
}

function initPwaInstall() {
  if (isStandalonePwa()) {
    document.documentElement.classList.add('is-standalone');
    document.getElementById('installGuideBar')?.remove();
    document.getElementById('installGuideModal')?.remove();
    document.getElementById('pwaInstallBtn')?.remove();
    return;
  }

  if (isDesktopApp()) {
    document.getElementById('pwaInstallBtn')?.remove();
    return;
  }

  document.getElementById('pwaInstallBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    handlePwaInstallClick();
  });

  if (isIphoneSafariBrowser() && !isInstallGuideClosed()) {
    buildInstallGuideModal();
  }
}

window.PwaInstall = {
  updateVisibility(onHome) {
    updatePwaInstallUi({ onHome: !!onHome });
  },
  handleInstallClick: handlePwaInstallClick,
};

function initAppSplash() {
  const splash = document.getElementById('appSplash');
  if (!splash) return;
  const hide = () => {
    splash.classList.add('splash-hide');
    setTimeout(() => splash.remove(), 400);
  };
  if (document.readyState === 'complete') {
    setTimeout(hide, 600);
  } else {
    window.addEventListener('load', () => setTimeout(hide, 600));
  }
}

function showUpdateBanner(reg) {
  let bar = document.getElementById('updateBanner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'updateBanner';
    bar.className = 'update-banner glass';
    bar.innerHTML = `
      <span>新しいバージョンがあります</span>
      <button type="button" id="updateReloadBtn" class="search-btn">更新</button>
    `;
    document.body.appendChild(bar);
    document.getElementById('updateReloadBtn').addEventListener('click', () => {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    });
  }
  bar.hidden = false;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(reg);
            }
          });
        });
        setInterval(() => reg.update(), 60 * 60 * 1000);
      })
      .catch(() => {});
  });
}

/* pywebview / デスクトップ版では Service Worker を登録しない（WebView2 安定化） */
const IS_DESKTOP_APP =
  new URLSearchParams(window.location.search).get('desktop') === '1' ||
  typeof window.pywebview !== 'undefined';

if (!IS_DESKTOP_APP) {
  registerServiceWorker();
}

function scoreBandClass(score) {
  if (score >= 80) return 'bull';
  if (score >= 60) return 'neutral';
  return 'bear';
}
