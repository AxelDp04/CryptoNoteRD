// ============================================
// CRYPTONOTE — Storage Manager
// Handles Supabase DB Sync + Local Fallback
// ============================================

const Storage = {
  KEYS: {
    TRANSACTIONS: 'cn_transactions',
    SETTINGS: 'cn_settings',
  },

  cache: null,

  // Load from local storage
  getLocalTransactions() {
    try {
      return JSON.parse(localStorage.getItem(this.KEYS.TRANSACTIONS) || '[]');
    } catch { return []; }
  },

  saveLocalTransactions(txs) {
    localStorage.setItem(this.KEYS.TRANSACTIONS, JSON.stringify(txs));
  },

  // Returns current active transactions list
  getTransactions() {
    if (this.cache !== null) {
      return this.cache;
    }
    return this.getLocalTransactions();
  },

  // Sync and fetch from Supabase if logged in
  async syncWithSupabase() {
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn() && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('transactions')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          // Normalize column names from SQL to JS
          this.cache = data.map(row => ({
            id: row.id,
            type: row.type,
            coinId: row.coin_id,
            name: row.name,
            symbol: row.symbol,
            quantity: parseFloat(row.quantity),
            price: parseFloat(row.price),
            bank: row.bank || '',
            commission: parseFloat(row.commission || 0),
            date: row.date,
            note: row.note || '',
            createdAt: row.created_at,
          }));

          // Also keep local backup
          this.saveLocalTransactions(this.cache);
          return this.cache;
        }
      } catch (err) {
        console.warn('Error fetching from Supabase, using local data:', err);
      }
    }
    this.cache = this.getLocalTransactions();
    return this.cache;
  },

  async addTransaction(tx) {
    tx.createdAt = new Date().toISOString();

    // If logged into Supabase, save directly to cloud DB
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn() && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('transactions')
          .insert({
            user_id: Auth.currentUser.id,
            type: tx.type,
            coin_id: tx.coinId,
            name: tx.name,
            symbol: tx.symbol.toUpperCase(),
            quantity: tx.quantity,
            price: tx.price,
            bank: tx.bank,
            commission: tx.commission || 0,
            date: tx.date || new Date().toISOString().split('T')[0],
            note: tx.note || null,
          })
          .select();

        if (error) {
          console.error('Supabase insert error:', error);
          throw error;
        }

        if (data && data[0]) {
          tx.id = data[0].id;
          tx.createdAt = data[0].created_at;
        }
      } catch (e) {
        console.error('Failed to insert into Supabase:', e);
        throw e;
      }
    } else {
      // Local fallback ID
      tx.id = Date.now() + Math.random().toString(36).substr(2, 5);
    }

    const txs = this.getTransactions();
    txs.unshift(tx);
    this.cache = txs;
    this.saveLocalTransactions(txs);
    return tx;
  },

  async deleteTransaction(id) {
    // If logged in, delete from cloud DB
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn() && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        const { error } = await supabaseClient
          .from('transactions')
          .delete()
          .eq('id', id);

        if (error) {
          console.error('Supabase delete error:', error);
          throw error;
        }
      } catch (e) {
        console.error('Failed to delete from Supabase:', e);
      }
    }

    const txs = this.getTransactions().filter(t => t.id !== id);
    this.cache = txs;
    this.saveLocalTransactions(txs);
    return txs;
  },

  // Migrate local transactions to Supabase account
  async syncLocalToCloud() {
    if (!Auth.isLoggedIn() || !supabaseClient) return 0;
    const local = this.getLocalTransactions();
    if (local.length === 0) return 0;

    let syncedCount = 0;
    for (const tx of local) {
      try {
        await supabaseClient.from('transactions').insert({
          user_id: Auth.currentUser.id,
          type: tx.type,
          coin_id: tx.coinId,
          name: tx.name,
          symbol: tx.symbol.toUpperCase(),
          quantity: tx.quantity,
          price: tx.price,
          bank: tx.bank,
          commission: tx.commission || 0,
          date: tx.date || new Date().toISOString().split('T')[0],
          note: tx.note || null,
        });
        syncedCount++;
      } catch (err) {
        console.warn('Sync item error:', err);
      }
    }
    await this.syncWithSupabase();
    return syncedCount;
  },

  // Returns aggregated holdings per coin from all transactions
  getHoldings() {
    const txs = this.getTransactions();
    const holdings = {};

    txs.forEach(tx => {
      const sym = tx.symbol.toUpperCase();
      if (!holdings[sym]) {
        holdings[sym] = {
          symbol: sym,
          name: tx.name,
          quantity: 0,
          totalInvested: 0,
          totalSold: 0,
          avgBuyPrice: 0,
          transactions: 0,
          coinId: tx.coinId || null,
        };
      }

      const h = holdings[sym];
      if (tx.type === 'buy') {
        h.totalInvested += (tx.quantity * tx.price) + (tx.commission || 0);
        h.quantity += tx.quantity;
      } else if (tx.type === 'sell') {
        h.quantity -= tx.quantity;
        h.totalSold += (tx.quantity * tx.price) - (tx.commission || 0);
      }
      h.transactions++;
    });

    // Calculate avg buy price
    Object.values(holdings).forEach(h => {
      const buys = txs.filter(t => t.symbol.toUpperCase() === h.symbol && t.type === 'buy');
      const totalQtyBought = buys.reduce((acc, t) => acc + t.quantity, 0);
      const totalPaidBought = buys.reduce((acc, t) => acc + (t.quantity * t.price) + (t.commission || 0), 0);
      h.avgBuyPrice = totalQtyBought > 0 ? totalPaidBought / totalQtyBought : 0;
      h.costBasis = h.quantity * h.avgBuyPrice;
    });

    // Filter out zero or negative holdings
    return Object.values(holdings).filter(h => h.quantity > 0.000001);
  },
};
