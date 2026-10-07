// ============================================
// CRYPTONOTE — Main Application Logic
// P2P Trading Tracker
// ============================================

const App = {
  currentPage: 'dashboard',
  prices: {},
  coinInfoCache: {},
  refreshInterval: null,
  selectedCoin: null,
  txFilter: 'all',
  initialBankBalances: {},

  async init() {
    this.initialBankBalances = JSON.parse(localStorage.getItem('cn_bank_offsets') || '{}');
    this.bindNav();
    this.bindModal();
    this.bindBankModal();
    this.bindForm();
    this.bindSearch();
    this.bindAuth();
    this.bindBottomNav();
    this.initPWA();

    if (typeof Auth !== 'undefined') {
      await Auth.init();
    }
    await Storage.syncWithSupabase();
    this.navigate('dashboard');
    this.startPriceRefresh();
  },

  async onAuthChange(user) {
    await Storage.syncWithSupabase();
    this.renderPage(this.currentPage);
  },

  // ── Navigation ──────────────────────────────
  bindNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.page));
    });
  },

  navigate(page) {
    this.currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (pageEl) pageEl.classList.add('active');
    if (navEl) navEl.classList.add('active');
    // Sync bottom nav active state
    document.querySelectorAll('.bottom-nav-item[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === page);
    });
    const titles = {
      dashboard: ['Dashboard', 'Resumen de tu portafolio P2P'],
      assets: ['Mis Activos', 'Posiciones abiertas con precios en tiempo real'],
      transactions: ['Historial', 'Registro completo de tus operaciones P2P'],
    };
    const t = titles[page] || ['', ''];
    const h1 = document.getElementById('page-title');
    const sub = document.getElementById('page-subtitle');
    if (h1) h1.textContent = t[0];
    if (sub) sub.textContent = t[1];
    this.renderPage(page);
  },

  async renderPage(page) {
    await this.refreshPrices();
    if (page === 'dashboard') this.renderDashboard();
    else if (page === 'assets') this.renderAssets();
    else if (page === 'transactions') this.renderTransactions();
  },

  // ── Price Refresh ────────────────────────────
  async refreshPrices() {
    const holdings = Storage.getHoldings();
    const coinIds = holdings.map(h => h.coinId).filter(Boolean);
    if (coinIds.length === 0) return;
    try {
      const fresh = await API.getPrices(coinIds);
      Object.assign(this.prices, fresh);
    } catch(e) {}
  },

  startPriceRefresh() {
    this.refreshInterval = setInterval(async () => {
      await this.refreshPrices();
      if (this.currentPage === 'dashboard') this.renderDashboard();
      else if (this.currentPage === 'assets') this.renderAssets();
      else if (this.currentPage === 'transactions') this.renderTransactions();
    }, 60000);
  },

  // ── Dashboard ───────────────────────────────
  renderDashboard() {
    const holdings = Storage.getHoldings();
    const txs = Storage.getTransactions();

    let totalInvested = 0;
    let totalSoldValue = 0;
    let currentValue = 0;

    txs.forEach(tx => {
      if (tx.type === 'buy') totalInvested += (tx.quantity * tx.price) + (tx.commission || 0);
      if (tx.type === 'sell') totalSoldValue += (tx.quantity * tx.price) - (tx.commission || 0);
    });

    holdings.forEach(h => {
      const p = this.prices[h.coinId]?.usd || h.avgBuyPrice;
      currentValue += h.quantity * p;
    });

    // Realized P&L
    let realizedPL = 0;
    txs.filter(t => t.type === 'sell').forEach(sell => {
      const sym = sell.symbol.toUpperCase();
      const buys = txs.filter(t => t.type === 'buy' && t.symbol.toUpperCase() === sym);
      const totalQtyBought = buys.reduce((a, t) => a + t.quantity, 0);
      const totalPaidBought = buys.reduce((a, t) => a + (t.quantity * t.price) + (t.commission || 0), 0);
      const avgCost = totalQtyBought > 0 ? totalPaidBought / totalQtyBought : 0;
      
      const revenue = (sell.quantity * sell.price) - (sell.commission || 0);
      const cost = sell.quantity * avgCost;
      realizedPL += (revenue - cost);
    });

    const unrealizedPL = currentValue - holdings.reduce((a, h) => a + h.costBasis, 0);
    const totalPL = realizedPL + unrealizedPL;
    const plPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;

    this.renderStatCards({ totalInvested, currentValue, totalPL, plPct });

    // Charts
    if (holdings.length > 0) {
      const chartCtx = document.getElementById('portfolioChart');
      if (chartCtx && !Charts.portfolioChart) Charts.initPortfolioChart(chartCtx);
      Charts.updatePortfolioChart(holdings, this.prices);
      document.getElementById('chart-empty')?.classList.add('hidden');
      const cc = document.getElementById('chart-content');
      if (cc) { cc.style.display = ''; cc.classList.remove('hidden'); }
    } else {
      document.getElementById('chart-empty')?.classList.remove('hidden');
      const cc = document.getElementById('chart-content');
      if (cc) cc.style.display = 'none';
    }

    this.renderBankBalances(txs);
    this.renderRecentTx(txs.slice(0, 5));
    this.renderPLBreakdown(realizedPL, unrealizedPL);
  },

  renderBankBalances(txs) {
    const list = document.getElementById('bank-balances-list');
    if (!list) return;
    const balances = {};
    txs.forEach(tx => {
      const b = tx.bank || 'Desconocido';
      if (!balances[b]) balances[b] = 0;
      if (tx.type === 'buy') {
        balances[b] -= (tx.quantity * tx.price) + (tx.commission || 0);
      } else {
        balances[b] += (tx.quantity * tx.price) - (tx.commission || 0);
      }
    });

    // Add initial offsets
    Object.keys(this.initialBankBalances).forEach(b => {
      if (!balances[b]) balances[b] = 0;
      balances[b] += this.initialBankBalances[b];
    });

    const entries = Object.entries(balances);
    if (entries.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Sin movimientos bancarios registrados</div>';
      return;
    }

    list.innerHTML = entries.map(([bank, bal]) => {
      const isNeg = bal < 0;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="font-weight:600;font-size:13px;color:var(--text-secondary)">🏦 ${bank}</div>
          <div style="font-weight:700;font-size:14px;color:${isNeg ? 'var(--red-400)' : 'var(--text-primary)'}">
            ${API.formatFiat(bal)}
          </div>
        </div>
      `;
    }).join('');
  },


  renderStatCards({ totalInvested, currentValue, totalPL, plPct }) {
    const isUp = totalPL >= 0;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setCls = (id, cls) => { const el = document.getElementById(id); if (el) el.className = 'stat-change ' + cls; };
    set('stat-invested', API.formatFiat(totalInvested));
    set('stat-current', API.formatFiat(currentValue));
    set('stat-pl', (isUp ? '+' : '') + API.formatFiat(totalPL));
    set('stat-pl-pct', (isUp ? '▲ ' : '▼ ') + Math.abs(plPct).toFixed(2) + '%');
    set('stat-assets', Storage.getHoldings().length);
    setCls('stat-pl-pct', isUp ? 'up' : 'down');
    const plCard = document.querySelector('.stat-card[data-type="pl"]');
    if (plCard) {
      const val = plCard.querySelector('.stat-value');
      if (val) val.className = 'stat-value ' + (isUp ? 'text-green' : 'text-red');
    }
  },

  renderPLBreakdown(realizedPL, unrealizedPL) {
    const panel = document.getElementById('pl-breakdown');
    if (!panel) return;
    const rUp = realizedPL >= 0;
    const uUp = unrealizedPL >= 0;
    panel.innerHTML = `
      <div class="pl-breakdown-item">
        <div class="pl-breakdown-label">
          <span class="pl-dot realized"></span>
          P&L Realizado
          <span class="pl-info-icon" title="Ganancia/Perdida ya cobrada en ventas cerradas">ⓘ</span>
        </div>
        <div class="pl-breakdown-val ${rUp ? 'text-green' : 'text-red'}">
          ${rUp ? '+' : ''}${API.formatFiat(realizedPL)}
        </div>
      </div>
      <div class="pl-breakdown-sep"></div>
      <div class="pl-breakdown-item">
        <div class="pl-breakdown-label">
          <span class="pl-dot unrealized"></span>
          P&L No Realizado
          <span class="pl-info-icon" title="Ganancia/Perdida latente en posiciones aun abiertas">ⓘ</span>
        </div>
        <div class="pl-breakdown-val ${uUp ? 'text-green' : 'text-red'}">
          ${uUp ? '+' : ''}${API.formatFiat(unrealizedPL)}
        </div>
      </div>
    `;
  },

  renderLegend({ labels, values, colors }, total) {
    const legend = document.getElementById('pie-legend');
    if (!legend) return;
    legend.innerHTML = '';
    labels.forEach((lbl, i) => {
      const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0';
      legend.innerHTML += `
        <div class="legend-item">
          <div class="legend-dot-wrap">
            <div class="legend-dot" style="background:${colors[i]}"></div>
            <span>${lbl}</span>
          </div>
          <span class="legend-pct">${pct}%</span>
        </div>`;
    });
  },

  renderRecentTx(txs) {
    const tbody = document.getElementById('recent-tx-body');
    if (!tbody) return;
    if (txs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="empty-state" style="padding:30px">
          <div class="empty-icon">📋</div>
          <h3>Sin transacciones</h3>
          <p>Registra tu primera operacion P2P para comenzar</p>
        </div></td></tr>`;
      return;
    }
    tbody.innerHTML = txs.map(tx => this.txRow(tx)).join('');
    tbody.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => this.deleteTransaction(btn.dataset.id));
    });
  },

  // ── Assets Page ──────────────────────────────
  renderAssets() {
    const holdings = Storage.getHoldings();
    const tbody = document.getElementById('assets-tbody');
    if (!tbody) return;

    if (holdings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">💼</div>
          <h3>Portafolio vacio</h3>
          <p>Registra una compra P2P para ver tus activos aqui</p>
        </div></td></tr>`;
      return;
    }

    tbody.innerHTML = holdings.map(h => {
      const priceData = this.prices[h.coinId];
      const currentPrice = priceData?.usd || h.avgBuyPrice;
      const change24h = priceData?.usd_24h_change;
      const currentValue = h.quantity * currentPrice;
      const pl = currentValue - h.costBasis;
      const plPct = h.costBasis > 0 ? (pl / h.costBasis) * 100 : 0;
      const isUp = pl >= 0;
      const c24up = change24h >= 0;

      const statusPill = isUp
        ? `<div class="p2p-status up">🟢 En Ganancia</div>`
        : `<div class="p2p-status down">🔴 En Perdida</div>`;

      const icon = this.coinInfoCache[h.coinId]?.image
        ? `<img class="coin-icon" src="${this.coinInfoCache[h.coinId].image}" alt="${h.symbol}">`
        : `<div class="coin-icon-placeholder">${h.symbol.substring(0,2)}</div>`;

      return `<tr>
        <td><div class="coin-cell">${icon}<div>
          <div class="coin-name">${h.name}</div>
          <div class="coin-symbol">${h.symbol}</div>
        </div></div></td>
        <td style="text-align:right">${API.formatFiat(currentPrice)}</td>
        <td style="text-align:right">${h.quantity % 1 === 0 ? h.quantity.toLocaleString() : h.quantity.toFixed(6)}</td>
        <td style="text-align:right">${API.formatFiat(h.avgBuyPrice)}</td>
        <td style="text-align:right">${API.formatFiat(currentValue)}</td>
        <td style="text-align:right" class="${isUp ? 'text-green' : 'text-red'}">
          <span style="font-weight:700">${isUp ? '+' : ''}${API.formatFiat(pl)}</span><br>
          <span style="font-size:11px;font-weight:600">${isUp ? '▲' : '▼'} ${Math.abs(plPct).toFixed(2)}%</span>
        </td>
        <td style="text-align:right">
          ${statusPill}
          ${change24h !== undefined
            ? `<div style="margin-top:4px"><span class="badge ${c24up ? 'up' : 'down'}">${c24up ? '▲' : '▼'} ${Math.abs(change24h).toFixed(2)}% 24h</span></div>`
            : ''}
        </td>
        <td style="text-align:center">
          <button class="btn-sell-direct" data-id="${h.coinId || ''}" data-symbol="${h.symbol}" title="Vender este activo registrado">⚡ Vender</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-sell-direct').forEach(btn => {
      btn.addEventListener('click', () => {
        this.openSellModalForCoin(btn.dataset.id, btn.dataset.symbol);
      });
    });

    holdings.forEach(h => {
      if (h.coinId && !this.coinInfoCache[h.coinId]) {
        API.getCoinInfo(h.coinId).then(info => {
          if (info) { this.coinInfoCache[h.coinId] = info; this.renderAssets(); }
        });
      }
    });
  },

  // ── Transactions Page ────────────────────────
  renderTransactions(filter) {
    if (filter) this.txFilter = filter;
    let txs = Storage.getTransactions();
    if (this.txFilter !== 'all') txs = txs.filter(t => t.type === this.txFilter);
    const q = document.getElementById('tx-search')?.value?.toLowerCase() || '';
    if (q) txs = txs.filter(t => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
    const tbody = document.getElementById('tx-tbody');
    if (!tbody) return;
    if (txs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <h3>Sin transacciones</h3>
          <p>No hay registros ${this.txFilter !== 'all' ? 'de ' + (this.txFilter === 'buy' ? 'compras' : 'ventas') : ''} aun</p>
        </div></td></tr>`;
      return;
    }
    tbody.innerHTML = txs.map(tx => this.txRow(tx, true)).join('');
    tbody.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => this.deleteTransaction(btn.dataset.id));
    });
  },

  txRow(tx, showFull = false) {
    const comis = tx.commission || 0;
    const total = tx.type === 'buy' 
      ? (tx.quantity * tx.price) + comis 
      : (tx.quantity * tx.price) - comis;
      
    const date = new Date(tx.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
    const typeLabel = tx.type === 'buy' ? '▲ Compra' : '▼ Venta';

    const noteHtml = tx.note
      ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px;font-style:italic">📝 ${tx.note}</div>`
      : '';
      
    const bankHtml = tx.bank 
      ? `<div style="font-size:12px;font-weight:600;color:var(--blue-300)">🏦 ${tx.bank}</div>`
      : '';

    return `<tr>
      <td><span class="tx-type ${tx.type}">${typeLabel}</span></td>
      <td><div style="font-weight:700">${tx.name}</div><div style="font-size:11px;color:var(--text-muted)">${tx.symbol.toUpperCase()}</div></td>
      <td style="font-family:monospace">${tx.quantity % 1 === 0 ? tx.quantity.toLocaleString() : tx.quantity.toFixed(6)}</td>
      <td>${API.formatFiat(tx.price)}</td>
      <td>
        <div style="font-weight:700">${API.formatFiat(total)}</div>
        ${comis > 0 ? `<div style="font-size:10px;color:var(--text-muted)">Comis: ${API.formatFiat(comis)}</div>` : ''}
      </td>
      <td>${bankHtml}</td>
      <td><div style="font-size:11px;color:var(--text-muted)">${date}</div>${noteHtml}</td>
      <td><div style="display:flex;align-items:center;justify-content:flex-end">
        <button class="btn-icon btn-del" data-id="${tx.id}" title="Eliminar">🗑</button>
      </div></td>
    </tr>`;
  },

  async deleteTransaction(id) {
    if (!confirm('¿Eliminar esta transaccion?')) return;
    await Storage.deleteTransaction(id);
    Toast.show('Transaccion eliminada', 'success');
    this.renderPage(this.currentPage);
  },

  // ── Modal ────────────────────────────────────
  bindModal() {
    document.getElementById('btn-add-tx')?.addEventListener('click', () => Modal.open());
    document.getElementById('btn-add-tx-2')?.addEventListener('click', () => Modal.open());
    document.getElementById('modal-close')?.addEventListener('click', () => Modal.close());
    document.getElementById('modal-cancel')?.addEventListener('click', () => Modal.close());
    document.getElementById('modal-overlay')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) Modal.close();
    });
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setTxType(btn.dataset.type));
    });
  },

  bindBankModal() {
    document.getElementById('btn-edit-banks')?.addEventListener('click', () => {
      const banks = ['Banreservas', 'Qik', 'BHD', 'Banco Popular', 'Santa Cruz', 'Efectivo', 'Binance Pay', 'Otro'];
      const body = document.getElementById('bank-modal-body');
      if (!body) return;
      body.innerHTML = banks.map(b => {
        const val = this.initialBankBalances[b] || 0;
        return `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label style="font-size:13px; font-weight:600; color:var(--text-secondary)">${b}</label>
            <input type="number" class="form-input bank-offset-input" data-bank="${b}" value="${val}" step="any" style="width:120px; padding:6px 10px; font-size:13px;">
          </div>
        `;
      }).join('');
      document.getElementById('bank-modal-overlay')?.classList.add('open');
    });

    document.getElementById('btn-save-banks')?.addEventListener('click', () => {
      document.querySelectorAll('.bank-offset-input').forEach(inp => {
        const val = parseFloat(inp.value) || 0;
        if (val !== 0) {
          this.initialBankBalances[inp.dataset.bank] = val;
        } else {
          delete this.initialBankBalances[inp.dataset.bank];
        }
      });
      localStorage.setItem('cn_bank_offsets', JSON.stringify(this.initialBankBalances));
      document.getElementById('bank-modal-overlay')?.classList.remove('open');
      Toast.show('Saldos iniciales actualizados', 'success');
      this.renderDashboard();
    });
  },

  openSellModalForCoin(coinId, symbol) {
    Modal.open();
    this.setTxType('sell', coinId, symbol);
  },

  setTxType(type, preselectId, preselectSymbol) {
    document.querySelectorAll('.type-btn').forEach(b => {
      b.className = 'type-btn ' + (b.dataset.type === type ? 'active-' + type : '');
    });
    document.getElementById('tx-type-hidden').value = type;
    const label = document.getElementById('price-label');
    if (label) label.textContent = type === 'buy' ? 'Tasa/Precio de compra (DOP)' : 'Tasa/Precio de venta (DOP)';

    const searchWrap = document.getElementById('coin-search-wrap');
    const sellWrap = document.getElementById('coin-sell-wrap');
    const sellChips = document.getElementById('sell-quick-chips');
    const sellInfo = document.getElementById('sell-holding-info');
    const lbs = document.getElementById('live-price-badge-sell');
    const lb = document.getElementById('live-price-badge');

    if (type === 'sell') {
      if (searchWrap) searchWrap.style.display = 'none';
      if (sellWrap) sellWrap.style.display = 'block';
      this.populateSellSelector(preselectId, preselectSymbol);
    } else {
      if (searchWrap) searchWrap.style.display = 'block';
      if (sellWrap) sellWrap.style.display = 'none';
      if (sellChips) sellChips.style.display = 'none';
      if (sellInfo) sellInfo.style.display = 'none';
      if (lb) lb.textContent = '';
      if (lbs) lbs.textContent = '';

      // Reset fields
      document.getElementById('coin-id-hidden').value = '';
      document.getElementById('coin-name-hidden').value = '';
      document.getElementById('coin-symbol-hidden').value = '';
      document.getElementById('tx-quantity').value = '';
      document.getElementById('tx-price').value = '';
      document.getElementById('coin-search').value = '';
      this.updateTotalPreview();
    }
  },

  // Build the sell dropdown from current holdings
  populateSellSelector(preselectId, preselectSymbol) {
    const holdings = Storage.getHoldings();
    const select = document.getElementById('sell-coin-select');
    const sellChips = document.getElementById('sell-quick-chips');
    const sellInfo = document.getElementById('sell-holding-info');
    const lbs = document.getElementById('live-price-badge-sell');
    if (!select) return;

    // Reset fields
    document.getElementById('coin-id-hidden').value = '';
    document.getElementById('coin-name-hidden').value = '';
    document.getElementById('coin-symbol-hidden').value = '';
    document.getElementById('tx-quantity').value = '';
    document.getElementById('tx-price').value = '';
    if (lbs) lbs.textContent = '';
    if (sellChips) sellChips.style.display = 'none';
    if (sellInfo) sellInfo.style.display = 'none';
    this.updateTotalPreview();

    if (holdings.length === 0) {
      select.innerHTML = '<option value="">— No tienes criptomonedas compradas para vender —</option>';
      if (lbs) {
        lbs.innerHTML = `<span style="color:var(--text-muted)">Primero registra una <button type="button" id="btn-quick-buy" style="background:none;border:none;color:var(--blue-400);text-decoration:underline;cursor:pointer;font-weight:700">compra</button> para poder venderla.</span>`;
        document.getElementById('btn-quick-buy')?.addEventListener('click', () => this.setTxType('buy'));
      }
      return;
    }

    select.innerHTML = '<option value="">Selecciona la moneda que vas a vender...</option>' +
      holdings.map(h => {
        const qtyFormatted = h.quantity % 1 === 0 ? h.quantity.toLocaleString() : h.quantity.toFixed(6);
        return `<option value="${h.coinId || h.symbol}" data-id="${h.coinId || ''}" data-name="${h.name}" data-symbol="${h.symbol}" data-qty="${h.quantity}" data-avg="${h.avgBuyPrice}">` +
          `${h.name} (${h.symbol}) — Disponible: ${qtyFormatted} (Costo prom: ${API.formatFiat(h.avgBuyPrice)})` +
        `</option>`;
      }).join('');

    select.onchange = () => {
      const opt = select.options[select.selectedIndex];
      if (!opt || !opt.value) {
        if (sellChips) sellChips.style.display = 'none';
        if (sellInfo) sellInfo.style.display = 'none';
        if (lbs) lbs.textContent = '';
        return;
      }

      const coinId = opt.dataset.id || opt.value;
      const coinName = opt.dataset.name;
      const coinSymbol = opt.dataset.symbol;
      const maxQty = parseFloat(opt.dataset.qty);
      const avgPrice = parseFloat(opt.dataset.avg) || 0;

      document.getElementById('coin-id-hidden').value = coinId;
      document.getElementById('coin-name-hidden').value = coinName;
      document.getElementById('coin-symbol-hidden').value = coinSymbol;

      const defaultQty = maxQty % 1 === 0 ? maxQty : parseFloat(maxQty.toFixed(6));
      document.getElementById('tx-quantity').value = defaultQty;

      if (sellChips) sellChips.style.display = 'flex';
      if (lbs) lbs.innerHTML = `<span style="color:var(--text-muted)">⏳ Obteniendo precio en vivo...</span>`;

      // Live price fetch
      const fetchId = coinId || coinSymbol.toLowerCase();
      API.getPrices([fetchId]).then(p => {
        const live = p[fetchId]?.usd || p[coinId]?.usd;
        if (live) {
          document.getElementById('tx-price').value = live < 1 ? live.toFixed(6) : live.toFixed(2);
          if (lbs) lbs.innerHTML = `🟢 Precio actual de mercado: <strong>${API.formatFiat(live)}</strong>`;
        } else {
          document.getElementById('tx-price').value = avgPrice ? avgPrice.toFixed(2) : '';
          if (lbs) lbs.innerHTML = `ℹ️ Ingresa el precio de venta acordado`;
        }
        this.updateTotalPreview();
        this.updateSellBreakdown();
      });

      // Quick chips listener
      sellChips.querySelectorAll('.btn-qty-chip').forEach(chip => {
        chip.onclick = () => {
          const pct = parseFloat(chip.dataset.pct);
          const newQty = maxQty * pct;
          document.getElementById('tx-quantity').value = newQty % 1 === 0 ? newQty : parseFloat(newQty.toFixed(6));
          this.updateTotalPreview();
          this.updateSellBreakdown();
        };
      });

      this.updateTotalPreview();
      this.updateSellBreakdown();
    };

    // Preselect if requested
    if (preselectId || preselectSymbol) {
      for (let i = 0; i < select.options.length; i++) {
        const opt = select.options[i];
        if (
          (preselectId && (opt.value === preselectId || opt.dataset.id === preselectId)) ||
          (preselectSymbol && opt.dataset.symbol?.toUpperCase() === preselectSymbol.toUpperCase())
        ) {
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change'));
          break;
        }
      }
    }
  },

  updateSellBreakdown() {
    const sellInfo = document.getElementById('sell-holding-info');
    const select = document.getElementById('sell-coin-select');
    if (!sellInfo || !select) return;

    const opt = select.options[select.selectedIndex];
    if (!opt || !opt.value) {
      sellInfo.style.display = 'none';
      return;
    }

    const sym = opt.dataset.symbol || '';
    const maxQty = parseFloat(opt.dataset.qty) || 0;
    const avgPrice = parseFloat(opt.dataset.avg) || 0;
    const sellQty = parseFloat(document.getElementById('tx-quantity').value) || 0;
    const sellPrice = parseFloat(document.getElementById('tx-price').value) || 0;
    const remainingQty = Math.max(0, maxQty - sellQty);

    const costOfPortion = sellQty * avgPrice;
    const revenue = sellQty * sellPrice;
    const p2pProfit = revenue - costOfPortion;
    const p2pProfitPct = avgPrice > 0 ? ((sellPrice - avgPrice) / avgPrice) * 100 : 0;
    const isUp = p2pProfit >= 0;

    sellInfo.style.display = 'flex';
    sellInfo.innerHTML = `
      <div class="sell-info-row">
        <span class="sell-info-label">📦 Saldo comprado:</span>
        <span class="sell-info-val">${maxQty % 1 === 0 ? maxQty.toLocaleString() : maxQty.toFixed(6)} ${sym}</span>
      </div>
      <div class="sell-info-row">
        <span class="sell-info-label">💵 Tu precio de compra prom:</span>
        <span class="sell-info-val">${API.formatFiat(avgPrice)}</span>
      </div>
      <div class="sell-info-row">
        <span class="sell-info-label">📉 Despues de vender te quedaran:</span>
        <span class="sell-info-val" style="color:var(--text-secondary)">${remainingQty % 1 === 0 ? remainingQty.toLocaleString() : remainingQty.toFixed(6)} ${sym}</span>
      </div>
      ${sellQty > 0 && sellPrice > 0 ? `
      <div class="sell-info-row" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08)">
        <span class="sell-info-label" style="font-weight:700">💰 Margen P2P de esta venta:</span>
        <span class="sell-info-val ${isUp ? 'text-green' : 'text-red'}" style="font-size:13px;font-weight:800">
          ${isUp ? '+' : ''}${API.formatFiat(p2pProfit)} (${isUp ? '▲' : '▼'} ${Math.abs(p2pProfitPct).toFixed(2)}%)
        </span>
      </div>` : ''}
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
        ℹ️ Al guardar, se restara esta cantidad de tus ${sym} registrados como comprados.
      </div>
    `;
  },

  updateTotalPreview() {
    const qty = parseFloat(document.getElementById('tx-quantity')?.value) || 0;
    const price = parseFloat(document.getElementById('tx-price')?.value) || 0;
    const type = document.getElementById('tx-type-hidden')?.value || 'buy';
    const commission = parseFloat(document.getElementById('tx-commission')?.value) || 0;
    
    let total = qty * price;
    if (type === 'buy') {
      total += commission;
    } else {
      total -= commission;
    }
    
    const totalEl = document.getElementById('total-amount');
    if (totalEl) totalEl.textContent = API.formatFiat(total);
  },

  // ── Coin Search ──────────────────────────────
  bindSearch() {
    const input = document.getElementById('coin-search');
    const dropdown = document.getElementById('coin-dropdown');
    if (!input) return;
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 1) { dropdown.style.display = 'none'; return; }
      debounce = setTimeout(() => this.searchCoins(q), 350);
    });
    document.addEventListener('click', e => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  },

  async searchCoins(q) {
    const dropdown = document.getElementById('coin-dropdown');
    dropdown.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--text-muted)">Buscando...</div>';
    dropdown.style.display = 'block';
    const results = await API.searchCoins(q);
    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--text-muted)">Sin resultados</div>';
      return;
    }
    dropdown.innerHTML = results.map(c => `
      <div class="coin-result" data-id="${c.id}" data-name="${c.name}" data-symbol="${c.symbol}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background .15s">
        <img src="${c.thumb}" width="24" height="24" style="border-radius:50%" onerror="this.style.display='none'">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${c.name}</div>
          <div style="font-size:11px;color:var(--text-muted)">${c.symbol}</div>
        </div>
      </div>`).join('');

    dropdown.querySelectorAll('.coin-result').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.05)');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', () => {
        document.getElementById('coin-search').value = el.dataset.name + ' (' + el.dataset.symbol + ')';
        document.getElementById('coin-id-hidden').value = el.dataset.id;
        document.getElementById('coin-name-hidden').value = el.dataset.name;
        document.getElementById('coin-symbol-hidden').value = el.dataset.symbol;
        dropdown.style.display = 'none';

        // Autofill live price
        const priceInput = document.getElementById('tx-price');
        const liveBadge = document.getElementById('live-price-badge');
        priceInput.value = '';
        if (liveBadge) liveBadge.innerHTML = '<span style="opacity:.7">Cargando precio live...</span>';
        API.getPrices([el.dataset.id]).then(p => {
          const price = p[el.dataset.id]?.usd;
          if (price) {
            priceInput.value = price.toFixed(price < 1 ? 6 : 2);
            if (liveBadge) liveBadge.innerHTML = `🟢 Precio live: <strong>${API.formatFiat(price)}</strong>`;
            this.updateTotalPreview();
          } else {
            if (liveBadge) liveBadge.innerHTML = '⚠️ Ingresa el precio manualmente';
          }
        });
      });
    });
  },

  // ── Form Submit ──────────────────────────────
  bindForm() {
    // Dynamic recalculation on quantity and price input
    ['tx-quantity', 'tx-price', 'tx-commission'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        this.updateTotalPreview();
        if (document.getElementById('tx-type-hidden').value === 'sell') {
          this.updateSellBreakdown();
        }
      });
    });

    document.getElementById('tx-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const coinId = document.getElementById('coin-id-hidden').value;
      const coinName = document.getElementById('coin-name-hidden').value;
      const coinSymbol = document.getElementById('coin-symbol-hidden').value;
      const quantity = parseFloat(document.getElementById('tx-quantity').value);
      const price = parseFloat(document.getElementById('tx-price').value);
      const type = document.getElementById('tx-type-hidden').value;
      const bank = document.getElementById('tx-bank')?.value || '';
      const commission = parseFloat(document.getElementById('tx-commission')?.value) || 0;
      const date = document.getElementById('tx-date').value || new Date().toISOString().split('T')[0];
      const note = document.getElementById('tx-note')?.value?.trim() || '';

      if (!coinId || !coinName) { Toast.show('Selecciona una criptomoneda', 'error'); return; }
      if (!quantity || quantity <= 0) { Toast.show('Ingresa una cantidad valida', 'error'); return; }
      if (!price || price <= 0) { Toast.show('Ingresa un precio valido', 'error'); return; }
      if (!bank) { Toast.show('Selecciona un banco u origen', 'error'); btn.disabled = false; return; }

      // Validate sell: ensure enough holdings registered from buys
      if (type === 'sell') {
        const holdings = Storage.getHoldings();
        const holding = holdings.find(h => (h.coinId && h.coinId === coinId) || h.symbol.toUpperCase() === coinSymbol.toUpperCase());
        if (!holding || quantity > (holding.quantity + 0.000001)) {
          const avail = holding ? (holding.quantity % 1 === 0 ? holding.quantity : holding.quantity.toFixed(6)) : 0;
          Toast.show(`Solo tienes ${avail} ${coinSymbol} registrado como comprado para vender`, 'error');
          return;
        }
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Guardando...';

      await Storage.addTransaction({ type, coinId, name: coinName, symbol: coinSymbol, quantity, price, bank, commission, date, note });

      await this.refreshPrices();
      btn.disabled = false;
      btn.innerHTML = 'Guardar Operacion';
      Modal.close();

      const icon = type === 'buy' ? '🟢' : '🔴';
      const actionMsg = type === 'buy'
        ? `Compra de ${coinName} guardada en tus activos`
        : `Venta de ${coinName} registrada y descontada de tu compra`;
      Toast.show(`${icon} ${actionMsg}`, 'success');

      this.renderPage(this.currentPage);
      e.target.reset();
      document.getElementById('coin-search').value = '';
      document.getElementById('coin-id-hidden').value = '';
      document.getElementById('sell-coin-select').value = '';
      document.getElementById('sell-quick-chips').style.display = 'none';
      document.getElementById('sell-holding-info').style.display = 'none';
      const liveBadge = document.getElementById('live-price-badge');
      if (liveBadge) liveBadge.textContent = '';
      const liveBadgeSell = document.getElementById('live-price-badge-sell');
      if (liveBadgeSell) liveBadgeSell.textContent = '';
      this.updateTotalPreview();
    });

    document.querySelectorAll('.tab-pill[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-pill[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderTransactions(btn.dataset.filter);
      });
    });

    document.getElementById('tx-search')?.addEventListener('input', () => this.renderTransactions());
  },
};

