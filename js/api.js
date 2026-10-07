// ============================================
// CRYPTONOTE — API Manager (CoinGecko)
// Fetches live prices for crypto assets
// ============================================

const API = {
  BASE: 'https://api.coingecko.com/api/v3',
  cache: {},
  cacheTime: 60000, // 60s cache

  // Search coins by name/symbol
  async searchCoins(query) {
    if (!query || query.length < 1) return [];
    try {
      const res = await fetch(`${this.BASE}/search?query=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      return (data.coins || []).slice(0, 8).map(c => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol.toUpperCase(),
        thumb: c.thumb,
      }));
    } catch (e) {
      console.warn('Search error:', e);
      return [];
    }
  },

  // Get prices for a list of coin IDs
  async getPrices(coinIds) {
    if (!coinIds || coinIds.length === 0) return {};
    const key = coinIds.sort().join(',');
    const now = Date.now();
    if (this.cache[key] && (now - this.cache[key].ts) < this.cacheTime) {
      return this.cache[key].data;
    }
    try {
      const ids = coinIds.join(',');
      const res = await fetch(
        `${this.BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
      );
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      this.cache[key] = { ts: now, data };
      return data;
    } catch (e) {
      console.warn('Price fetch error:', e);
      return {};
    }
  },

  // Get coin info (for icon URL)
  async getCoinInfo(coinId) {
    const key = 'info_' + coinId;
    const now = Date.now();
    if (this.cache[key] && (now - this.cache[key].ts) < 300000) {
      return this.cache[key].data;
    }
    try {
      const res = await fetch(`${this.BASE}/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const info = {
        id: data.id,
        name: data.name,
        symbol: data.symbol.toUpperCase(),
        image: data.image?.small || null,
      };
      this.cache[key] = { ts: now, data: info };
      return info;
    } catch (e) {
      return null;
    }
  },

  // Format Fiat (DOP)
  formatFiat(val, compact = false) {
    if (val === null || val === undefined || isNaN(val)) return 'RD$—';
    if (compact && Math.abs(val) >= 1000) {
      return 'RD$' + Intl.NumberFormat('es-DO', { notation: 'compact', maximumFractionDigits: 2 }).format(val);
    }
    const fmt = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(val) < 1 ? 6 : 2 }).format(val);
    return 'RD$' + fmt;
  },

  formatPct(val) {
    if (val === null || val === undefined || isNaN(val)) return '—';
    const sign = val >= 0 ? '+' : '';
    return sign + val.toFixed(2) + '%';
  },
};
