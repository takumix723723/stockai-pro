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
  const { enabled, threshold } = getAlertSettings();
  if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const list = JSON.parse(localStorage.getItem('watchlist') || '[]');
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
            icon: '/static/icons/icon-192.svg',
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

let deferredInstallPrompt = null;

function isIosDevice() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function showIosInstallModal() {
  const modal = document.getElementById('iosInstallModal');
  if (modal) modal.hidden = false;
}

function hideIosInstallModal() {
  const modal = document.getElementById('iosInstallModal');
  if (modal) modal.hidden = true;
}

function showInstallBanner(mode) {
  const banner = document.getElementById('installBanner');
  const textEl = banner?.querySelector('.install-banner-text');
  const installBtn = document.getElementById('installBtn');
  if (!banner) return;

  if (mode === 'ios') {
    if (textEl) textEl.textContent = 'StockAI Pro をホーム画面に追加';
    if (installBtn) installBtn.textContent = '追加方法';
  } else {
    if (textEl) textEl.textContent = 'StockAI Pro をアプリとしてインストール';
    if (installBtn) installBtn.textContent = 'インストール';
  }
  banner.hidden = false;
}

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

function initPwaInstall() {
  const banner = document.getElementById('installBanner');
  const installBtn = document.getElementById('installBtn');
  const dismissBtn = document.getElementById('installDismiss');
  const iosClose = document.getElementById('iosInstallClose');
  const iosBackdrop = document.getElementById('iosInstallBackdrop');

  if (typeof IS_DESKTOP_APP !== 'undefined' && IS_DESKTOP_APP) return;
  if (isStandalonePwa()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (localStorage.getItem('installDismissed') === '1') return;
    showInstallBanner('android');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (banner) banner.hidden = true;
    showToast('アプリのインストールが完了しました');
  });

  if (isIosDevice()) {
    setTimeout(() => {
      if (localStorage.getItem('installDismissed') === '1') return;
      if (isStandalonePwa()) return;
      showInstallBanner('ios');
    }, 2500);
  }

  installBtn?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      try {
        await deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('インストールを開始しました');
        }
      } catch {
        showToast('インストールできませんでした');
      }
      deferredInstallPrompt = null;
      if (banner) banner.hidden = true;
      return;
    }

    if (isIosDevice()) {
      showIosInstallModal();
      return;
    }

    showToast('ブラウザメニューから「アプリをインストール」を選んでください');
  });

  dismissBtn?.addEventListener('click', () => {
    localStorage.setItem('installDismissed', '1');
    if (banner) banner.hidden = true;
  });

  iosClose?.addEventListener('click', hideIosInstallModal);
  iosBackdrop?.addEventListener('click', hideIosInstallModal);
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