// ── Modal utility ────────────────────────────
const Modal = {
  open() {
    document.getElementById('modal-overlay').classList.add('open');
    const dateInput = document.getElementById('tx-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
    const type = document.getElementById('tx-type-hidden').value;
    if (type === 'buy') {
      document.getElementById('coin-search')?.focus();
    } else {
      document.getElementById('sell-coin-select')?.focus();
    }
  },
  close() {
    document.getElementById('modal-overlay').classList.remove('open');
  },
};


// ── Toast utility ────────────────────────────
const Toast = {
  show(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✅' : '❌'}</span><span>${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('show')); });
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  },
};

// ── Auth Modal Controller ────────────────────
const AuthModal = {
  mode: 'login',

  open(mode = 'login') {
    this.setMode(mode);
    document.getElementById('auth-modal-overlay')?.classList.add('open');
    setTimeout(() => document.getElementById('auth-email')?.focus(), 100);
  },

  close() {
    document.getElementById('auth-modal-overlay')?.classList.remove('open');
    this.clearAlert();
  },

  setMode(mode) {
    this.mode = mode;
    this.clearAlert();
    const tabLogin  = document.getElementById('tab-auth-login');
    const tabSignup = document.getElementById('tab-auth-signup');
    const nameGroup = document.getElementById('group-auth-name');
    const submitBtn = document.getElementById('btn-auth-submit');
    const switchText = document.getElementById('auth-switch-text');
    const switchBtn  = document.getElementById('btn-auth-switch');
    const syncWrap  = document.getElementById('auth-sync-wrap');

    if (mode === 'signup') {
      if (tabLogin)  tabLogin.classList.remove('active');
      if (tabSignup) tabSignup.classList.add('active');
      if (nameGroup) nameGroup.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Crear Cuenta Gratis';
      if (switchText) switchText.textContent = 'Ya tienes cuenta?';
      if (switchBtn)  switchBtn.textContent  = 'Inicia sesion';
      if (syncWrap)  syncWrap.style.display  = 'none';
    } else {
      if (tabLogin)  tabLogin.classList.add('active');
      if (tabSignup) tabSignup.classList.remove('active');
      if (nameGroup) nameGroup.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Iniciar Sesion';
      if (switchText) switchText.textContent = 'No tienes cuenta?';
      if (switchBtn)  switchBtn.textContent  = 'Registrate gratis';
      if (syncWrap) {
        const local = Storage.getLocalTransactions();
        syncWrap.style.display = local.length > 0 ? 'block' : 'none';
      }
    }
  },

  showAlert(msg, type = 'error') {
    const el = document.getElementById('auth-alert');
    if (!el) return;
    el.style.display = 'block';
    el.className = 'auth-alert';
    if (type === 'error') {
      el.style.background = 'rgba(239,68,68,0.12)';
      el.style.border = '1px solid rgba(239,68,68,0.3)';
      el.style.color = 'var(--red-400)';
    } else {
      el.style.background = 'rgba(16,185,129,0.12)';
      el.style.border = '1px solid rgba(16,185,129,0.3)';
      el.style.color = 'var(--green-400)';
    }
    el.innerHTML = msg;
  },

  clearAlert() {
    const el = document.getElementById('auth-alert');
    if (el) el.style.display = 'none';
  },

  // ── Forgot-password sub-view inside the auth card ──────
  showForgotView() {
    this.clearAlert();
    const form        = document.getElementById('auth-form');
    const tabs        = document.querySelector('.auth-tabs');
    const switchRow   = document.querySelector('.auth-switch');
    const syncWrap    = document.getElementById('auth-sync-wrap');
    const divider     = document.querySelector('.auth-divider');
    const googleBtn   = document.getElementById('btn-google-signin');

    // Hide irrelevant elements
    if (form)      form.style.display      = 'none';
    if (tabs)      tabs.style.display      = 'none';
    if (switchRow) switchRow.style.display = 'none';
    if (syncWrap)  syncWrap.style.display  = 'none';
    if (divider)   divider.style.display   = 'none';
    if (googleBtn) googleBtn.style.display = 'none';

    // Inject the forgot-password mini-form if not already present
    let fp = document.getElementById('forgot-pw-section');
    if (!fp) {
      fp = document.createElement('div');
      fp.id = 'forgot-pw-section';
      fp.innerHTML = `
        <div style="text-align:center;margin-bottom:14px">
          <div style="font-size:28px;margin-bottom:6px">🔑</div>
          <div style="font-weight:700;font-size:16px;color:var(--text-primary)">¿Olvidaste tu contraseña?</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Ingresa tu correo y te enviaremos un enlace para restablecerla.</div>
        </div>
        <div class="auth-field">
          <label class="auth-label">Correo Electrónico</label>
          <input type="email" class="auth-input" id="forgot-email" placeholder="tu@correo.com" required>
        </div>
        <div id="forgot-alert" style="display:none;padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:10px"></div>
        <button type="button" class="btn-auth-submit" id="btn-send-reset" style="width:100%">Enviar Enlace</button>
        <button type="button" id="btn-back-to-login" style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;text-decoration:underline;width:100%;margin-top:10px;text-align:center">← Volver al inicio de sesión</button>
      `;
      const card = document.querySelector('.auth-card');
      card.insertBefore(fp, document.querySelector('.auth-security'));

      // Send reset email
      document.getElementById('btn-send-reset').addEventListener('click', async () => {
        const email  = document.getElementById('forgot-email').value.trim();
        const alertEl = document.getElementById('forgot-alert');
        const btn    = document.getElementById('btn-send-reset');
        if (!email) { alertEl.style.display='block'; alertEl.textContent='Escribe tu correo.'; alertEl.style.color='var(--red-400)'; return; }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Enviando...';
        try {
          await Auth.sendPasswordResetEmail(email);
          alertEl.style.display  = 'block';
          alertEl.style.background = 'rgba(16,185,129,0.12)';
          alertEl.style.border    = '1px solid rgba(16,185,129,0.3)';
          alertEl.style.color     = 'var(--green-400)';
          alertEl.innerHTML = `✅ Enlace enviado a <strong>${email}</strong>. Revisa tu bandeja (y spam).`;
          btn.textContent = '¡Enviado!';
        } catch(err) {
          alertEl.style.display  = 'block';
          alertEl.style.background = 'rgba(239,68,68,0.12)';
          alertEl.style.border    = '1px solid rgba(239,68,68,0.3)';
          alertEl.style.color     = 'var(--red-400)';
          alertEl.textContent = 'Error: ' + (err.message || 'No se pudo enviar el enlace.');
          btn.disabled = false;
          btn.textContent = 'Enviar Enlace';
        }
      });

      // Back to login
      document.getElementById('btn-back-to-login').addEventListener('click', () => AuthModal.restoreLoginView());
    } else {
      fp.style.display = 'block';
      const alertEl = document.getElementById('forgot-alert');
      if (alertEl) alertEl.style.display = 'none';
      const sendBtn = document.getElementById('btn-send-reset');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Enviar Enlace'; }
    }
  },

  restoreLoginView() {
    const fp        = document.getElementById('forgot-pw-section');
    const form      = document.getElementById('auth-form');
    const tabs      = document.querySelector('.auth-tabs');
    const switchRow = document.querySelector('.auth-switch');
    const divider   = document.querySelector('.auth-divider');
    const googleBtn = document.getElementById('btn-google-signin');

    if (fp)        fp.style.display        = 'none';
    if (form)      form.style.display      = 'block';
    if (tabs)      tabs.style.display      = 'flex';
    if (switchRow) switchRow.style.display = 'block';
    if (divider)   divider.style.display   = 'flex';
    if (googleBtn) googleBtn.style.display = 'flex';
    this.setMode('login');
  },
};

// ── Password-recovery URL detector ─────────────
App._checkPasswordRecovery = function() {
  // Supabase appends #access_token=...&type=recovery to the redirect URL
  const hash = window.location.hash;
  if (hash && hash.includes('type=recovery')) {
    // Let supabase-js parse the session from the hash automatically (it does on init),
    // then open the new-password modal.
    setTimeout(() => {
      document.getElementById('reset-modal-overlay')?.classList.add('open');
      document.getElementById('reset-new-password')?.focus();
    }, 400);
  }
};

// Add bindAuth to App
App.bindAuth = function() {
  // Open auth overlay
  document.getElementById('btn-open-auth')?.addEventListener('click', () => AuthModal.open('login'));

  // Close
  document.getElementById('auth-modal-close')?.addEventListener('click', () => AuthModal.close());
  document.getElementById('auth-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) AuthModal.close();
  });

  // Tab switches
  document.getElementById('tab-auth-login')?.addEventListener('click',  () => AuthModal.setMode('login'));
  document.getElementById('tab-auth-signup')?.addEventListener('click', () => AuthModal.setMode('signup'));

  // Switch link (below form)
  document.getElementById('btn-auth-switch')?.addEventListener('click', () => {
    AuthModal.setMode(AuthModal.mode === 'login' ? 'signup' : 'login');
  });

  // Password toggle
  document.getElementById('btn-toggle-pass')?.addEventListener('click', () => {
    const inp = document.getElementById('auth-password');
    const btn = document.getElementById('btn-toggle-pass');
    if (inp) {
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? '\u{1F441}' : '\u{1F648}';
    }
  });

  // Google OAuth
  document.getElementById('btn-google-signin')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-google-signin');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="border-top-color:#1a1a2e"></span> Redirigiendo a Google...';
    try {
      await Auth.signInWithGoogle();
      // Page will redirect — no further action needed
    } catch (err) {
      AuthModal.showAlert('Error al conectar con Google: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.612 14.01 17.64 11.81 17.64 9.2z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg> Continuar con Google';
    }
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if (!confirm('Cerrar tu sesion?')) return;
    await Auth.signOut();
    await Storage.syncWithSupabase();
    Toast.show('Sesion cerrada correctamente', 'success');
    App.renderPage(App.currentPage);
  });

  // Sync local
  document.getElementById('btn-sync-local')?.addEventListener('click', async () => {
    if (!Auth.isLoggedIn()) {
      AuthModal.showAlert('Debes iniciar sesion primero.', 'error');
      return;
    }
    const btn = document.getElementById('btn-sync-local');
    btn.textContent = 'Sincronizando...';
    btn.disabled = true;
    const count = await Storage.syncLocalToCloud();
    btn.textContent = 'Sincronizado!';
    Toast.show(`Se sincronizaron ${count} operaciones a tu cuenta`, 'success');
    App.renderPage(App.currentPage);
  });

  // ── Forgot Password ─────────────────────────
  document.getElementById('btn-forgot-password')?.addEventListener('click', () => {
    AuthModal.showForgotView();
  });

  // ── Reset Password modal (after clicking email link) ──
  App._checkPasswordRecovery();

  // Reset password form submit
  document.getElementById('reset-password-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const newPass = document.getElementById('reset-new-password').value;
    const btn     = document.getElementById('btn-save-new-password');
    btn.disabled  = true;
    btn.innerHTML = '<span class="spinner"></span> Guardando...';
    try {
      await Auth.updatePassword(newPass);
      document.getElementById('reset-modal-overlay').classList.remove('open');
      Toast.show('✅ Contraseña actualizada correctamente. Ya puedes iniciar sesión.', 'success');
      // clean the hash so it doesn't re-trigger
      history.replaceState(null, '', window.location.pathname);
    } catch (err) {
      Toast.show('❌ Error: ' + (err.message || 'No se pudo actualizar la contraseña.'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Contraseña';
    }
  });

  // Email/Password form submit
  document.getElementById('auth-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email       = document.getElementById('auth-email').value.trim();
    const password    = document.getElementById('auth-password').value;
    const displayName = document.getElementById('auth-name')?.value.trim() || '';
    const submitBtn   = document.getElementById('btn-auth-submit');

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Procesando...';
    AuthModal.clearAlert();

    try {
      if (AuthModal.mode === 'signup') {
        const data = await Auth.signUp(email, password, displayName);
        if (data.session) {
          AuthModal.close();
          Toast.show('Cuenta creada. Bienvenido a CryptoNote!', 'success');
          const localCount = Storage.getLocalTransactions().length;
          if (localCount > 0) {
            await Storage.syncLocalToCloud();
            Toast.show(`Se subieron ${localCount} operaciones previas a tu cuenta.`, 'success');
          }
          await Storage.syncWithSupabase();
          App.renderPage(App.currentPage);
        } else {
          AuthModal.showAlert(
            'Cuenta creada. Revisa tu correo para confirmarla. (O desactiva "Confirm email" en Supabase para ingreso inmediato.)',
            'success'
          );
        }
      } else {
        const data = await Auth.signIn(email, password);
        AuthModal.close();
        const name = Auth.getDisplayName();
        Toast.show(`Hola de nuevo, ${name}!`, 'success');
        await Storage.syncWithSupabase();
        App.renderPage(App.currentPage);
      }
    } catch (err) {
      let msg = err.message || 'Error de autenticacion';
      if (msg.includes('Invalid login credentials')) msg = 'Correo o contrasena incorrectos.';
      if (msg.includes('already registered'))        msg = 'Este correo ya tiene cuenta. Intenta iniciar sesion.';
      if (msg.includes('Password should be'))        msg = 'La contrasena debe tener al menos 6 caracteres.';
      AuthModal.showAlert(msg, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = AuthModal.mode === 'signup' ? 'Crear Cuenta Gratis' : 'Iniciar Sesion';
    }
  });
};

