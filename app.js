/* ============================================================
   GREKO EGYPT – YTD SALES DASHBOARD  •  app.js  (v4)
   Single global state, server-side data, full DAX pipeline.
   ============================================================ */
'use strict';

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
const STATE = {
  measure:  'ton',                    // 'ton' | 'carton' | 'cups'
  period:   'ytd',                    // 'ytd' | 'q1' | 'q2' | 'jan' … 'jun'
  months:   [1,2,3,4,5,6],           // active months array (drives API call)
  page:     'home',
  data:     null,                     // window.GREKO_DATA – set after fetch
  loading:  false,
  chFilter: null,                     // channel filter for Channel page
  chTab:    'sales',                  // 'sales' | 'returns' | 'customers'
};

const PERIOD_MONTHS = {
  ytd: [1,2,3,4,5,6],
  q1:  [1,2,3],
  q2:  [4,5,6],
  jan: [1], feb: [2], mar: [3], apr: [4], may: [5], jun: [6],
};

// ═══════════════════════════════════════════════════════════════
// CHART.JS SETUP
// ═══════════════════════════════════════════════════════════════
Chart.register(ChartDataLabels);
Chart.defaults.color           = '#8899bb';
Chart.defaults.borderColor     = 'rgba(255,255,255,0.05)';
Chart.defaults.font.family     = 'Inter, sans-serif';
Chart.defaults.plugins.legend.labels.usePointStyle  = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
Chart.defaults.plugins.datalabels.display   = true;
Chart.defaults.plugins.datalabels.color     = '#fff';
Chart.defaults.plugins.datalabels.font      = { size: 10, weight: '600' };
Chart.defaults.plugins.datalabels.formatter = v => (!v || Math.abs(v) < 0.001) ? '' :
  v.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const _charts = {};
function mkChart(id, cfg) {
  _charts[id]?.destroy();
  const el = document.getElementById(id);
  if (!el) return null;
  return (_charts[id] = new Chart(el, cfg));
}

const C = {
  blue: '#003087', blueL: '#0052CC', cyan: '#00B4D8', teal: '#0077B6',
  green: '#06D6A0', red: '#EF476F', gold: '#F4A261', orange: '#FFB703',
  purple: '#7B2D8B', gray: '#8899bb',
};
const CAT_COLORS = {
  'Plain': C.blueL, 'Tart & Fruit': C.green, 'Yopolis PRO': C.cyan,
  'Labneh': C.gold, 'Double Zero': C.purple, 'Greko': C.teal,
  'Cream Cheese': C.orange, 'Creams': C.red, 'Yopo Flip': '#3AE8FF',
  'Dips': '#A78BFA', 'Bucket': '#34D399', 'Delights': '#F472B6',
};
const catColor = c => CAT_COLORS[c] || C.gray;

// ═══════════════════════════════════════════════════════════════
// FORMATTERS  (single source of truth)
// ═══════════════════════════════════════════════════════════════
const fmt  = n => n == null || isNaN(n) ? '–' :
  n.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtP = n => n == null || isNaN(n) ? '–' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
const trunc = (s, n = 22) => !s ? '' : s.length > n ? s.slice(0, n) + '…' : s;

// ═══════════════════════════════════════════════════════════════
// CALCULATION HELPERS  (single engine – mirrors DAX)
// ═══════════════════════════════════════════════════════════════
const grow = (v26, v25) => v25 > 0 ? ((v26 - v25) / v25 * 100) : (v26 > 0 ? 100 : 0);
const ach  = (v, t)    => t > 0   ? (v / t * 100)             : 0;
const retP = (s, r)    => (s + r) > 0 ? (r / (s + r) * 100)  : 0;
const hasTgt = t       => t != null && t > 0;

// ═══════════════════════════════════════════════════════════════
// CHART OPTIONS
// ═══════════════════════════════════════════════════════════════
const barOpts = (iH = false) => ({
  indexAxis: iH ? 'y' : 'x',
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.05)', display: !iH }, ticks: { font: { size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,0.05)', display:  iH }, ticks: { font: { size: 10 } } },
  },
});
const lineOpts = () => ({
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' } },
  scales: {
    x: { grid: { display: false } },
    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { font: { size: 10 } } },
  },
});

// ═══════════════════════════════════════════════════════════════
// UI COMPONENT HELPERS
// ═══════════════════════════════════════════════════════════════
function kpi(icon, label, value, change, accent, sub = '') {
  const chg = change != null
    ? `<span class="kpi-change ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%</span>`
    : '';
  return `<div class="kpi-card ${accent}">
    <span class="kpi-icon">${icon}</span>
    <div class="kpi-value">${value}</div>
    <div class="kpi-label">${label}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    ${chg}
  </div>`;
}

function card(title, sub, inner) {
  return `<div class="chart-card"><div class="chart-header"><div>
    <div class="chart-title">${title}</div>
    ${sub ? `<div class="chart-subtitle">${sub}</div>` : ''}
  </div></div>${inner}</div>`;
}

function cw(id, h = '280') {
  return `<div class="chart-container" style="height:${h}px"><canvas id="${id}"></canvas></div>`;
}

function badge(txt, cls) { return `<span class="badge ${cls}">${txt}</span>`; }

function achBadge(a) {
  return a == null ? badge('N/A', 'badge-gray')
    : badge(a.toFixed(1) + '%', a >= 90 ? 'badge-up' : a >= 70 ? 'badge-warn' : 'badge-down');
}

