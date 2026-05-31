/**
 * IPO / PO 画面 — SBI風カードUI
 * localStorage: ipoFavorites [{ id, type, notify: { bb_deadline, listing_date } }]
 */

function ipoEscapeHtml(str) {
  if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') {
    return window.escapeHtml(str);
  }
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const IPO_FETCH_TIMEOUT_MS = 15000;
const IPO_MAX_RETRIES = 5;

const IpoFavorites = {
  KEY: 'ipoFavorites',

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch {
      return [];
    }
  },

  save(list) {
    localStorage.setItem(this.KEY, JSON.stringify(list));
  },

  isFavorite(id) {
    return this.load().some((f) => f.id === id);
  },

  toggle(id, type, notifyEvents) {
    const list = this.load();
    const idx = list.findIndex((f) => f.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      this.save(list);
      return false;
    }
    list.push({
      id,
      type,
      addedAt: new Date().toISOString(),
      notify: {
        bb_deadline: true,
        listing_date: true,
        po_settlement: true,
      },
      events: notifyEvents || [],
    });
    this.save(list);
    return true;
  },
};

const IpoPage = {
  ipoFilter: 'all',
  poFilter: 'all',
  activeTab: 'ipo',
  lastMeta: null,
  _inited: false,
  _ipoRetry: 0,
  _poRetry: 0,

  async fetchJson(path, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IPO_FETCH_TIMEOUT_MS);
    try {
      const res = opts.silent
        ? await fetchSilent(path, { signal: controller.signal })
        : await fetch(path, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error(json.message || 'failed');
      return json;
    } finally {
      clearTimeout(timer);
    }
  },

  showLoadError(containerEl, message, retryFn, retryCount) {
    if (!containerEl) return;
    const exhausted = retryCount >= IPO_MAX_RETRIES;
    containerEl.innerHTML = `
      <div class="ipo-load-error">
        <p class="ipo-load-error-msg">${ipoEscapeHtml(message)}</p>
        ${exhausted ? `<button type="button" class="ipo-retry-btn" data-ipo-retry>再読み込み</button>` : `<p class="conn-retry-hint">接続再試行中… (${retryCount}/${IPO_MAX_RETRIES})</p>`}
      </div>
    `;
    const btn = containerEl.querySelector('[data-ipo-retry]');
    btn?.addEventListener('click', () => {
      if (typeof retryFn === 'function') retryFn();
    });
  },

  setMetaLoading() {
    const label = document.getElementById('ipoPageMeta');
    if (label) label.textContent = '読み込み中…';
  },

  setMetaError(message) {
    const label = document.getElementById('ipoPageMeta');
    if (label) label.textContent = message || '取得に失敗しました';
  },

  init() {
    if (!document.getElementById('ipoList')) return;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    if (this._inited) return;

    const typeSelect = document.getElementById('ipoTypeSelect');
    typeSelect?.addEventListener('change', () => {
      this.switchTab(typeSelect.value);
    });

    document.querySelectorAll('.ipo-segment-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        if (this.activeTab === 'po') {
          this.poFilter = filter;
          this.setSegmentActive(filter);
          this.loadPoList();
        } else {
          this.ipoFilter = filter;
          this.setSegmentActive(filter);
          this.loadIpoList();
        }
      });
    });

    this._inited = true;
  },

  destroy() {
    this._inited = false;
    this.activeTab = 'ipo';
    this.ipoFilter = 'all';
    this.poFilter = 'all';
    this._ipoRetry = 0;
    this._poRetry = 0;
  },

  switchTab(name) {
    this.activeTab = name;
    const select = document.getElementById('ipoTypeSelect');
    if (select && select.value !== name) select.value = name;

    document.getElementById('ipoPanelIpo').hidden = name !== 'ipo';
    document.getElementById('ipoPanelPo').hidden = name !== 'po';
    document.getElementById('ipoPanelIpo').classList.toggle('active', name === 'ipo');
    document.getElementById('ipoPanelPo').classList.toggle('active', name === 'po');

    const openBtn = document.getElementById('ipoSegmentOpen');
    if (openBtn) openBtn.textContent = name === 'po' ? '受付中' : '募集中';

    const filter = name === 'po' ? this.poFilter : this.ipoFilter;
    this.setSegmentActive(filter);
    this.updatePageMeta(this.lastMeta);
  },

  setSegmentActive(filter) {
    document.querySelectorAll('.ipo-segment-btn').forEach((btn) => {
      const on = btn.dataset.filter === filter;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  },

  updatePageMeta(meta) {
    if (!meta) return;
    this.lastMeta = meta;
    const title = document.getElementById('ipoPageTitle');
    const label = document.getElementById('ipoPageMeta');
    if (title) title.textContent = this.activeTab === 'po' ? 'PO（売出）' : 'IPO・PO';
    if (!label) return;
    if (this.activeTab === 'po') {
      label.textContent = `受付中 ${meta.open_po_count ?? 0}件 · 更新 ${meta.updated || ''}`;
    } else {
      label.textContent = `募集中 ${meta.open_ipo_count ?? 0}件 · 更新 ${meta.updated || ''}`;
    }
  },

  statusClass(status) {
    return status === 'open' ? 'ipo-status-open' : 'ipo-status-closed';
  },

  sbiRow(label, value, extraClass = '') {
    return `
      <div class="ipo-sbi-row">
        <span class="ipo-sbi-label">${ipoEscapeHtml(label)}</span>
        <span class="ipo-sbi-value${extraClass ? ` ${extraClass}` : ''}">${ipoEscapeHtml(value)}</span>
      </div>
    `;
  },

  favBtnHtml(id, type) {
    const on = IpoFavorites.isFavorite(id);
    return `<button type="button" class="ipo-fav-btn${on ? ' is-on' : ''}" data-fav-id="${ipoEscapeHtml(id)}" data-fav-type="${ipoEscapeHtml(type)}" aria-label="お気に入り">${on ? '★' : '☆'}</button>`;
  },

  bindFavButtons(container) {
    container.querySelectorAll('[data-fav-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const on = IpoFavorites.toggle(btn.dataset.favId, btn.dataset.favType, []);
        btn.classList.toggle('is-on', on);
        btn.textContent = on ? '★' : '☆';
        showToast?.(on ? 'お気に入りに追加（通知拡張予定）' : 'お気に入り解除');
      });
    });
  },

  ipoCardHtml(item) {
    const href = `/ipo/${encodeURIComponent(item.id)}`;
    return `
      <article class="ipo-sbi-card">
        <div class="ipo-sbi-card-head">
          <div class="ipo-sbi-badges">
            <span class="ipo-sbi-badge">IPO</span>
            <span class="ipo-sbi-status ${this.statusClass(item.status)}">${ipoEscapeHtml(item.status_label)}</span>
          </div>
          ${this.favBtnHtml(item.id, 'ipo')}
        </div>
        <div class="ipo-sbi-title-block">
          <h3 class="ipo-sbi-name">${ipoEscapeHtml(item.name_full || item.name)}</h3>
          <span class="ipo-sbi-code">${ipoEscapeHtml(item.code)}</span>
        </div>
        <div class="ipo-sbi-rows">
          ${this.sbiRow('市場区分', item.market)}
          ${this.sbiRow('BB期間', item.bb_period_fmt)}
          ${this.sbiRow('仮条件', item.price_range)}
          ${this.sbiRow('想定価格', item.expected_price_fmt, 'ipo-sbi-value-accent')}
          ${this.sbiRow('上場日', item.listing_date_fmt)}
          ${this.sbiRow('主幹事', item.lead_underwriter)}
        </div>
        <a href="${ipoEscapeHtml(href)}" class="ipo-sbi-detail-btn">詳細を見る</a>
      </article>
    `;
  },

  poCardHtml(item) {
    return `
      <article class="ipo-sbi-card po-sbi-card">
        <div class="ipo-sbi-card-head">
          <div class="ipo-sbi-badges">
            <span class="ipo-sbi-badge po-sbi-badge">PO</span>
            <span class="ipo-sbi-status ${this.statusClass(item.status)}">${ipoEscapeHtml(item.status_label)}</span>
          </div>
          ${this.favBtnHtml(item.id, 'po')}
        </div>
        <div class="ipo-sbi-title-block">
          <h3 class="ipo-sbi-name">${ipoEscapeHtml(item.name)}</h3>
          <span class="ipo-sbi-code">${ipoEscapeHtml(item.code)}</span>
        </div>
        <div class="ipo-sbi-rows">
          ${this.sbiRow('市場区分', item.market || '—')}
          ${this.sbiRow('割引率', item.discount_rate, 'ipo-sbi-value-accent')}
          ${this.sbiRow('受渡日', item.settlement_date_fmt)}
          ${this.sbiRow('売出株数', item.shares_fmt || '—')}
          ${this.sbiRow('短期影響', item.short_term_impact)}
        </div>
      </article>
    `;
  },

  async loadIpoList(opts = {}) {
    const el = document.getElementById('ipoList');
    if (!el) return false;
    const filter = opts.filter ?? this.ipoFilter;
    const q = filter !== 'all' ? `?status=${filter}` : '';
    const isRetry = !!opts.isRetry;
    if (!opts.silent && !isRetry) {
      this.setMetaLoading();
      el.innerHTML = '<div class="skeleton-list"><div class="skeleton-card-row"></div><div class="skeleton-card-row"></div></div>';
    }
    try {
      const json = await this.fetchJson(`/api/ipo${q}`, opts);
      this._ipoRetry = 0;
      this.updatePageMeta(json.meta || {});
      if (!json.items.length) {
        el.innerHTML = '<div class="ipo-empty">該当するIPOがありません</div>';
        resetAutoRetry?.('ipoList');
        return true;
      }
      el.innerHTML = json.items.map((i) => this.ipoCardHtml(i)).join('');
      this.bindFavButtons(el);
      resetAutoRetry?.('ipoList');
      return true;
    } catch (e) {
      console.error('loadIpoList', e);
      this._ipoRetry += 1;
      const msg = e.name === 'AbortError' ? 'IPOデータの取得がタイムアウトしました' : 'IPOデータの取得に失敗しました';
      if (this._ipoRetry >= IPO_MAX_RETRIES) {
        this.setMetaError('取得失敗 · 再読み込みしてください');
        this.showLoadError(el, msg, () => {
          this._ipoRetry = 0;
          this.loadIpoList({ isRetry: true });
        }, this._ipoRetry);
        return false;
      }
      this.setMetaError(`再試行中 (${this._ipoRetry}/${IPO_MAX_RETRIES})`);
      this.showLoadError(el, msg, null, this._ipoRetry);
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (this._ipoRetry - 1), 8000)));
      if (document.getElementById('ipoList')) {
        return this.loadIpoList({ ...opts, isRetry: true, silent: true });
      }
      return false;
    }
  },

  async loadPoList(opts = {}) {
    const el = document.getElementById('poList');
    if (!el) return false;
    const filter = opts.filter ?? this.poFilter;
    const q = filter !== 'all' ? `?status=${filter}` : '';
    const isRetry = !!opts.isRetry;
    if (!opts.silent && !isRetry) {
      el.innerHTML = '<div class="skeleton-list"><div class="skeleton-card-row"></div></div>';
    }
    try {
      const json = await this.fetchJson(`/api/po${q}`, opts);
      this._poRetry = 0;
      if (this.activeTab === 'po') this.updatePageMeta(json.meta || {});
      if (!json.items.length) {
        el.innerHTML = '<div class="ipo-empty">該当するPOがありません</div>';
        resetAutoRetry?.('poList');
        return true;
      }
      el.innerHTML = json.items.map((i) => this.poCardHtml(i)).join('');
      this.bindFavButtons(el);
      resetAutoRetry?.('poList');
      return true;
    } catch (e) {
      console.error('loadPoList', e);
      this._poRetry += 1;
      const msg = e.name === 'AbortError' ? 'POデータの取得がタイムアウトしました' : 'POデータの取得に失敗しました';
      if (this._poRetry >= IPO_MAX_RETRIES) {
        if (this.activeTab === 'po') this.setMetaError('取得失敗 · 再読み込みしてください');
        this.showLoadError(el, msg, () => {
          this._poRetry = 0;
          this.loadPoList({ isRetry: true });
        }, this._poRetry);
        return false;
      }
      this.showLoadError(el, msg, null, this._poRetry);
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** (this._poRetry - 1), 8000)));
      if (document.getElementById('poList')) {
        return this.loadPoList({ ...opts, isRetry: true, silent: true });
      }
      return false;
    }
  },

  async initDetail(ipoId) {
    const main = document.getElementById('ipoDetailMain');
    const favBtn = document.getElementById('detailFavBtn');
    try {
      const res = await fetch(`/api/ipo/${encodeURIComponent(ipoId)}`);
      const json = await res.json();
      if (json.status !== 'ok' || !json.item) throw new Error('failed');
      const d = json.item;
      document.title = `${d.name_full || d.name} - IPO - StockAI Pro`;
      document.getElementById('detailCode').textContent = d.code;
      document.getElementById('detailName').textContent = d.name_full || d.name;

      const favOn = IpoFavorites.isFavorite(d.id);
      if (favBtn) {
        favBtn.classList.toggle('is-on', favOn);
        favBtn.textContent = favOn ? '★' : '☆';
        favBtn.addEventListener('click', () => {
          const on = IpoFavorites.toggle(d.id, 'ipo', d.notify_events);
          favBtn.classList.toggle('is-on', on);
          favBtn.textContent = on ? '★' : '☆';
          showToast?.(on ? 'お気に入りに追加' : 'お気に入り解除');
        });
      }

      const ai = d.ai_first_day_expect || {};
      main.innerHTML = `
        <section class="ipo-detail-hero card-premium">
          <div class="ipo-card-tags">
            <span class="ipo-tag market">${ipoEscapeHtml(d.market)}</span>
            <span class="ipo-tag ${this.statusClass(d.status)}">${ipoEscapeHtml(d.status_label)}</span>
            <span class="ipo-tag sector">${ipoEscapeHtml(d.sector || '')}</span>
          </div>
          <div class="ipo-detail-price">
            <span class="ipo-detail-range">${ipoEscapeHtml(d.price_range)}</span>
            <span class="ipo-detail-expected">想定 ${ipoEscapeHtml(d.expected_price_fmt)}</span>
          </div>
          <div class="ipo-detail-dates">
            <span>BB ${ipoEscapeHtml(d.bb_period_fmt)}</span>
            <span>上場 ${ipoEscapeHtml(d.listing_date_fmt)}</span>
          </div>
          <div class="ipo-detail-underwriter">主幹事: ${ipoEscapeHtml(d.lead_underwriter)}</div>
        </section>

        <section class="section-block">
          <h2 class="section-title">会社概要</h2>
          <div class="ipo-text card-premium">${ipoEscapeHtml(d.overview || '')}</div>
        </section>

        <section class="section-block">
          <h2 class="section-title">事業内容</h2>
          <div class="ipo-text card-premium ipo-pre">${ipoEscapeHtml(d.business || '')}</div>
        </section>

        <section class="section-block">
          <h2 class="section-title">公募・需給</h2>
          <div class="ipo-detail-grid card-premium">
            <div class="ipo-kv"><span class="ipo-k">吸収金額</span><span class="ipo-v">${ipoEscapeHtml(d.offering_amount_fmt || '—')}</span></div>
            <div class="ipo-kv"><span class="ipo-k">ロックアップ</span><span class="ipo-v">${ipoEscapeHtml(d.lock_up || '—')}</span></div>
          </div>
        </section>

        ${(d.vc_holdings || []).length ? `
        <section class="section-block">
          <h2 class="section-title">VC保有</h2>
          <div class="ipo-vc-list card-premium">
            ${d.vc_holdings.map((v) => `
              <div class="ipo-vc-row">
                <span>${ipoEscapeHtml(v.name)}</span>
                <span class="ipo-vc-ratio">${ipoEscapeHtml(v.ratio)}</span>
                <span class="ipo-vc-lock">${ipoEscapeHtml(v.lock || '')}</span>
              </div>
            `).join('')}
          </div>
        </section>` : ''}

        <section class="section-block">
          <h2 class="section-title">🤖 AI初値期待</h2>
          <div class="ipo-ai-card card-premium">
            <div class="ipo-ai-score">${ai.score ?? '—'}<span class="ipo-ai-sub">/ 100</span></div>
            <div class="ipo-ai-label">${ipoEscapeHtml(ai.label || '')}</div>
            <p class="ipo-ai-comment">${ipoEscapeHtml(ai.comment || '')}</p>
          </div>
        </section>

        ${(d.notify_events || []).length ? `
        <section class="section-block">
          <h2 class="section-title">📅 スケジュール</h2>
          <div class="ipo-schedule card-premium">
            ${d.notify_events.map((ev) => `
              <div class="ipo-schedule-row">
                <span class="ipo-schedule-type">${ipoEscapeHtml(ev.label)}</span>
                <span class="ipo-schedule-at">${ipoEscapeHtml(String(ev.at).slice(0, 10))}</span>
              </div>
            `).join('')}
          </div>
        </section>` : ''}

        <p class="ipo-disclaimer">※ 参考データ。公式開示・証券会社情報を必ずご確認ください。</p>
      `;
    } catch (e) {
      console.error(e);
      scheduleAutoRetry?.('ipoDetail', () => this.initDetail(ipoId), { containerEl: main });
    }
  },
};

window.IpoPage = IpoPage;
window.IpoFavorites = IpoFavorites;