// ── Bottom Navigation Bar ─────────────────────
App.bindBottomNav = function() {
  // Create sidebar backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.id = 'sidebar-backdrop';
  document.body.appendChild(backdrop);

  const closeSidebar = () => {
    document.querySelector('.sidebar')?.classList.remove('open');
    backdrop.classList.remove('open');
  };
  backdrop.addEventListener('click', closeSidebar);

  // Bottom nav page items
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      App.navigate(btn.dataset.page);
    });
  });

  // FAB — open new transaction modal
  document.getElementById('btn-add-tx-mob')?.addEventListener('click', () => {
    Modal.open();
  });

  // Account button — open auth modal or show logged-in state
  document.getElementById('btn-open-auth-mob')?.addEventListener('click', () => {
    if (Auth.isLoggedIn()) {
      // If logged in, confirm logout
      if (confirm(`Sesión de ${Auth.getDisplayName()}\n\n¿Cerrar sesión?`)) {
        Auth.signOut().then(() => {
          Storage.syncWithSupabase();
          Toast.show('Sesión cerrada.', 'success');
          App.renderPage(App.currentPage);
        });
      }
    } else {
      AuthModal.open('login');
    }
  });

  // Keep the account icon updated when auth state changes
  const origUpdateUI = Auth.updateUI?.bind(Auth);
  if (origUpdateUI) {
    Auth.updateUI = function() {
      origUpdateUI();
      const mobAccountBtn = document.getElementById('btn-open-auth-mob');
      if (mobAccountBtn) {
        const icon  = mobAccountBtn.querySelector('.bottom-nav-icon');
        const label = mobAccountBtn.querySelector('.bottom-nav-label');
        if (Auth.currentUser) {
          if (icon)  icon.textContent  = '✅';
          if (label) label.textContent = 'Cuenta';
        } else {
          if (icon)  icon.textContent  = '👤';
          if (label) label.textContent = 'Cuenta';
        }
      }
    };
  }
};

