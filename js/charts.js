// ============================================
// CRYPTONOTE — Charts Manager (Chart.js)
// ============================================

const Charts = {
  portfolioChart: null,
  pieChart: null,

  COLORS: [
    '#2563EB','#10B981','#8B5CF6','#F59E0B','#EF4444',
    '#06B6D4','#EC4899','#84CC16','#F97316','#6366F1',
  ],

  initPortfolioChart(ctx) {
    if (this.portfolioChart) this.portfolioChart.destroy();
    this.portfolioChart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{
        label: 'Valor del Portafolio',
        data: [],
        borderColor: '#2563EB',
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return 'transparent';
          const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(37,99,235,0.25)');
          gradient.addColorStop(1, 'rgba(37,99,235,0.0)');
          return gradient;
        },
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#2563EB',
        pointBorderColor: '#0F172A',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.4,
      }]},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E293B',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#94A3B8',
            bodyColor: '#F1F5F9',
            padding: 12,
            callbacks: {
              label: ctx => ' ' + API.formatFiat(ctx.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: { color: '#64748B', font: { size: 11, family: 'Inter' }, maxTicksLimit: 7 },
            border: { display: false },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
            ticks: {
              color: '#64748B',
              font: { size: 11, family: 'Inter' },
              callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0)),
            },
            border: { display: false },
          },
        },
      },
    });
  },

  updatePortfolioChart(holdings, prices) {
    if (!this.portfolioChart) return;
    // Build simulated 30-day history from cost basis to current value
    const totalCurrent = holdings.reduce((acc, h) => {
      const p = prices[h.coinId]?.usd || h.avgBuyPrice;
      return acc + (h.quantity * p);
    }, 0);
    const totalCost = holdings.reduce((acc, h) => acc + h.costBasis, 0);

    const labels = [];
    const values = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(d.toLocaleDateString('es', { month: 'short', day: 'numeric' }));
      // Interpolate + small noise for visual interest
      const t = (29 - i) / 29;
      const noise = (Math.random() - 0.45) * 0.04;
      const v = totalCost + (totalCurrent - totalCost) * t + totalCurrent * noise;
      values.push(Math.max(0, v));
    }
    values[29] = totalCurrent;

    this.portfolioChart.data.labels = labels;
    this.portfolioChart.data.datasets[0].data = values;
    this.portfolioChart.update('active');
  },

  initPieChart(ctx) {
    if (this.pieChart) this.pieChart.destroy();
    this.pieChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: [], datasets: [{ data: [], backgroundColor: this.COLORS, borderColor: '#0F172A', borderWidth: 3, hoverOffset: 6 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E293B',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#94A3B8',
            bodyColor: '#F1F5F9',
            padding: 12,
            callbacks: {
              label: ctx => ' ' + API.formatFiat(ctx.parsed) + ' (' + ctx.label + ')',
            },
          },
        },
      },
    });
  },

  updatePieChart(holdings, prices) {
    if (!this.pieChart) return;
    const labels = [];
    const values = [];
    const colors = [];

    holdings.forEach((h, i) => {
      const p = prices[h.coinId]?.usd || h.avgBuyPrice;
      const v = h.quantity * p;
      if (v > 0) {
        labels.push(h.symbol);
        values.push(v);
        colors.push(this.COLORS[i % this.COLORS.length]);
      }
    });

    this.pieChart.data.labels = labels;
    this.pieChart.data.datasets[0].data = values;
    this.pieChart.data.datasets[0].backgroundColor = colors;
    this.pieChart.update('active');

    return { labels, values, colors };
  },
};
