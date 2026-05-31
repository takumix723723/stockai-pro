/**
 * IPO / PO 画面 — お気に入り・通知拡張用
 * localStorage: ipoFavorites [{ id, type, notify: { bb_deadline, listing_date } }]
 */
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

  init() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

    document.querySelectorAll('.ipo-subtab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.ipoTab));
    });
    document.querySelectorAll('.ipo-filter:not(.po-filter)').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ipo-filter:not(.po-filter)').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.ipoFilter = btn.dataset.filter;
        this.loadIpoList();
      });
    });
    document.querySelectorAll('.po-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.po-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.poFilter = btn.dataset.poFilter;
        this.loadPoList();
      });
    });

    this.loadIpoList();
    this.loadPoList();
  },

  switchTab(name) {
    this.activeTab = name;
    document.querySelectorAll('.ipo-subtab').forEach((b) => {
      b.classList.toggle('active', b.dataset.ipoTab === name);
    });
    document.getElementById('ipoPanelIpo').hidden = name !== 'ipo';
    document.getElementById('ipoPanelPo').hidden = name !== 'po';
    document.getElementById('ipoPanelIpo').classList.toggle('active', name === 'ipo');
    document.getElementById('ipoPanelPo').classList.toggle('active', name === 'po');
  },

  statusClass(status) {
    return status === 'open' ? 'ipo-status-open' : 'ipo-status-closed';
  },

  favBtnHtml(id, type, events) {
    const on = IpoFavorites.isFavorite(id);
    return `<button type="button" class="ipo-fav-btn${on ? ' is-on' : ''}" data-fav-id="${escapeHtml(id)}" data-fav-type="${escapeHtml(type)}" aria-label="お気に入り">${on ? '★' : '☆'}</button>`;
  },

  bindFavButtons(container) {
    container.querySelectorAll('[data-fav-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.favId;
        const type = btn.dataset.favType;
        const on = IpoFavorites.toggle(id, type, []);
        btn.classList.toggle('is-on', on);
        btn.textContent = on ? '★' : '☆';
        showToast?.(on ? 'お気に入りに追加（通知拡張予定）' : 'お気に入り解除');
      });
    });
  },

  ipoCardHtml(item) {
    const href = `/ipo/${encodeURIComponent(item.id)}`;
    return `
      <div class="ipo-card card-premium" data-ipo-href="${escapeHtml(href)}">
        <div class="ipo-card-top">
          <div class="ipo-card-title">
            <span class="ipo-card-name">${escapeHtml(item.name_full || item.name)}</span>
            <span class="ipo-card-code">${escapeHtml(item.code)}</span>
          </div>
          ${this.favBtnHtml(item.id, 'ipo', item.notify_events)}
        </div>
        <div class="ipo-card-body">
        <div class="ipo-card-tags">
          <span class="ipo-tag market">${escapeHtml(item.market)}</span>
          <span class="ipo-tag ${this.statusClass(item.status)}">${escapeHtml(item.status_label)}</span>
          ${item.sector ? `<span class="ipo-tag sector">${escapeHtml(item.sector)}</span>` : ''}
        </div>
        <div class="ipo-card-grid">
          <div class="ipo-kv"><span class="ipo-k">BB期間</span><span class="ipo-v">${escapeHtml(item.bb_period_fmt)}</span></div>
          <div class="ipo-kv"><span class="ipo-k">上場日</span><span class="ipo-v">${escapeHtml(item.listing_date_fmt)}</span></div>
          <div class="ipo-kv"><span class="ipo-k">仮条件</span><span class="ipo-v">${escapeHtml(item.price_range)}</span></div>
          <div class="ipo-kv"><span class="ipo-k">想定価格</span><span class="ipo-v highlight">${escapeHtml(item.expected_price_fmt)}</span></div>
          <div class="ipo-kv ipo-kv-wide"><span class="ipo-k">主幹事</span><span class="ipo-v">${escapeHtml(item.lead_underwriter)}</span></div>
        </div>
        </div>
      </div>
    `;
  },

  poCardHtml(item) {
    return `
      <div class="ipo-card po-card card-premium">
        <div class="ipo-card-top">
          <div class="ipo-card-title">
            <span class="ipo-card-name">${escapeHtml(item.name)}</span>
            <span class="ipo-card-code">${escapeHtml(item.code)}</span>
          </div>
          ${this.favBtnHtml(item.id, 'po', item.notify_events)}
        </div>
        <div class="ipo-card-tags">
          <span class="ipo-tag market">${escapeHtml(item.market || '—')}</span>
          <span class="ipo-tag ${this.statusClass(item.status)}">${escapeHtml(item.status_label)}</span>
          <span class="ipo-tag discount">割引 ${escapeHtml(item.discount_rate)}</span>
        </div>
        <div class="ipo-card-grid">
          <div class="ipo-kv"><span class="ipo-k">受渡日</span><span class="ipo-v">${escapeHtml(item.settlement_date_fmt)}</span></div>
          <div class="ipo-kv"><span class="ipo-k">売出株数</span><span class="ipo-v">${escapeHtml(item.shares_fmt || '—')}</span></div>
          <div class="ipo-kv ipo-kv-wide"><span class="ipo-k">短期影響</span><span class="ipo-v">${escapeHtml(item.short_term_impact)}</span></div>
        </div>
      </div>
    `;
  },

  async loadIpoList(opts = {}) {
    const el = document.getElementById('ipoList');
    if (!el) return;
    const filter = opts.filter ?? this.ipoFilter;
    const q = filter !== 'all' ? `?status=${filter}` : '';
    try {
      const res = opts.silent ? await fetchSilent(`/api/ipo${q}`) : await fetch(`/api/ipo${q}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error('failed');
      const meta = json.meta || {};
      const label = document.getElementById('ipoMetaLabel');
      if (label) {
        label.textContent = `募集中 ${meta.open_ipo_count ?? 0}件 · ${meta.updated || ''}`;
      }
      if (!json.items.length) {
        el.innerHTML = '<div class="ipo-empty">該当するIPOがありません</div>';
        return;
      }
      el.innerHTML = json.items.map((i) => this.ipoCardHtml(i)).join('');
      this.bindFavButtons(el);
      el.querySelectorAll('[data-ipo-href]').forEach((card) => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.ipo-fav-btn')) return;
          window.location.href = card.dataset.ipoHref;
        });
      });
      resetAutoRetry?.('ipoList');
    } catch (e) {
      console.error(e);
      scheduleAutoRetry?.('ipoList', () => this.loadIpoList({ isRetry: true }), { containerEl: el });
    }
  },

  async loadPoList(opts = {}) {
    const el = document.getElementById('poList');
    if (!el) return;
    const filter = opts.filter ?? this.poFilter;
    const q = filter !== 'all' ? `?status=${filter}` : '';
    try {
      const res = opts.silent ? await fetchSilent(`/api/po${q}`) : await fetch(`/api/po${q}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error('failed');
      if (!json.items.length) {
        el.innerHTML = '<div class="ipo-empty">該当するPOがありません</div>';
        return;
      }
      el.innerHTML = json.items.map((i) => this.poCardHtml(i)).join('');
      this.bindFavButtons(el);
      resetAutoRetry?.('poList');
    } catch (e) {
      console.error(e);
      scheduleAutoRetry?.('poList', () => this.loadPoList({ isRetry: true }), { containerEl: el });
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
            <span class="ipo-tag market">${escapeHtml(d.market)}</span>
            <span class="ipo-tag ${this.statusClass(d.status)}">${escapeHtml(d.status_label)}</span>
            <span class="ipo-tag sector">${escapeHtml(d.sector || '')}</span>
          </div>
          <div class="ipo-detail-price">
            <span class="ipo-detail-range">${escapeHtml(d.price_range)}</span>
            <span class="ipo-detail-expected">想定 ${escapeHtml(d.expected_price_fmt)}</span>
          </div>
          <div class="ipo-detail-dates">
            <span>BB ${escapeHtml(d.bb_period_fmt)}</span>
            <span>上場 ${escapeHtml(d.listing_date_fmt)}</span>
          </div>
          <div class="ipo-detail-underwriter">主幹事: ${escapeHtml(d.lead_underwriter)}</div>
        </section>

        <section class="section-block">
          <h2 class="section-title">会社概要</h2>
          <div class="ipo-text card-premium">${escapeHtml(d.overview || '')}</div>
        </section>

        <section class="section-block">
          <h2 class="section-title">事業内容</h2>
          <div class="ipo-text card-premium ipo-pre">${escapeHtml(d.business || '')}</div>
        </section>

        <section class="section-block">
          <h2 class="section-title">公募・需給</h2>
          <div class="ipo-detail-grid card-premium">
            <div class="ipo-kv"><span class="ipo-k">吸収金額</span><span class="ipo-v">${escapeHtml(d.offering_amount_fmt || '—')}</span></div>
            <div class="ipo-kv"><span class="ipo-k">ロックアップ</span><span class="ipo-v">${escapeHtml(d.lock_up || '—')}</span></div>
          </div>
        </section>

        ${(d.vc_holdings || []).length ? `
        <section class="section-block">
          <h2 class="section-title">VC保有</h2>
          <div class="ipo-vc-list card-premium">
            ${d.vc_holdings.map((v) => `
              <div class="ipo-vc-row">
                <span>${escapeHtml(v.name)}</span>
                <span class="ipo-vc-ratio">${escapeHtml(v.ratio)}</span>
                <span class="ipo-vc-lock">${escapeHtml(v.lock || '')}</span>
              </div>
            `).join('')}
          </div>
        </section>` : ''}

        <section class="section-block">
          <h2 class="section-title">🤖 AI初値期待</h2>
          <div class="ipo-ai-card card-premium">
            <div class="ipo-ai-score">${ai.score ?? '—'}<span class="ipo-ai-sub">/ 100</span></div>
            <div class="ipo-ai-label">${escapeHtml(ai.label || '')}</div>
            <p class="ipo-ai-comment">${escapeHtml(ai.comment || '')}</p>
          </div>
        </section>

        ${(d.notify_events || []).length ? `
        <section class="section-block">
          <h2 class="section-title">📅 スケジュール</h2>
          <div class="ipo-schedule card-premium">
            ${d.notify_events.map((ev) => `
              <div class="ipo-schedule-row">
                <span class="ipo-schedule-type">${escapeHtml(ev.label)}</span>
                <span class="ipo-schedule-at">${escapeHtml(String(ev.at).slice(0, 10))}</span>
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
