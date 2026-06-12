/**
 * 売買シミュレーター — 個別銘柄ページ
 */
(function (global) {
  const STORAGE_PREFIX = 'stockai_trade_sim_';
  const TAX_RATE = 0.20315;

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

  function fmtNum(n, digits = 0) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toLocaleString('ja-JP', { maximumFractionDigits: digits });
  }

  function parseNum(val) {
    if (val == null || val === '') return null;
    const n = Number(String(val).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function storageKey(symbol) {
    return STORAGE_PREFIX + String(symbol || '').toUpperCase();
  }

  function loadState(symbol) {
    try {
      const raw = localStorage.getItem(storageKey(symbol));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveState(symbol, state) {
    try {
      localStorage.setItem(storageKey(symbol), JSON.stringify(state));
    } catch (_) { /* ignore */ }
  }

  function calc(inputs) {
    const buy = inputs.buy;
    const shares = inputs.shares;
    const target = inputs.target;
    const stop = inputs.stop;
    const fee = inputs.fee || 0;
    const taxOn = !!inputs.taxOn;

    if (!buy || !shares || buy <= 0 || shares <= 0) return null;

    const capital = buy * shares + fee;
    const grossTarget = target != null ? (target - buy) * shares - fee : null;
    const grossStop = stop != null ? (stop - buy) * shares - fee : null;
    const grossNeutral = -fee;

    const taxTarget = grossTarget != null && taxOn && grossTarget > 0
      ? grossTarget * (1 - TAX_RATE) : grossTarget;
    const taxStop = grossStop != null && taxOn && grossStop < 0
      ? grossStop : (grossStop != null && taxOn && grossStop > 0 ? grossStop * (1 - TAX_RATE) : grossStop);

    const pctTarget = target != null ? ((target - buy) / buy) * 100 : null;
    const pctStop = stop != null ? ((stop - buy) / buy) * 100 : null;

    let rr = null;
    if (grossTarget != null && grossStop != null && grossTarget > 0 && grossStop < 0) {
      rr = grossTarget / Math.abs(grossStop);
    }

    const profitRate = grossTarget != null ? (grossTarget / capital) * 100 : null;
    const lossRate = grossStop != null ? (grossStop / capital) * 100 : null;

    return {
      capital,
      grossTarget,
      grossStop,
      taxTarget,
      taxStop,
      grossNeutral,
      pctTarget,
      pctStop,
      rr,
      profitRate,
      lossRate,
    };
  }

  function aiComment(result, inputs) {
    if (!result) return '買値と株数を入力するとシミュレーション結果が表示されます。';
    const parts = [];
    if (result.rr != null) {
      if (result.rr >= 2) {
        parts.push('目標利益に対して損失リスクが小さく、リスクリワードは良好です');
      } else if (result.rr >= 1) {
        parts.push('リスクリワードはおおむね均衡しています');
      } else {
        parts.push('損切り時の損失が目標利益を上回るため、リスクリワードは低めです');
      }
    }
    if (result.pctStop != null && Math.abs(result.pctStop) > 10) {
      parts.push('損切り幅が広いため、資金管理に注意が必要です');
    }
    if (result.pctTarget != null && result.pctTarget > 15) {
      parts.push('利益率は高いが、目標株価までの上昇率も大きめです');
    } else if (result.pctTarget != null && result.pctTarget < 3) {
      parts.push('目標までの上昇幅は小さめで、短期の値幅狙いに近い設定です');
    }
    if (inputs.taxOn && result.taxTarget != null && result.taxTarget > 0) {
      parts.push('税引後利益は概算（約20.315%）です。実際の課税は口座・譲渡損益に依存します');
    }
    return parts.length ? parts.join('。') + '。' : '入力値に基づく損益イメージです。リスクと資金に合わせて調整してください。';
  }

  const StockSimulator = {
    symbol: null,
    currentPrice: null,
    mounted: false,

    mount(symbol) {
      StockSimulator.symbol = symbol;
      const host = document.getElementById('tradeSimulator');
      if (!host) return;

      const saved = loadState(symbol) || {};
      host.innerHTML = `
        <div class="sim-form-grid">
          <label class="sim-field">
            <span class="sim-label">買値（円）</span>
            <input type="number" id="simBuy" class="sim-input" inputmode="decimal" min="0" step="1" placeholder="現在値">
          </label>
          <label class="sim-field">
            <span class="sim-label">株数</span>
            <input type="number" id="simShares" class="sim-input" inputmode="numeric" min="1" step="1" value="100">
          </label>
          <label class="sim-field">
            <span class="sim-label">目標株価（円）</span>
            <input type="number" id="simTarget" class="sim-input" inputmode="decimal" min="0" step="1">
          </label>
          <label class="sim-field">
            <span class="sim-label">損切り株価（円）</span>
            <input type="number" id="simStop" class="sim-input" inputmode="decimal" min="0" step="1">
          </label>
          <label class="sim-field">
            <span class="sim-label">手数料（円・任意）</span>
            <input type="number" id="simFee" class="sim-input" inputmode="numeric" min="0" step="1" value="0">
          </label>
          <label class="sim-field sim-field-check">
            <span class="sim-label">税金考慮（概算20.315%）</span>
            <label class="sim-toggle"><input type="checkbox" id="simTax"> ON</label>
          </label>
        </div>
        <div class="sim-results" id="simResults"></div>
        <p class="sim-disclaimer">※これは売買推奨ではなく、入力値に基づく損益シミュレーションです。</p>
      `;

      const buyEl = document.getElementById('simBuy');
      const sharesEl = document.getElementById('simShares');
      const targetEl = document.getElementById('simTarget');
      const stopEl = document.getElementById('simStop');
      const feeEl = document.getElementById('simFee');
      const taxEl = document.getElementById('simTax');

      if (saved.shares) sharesEl.value = saved.shares;
      if (saved.fee != null) feeEl.value = saved.fee;
      if (saved.taxOn) taxEl.checked = true;
      if (saved.buy) buyEl.value = saved.buy;
      if (saved.target) targetEl.value = saved.target;
      if (saved.stop) stopEl.value = saved.stop;

      const onChange = () => StockSimulator.recalc();
      [buyEl, sharesEl, targetEl, stopEl, feeEl, taxEl].forEach((el) => {
        el.addEventListener('input', onChange);
        el.addEventListener('change', onChange);
      });

      StockSimulator.mounted = true;
      StockSimulator.recalc();
    },

    setCurrentPrice(price) {
      StockSimulator.currentPrice = price;
      const buyEl = document.getElementById('simBuy');
      if (!buyEl || price == null) return;
      const saved = loadState(StockSimulator.symbol);
      if (!buyEl.value && !saved?.buy) {
        buyEl.value = Math.round(price);
        const targetEl = document.getElementById('simTarget');
        const stopEl = document.getElementById('simStop');
        if (targetEl && !targetEl.value) targetEl.value = Math.round(price * 1.1);
        if (stopEl && !stopEl.value) stopEl.value = Math.round(price * 0.95);
      }
      StockSimulator.recalc();
    },

    getInputs() {
      return {
        buy: parseNum(document.getElementById('simBuy')?.value),
        shares: parseNum(document.getElementById('simShares')?.value),
        target: parseNum(document.getElementById('simTarget')?.value),
        stop: parseNum(document.getElementById('simStop')?.value),
        fee: parseNum(document.getElementById('simFee')?.value) || 0,
        taxOn: document.getElementById('simTax')?.checked,
      };
    },

    recalc() {
      const inputs = StockSimulator.getInputs();
      if (StockSimulator.symbol) saveState(StockSimulator.symbol, inputs);
      const result = calc(inputs);
      const out = document.getElementById('simResults');
      if (!out) return;

      if (!result) {
        out.innerHTML = '<div class="sim-empty">買値と株数を入力してください</div>';
        return;
      }

      const profitCls = (n) => (n == null ? '' : n >= 0 ? 'up' : 'down');
      const showProfit = inputs.taxOn && result.taxTarget != null ? result.taxTarget : result.grossTarget;
      const showLoss = inputs.taxOn && result.taxStop != null ? result.taxStop : result.grossStop;

      out.innerHTML = `
        <div class="sim-metrics">
          <div class="sim-metric"><span class="sim-metric-k">必要資金</span><span class="sim-metric-v">${fmtYen(result.capital)}</span></div>
          <div class="sim-metric"><span class="sim-metric-k">目標到達時の利益</span><span class="sim-metric-v ${profitCls(result.grossTarget)}">${result.grossTarget != null ? fmtSignedYen(result.grossTarget) : '—'}</span></div>
          <div class="sim-metric"><span class="sim-metric-k">損切り時の損失</span><span class="sim-metric-v ${profitCls(result.grossStop)}">${result.grossStop != null ? fmtYen(result.grossStop) : '—'}</span></div>
          ${inputs.taxOn ? `<div class="sim-metric"><span class="sim-metric-k">税引後利益（目標時）</span><span class="sim-metric-v ${profitCls(result.taxTarget)}">${result.taxTarget != null ? fmtYen(result.taxTarget) : '—'}</span></div>` : ''}
          <div class="sim-metric"><span class="sim-metric-k">利益率（目標時）</span><span class="sim-metric-v ${profitCls(result.profitRate)}">${result.profitRate != null ? fmtPct(result.profitRate) : '—'}</span></div>
          <div class="sim-metric"><span class="sim-metric-k">損失率（損切り時）</span><span class="sim-metric-v ${profitCls(result.lossRate)}">${result.lossRate != null ? fmtPct(result.lossRate) : '—'}</span></div>
          <div class="sim-metric"><span class="sim-metric-k">リスクリワード比</span><span class="sim-metric-v">${result.rr != null ? result.rr.toFixed(2) + '倍' : '—'}</span></div>
          <div class="sim-metric"><span class="sim-metric-k">目標まで</span><span class="sim-metric-v">${result.pctTarget != null ? fmtPct(result.pctTarget) : '—'}</span></div>
          <div class="sim-metric"><span class="sim-metric-k">損切りまで</span><span class="sim-metric-v">${result.pctStop != null ? fmtPct(result.pctStop) : '—'}</span></div>
        </div>
        <div class="sim-scenarios">
          <div class="sim-scenario sim-scenario-bull">
            <span class="sim-scenario-label">強気シナリオ</span>
            <span class="sim-scenario-text">目標到達なら <strong class="up">${showProfit != null ? fmtSignedYen(showProfit) : '—'}</strong></span>
          </div>
          <div class="sim-scenario sim-scenario-bear">
            <span class="sim-scenario-label">弱気シナリオ</span>
            <span class="sim-scenario-text">損切りなら <strong class="down">${showLoss != null ? fmtSignedYen(showLoss) : '—'}</strong></span>
          </div>
          <div class="sim-scenario sim-scenario-neutral">
            <span class="sim-scenario-label">中立</span>
            <span class="sim-scenario-text">現在値付近なら <strong>${fmtYen(result.grossNeutral)}</strong></span>
          </div>
        </div>
        <div class="sim-ai-comment">
          <span class="sim-ai-label">💡 シミュレーションコメント</span>
          <p>${global.escapeHtml ? global.escapeHtml(aiComment(result, inputs)) : aiComment(result, inputs)}</p>
        </div>
      `;
    },
  };

  global.StockSimulator = StockSimulator;
})(window);