// ── PWA Install Banner ────────────────────────
App.initPWA = function() {
  let deferredPrompt = null;

  // Inject banner HTML once
  const banner = document.createElement('div');
  banner.className = 'pwa-install-banner';
  banner.id = 'pwa-install-banner';
  banner.innerHTML = `
    <div class="pwa-install-banner-text">
      📲 Instalar CryptoNote
      <small>Agrega la app a tu pantalla de inicio para acceso offline.</small>
    </div>
    <button class="pwa-install-btn" id="pwa-install-btn">Instalar</button>
    <button class="pwa-install-dismiss" id="pwa-install-dismiss" title="Cerrar">✕</button>
  `;
  document.body.appendChild(banner);

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    // Only show if not already dismissed
    if (!localStorage.getItem('pwa_banner_dismissed')) {
      setTimeout(() => banner.classList.add('show'), 2000);
    }
  });

  document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      Toast.show('✅ ¡CryptoNote instalada!', 'success');
    }
    deferredPrompt = null;
    banner.classList.remove('show');
  });

  document.getElementById('pwa-install-dismiss')?.addEventListener('click', () => {
    banner.classList.remove('show');
    localStorage.setItem('pwa_banner_dismissed', '1');
  });

  // Hide banner once installed
  window.addEventListener('appinstalled', () => {
    banner.classList.remove('show');
    Toast.show('✅ CryptoNote instalada en tu dispositivo.', 'success');
  });
};

// ── Boot ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());