function progBar(label, pct, val, color) {
  return `<div class="progress-bar-wrap">
    <div class="progress-bar-header">
      <span class="progress-bar-label">${label}</span>
      <span class="progress-bar-val">${val}</span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" style="width:${Math.min(Math.max(pct, 0), 100)}%;background:${color}"></div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// SORTING
// ═══════════════════════════════════════════════════════════════
let currentSort = { field: 's26', desc: true };

function sortData(arr) {
  const m = STATE.measure;
  return [...arr].sort((a, b) => {
    let va, vb;
    switch (currentSort.field) {
      case 'name': va = a.name || a.product || a.category || a.customer || a.channel || ''; vb = b.name || b.product || b.category || b.customer || b.channel || ''; break;
      case 's25':  va = a[m].s25;  vb = b[m].s25;  break;
      case 's26':  va = a[m].s26;  vb = b[m].s26;  break;
      case 'r26':  va = a[m].r26;  vb = b[m].r26;  break;
      case 'grow': va = grow(a[m].s26, a[m].s25); vb = grow(b[m].s26, b[m].s25); break;
      case 'retP': va = retP(a[m].s26, a[m].r26); vb = retP(b[m].s26, b[m].r26); break;
      case 'ach26':va = hasTgt(a[m].tgt26) ? ach(a[m].s26, a[m].tgt26) : -1;
                   vb = hasTgt(b[m].tgt26) ? ach(b[m].s26, b[m].tgt26) : -1; break;
      default:     va = a[m]?.[currentSort.field] ?? 0; vb = b[m]?.[currentSort.field] ?? 0;
    }
    if (typeof va === 'string') return currentSort.desc ? vb.localeCompare(va) : va.localeCompare(vb);
    return currentSort.desc ? (vb || 0) - (va || 0) : (va || 0) - (vb || 0);
  });
}

function thSort(label, field) {
  const active = currentSort.field === field;
  const arrow  = active ? (currentSort.desc ? ' ↓' : ' ↑') : ' ⇅';
  return `<th data-sort="${field}" style="cursor:pointer;user-select:none">${label}<span style="opacity:0.4;font-size:10px">${arrow}</span></th>`;
}

function attachSort() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (currentSort.field === f) currentSort.desc = !currentSort.desc;
      else { currentSort.field = f; currentSort.desc = true; }
      renderPage();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════════════════════════
async function fetchData(months) {
  setLoaderText('Loading data from server…');
  const url = `/api/data?months=${months.join(',')}`;
  const res  = await fetch(url);
  if (!res.ok) {
    let rawText = '';
    try {
      rawText = await res.text();
      const errBody = JSON.parse(rawText);
      throw new Error(JSON.stringify(errBody, null, 2));
    } catch(e) {
      if (e.message.startsWith('{')) throw e;
      throw new Error(`API ${res.status} ${res.statusText} \nRaw Response: ${rawText.substring(0,200)}`);
    }
  }
  const data = await res.json();
  if (data.success === false) {
    throw new Error(JSON.stringify(data, null, 2));
  }
  return data;
}

// ═══════════════════════════════════════════════════════════════
// PAGE ROUTING
// ═══════════════════════════════════════════════════════════════
const PAGE_TITLES = {
  home:      'YTD Greko Egypt Dashboard',
  ytd:       'YTD Performance',
  products:  'Product Analysis',
  customers: 'Customer Analysis',
  channels:  'Channel Analysis',
  returns:   'Returns Analysis',
  growth:    'Growth Analysis',
  monthly:   'Monthly Trend',
  quarterly: 'Quarterly Dashboard',
};

function go(page) {
  if (!PAGE_TITLES[page]) return;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
  document.getElementById('page-title').textContent = PAGE_TITLES[page];
  STATE.page = page;
  if (STATE.data) renderPage();
  document.getElementById('sidebar').classList.remove('open');
}

function renderPage() {
  const D = STATE.data;
  if (!D) return;
  currentSort = { field: 's26', desc: true }; // reset sort on page change
  switch (STATE.page) {
    case 'home':      pgHome(D);      break;
    case 'ytd':       pgYTD(D);       break;
    case 'products':  pgProducts(D);  break;
    case 'customers': pgCustomers(D); break;
    case 'channels':  pgChannels(D);  break;
    case 'returns':   pgReturns(D);   break;
    case 'growth':    pgGrowth(D);    break;
    case 'monthly':   pgMonthly(D);   break;
    case 'quarterly': pgQuarterly(D); break;
  }
  attachSort();
}

// ═══════════════════════════════════════════════════════════════
// HOME  (Executive + Year Comparison merged)
// ═══════════════════════════════════════════════════════════════
function pgHome(D) {
  const m  = D.meta;
  const M  = STATE.measure;
  const mm = m[M];

  const g    = grow(mm.s26, mm.s25);
  const a26  = hasTgt(mm.tgt26) ? ach(mm.s26, mm.tgt26) : null;
  const a25  = hasTgt(mm.tgt25) ? ach(mm.s25, mm.tgt25) : null;
  const rp26 = retP(mm.s26, mm.r26);
  const rp25 = retP(mm.s25, mm.r25);

  // Sales variance (Year-over-Year)
  const variance     = mm.s26 - mm.s25;
  const retVariance  = mm.r26 - mm.r25;

  const cats = [...D.category_data].filter(c => c[M].s26 > 0 || c[M].s25 > 0)
                                    .sort((a, b) => b[M].s26 - a[M].s26);

  document.getElementById('page-home').innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      ${kpi('💰', `Sales 2026`, fmt(mm.s26), null, 'cyan', `Target: ${hasTgt(mm.tgt26) ? fmt(mm.tgt26) : 'N/A'}`)}
      ${kpi('📅', `Sales 2025`, fmt(mm.s25), null, 'blue', `Target: ${hasTgt(mm.tgt25) ? fmt(mm.tgt25) : 'N/A'}`)}
      ${kpi('📈', 'Growth %', fmtP(g), g, 'green', `Δ ${fmt(variance)}`)}
      ${kpi('🎯', 'Achievement 26', a26 != null ? a26.toFixed(1) + '%' : 'N/A', a26 != null ? a26 - 100 : null, 'cyan', `2025: ${a25 != null ? a25.toFixed(1) + '%' : 'N/A'}`)}
      ${kpi('↩️', 'Returns 26', fmt(mm.r26), null, 'red', `2025: ${fmt(mm.r25)}`)}
      ${kpi('📉', 'Return Rate 26', rp26.toFixed(1) + '%', -(rp26 - rp25), 'red', `Was: ${rp25.toFixed(1)}%`)}
    </div>

    <!-- Year Comparison KPIs -->
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-top:16px">
      ${kpi('⚖️', 'Sales Variance', fmt(variance), g, 'cyan', '2026 vs 2025')}
      ${kpi('👥', 'Customers 26', m.customers_26.toString(), m.customers_26 - m.customers_25, 'blue', `Was: ${m.customers_25}`)}
      ${kpi('🔄', 'Partial Returns 26', fmt(mm.partial26), null, 'gold', `2025: ${fmt(mm.partial25)}`)}
      ${kpi('↩️', 'Return Δ', fmt(retVariance), retVariance <= 0 ? 10 : -10, 'red', '2026 - 2025')}
    </div>

    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📊 Sales by Category', 'Contribution 2026', cw('ch-h-cat', '300'))}
      ${card('📅 Monthly Sales Trend', '2025 vs 2026', cw('ch-h-mon', '300'))}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📈 Category Growth', '2025 vs 2026', cw('ch-h-catgrow', '280'))}
      ${card('🎯 Achievement by Category', 'Ach % 2026', cw('ch-h-ach', '280'))}
    </div>
    <div class="chart-grid cols-1" style="margin-top:20px">
      ${card('📊 Cumulative Sales', 'YTD Accumulation', cw('ch-h-cum', '300'))}
    </div>
  `;

  setTimeout(() => {
    // Doughnut
    mkChart('ch-h-cat', { type: 'doughnut',
      data: { labels: cats.map(c => c.category),
        datasets: [{ data: cats.map(c => c[M].s26), backgroundColor: cats.map(c => catColor(c.category)), borderWidth: 1, borderColor: '#0a1628' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
    });

    // Monthly trend
    const md = [...D.monthly_data].filter(x => STATE.months.includes(x.month_id)).sort((a, b) => a.month_id - b.month_id);
    mkChart('ch-h-mon', { type: 'line',
      data: { labels: md.map(x => x.month_short),
        datasets: [
          { label: '2025', data: md.map(x => x[M].s25), borderColor: C.blueL, borderWidth: 2, fill: false, pointRadius: 4 },
          { label: '2026', data: md.map(x => x[M].s26), borderColor: C.cyan,  borderWidth: 2.5, fill: false, pointRadius: 4 },
          { label: 'Target 26', data: md.map(x => x[M].tgt26), borderColor: C.gold, borderDash: [4, 4], borderWidth: 1.5, fill: false, pointRadius: 0, datalabels: { display: false } },
        ] },
      options: lineOpts(),
    });

    // Category growth
    mkChart('ch-h-catgrow', { type: 'bar',
      data: { labels: cats.map(c => c.category),
        datasets: [
          { label: '2025', data: cats.map(c => c[M].s25), backgroundColor: C.blueL + 'BB', borderRadius: 3 },
          { label: '2026', data: cats.map(c => c[M].s26), backgroundColor: cats.map(c => catColor(c.category) + 'BB'), borderRadius: 3 },
        ] },
      options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
    });

    // Achievement
    mkChart('ch-h-ach', { type: 'bar',
      data: { labels: cats.map(c => c.category),
        datasets: [{ data: cats.map(c => hasTgt(c[M].tgt26) ? ach(c[M].s26, c[M].tgt26) : null),
          backgroundColor: cats.map(c => {
            if (!hasTgt(c[M].tgt26)) return C.gray + '66';
            const a = ach(c[M].s26, c[M].tgt26);
            return a >= 90 ? C.green + 'CC' : a >= 70 ? C.gold + 'CC' : C.red + 'CC';
          }),
          borderRadius: 4,
          datalabels: { formatter: v => v != null ? v.toFixed(1) + '%' : 'N/A' },
        }] },
      options: barOpts(),
    });

    // Cumulative
    const mdAll = [...D.monthly_data].filter(x => STATE.months.includes(x.month_id)).sort((a, b) => a.month_id - b.month_id);
    let c25 = 0, c26 = 0;
    mkChart('ch-h-cum', { type: 'line',
      data: { labels: mdAll.map(x => x.month_short),
        datasets: [
          { label: '2025 Cumulative', data: mdAll.map(x => (c25 += x[M].s25, c25)), borderColor: C.blueL, backgroundColor: C.blueL + '11', fill: true, borderWidth: 2 },
          { label: '2026 Cumulative', data: mdAll.map(x => (c26 += x[M].s26, c26)), borderColor: C.cyan,  backgroundColor: C.cyan  + '11', fill: true, borderWidth: 2.5 },
        ] },
      options: lineOpts(),
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// YTD PERFORMANCE
// ═══════════════════════════════════════════════════════════════
function pgYTD(D) {
  const M = STATE.measure;
  const items = sortData(D.product_data.map(p => ({ ...p, name: p.product })));

  document.getElementById('page-ytd').innerHTML = `
    <div class="chart-card">
      <div class="chart-header"><div class="chart-title">📋 Full YTD Product Matrix</div></div>
      <div class="data-table-wrapper" style="max-height:500px;overflow-y:auto">
        <table class="data-table">
          <thead><tr>
            <th>#</th>
            ${thSort('Product', 'name')}
            <th>Category</th>
            ${thSort('Sales 25', 's25')}
            ${thSort('Sales 26', 's26')}
            ${thSort('Growth', 'grow')}
            ${thSort('Target 26', 'tgt26')}
            ${thSort('Ach%', 'ach26')}
            ${thSort('Ret% 26', 'retP')}
          </tr></thead>
          <tbody>
            ${items.filter(p => p[M].s25 > 0 || p[M].s26 > 0).map((p, i) => {
              const s25 = p[M].s25, s26 = p[M].s26, t26 = p[M].tgt26, r26 = p[M].r26;
              const g = grow(s26, s25);
              const a = hasTgt(t26) ? ach(s26, t26) : null;
              const r = retP(s26, r26);
              return `<tr>
                <td>${i + 1}</td>
                <td>${p.product}</td>
                <td style="color:${catColor(p.category)}">${p.category}</td>
                <td class="num">${fmt(s25)}</td>
                <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
                <td class="num">${badge(fmtP(g), g >= 0 ? 'badge-up' : 'badge-down')}</td>
                <td class="num">${hasTgt(t26) ? fmt(t26) : '–'}</td>
                <td class="num">${achBadge(a)}</td>
                <td class="num" style="color:${r > 10 ? C.red : r > 5 ? C.gold : C.green}">${r.toFixed(1)}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════
function pgProducts(D) {
  const M     = STATE.measure;
  const prods = sortData(D.product_data.filter(p => p[M].s26 > 0 || p[M].s25 > 0));
  const top10 = prods.slice(0, 10);
  const bot10 = [...prods].filter(p => p[M].s25 > 0).sort((a, b) => grow(a[M].s26, a[M].s25) - grow(b[M].s26, b[M].s25)).slice(0, 10);
  const cg    = [...D.category_data].sort((a, b) => b[M].s26 - a[M].s26);

  document.getElementById('page-products').innerHTML = `
    <div class="chart-grid cols-2">
      ${card('🏆 Top 10 Products 2026', 'By absolute sales', cw('ch-p-top', '300'))}
      ${card('📉 Bottom 10 Products', 'By growth %', cw('ch-p-bot', '300'))}
    </div>
    <div class="chart-grid cols-1" style="margin-top:20px">
      ${card('📊 Category Performance', 'Sales & Achievement 2026', cw('ch-p-catsum', '300'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">📋 Category Summary</div></div>
      <table class="data-table">
        <thead><tr>
          ${thSort('Category', 'name')}
          ${thSort('Sales 25', 's25')}
          ${thSort('Sales 26', 's26')}
          ${thSort('Growth', 'grow')}
          ${thSort('Target 26', 'tgt26')}
          ${thSort('Achievement', 'ach26')}
          ${thSort('Return 26', 'r26')}
        </tr></thead>
        <tbody>${sortData(D.category_data.map(c => ({ ...c, name: c.category }))).map(c => {
          const s25 = c[M].s25, s26 = c[M].s26, t26 = c[M].tgt26, r26 = c[M].r26;
          const g = grow(s26, s25);
          const a = hasTgt(t26) ? ach(s26, t26) : null;
          return `<tr>
            <td style="color:${catColor(c.category)}"><strong>${c.category}</strong></td>
            <td class="num">${fmt(s25)}</td>
            <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
            <td class="num">${badge(fmtP(g), g >= 0 ? 'badge-up' : 'badge-down')}</td>
            <td class="num">${hasTgt(t26) ? fmt(t26) : '–'}</td>
            <td class="num">${achBadge(a)}</td>
            <td class="num" style="color:${C.red}">${fmt(r26)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(() => {
    mkChart('ch-p-top', { type: 'bar',
      data: { labels: top10.map(p => trunc(p.product, 20)), datasets: [{ data: top10.map(p => p[M].s26), backgroundColor: C.cyan + 'BB', borderRadius: 4 }] },
      options: barOpts(true),
    });
    mkChart('ch-p-bot', { type: 'bar',
      data: { labels: bot10.map(p => trunc(p.product, 20)), datasets: [{ data: bot10.map(p => grow(p[M].s26, p[M].s25)), backgroundColor: C.red + 'BB', borderRadius: 4, datalabels: { formatter: v => fmtP(v) } }] },
      options: barOpts(true),
    });
    mkChart('ch-p-catsum', { type: 'bar',
      data: { labels: cg.map(c => c.category),
        datasets: [
          { label: '2025', data: cg.map(c => c[M].s25), backgroundColor: C.blueL + 'AA', borderRadius: 3 },
          { label: '2026', data: cg.map(c => c[M].s26), backgroundColor: cg.map(c => catColor(c.category) + 'CC'), borderRadius: 3 },
        ] },
      options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════════
function pgCustomers(D) {
  const M  = STATE.measure;
  const cs = sortData(D.customer_data.filter(c => c[M].s26 > 0 && c.in_25));
  const gold   = cs.slice(0, 10);
  const silver = cs.slice(10, Math.floor(10 + cs.length * 0.3));
  const bronze = cs.slice(10 + silver.length);
  const lost   = sortData(D.customer_data.filter(c => c[M].s25 > 0 && c[M].s26 === 0));

  // Top 10 by Return Ton (sorted descending by r26)
  const topRet = [...D.customer_data].filter(c => c[M].r26 > 0)
                                     .sort((a, b) => b[M].r26 - a[M].r26)
                                     .slice(0, 10);

  document.getElementById('page-customers').innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('🥇', 'Gold (Top 10)', '10', null, 'gold', 'Best returning customers')}
      ${kpi('🥈', 'Silver', silver.length.toString(), null, 'cyan', 'Next 30%')}
      ${kpi('🥉', 'Bronze', bronze.length.toString(), null, 'blue', 'Remaining returning')}
      ${kpi('❌', 'Lost Customers', lost.length.toString(), null, 'red', 'Purchased 25, zero 26')}
    </div>
    <div class="chart-grid cols-2">
      ${card('🏆 Top 10 Customers (Gold)', 'By sales 2026', cw('ch-c-top', '300'))}
      ${card('↩️ Top 10 by Return Ton', 'Sorted by Return Ton ↓', cw('ch-c-ret', '300'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">📋 Customer Detail Table</div></div>
      <div class="data-table-wrapper" style="max-height:400px;overflow-y:auto">
        <table class="data-table">
          <thead><tr>
            <th>#</th>
            ${thSort('Customer', 'name')}
            <th>Channel</th>
            ${thSort('Sales 25', 's25')}
            ${thSort('Sales 26', 's26')}
            ${thSort('Growth', 'grow')}
            ${thSort('Return 26', 'r26')}
            ${thSort('Ret%', 'retP')}
          </tr></thead>
          <tbody>${sortData(cs.map(c => ({ ...c, name: c.customer }))).map((c, i) => {
            const s25 = c[M].s25, s26 = c[M].s26, r26 = c[M].r26;
            const g = grow(s26, s25), rp = retP(s26, r26);
            const tier = i < 10 ? '🥇' : i < 10 + silver.length ? '🥈' : '🥉';
            return `<tr>
              <td>${tier} ${i + 1}</td>
              <td>${trunc(c.customer, 28)}</td>
              <td><span class="badge badge-gray">${c.channel || '–'}</span></td>
              <td class="num">${fmt(s25)}</td>
              <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
              <td class="num">${badge(fmtP(g), g >= 0 ? 'badge-up' : 'badge-down')}</td>
              <td class="num" style="color:${C.red}">${fmt(r26)}</td>
              <td class="num" style="color:${rp > 10 ? C.red : rp > 5 ? C.gold : C.green}">${rp.toFixed(1)}%</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">❌ Lost Customers</div></div>
      <div class="data-table-wrapper" style="max-height:250px;overflow-y:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Customer</th><th>Channel</th><th class="num">Sales 25</th><th class="num">Returns 25</th></tr></thead>
          <tbody>${lost.map((c, i) => `<tr><td>${i + 1}</td><td>${trunc(c.customer, 28)}</td><td>${c.channel || '–'}</td><td class="num">${fmt(c[M].s25)}</td><td class="num">${fmt(c[M].r25)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
  setTimeout(() => {
    mkChart('ch-c-top', { type: 'bar',
      data: { labels: gold.map(c => trunc(c.customer, 20)), datasets: [{ data: gold.map(c => c[M].s26), backgroundColor: C.gold + 'CC', borderRadius: 4 }] },
      options: barOpts(true),
    });
    mkChart('ch-c-ret', { type: 'bar',
      data: { labels: topRet.map(c => trunc(c.customer, 20)), datasets: [{ data: topRet.map(c => c[M].r26), backgroundColor: C.red + 'CC', borderRadius: 4 }] },
      options: barOpts(true),
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// CHANNELS
// ═══════════════════════════════════════════════════════════════
function pgChannels(D) {
  const M    = STATE.measure;
  const tab  = STATE.chTab;
  const chs  = sortData(D.channel_data.filter(c => c[M].s26 > 0 || c[M].s25 > 0).map(c => ({ ...c, name: c.channel })));
  const filtCh = STATE.chFilter;
  const chList = [...new Set(D.channel_data.map(c => c.channel).filter(Boolean))].sort();

  document.getElementById('page-channels').innerHTML = `
    <div class="channel-controls">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="font-size:12px;color:#8899bb">Channel:</label>
        <select id="ch-filter-sel" class="ch-select">
          <option value="">All Channels</option>
          ${chList.map(c => `<option value="${c}" ${filtCh === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="ch-tabs">
      <button class="ch-tab ${tab === 'sales'     ? 'active' : ''}" data-tab="sales">📊 Sales</button>
      <button class="ch-tab ${tab === 'returns'   ? 'active' : ''}" data-tab="returns">↩️ Returns</button>
      <button class="ch-tab ${tab === 'customers' ? 'active' : ''}" data-tab="customers">👥 Customers</button>
    </div>
    <div id="ch-tab-content"></div>
  `;

  // Tab events
  document.querySelectorAll('.ch-tab').forEach(btn => {
    btn.addEventListener('click', () => { STATE.chTab = btn.dataset.tab; pgChannels(D); });
  });

  // Channel filter
  document.getElementById('ch-filter-sel').addEventListener('change', e => {
    STATE.chFilter = e.target.value || null;
    pgChannels(D);
  });

  const view = filtCh ? chs.filter(c => c.channel === filtCh) : chs;

  if (tab === 'sales') {
    document.getElementById('ch-tab-content').innerHTML = `
      <div class="chart-grid cols-2">
        ${card('📊 Sales by Channel', '2025 vs 2026', cw('ch-ch-bars', '300'))}
        ${card('📈 Growth by Channel', 'Year over Year %', cw('ch-ch-grow', '300'))}
      </div>
      <div class="chart-card" style="margin-top:20px">
        <div class="chart-header"><div class="chart-title">📋 Channel Sales Table</div></div>
        <table class="data-table">
          <thead><tr>
            <th>Channel</th>
            <th class="num">Sales 25</th>
            <th class="num">Sales 26</th>
            <th class="num">Growth</th>
            <th class="num">Return 25</th>
            <th class="num">Return 26</th>
            <th class="num">Ret% 26</th>
          </tr></thead>
          <tbody>${view.map(c => {
            const s25 = c[M].s25, s26 = c[M].s26, r25 = c[M].r25, r26 = c[M].r26;
            const g = grow(s26, s25), rp = retP(s26, r26);
            return `<tr>
              <td><strong>${c.channel}</strong></td>
              <td class="num">${fmt(s25)}</td>
              <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
              <td class="num">${badge(fmtP(g), g >= 0 ? 'badge-up' : 'badge-down')}</td>
              <td class="num">${fmt(r25)}</td>
              <td class="num" style="color:${C.red}">${fmt(r26)}</td>
              <td class="num" style="color:${rp > 10 ? C.red : rp > 5 ? C.gold : C.green}">${rp.toFixed(1)}%</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    `;
    setTimeout(() => {
      mkChart('ch-ch-bars', { type: 'bar',
        data: { labels: view.map(c => c.channel),
          datasets: [
            { label: '2025', data: view.map(c => c[M].s25), backgroundColor: C.blueL + 'CC', borderRadius: 3 },
            { label: '2026', data: view.map(c => c[M].s26), backgroundColor: C.cyan  + 'CC', borderRadius: 3 },
          ] },
        options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
      });
      mkChart('ch-ch-grow', { type: 'bar',
        data: { labels: view.map(c => c.channel),
          datasets: [{ data: view.map(c => grow(c[M].s26, c[M].s25)),
            backgroundColor: view.map(c => grow(c[M].s26, c[M].s25) >= 0 ? C.green + 'CC' : C.red + 'CC'),
            borderRadius: 4, datalabels: { formatter: v => fmtP(v) } }] },
        options: barOpts(),
      });
    }, 50);

  } else if (tab === 'returns') {
    document.getElementById('ch-tab-content').innerHTML = `
      <div class="chart-grid cols-2">
        ${card('↩️ Returns by Channel', '2025 vs 2026', cw('ch-ch-ret', '300'))}
        ${card('📉 Return Rate %', 'By channel', cw('ch-ch-retp', '300'))}
      </div>
    `;
    setTimeout(() => {
      mkChart('ch-ch-ret', { type: 'bar',
        data: { labels: view.map(c => c.channel),
          datasets: [
            { label: '2025', data: view.map(c => c[M].r25), backgroundColor: C.blueL + 'AA', borderRadius: 3 },
            { label: '2026', data: view.map(c => c[M].r26), backgroundColor: C.red + 'CC',   borderRadius: 3 },
          ] },
        options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
      });
      mkChart('ch-ch-retp', { type: 'bar',
        data: { labels: view.map(c => c.channel),
          datasets: [{ data: view.map(c => retP(c[M].s26, c[M].r26)),
            backgroundColor: view.map(c => retP(c[M].s26, c[M].r26) > 10 ? C.red + 'CC' : C.green + 'CC'),
            borderRadius: 4, datalabels: { formatter: v => v.toFixed(1) + '%' } }] },
        options: barOpts(),
      });
    }, 50);

  } else {
    // Customers tab
    document.getElementById('ch-tab-content').innerHTML = `
      <div class="chart-grid cols-2">
        ${card('👥 Customers per Channel', '2025 vs 2026', cw('ch-ch-custs', '300'))}
        ${card('👥 Customer Count Change', 'Δ 2026 vs 2025', cw('ch-ch-custΔ', '300'))}
      </div>
    `;
    setTimeout(() => {
      mkChart('ch-ch-custs', { type: 'bar',
        data: { labels: view.map(c => c.channel),
          datasets: [
            { label: '2025', data: view.map(c => c.customers_25 || 0), backgroundColor: C.blueL + 'CC', borderRadius: 3 },
            { label: '2026', data: view.map(c => c.customers_26 || 0), backgroundColor: C.cyan  + 'CC', borderRadius: 3 },
          ] },
        options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
      });
      mkChart('ch-ch-custΔ', { type: 'bar',
        data: { labels: view.map(c => c.channel),
          datasets: [{ data: view.map(c => (c.customers_26 || 0) - (c.customers_25 || 0)),
            backgroundColor: view.map(c => ((c.customers_26 || 0) - (c.customers_25 || 0)) >= 0 ? C.green + 'CC' : C.red + 'CC'),
            borderRadius: 4, datalabels: { formatter: v => (v >= 0 ? '+' : '') + v } }] },
        options: barOpts(),
      });
    }, 50);
  }
}

// ═══════════════════════════════════════════════════════════════
// RETURNS
// ═══════════════════════════════════════════════════════════════
function pgReturns(D) {
  const M    = STATE.measure;
  const cats = [...D.category_data].filter(c => c[M].r25 > 0 || c[M].r26 > 0).sort((a, b) => b[M].r26 - a[M].r26);
  const topRetCusts = [...D.customer_data].filter(c => c[M].r26 > 0).sort((a, b) => b[M].r26 - a[M].r26).slice(0, 10);

  document.getElementById('page-returns').innerHTML = `
    <div class="chart-grid cols-2">
      ${card('📅 Monthly Return Trend', '2025 vs 2026', cw('ch-r-mon', '300'))}
      ${card('🗂️ Return Volume by Category', '', cw('ch-r-cat', '300'))}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('👥 Top 10 Customers by Return Ton', 'Sorted descending', cw('ch-r-custs', '300'))}
      ${card('📊 Partial Returns by Category', '', cw('ch-r-partial', '300'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">📋 Return Details (Category Level)</div></div>
      <table class="data-table">
        <thead><tr>
          <th>Category</th><th class="num">Return 25</th><th class="num">Return 26</th>
          <th class="num">Ret% 25</th><th class="num">Ret% 26</th>
        </tr></thead>
        <tbody>${cats.map(c => {
          const r25 = c[M].r25, r26 = c[M].r26;
          const rp25 = retP(c[M].s25, r25), rp26 = retP(c[M].s26, r26);
          return `<tr>
            <td style="color:${catColor(c.category)}">${c.category}</td>
            <td class="num">${fmt(r25)}</td>
            <td class="num" style="color:${C.red}">${fmt(r26)}</td>
            <td class="num">${rp25.toFixed(1)}%</td>
            <td class="num" style="color:${rp26 > rp25 ? C.red : C.green}">${rp26.toFixed(1)}%</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(() => {
    const md = [...D.monthly_data].filter(x => STATE.months.includes(x.month_id)).sort((a, b) => a.month_id - b.month_id);
    mkChart('ch-r-mon', { type: 'line',
      data: { labels: md.map(x => x.month_short),
        datasets: [
          { label: '2025', data: md.map(x => x[M].r25), borderColor: C.blueL, fill: false, borderWidth: 2 },
          { label: '2026', data: md.map(x => x[M].r26), borderColor: C.red,   fill: false, borderWidth: 2.5 },
        ] },
      options: lineOpts(),
    });
    mkChart('ch-r-cat', { type: 'bar',
      data: { labels: cats.map(c => c.category),
        datasets: [
          { label: '2025', data: cats.map(c => c[M].r25), backgroundColor: C.blueL + 'AA', borderRadius: 3 },
          { label: '2026', data: cats.map(c => c[M].r26), backgroundColor: C.red   + 'CC', borderRadius: 3 },
        ] },
      options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
    });
    mkChart('ch-r-custs', { type: 'bar',
      data: { labels: topRetCusts.map(c => trunc(c.customer, 20)), datasets: [{ data: topRetCusts.map(c => c[M].r26), backgroundColor: C.red + 'CC', borderRadius: 4 }] },
      options: barOpts(true),
    });
    mkChart('ch-r-partial', { type: 'bar',
      data: { labels: cats.map(c => c.category),
        datasets: [{ data: cats.map(c => c[M].partial26 ?? 0), backgroundColor: C.orange + 'CC', borderRadius: 4, label: 'Partial' }] },
      options: { ...barOpts(), plugins: { legend: { display: false } } },
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// GROWTH
// ═══════════════════════════════════════════════════════════════
function pgGrowth(D) {
  const M    = STATE.measure;
  const cats = sortData(D.category_data.map(c => ({ ...c, name: c.category }))).filter(c => c[M].s25 > 0 || c[M].s26 > 0);

  document.getElementById('page-growth').innerHTML = `
    <div class="chart-grid cols-2">
      ${card('📊 Growth Variance by Category', 'Absolute Δ (2026 − 2025)', cw('ch-g-cat', '350'))}
      ${card('📈 Growth % by Category', 'Relative Δ', cw('ch-g-catp', '350'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <div class="chart-header"><div class="chart-title">📋 Growth Detail Table</div></div>
      <table class="data-table">
        <thead><tr>
          ${thSort('Category', 'name')}
          ${thSort('Sales 25', 's25')}
          ${thSort('Sales 26', 's26')}
          ${thSort('Growth Δ', 'grow')}
          ${thSort('Achievement', 'ach26')}
        </tr></thead>
        <tbody>${cats.map(c => {
          const g = grow(c[M].s26, c[M].s25);
          const a = hasTgt(c[M].tgt26) ? ach(c[M].s26, c[M].tgt26) : null;
          return `<tr>
            <td style="color:${catColor(c.category)}">${c.category}</td>
            <td class="num">${fmt(c[M].s25)}</td>
            <td class="num" style="color:${C.cyan}">${fmt(c[M].s26)}</td>
            <td class="num">${badge(fmtP(g), g >= 0 ? 'badge-up' : 'badge-down')}</td>
            <td class="num">${achBadge(a)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(() => {
    const sorted = [...cats].sort((a, b) => (b[M].s26 - b[M].s25) - (a[M].s26 - a[M].s25));
    mkChart('ch-g-cat', { type: 'bar',
      data: { labels: sorted.map(c => c.category),
        datasets: [{ data: sorted.map(c => c[M].s26 - c[M].s25),
          backgroundColor: sorted.map(c => c[M].s26 >= c[M].s25 ? C.green + 'CC' : C.red + 'CC'),
          borderRadius: 4, datalabels: { formatter: v => (v >= 0 ? '+' : '') + fmt(v) } }] },
      options: barOpts(true),
    });
    const sortedP = [...cats].sort((a, b) => grow(b[M].s26, b[M].s25) - grow(a[M].s26, a[M].s25));
    mkChart('ch-g-catp', { type: 'bar',
      data: { labels: sortedP.map(c => c.category),
        datasets: [{ data: sortedP.map(c => grow(c[M].s26, c[M].s25)),
          backgroundColor: sortedP.map(c => grow(c[M].s26, c[M].s25) >= 0 ? C.green + 'CC' : C.red + 'CC'),
          borderRadius: 4, datalabels: { formatter: v => fmtP(v) } }] },
      options: barOpts(true),
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// MONTHLY
// ═══════════════════════════════════════════════════════════════
function pgMonthly(D) {
  const M  = STATE.measure;
  const md = [...D.monthly_data].sort((a, b) => a.month_id - b.month_id);
  document.getElementById('page-monthly').innerHTML = `
    <div class="chart-grid cols-1">
      ${card('📅 Monthly Detail', 'Sales 2025 vs 2026 vs Target', cw('ch-m-bar', '350'))}
    </div>
    <div class="chart-card" style="margin-top:20px">
      <table class="data-table">
        <thead><tr>
          <th>Month</th>
          <th class="num">Sales 25</th><th class="num">Sales 26</th>
          <th class="num">Growth</th>
          <th class="num">Target 26</th><th class="num">Ach%</th>
          <th class="num">Return 26</th>
        </tr></thead>
        <tbody>${md.map(x => {
          const s25 = x[M].s25, s26 = x[M].s26, t26 = x[M].tgt26, r26 = x[M].r26;
          const g = grow(s26, s25), a = hasTgt(t26) ? ach(s26, t26) : null;
          return `<tr>
            <td><strong>${x.month_name}</strong> ${x.in_ytd ? badge('YTD', 'badge-new') : ''}</td>
            <td class="num">${fmt(s25)}</td>
            <td class="num" style="color:${C.cyan}">${fmt(s26)}</td>
            <td class="num">${badge(fmtP(g), g >= 0 ? 'badge-up' : 'badge-down')}</td>
            <td class="num">${hasTgt(t26) ? fmt(t26) : '–'}</td>
            <td class="num">${achBadge(a)}</td>
            <td class="num" style="color:${C.red}">${fmt(r26)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
  setTimeout(() => {
    mkChart('ch-m-bar', { type: 'bar',
      data: { labels: md.map(x => x.month_short),
        datasets: [
          { label: '2025', data: md.map(x => x[M].s25), backgroundColor: C.blueL + 'AA', borderRadius: 3 },
          { label: '2026', data: md.map(x => x[M].s26), backgroundColor: C.cyan  + 'CC', borderRadius: 3 },
          { label: 'Target 26', data: md.map(x => x[M].tgt26), type: 'line', borderColor: C.gold, borderDash: [4, 4], fill: false, pointRadius: 0, datalabels: { display: false } },
        ] },
      options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// QUARTERLY
// ═══════════════════════════════════════════════════════════════
function pgQuarterly(D) {
  const M  = STATE.measure;
  const qm = STATE.period === 'q1' ? [1,2,3] : STATE.period === 'q2' ? [4,5,6] : STATE.months;
  const fil = [...D.monthly_data].filter(x => qm.includes(x.month_id)).sort((a, b) => a.month_id - b.month_id);

  let s25 = 0, s26 = 0, t26 = 0, r25 = 0, r26 = 0;
  fil.forEach(x => { s25 += x[M].s25; s26 += x[M].s26; if (x[M].tgt26) t26 += x[M].tgt26; r25 += x[M].r25; r26 += x[M].r26; });
  const g = grow(s26, s25), a = hasTgt(t26) ? ach(s26, t26) : null;

  document.getElementById('page-quarterly').innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('💰', 'Sales 2026', fmt(s26), null, 'cyan', `Target: ${hasTgt(t26) ? fmt(t26) : 'N/A'}`)}
      ${kpi('📅', 'Sales 2025', fmt(s25), null, 'blue', '')}
      ${kpi('📈', 'Growth', fmtP(g), g, 'green', '')}
      ${kpi('🎯', 'Achievement', a != null ? a.toFixed(1) + '%' : 'N/A', a != null ? a - 100 : null, 'cyan', '')}
    </div>
    <div class="chart-grid cols-2" style="margin-top:20px">
      ${card('📊 Sales by Month', '', cw('ch-q-sales', '300'))}
      ${card('↩️ Returns by Month', '', cw('ch-q-ret', '300'))}
    </div>
  `;
  setTimeout(() => {
    mkChart('ch-q-sales', { type: 'bar',
      data: { labels: fil.map(x => x.month_short),
        datasets: [
          { label: '2025', data: fil.map(x => x[M].s25), backgroundColor: C.blueL + 'AA', borderRadius: 3 },
          { label: '2026', data: fil.map(x => x[M].s26), backgroundColor: C.cyan  + 'CC', borderRadius: 3 },
        ] },
      options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
    });
    mkChart('ch-q-ret', { type: 'bar',
      data: { labels: fil.map(x => x.month_short),
        datasets: [
          { label: '2025', data: fil.map(x => x[M].r25), backgroundColor: C.blueL + 'AA', borderRadius: 3 },
          { label: '2026', data: fil.map(x => x[M].r26), backgroundColor: C.red   + 'CC', borderRadius: 3 },
        ] },
      options: { ...barOpts(), plugins: { legend: { position: 'top' } } },
    });
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// LOADING UI
// ═══════════════════════════════════════════════════════════════
function setLoaderText(t) {
  const el = document.getElementById('loader-text');
  if (el) el.textContent = t;
}
function showLoader() {
  const ov = document.getElementById('loading-overlay');
  if (ov) { ov.classList.remove('hidden'); ov.style.display = ''; }
}
function hideLoader() {
  const ov = document.getElementById('loading-overlay');
  if (ov) { ov.classList.add('hidden'); setTimeout(() => { if (ov.classList.contains('hidden')) ov.style.display = 'none'; }, 500); }
}

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════════
const AUTH_KEY  = 'greko_auth';
const AUTH_USER = 'mahmoudashour';
const AUTH_PASS = 'Greko@2026';

function isLoggedIn() { return localStorage.getItem(AUTH_KEY) === 'true'; }

function showLogin() {
  hideLoader();
  document.getElementById('login-page').style.display = '';
  document.getElementById('dashboard').style.display  = 'none';
}

function showDashboard() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('dashboard').style.display  = '';
}

function setupAuth() {
  const btn  = document.getElementById('login-btn');
  const uInp = document.getElementById('login-user');
  const pInp = document.getElementById('login-pass');
  const err  = document.getElementById('login-error');

  function doLogin() {
    const u = uInp.value.trim();
    const p = pInp.value;
    if (u === AUTH_USER && p === AUTH_PASS) {
      localStorage.setItem(AUTH_KEY, 'true');
      err.style.display = 'none';
      showDashboard();
      loadAndRender();
    } else {
      err.style.display = '';
      pInp.value = '';
      pInp.focus();
    }
  }

  btn.addEventListener('click', doLogin);
  [uInp, pInp].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); }));

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem(AUTH_KEY);
    location.reload();
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN LOAD & RENDER
// ═══════════════════════════════════════════════════════════════
async function loadAndRender() {
  showLoader();
  setLoaderText('Fetching data…');
  try {
    STATE.data = await fetchData(STATE.months);
    const period = STATE.data.meta.period || '';
    document.getElementById('ytd-label-top').textContent = period;
    document.getElementById('last-update').textContent   = period;
    hideLoader();
    go('home');
  } catch (e) {
    console.error('Load error:', e);
    const txt = document.getElementById('loader-text');
    txt.style.whiteSpace = 'pre-wrap';
    txt.style.textAlign = 'left';
    txt.style.fontFamily = 'monospace';
    txt.style.fontSize = '12px';
    txt.style.maxWidth = '80vw';
    txt.textContent = e.message || 'Error loading data.';
    document.getElementById('loading-overlay').classList.add('error');
  }
}

async function reloadForPeriod() {
  showLoader();
  setLoaderText('Loading…');
  try {
    STATE.data = await fetchData(STATE.months);
    const period = STATE.data.meta.period || '';
    document.getElementById('ytd-label-top').textContent = period;
    document.getElementById('last-update').textContent   = period;
    hideLoader();
    renderPage();
  } catch (e) {
    console.error('Reload error:', e);
    const txt = document.getElementById('loader-text');
    txt.style.whiteSpace = 'pre-wrap';
    txt.style.textAlign = 'left';
    txt.style.fontFamily = 'monospace';
    txt.style.fontSize = '12px';
    txt.style.maxWidth = '80vw';
    txt.textContent = e.message || 'Error loading data.';
    document.getElementById('loading-overlay').classList.add('error');
  }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
  setupAuth();

  if (!isLoggedIn()) {
    showLogin();
    return;
  }

  showDashboard();

  // ── Period slicer ────────────────────────────────────────────
  document.querySelectorAll('#period-slicer .measure-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#period-slicer .measure-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      STATE.period = e.target.dataset.period;
      STATE.months = PERIOD_MONTHS[STATE.period] || [1,2,3,4,5,6];
      reloadForPeriod();
    });
  });

  // ── Measure slicer ───────────────────────────────────────────
  document.querySelectorAll('#measure-slicer .measure-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#measure-slicer .measure-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      STATE.measure = e.target.dataset.measure;
      currentSort = { field: 's26', desc: true };
      renderPage();
    });
  });

  // ── Nav ──────────────────────────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); go(el.dataset.page); });
  });

  // ── Mobile sidebar ───────────────────────────────────────────
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // ── Initial load ─────────────────────────────────────────────
  loadAndRender();
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', init)
  : init();
