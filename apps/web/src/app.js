/* 应用外壳：状态、路由、总览、导入、设置、口径、下钻 */
(function (root) {
  'use strict';

  var UI = root.UI, Charts = root.Charts, Engine = root.FinEngine;
  var SETTINGS_KEY = 'fin_settings_v1';

  var PAGE_META = {
    overview: { title: '经营总览', sub: '老板视角的一页纸：利润、店铺、现金、成本、库存' },
    briefing: { title: '经营简报', sub: 'AI 起草 → 财务提交 → 老板审核 → 推送办公平台' },
    stores: { title: '店铺利润', sub: '每个店铺 / 平台的收入、成本与利润贡献' },
    products: { title: '商品利润', sub: '按 SKU 核算销量、成本、毛利与库存占用' },
    settlement: { title: '平台结算与对账', sub: '账单 vs 订单 vs 打款，差异逐笔说明' },
    logistics: { title: '物流成本', sub: '面单费用、单均运费、区域与退回成本' },
    inventory: { title: '采购与库存', sub: '移动加权平均成本、库存金额与周转、滞销' },
    payroll: { title: '工资与提成', sub: '底薪 + 阶梯提成，按人 / 按店铺核算' },
    invoices: { title: '费用与发票', sub: '费用结构、进项 / 销项台账与匹配差异' },
    import: { title: '数据导入', sub: '把平台、物流、ERP、采购、工资、发票数据接进来' },
    settings: { title: '设置', sub: '店铺费率、提成阶梯与核算参数' },
    formulas: { title: '口径与说明', sub: '每个指标怎么算、数据从哪来、校验规则' }
  };
  var NAV = [
    { group: '经营分析', items: [['overview', '经营总览', 'overview'], ['briefing', '经营简报', 'invoices'], ['stores', '店铺利润', 'stores'], ['products', '商品利润', 'products']] },
    { group: '资金与成本', items: [['settlement', '平台结算', 'settlement'], ['logistics', '物流成本', 'logistics'], ['inventory', '采购与库存', 'inventory']] },
    { group: '人效与票据', items: [['payroll', '工资与提成', 'payroll'], ['invoices', '费用与发票', 'invoices']] },
    { group: '系统', items: [['import', '数据导入', 'import'], ['settings', '设置', 'settings'], ['formulas', '口径与说明', 'info']] }
  ];
  var FORMULA_LABELS = {
    revenue: '营业收入', gmv: 'GMV', refund: '退款', cogs: '商品成本', freight: '物流成本',
    platformFees: '平台费用', commission: '佣金', promotion: '推广费', labor: '人工成本',
    other: '其他费用', grossProfit: '经营毛利', contribution: '贡献毛利', netProfit: '净利润',
    netMargin: '净利率', aov: '客单价', refundRate: '退款率', turnoverDays: '周转天数',
    cashReceived: '已回款', cashPending: '待结算', cashOccupied: '账期占款', invoice: '发票匹配'
  };

  var state = {
    data: null, model: null, page: 'overview', month: 'all', store: 'all',
    sort: {}, imported: false, import: null, lastExport: null, booted: false
  };

  function apiMode() { return !!(root.FinApi && root.FinApi.mode === 'api'); }
  function dataLabel() { return apiMode() ? '' : ' · 演示数据'; }

  function uid() { return Math.random().toString(36).slice(2, 8); }

  function applySavedSettings(data) {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return data;
      var saved = JSON.parse(raw);
      if (saved.settings) {
        if (saved.settings.commission_ladder) data.settings.commission_ladder = saved.settings.commission_ladder;
        if (saved.settings.slow_moving_days) data.settings.slow_moving_days = saved.settings.slow_moving_days;
        if (saved.settings.default_basis) data.settings.default_basis = saved.settings.default_basis;
      }
      if (saved.stores) {
        data.stores.forEach(function (s) {
          if (saved.stores[s.id]) Object.assign(s, saved.stores[s.id]);
        });
      }
    } catch (e) { /* 忽略损坏的本地设置 */ }
    return data;
  }

  function compute() {
    state.model = Engine.computeModel(state.data);
  }

  function currentScope() {
    return scopeFor(state.month, state.store);
  }

  var SCOPE_FIELDS = ['gmv', 'refund', 'netSales', 'subsidy', 'revenue', 'cogs', 'freight', 'commission', 'techFee', 'paymentFee', 'insurance', 'platformFees', 'promotion', 'labor', 'other', 'grossProfit', 'contribution', 'netProfit', 'orders', 'units', 'shipCount'];

  function scopeFor(month, storeId) {
    var m = state.model;
    if (!storeId || storeId === 'all') return month === 'all' ? m.total : m.companyMonth[month];
    if (month !== 'all') return m.storeMonth[storeId][month];
    var acc = { month: 'all', store_id: storeId };
    SCOPE_FIELDS.forEach(function (k) { acc[k] = 0; });
    m.months.forEach(function (mm) {
      SCOPE_FIELDS.forEach(function (k) { acc[k] += Number(m.storeMonth[storeId][mm][k] || 0); });
    });
    acc.netSales = acc.revenue - acc.subsidy;
    acc.grossProfit = acc.revenue - acc.cogs;
    acc.contribution = acc.grossProfit - acc.freight;
    acc.aov = acc.orders ? acc.gmv / acc.orders : 0;
    acc.refundRate = acc.gmv ? acc.refund / acc.gmv * 100 : 0;
    acc.netMargin = acc.revenue ? acc.netProfit / acc.revenue * 100 : 0;
    return acc;
  }

  // ---------------- 导航 / 顶栏 ----------------
  function renderSidebar() {
    var html = '<div class="brand"><div class="brand-mark">麓</div><div><div class="brand-name">麓野 · 财务中枢</div>' +
      '<div class="brand-sub">FINANCE CONSOLE</div>' + (apiMode() ? '' : '<span class="demo-pill">DEMO 演示数据</span>') + '</div></div>';
    html += '<nav class="nav">';
    NAV.forEach(function (g) {
      html += '<div class="nav-group">' + g.group + '</div>';
      g.items.forEach(function (it) {
        html += '<button class="nav-item" data-page="' + it[0] + '">' + UI.icon(it[2]) + '<span>' + it[1] + '</span></button>';
      });
    });
    html += '</nav>';
    html += '<div class="sidebar-foot">数据截止 ' + state.model.months[state.model.months.length - 1] + '-31<br>' +
      (apiMode() ? UI.esc(root.FinApi.user.tenant.name) + '<br>' + UI.esc(root.FinApi.user.displayName) + ' · ' + UI.esc(root.FinApi.user.roleLabel) +
        '<br><button class="btn ghost small" data-action="logout" style="margin-top:6px">退出登录</button>' : '演示品牌与店铺均为虚构<br>单角色 · 仅老板视图') + '</div>';
    document.getElementById('sidebar').innerHTML = html;
  }

  function renderTopbar() {
    var meta = PAGE_META[state.page];
    var showFilter = ['import', 'settings', 'formulas', 'briefing'].indexOf(state.page) < 0;
    var showStore = ['overview', 'stores', 'products', 'settlement', 'logistics'].indexOf(state.page) >= 0;
    var scopeText = UI.fullMonth(state.month) + (state.store === 'all' ? ' · 全部店铺' : ' · ' + storeName(state.store));
    var html = '<div class="topbar-title"><h1>' + (apiMode() ? UI.esc(root.FinApi.user.roleLabel) + '视图' : '老板视图') + '</h1><p>数据截止 ' + state.model.months[state.model.months.length - 1] + '-31 · ' + UI.esc(scopeText) + dataLabel() + '</p></div>';
    html += '<div class="topbar-actions">';
    if (showFilter) {
      html += '<div class="chips" role="group" aria-label="账期">';
      html += '<button class="chip' + (state.month === 'all' ? ' active' : '') + '" data-month="all">全部</button>';
      state.model.months.forEach(function (m) {
        html += '<button class="chip' + (state.month === m ? ' active' : '') + '" data-month="' + m + '">' + Number(m.slice(5, 7)) + '月</button>';
      });
      html += '</div>';
    }
    if (showStore) {
      html += '<select class="select" id="store-filter" aria-label="店铺">';
      html += '<option value="all"' + (state.store === 'all' ? ' selected' : '') + '>全部店铺</option>';
      state.model.stores.forEach(function (s) {
        html += '<option value="' + s.id + '"' + (state.store === s.id ? ' selected' : '') + '>' + UI.esc(s.name) + '</option>';
      });
      html += '</select>';
    }
    html += '<button class="btn" data-action="print">' + UI.icon('print') + '打印</button>';
    html += '<button class="btn" data-action="export">' + UI.icon('download') + '导出 CSV</button>';
    html += '<button class="btn primary" data-action="go" data-page="import">' + UI.icon('import') + '导入数据</button>';
    html += '</div>';
    document.getElementById('topbar').innerHTML = html;
  }

  function setNavActive() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (el) {
      el.classList.toggle('active', el.getAttribute('data-page') === state.page);
    });
  }

  // ---------------- 页面上下文 ----------------
  function makeCtx() {
    var ctx = {
      state: state, model: state.model, month: state.month, store: state.store,
      months: state.model.months, fmt: UI, charts: Charts,
      sort: state.sort[state.page] || {},
      isAll: state.month === 'all'
    };
    ctx.setExport = function (name, headers, rows) { ctx.export = { name: name, headers: headers, rows: rows }; };
    ctx.scope = currentScope;
    ctx.scopeLabel = UI.fullMonth(state.month) + (state.store === 'all' ? '' : ' · ' + storeName(state.store));
    ctx.storeRows = function () {
      return state.model.stores.map(function (s) {
        if (state.month === 'all') return Object.assign({}, state.model.storeTotal[s.id], { name: s.name, platform: s.platform });
        var sm = state.model.storeMonth[s.id][state.month];
        return Object.assign({}, sm, { name: s.name });
      }).sort(function (a, b) { return b.netProfit - a.netProfit; });
    };
    return ctx;
  }

  function storeName(id) {
    var s = state.model.stores.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : id;
  }

  function scopeStores() {
    var model = state.model;
    return model.stores.filter(function (s) { return state.store === 'all' || s.id === state.store; });
  }

  function render() {
    if (!state.model) return;
    renderTopbar();
    setNavActive();
    var ctx = makeCtx();
    var result;
    try {
      if (state.page === 'overview') result = renderOverview(ctx);
      else if (state.page === 'import') result = renderImport(ctx);
      else if (state.page === 'settings') result = renderSettings(ctx);
      else if (state.page === 'formulas') result = renderFormulas(ctx);
      else if (root.Views && root.Views[state.page]) result = root.Views[state.page](ctx);
      else result = { html: '<div class="empty">页面不存在</div>' };
    } catch (e) {
      result = { html: '<div class="card pad"><h3>页面渲染出错</h3><p class="muted">' + UI.esc(e.message) + '</p></div>' };
      console.error(e);
    }
    document.getElementById('view').innerHTML = result.html;
    state.lastExport = result.export || ctx.export || null;
    window.scrollTo(0, 0);
  }

  function go(page) {
    if (!PAGE_META[page]) return;
    state.page = page;
    if (location.hash !== '#/' + page) location.hash = '#/' + page;
    else render();
  }

  // ---------------- 总览 ----------------
  function renderOverview(ctx) {
    var m = state.model, month = state.month;
    var scope = scopeFor(month, state.store);
    var prev = null;
    if (month !== 'all') {
      var idx = m.months.indexOf(month);
      if (idx > 0) prev = state.store === 'all' ? m.companyMonth[m.months[idx - 1]] : m.storeMonth[state.store][m.months[idx - 1]];
    }
    var curNet = scope.netProfit;
    var d = (month !== 'all' && prev) ? UI.delta(curNet, prev.netProfit) : null;

    var inv = month === 'all' ? m.inventory.summary : m.inventory.monthly[month];
    var invValue = month === 'all' ? m.inventory.summary.value : inv.closingValue;
    var turnover = month === 'all' ? m.inventory.summary.turnoverDays : inv.turnoverDays;
    var slowValue = m.inventory.summary.slowMovingValue;

    var stores = ctx.storeRows();
    var rankBase = month === 'all' ? m.total.netProfit : m.companyMonth[month].netProfit;
    var rankMax = Math.max.apply(null, stores.map(function (s) { return Math.abs(s.netProfit); }).concat([1]));
    var costItems = [
      { label: '商品成本', value: scope.cogs, color: 'var(--chart-1)' },
      { label: '物流', value: scope.freight, color: 'var(--chart-2)' },
      { label: '平台费用', value: scope.platformFees, color: 'var(--chart-3)' },
      { label: '推广', value: scope.promotion, color: 'var(--chart-4)' },
      { label: '人工', value: scope.labor, color: 'var(--chart-5)' },
      { label: '其他', value: scope.other, color: 'var(--chart-8)' }
    ];

    // 现金流是时点口径：始终显示截至数据截止日的累计回款与当前未结算金额
    var cash = state.store === 'all' ? m.cash.total : m.cash.byStore[state.store];

    var html = '';
    html += '<div class="print-head"><span class="brandline">麓野 · 财务中枢</span><span>经营总览 · ' + ctx.scopeLabel + '</span><span>数据截止 ' + m.months[m.months.length - 1] + '-31</span></div>';
    html += '<div class="page-head"><div><div class="eyebrow">Overview</div><h2>经营总览</h2>' +
      '<p>' + UI.esc(ctx.scopeLabel) + ' · 营业收入 ' + UI.wan(scope.revenue) + ' · 订单 ' + UI.num(scope.orders) + ' 笔</p></div>' +
      '<div class="head-actions"><button class="btn" data-action="go" data-page="formulas">' + UI.icon('info') + '口径说明</button>' +
      '<button class="btn" data-action="go" data-page="import">' + UI.icon('import') + '导入真实数据</button></div></div>';

    // KPI 五张卡
    html += '<div class="kpi-grid">';

    html += '<div class="card kpi"><div class="kpi-label" title="净利润 = 营业收入 − 商品成本 − 物流 − 平台费用 − 推广费 − 人工 − 其他费用；净利率 = 净利润 ÷ 营业收入">净利润 <span class="muted">/ 净利率</span></div>' +
      '<div class="kpi-value">' + UI.wan(curNet) + '<span class="unit">元</span></div>' +
      '<div class="kpi-sub">' + (month === 'all'
        ? '<span class="muted">近 ' + m.months.length + ' 个月累计</span>'
        : '<span class="delta ' + (d ? d.cls : 'flat') + '">' + (d ? d.text : '—') + '</span><span>环比</span>') +
      '<span class="badge ok">净利率 ' + UI.pct(scope.netMargin) + '</span></div>' +
      '<div class="kpi-spark">' + Charts.sparkline({
        values: m.months.map(function (x) { return state.store === 'all' ? m.companyMonth[x].netProfit : m.storeMonth[state.store][x].netProfit; }),
        width: 250, height: 36, color: 'var(--chart-4)'
      }) + '</div>' +
      '<div class="kpi-foot">营业收入 ' + UI.money(scope.revenue) + ' · 贡献毛利 ' + UI.money(scope.contribution) + '</div></div>';

    html += '<div class="card kpi"><div class="kpi-label" title="按店铺净利润排名；贡献占比 = 店铺净利润 ÷ 公司净利润">店铺利润排名 <span class="muted">/ 贡献占比</span></div>' +
      '<div class="kpi-mini-list">' + stores.slice(0, 3).map(function (s) {
        var share = rankBase ? Math.round(s.netProfit / rankBase * 1000) / 10 : 0;
        return '<div class="kpi-mini-row"><span class="nowrap">' + UI.esc(s.name.replace(/（.*?）/, '')) + '</span>' +
          '<span class="mono">' + UI.wan(s.netProfit) + ' · ' + share + '%</span>' +
          '<span class="track"><i style="width:' + Math.max(2, Math.min(100, Math.abs(s.netProfit) / rankMax * 100)) + '%"></i></span></div>';
      }).join('') + '</div>' +
      '<div class="kpi-foot">最好 ' + UI.pct(stores[0].netMargin) + ' · 最差 ' + UI.pct(stores[stores.length - 1].netMargin) + '</div></div>';

    html += '<div class="card kpi"><div class="kpi-label" title="时点口径（截至数据截止日）：已回款 = 平台打款流水累计；待结算 = 未结算账单的结算金额；账期占款 = 未结算账单对应的订单净额">现金流 <span class="muted">截至 ' + m.months[m.months.length - 1] + '-31</span></div>' +
      '<div class="kpi-value" style="font-size:24px">' + UI.wan(cash.received) + '<span class="unit">元</span></div>' +
      '<div class="kpi-sub"><span>累计已回款</span><span>待结算 <b class="mono">' + UI.wan(cash.pending) + '</b></span><span>账期占款 <b class="mono">' + UI.wan(cash.occupied) + '</b></span></div>' +
      '<div class="kpi-foot">平台还没打给我们的钱：' + UI.money(cash.occupied) + '</div></div>';

    html += '<div class="card kpi"><div class="kpi-label" title="各项成本 ÷ 营业收入；商品成本按移动加权平均，平台费用取账单实际值">成本结构 <span class="muted">占营业收入</span></div>' +
      '<div class="kpi-mini-list">' + costItems.map(function (c) {
        var p = scope.revenue ? c.value / scope.revenue * 100 : 0;
        return '<div class="kpi-mini-row"><span>' + c.label + '</span><span class="mono">' + UI.pct(p) + '</span>' +
          '<span class="track"><i style="width:' + Math.min(100, p) + '%;background:' + c.color + '"></i></span></div>';
      }).join('') + '</div></div>';

    html += '<div class="card kpi"><div class="kpi-label" title="库存金额 = 期末结存 × 移动加权平均单价；周转天数 = 平均库存 ÷ 出库成本 × 天数；滞销 = 超 60 天无出库">库存与滞销 <span class="muted">' + (state.store === 'all' ? '期末' : '全公司口径') + '</span></div>' +
      '<div class="kpi-value" style="font-size:24px">' + UI.wan(invValue) + '<span class="unit">元</span></div>' +
      '<div class="kpi-sub"><span>周转 <b class="mono">' + turnover + '</b> 天</span><span>滞销 <b class="mono">' + UI.wan(slowValue) + '</b></span></div>' +
      '<div class="kpi-spark">' + Charts.progressBar({
        value: slowValue, max: Math.max(1, invValue), width: 250, height: 42,
        color: 'var(--chart-4)', label: '滞销占库存',
        valueFormat: function (v) { return UI.wan(v); }
      }) + '</div>' +
      '<div class="kpi-foot">滞销 SKU ' + m.inventory.summary.slowMovingCount + ' 个 · 共 ' + m.inventory.summary.skuCount + ' 个 SKU</div></div>';

    html += '</div>';

    // 趋势与成本结构
    html += '<div class="grid grid-12" style="margin-top:14px">';
    html += '<div class="card span-8"><div class="panel-head"><h3>收入与净利润趋势</h3><span class="sub">' + m.months.length + ' 个月 · 按订单与账单核算</span></div>' +
      '<div class="panel-body"><div class="chart">' + Charts.lineChart({
        xLabels: m.months.map(function (x) { return Number(x.slice(5, 7)) + '月'; }),
        series: [
          { name: '营业收入', color: 'var(--chart-1)', points: m.months.map(function (x) { return state.store === 'all' ? m.companyMonth[x].revenue : m.storeMonth[state.store][x].revenue; }) },
          { name: '净利润', color: 'var(--chart-4)', points: m.months.map(function (x) { return state.store === 'all' ? m.companyMonth[x].netProfit : m.storeMonth[state.store][x].netProfit; }) }
        ],
        height: 250, valueFormat: function (v) { return UI.wan(v); }
      }) + '</div></div></div>';
    html += '<div class="card span-4"><div class="panel-head"><h3>成本结构</h3><span class="sub">占成本合计 · ' + UI.fullMonth(month) + '</span></div>' +
      '<div class="panel-body"><div class="chart">' + Charts.donutChart({
        items: costItems.map(function (c) { return { label: c.label, value: c.value, color: c.color }; }),
        size: 190, centerLabel: '成本合计', centerValue: UI.wan(costItems.reduce(function (s, c) { return s + c.value; }, 0)),
        valueFormat: function (v) { return UI.wan(v); }, legendPosition: 'bottom'
      }) + '</div></div></div>';
    html += '</div>';

    // 利润桥 + 校验预警
    var wf = [{ label: '收入', value: scope.revenue, type: 'start' }];
    [['商品', scope.cogs], ['物流', scope.freight], ['平台', scope.platformFees], ['推广', scope.promotion], ['人工', scope.labor], ['其他', scope.other]]
      .forEach(function (x) { wf.push({ label: x[0], value: -x[1], type: 'delta' }); });
    wf.push({ label: '净利', value: scope.netProfit, type: 'total' });

    html += '<div class="grid grid-12" style="margin-top:14px">';
    html += '<div class="card span-6"><div class="panel-head"><h3>利润桥</h3><span class="sub">收入如何变成净利润</span></div>' +
      '<div class="panel-body"><div class="chart">' + Charts.waterfallChart({ items: wf, height: 300, valueFormat: function (v) { return UI.wan(v); } }) + '</div></div></div>';
    html += '<div class="card span-6"><div class="panel-head"><h3>勾稽校验</h3><span class="sub">8 项自动核对</span>' +
      '<div class="panel-actions">' + UI.badge(m.checks.filter(function (c) { return c.ok; }).length + '/' + m.checks.length + ' 通过', m.checks.every(function (c) { return c.ok; }) ? 'ok' : 'bad') + '</div></div>' +
      '<div class="panel-body"><div class="check-grid">' + m.checks.map(function (c) {
        return '<div class="check-item' + (c.ok ? '' : ' bad') + '" data-drill="check" data-id="' + c.id + '" style="cursor:pointer">' +
          '<span class="lamp"></span><span class="txt"><b>' + UI.esc(c.label) + '</b>' +
          (c.ok ? UI.esc(c.detail || '一致') : UI.esc(c.detail || '差异 ' + c.diff)) + '</span></div>';
      }).join('') + '</div></div></div>';
    html += '</div>';

    // 预警
    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>需要老板关注</h3><span class="sub">来自对账、库存、发票与勾稽</span></div>' +
      '<div class="panel-body">';
    if (m.alerts.length) {
      html += '<div class="alert-list">' + m.alerts.slice(0, 8).map(function (a, i) {
        return '<div class="alert-item ' + a.level + '" data-alert-index="' + i + '"><span class="icon">' + (a.level === 'error' ? '!' : a.level === 'warn' ? '!' : 'i') + '</span>' +
          '<div><div class="t">' + UI.esc(a.title) + '</div><div class="d">' + UI.esc(a.detail) + '</div></div></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="callout">' + UI.icon('check') + '<span>所有勾稽与对账检查通过，没有需要关注的异常。</span></div>';
    }
    html += '</div></div>';

    // 导出：总览 KPI + 成本结构
    ctx.setExport('经营总览-' + (month === 'all' ? '全部账期' : month) + '.csv',
      ['指标', '数值', '口径'],
      [['营业收入', scope.revenue, '净销售额 + 平台补贴'], ['商品成本', scope.cogs, '移动加权平均'],
        ['贡献毛利', scope.contribution, '营业收入 - 商品成本 - 物流'], ['净利润', scope.netProfit, '见口径说明'],
        ['净利率(%)', scope.netMargin, '净利润 / 营业收入'], ['GMV', scope.gmv, '订单实付合计'],
        ['订单数', scope.orders, ''], ['客单价', scope.aov, ''], ['退款率(%)', scope.refundRate, ''],
        ['库存金额', invValue, ''], ['周转天数', turnover, ''], ['已回款', cash.received, ''], ['待结算', cash.pending, ''], ['账期占款', cash.occupied, '']]);

    return { html: html };
  }

  // ---------------- 导入 ----------------
  function renderImport(ctx) {
    var tables = root.FinTemplates.TABLES;
    var html = '';
    html += '<div class="page-head"><div><div class="eyebrow">Data In</div><h2>数据导入</h2>' +
      '<p>模板按中文表头设计，支持 CSV 与 .xlsx；导入前先校验，确认后才写入并重算。</p></div></div>';

    html += '<div class="callout" style="margin-bottom:14px">' + UI.icon('info') +
      (apiMode() ? '<div><b>导入的数据会保存到服务器。</b> 服务器会重新校验整份文件，有任何错误都不会写入；每次导入都有记录和审计。</div></div>' : '<div><b>导入的数据只在本次会话有效。</b> 演示数据不会被覆盖，刷新页面可回到内置演示数据；需要长期保存请导出数据快照。</div></div>');

    if (state.import && state.import.result) html += renderImportResult(state.import);
    else if (state.import && state.import.done) {
      html += '<div class="import-result"><div class="head">' + UI.badge('导入成功', 'ok') +
        '<h4>' + UI.esc(state.import.done.label) + '</h4></div>' +
        '<p class="hint">已写入 ' + state.import.done.rows + ' 条记录，系统已自动重算。可继续导入其他表，或回到总览查看结果。</p>' +
        '<div class="row" style="margin-top:10px;display:flex;gap:8px"><button class="btn primary" data-action="go" data-page="overview">查看总览</button>' +
        '<button class="btn" data-action="import-reset">继续导入</button></div></div>';
    }

    html += '<div class="import-grid">';
    tables.forEach(function (t) {
      html += '<div class="import-card"><div class="top"><span class="ic">' + (t.icon || '📄') + '</span><h4>' + UI.esc(t.label) + '</h4></div>' +
        '<p>' + UI.esc(t.desc) + '</p><div class="row">' +
        '<button class="btn small" data-action="template" data-table="' + t.id + '">' + UI.icon('download', 13) + '下载模板</button>' +
        '<button class="btn small primary" data-action="pick-file" data-table="' + t.id + '">选择文件</button>' +
        '<input type="file" accept=".csv,.xlsx" hidden data-import-file="' + t.id + '">' +
        '</div></div>';
    });
    html += '</div>';

    html += '<div class="card" style="margin-top:16px"><div class="panel-head"><h3>数据快照与恢复</h3><span class="sub">整包 JSON，便于备份或换机器演示</span></div>' +
      '<div class="panel-body"><div class="form-grid">' +
      '<button class="btn" data-action="snapshot-export">' + UI.icon('download') + '导出当前数据快照</button>' +
      '<button class="btn" data-action="restore-demo">' + UI.icon('refresh') + '恢复内置演示数据</button>' +
      '</div><p class="hint" style="margin-top:10px">快照包含全部原始明细与设置，重新导入时可用「数据快照」恢复；当前演示数据为 3 个月、3 店、36 个 SKU、约 ' +
      UI.num(state.data.orders.length) + ' 条订单。</p></div></div>';

    return { html: html };
  }

  function renderImportResult(imp) {
    var r = imp.result;
    var table = root.FinTemplates.getTable(imp.tableId);
    var okBadge = r.ok ? UI.badge('校验通过', 'ok') : UI.badge(r.errorCount + ' 处错误', 'bad');
    var html = '<div class="import-result"><div class="head">' + okBadge + '<h4>' + UI.esc(table.label) + '</h4>' +
      '<span class="muted tiny">' + UI.esc(imp.fileName) + '</span>' +
      '<button class="btn ghost small" style="margin-left:auto" data-action="import-cancel">取消</button></div>';
    html += '<div class="kv">' +
      '<div><div class="k">读取行数</div><div class="v">' + UI.num(r.stats.rows) + '</div></div>' +
      '<div><div class="k">通过校验</div><div class="v">' + UI.num(r.stats.valid) + '</div></div>' +
      '<div><div class="k">将写入记录</div><div class="v">' + UI.num(r.stats.outputRows) + '</div></div>' +
      '<div><div class="k">错误</div><div class="v" style="color:' + (r.errorCount ? 'var(--red)' : 'var(--jade)') + '">' + r.errorCount + '</div></div>' +
      '<div><div class="k">警告</div><div class="v">' + (r.warningCount || 0) + '</div></div>' +
      '</div>';

    var mapped = [];
    Object.keys(r.mapping || {}).forEach(function (i) {
      var key = r.mapping[i];
      var fld = table.fields.filter(function (f) { return f.key === key; })[0];
      mapped.push('<span class="badge neutral">' + UI.esc(r.headers[i]) + ' → ' + UI.esc(fld ? fld.label : key) + '</span>');
    });
    html += '<div style="margin-top:12px"><div class="k">字段映射</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px">' +
      (mapped.join('') || '<span class="muted tiny">没有识别到字段</span>') + '</div>';
    if (r.unmatched && r.unmatched.length) {
      html += '<p class="hint" style="margin-top:6px">未识别列（将忽略）：' + UI.esc(r.unmatched.join('、')) + '</p>';
    }
    html += '</div>';

    if (r.errors && r.errors.length) {
      html += '<div style="margin-top:14px"><div class="k" style="color:var(--red)">错误清单（前 ' + Math.min(20, r.errors.length) + ' 条）</div>' +
        UI.table({
          columns: [
            { key: 'row', label: '行号', num: true, width: '60px' },
            { key: 'field', label: '字段', width: '110px' },
            { key: 'value', label: '原值' },
            { key: 'message', label: '原因' }
          ],
          rows: r.errors.slice(0, 20)
        }) + '<button class="btn small" style="margin-top:8px" data-action="export-errors">下载完整错误清单</button></div>';
    }
    if (r.warnings && r.warnings.length) {
      html += '<div style="margin-top:12px"><div class="k">警告（不影响导入）</div><ul class="hint" style="margin:6px 0 0 18px">' +
        r.warnings.slice(0, 5).map(function (w) { return '<li>' + UI.esc(w) + '</li>'; }).join('') + '</ul></div>';
    }

    if (r.preview && r.preview.length) {
      var keys = Object.keys(r.preview[0]).filter(function (k) { return k !== '__row'; }).slice(0, 8);
      html += '<div style="margin-top:14px"><div class="k">数据预览（前 5 条）</div>' + UI.table({
        columns: keys.map(function (k) { return { key: k, label: k }; }),
        rows: r.preview
      }) + '</div>';
    }

    if (r.ok) {
      html += '<div style="margin-top:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<label class="tiny"><input type="radio" name="import-mode" value="append" checked> 追加 / 覆盖同号记录</label>' +
        '<label class="tiny"><input type="radio" name="import-mode" value="replace"> 替换整表</label>' +
        '<button class="btn primary" data-action="apply-import">确认导入并重算</button></div>';
    } else {
      html += '<p class="hint" style="margin-top:12px">修正错误后重新选择文件即可，当前数据未被修改。</p>';
    }
    html += '</div>';
    return html;
  }

  function importFile(tableId, file) {
    root.FinImporter.readFile(file).then(function (parsed) {
      var result = root.FinImporter.prepare(tableId, parsed, state.data, 'append');
      if (parsed.truncated) result.warnings.unshift('文件超过 20000 行，已截断；请拆分后分批导入');
      state.import = { tableId: tableId, fileName: file.name, result: result, parsed: parsed, file: file };
      render();
    }).catch(function (e) {
      UI.toast(e.message || '文件解析失败', 'err');
    });
  }

  function applyImport() {
    var imp = state.import;
    if (!imp || !imp.result || !imp.result.ok) return;
    var modeEl = document.querySelector('input[name="import-mode"]:checked');
    var mode = modeEl ? modeEl.value : 'append';
    if (apiMode()) {
      // 服务端模式：后端重新解析、校验并在事务中写库，前端预览结果不作为依据
      UI.toast('正在写入服务器并重算…', 'ok');
      root.FinApi.commitImport(imp.tableId, imp.file, mode).then(function (res) {
        return root.FinApi.loadDataset().then(function (data) {
          state.data = data;
          compute();
          state.imported = true;
          state.import = { done: { label: imp.result.label, rows: res.written } };
          UI.toast('导入完成，已保存到服务器并重新核算', 'ok');
          render();
        });
      }).catch(function (e) {
        UI.toast('导入失败：' + e.message, 'err');
      });
      return;
    }
    var backup = state.data;
    try {
      state.data = root.FinImporter.apply(state.data, imp.result.patch, mode);
      compute();
      state.imported = true;
      state.import = { done: { label: imp.result.label, rows: imp.result.stats.outputRows } };
      UI.toast('导入完成，已重新核算', 'ok');
      render();
    } catch (e) {
      state.data = backup;
      compute();
      UI.toast('导入失败：' + e.message, 'err');
    }
  }

  // ---------------- 设置 ----------------
  function renderSettings(ctx) {
    var d = state.data, s = d.settings;
    var html = '';
    html += '<div class="page-head"><div><div class="eyebrow">Settings</div><h2>设置</h2>' +
      '<p>修改后点保存，系统立即按新参数重算；设置保存在本机浏览器。</p></div></div>';

    html += '<div class="grid grid-12"><div class="card span-7"><div class="panel-head"><h3>店铺与平台费率</h3><span class="sub">有平台账单时损益取账单实际值，费率用于估算与对账基准</span></div>' +
      '<div class="panel-body"><div class="table-wrap"><table class="data"><thead><tr><th>店铺</th><th>平台</th><th class="num">佣金率 %</th><th class="num">软件服务费 %</th><th class="num">支付手续费 %</th><th class="num">运费险 %</th><th class="num">账期(天)</th></tr></thead><tbody>';
    d.stores.forEach(function (st) {
      html += '<tr><td class="name">' + UI.esc(st.name) + '<span class="sub">' + st.id + '</span></td>' +
        '<td>' + UI.platformName(st.platform) + '</td>' +
        ['commission_rate', 'tech_fee_rate', 'payment_fee_rate', 'insurance_rate'].map(function (k) {
          return '<td class="num"><input class="input num" style="width:74px" data-rate="' + st.id + '|' + k + '" value="' + (Number(st[k]) * 100).toFixed(2) + '"></td>';
        }).join('') +
        '<td class="num"><input class="input num" style="width:58px" data-rate="' + st.id + '|settlement_days" value="' + Number(st.settlement_days || 0) + '"></td></tr>';
    });
    html += '</tbody></table>' +
      '<p class="hint" style="margin-top:10px">参考口径：天猫/淘宝佣金常见 2%–5% + 基础软件服务费 0.6%（60 元封顶已于 2025-11-30 到期，现行不封顶）；支付手续费 0.6% 仅贷记渠道（借记卡、余额宝免费）；小红书类目技术服务费 2%–5%，前 100 万免佣已于 2026-08-31 到期。演示数据为示例值，请按你的平台协议调整。</p>' +
      '</div></div></div>';

    html += '<div class="card span-5"><div class="panel-head"><h3>提成阶梯</h3><span class="sub">按店铺贡献毛利分档，左闭右开</span></div>' +
      '<div class="panel-body"><div id="ladder-editor">' +
      (s.commission_ladder || []).map(function (b, i) {
        return '<div class="ladder-row" data-ladder-row="' + i + '">' +
          '<div class="field"><label>下限</label><input class="input num" data-ladder="min" value="' + (b.min || 0) + '"></div>' +
          '<div class="field"><label>上限(空=不限)</label><input class="input num" data-ladder="max" value="' + (b.max === null || b.max === undefined ? '' : b.max) + '"></div>' +
          '<div class="field"><label>提成率 %</label><input class="input num" data-ladder="rate" value="' + (Number(b.rate) * 100).toFixed(2) + '"></div>' +
          '<span></span><button class="btn ghost small" data-action="del-ladder" data-index="' + i + '">✕</button></div>';
      }).join('') + '</div>' +
      '<button class="btn small" data-action="add-ladder" style="margin-top:6px">+ 增加一档</button>' +
      '<div class="field" style="margin-top:14px"><label>提成基数</label><select class="select" id="basis-select">' +
      '<option value="gross_profit"' + (s.default_basis === 'gross_profit' ? ' selected' : '') + '>贡献毛利（收入 − 商品成本 − 物流）</option>' +
      '<option value="revenue"' + (s.default_basis === 'revenue' ? ' selected' : '') + '>净销售额</option></select></div>' +
      '<div class="field" style="margin-top:10px"><label>滞销判定天数</label><input class="input num" id="slow-days" value="' + (s.slow_moving_days || 60) + '" style="width:110px"></div>' +
      '</div></div></div>';
    html += '</div>';

    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>数据与恢复</h3><span class="sub">' + (state.imported ? '当前使用导入数据（本次会话）' : '当前使用内置演示数据') + '</span></div>' +
      '<div class="panel-body"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="btn primary" data-action="save-settings">' + UI.icon('check') + '保存并重算</button>' +
      '<button class="btn" data-action="snapshot-export">' + UI.icon('download') + '导出数据快照</button>' +
      '<button class="btn" data-action="restore-demo">' + UI.icon('refresh') + '恢复演示数据与默认设置</button>' +
      '<span class="hint">订单 ' + UI.num(d.orders.length) + ' 条 · 账单 ' + d.platform_bills.length + ' 张 · 发票 ' + d.invoices.length + ' 张</span>' +
      '</div></div></div>';

    return { html: html };
  }

  function saveSettings() {
    var d = state.data;
    d.stores.forEach(function (st) {
      ['commission_rate', 'tech_fee_rate', 'payment_fee_rate', 'insurance_rate', 'settlement_days'].forEach(function (k) {
        var el = document.querySelector('[data-rate="' + st.id + '|' + k + '"]');
        if (!el) return;
        var v = Number(el.value);
        if (!isFinite(v)) return;
        st[k] = k === 'settlement_days' ? Math.round(v) : v / 100;
      });
    });
    var ladder = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-ladder-row]'), function (row) {
      var min = Number(row.querySelector('[data-ladder="min"]').value) || 0;
      var maxRaw = row.querySelector('[data-ladder="max"]').value;
      var rate = Number(row.querySelector('[data-ladder="rate"]').value);
      if (!isFinite(rate)) return;
      ladder.push({ min: min, max: maxRaw === '' ? null : Number(maxRaw), rate: rate / 100 });
    });
    ladder.sort(function (a, b) { return a.min - b.min; });
    if (ladder.length) d.settings.commission_ladder = ladder;
    var basis = document.getElementById('basis-select');
    if (basis) d.settings.default_basis = basis.value;
    var slow = document.getElementById('slow-days');
    if (slow) d.settings.slow_moving_days = Math.max(1, Math.round(Number(slow.value) || 60));

    if (apiMode()) {
      var payload = {
        settings: { commission_ladder: d.settings.commission_ladder, default_basis: d.settings.default_basis, slow_moving_days: d.settings.slow_moving_days },
        stores: d.stores.reduce(function (acc, st) {
          acc[st.id] = { commission_rate: st.commission_rate, tech_fee_rate: st.tech_fee_rate, payment_fee_rate: st.payment_fee_rate, insurance_rate: st.insurance_rate, settlement_days: st.settlement_days };
          return acc;
        }, {})
      };
      root.FinApi.saveSettings(payload).then(function () { return root.FinApi.loadDataset(); }).then(function (data) {
        state.data = data; compute(); UI.toast('设置已保存到服务器，报表已重算', 'ok'); render();
      }).catch(function (e) { UI.toast('保存失败：' + e.message, 'err'); });
      return;
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        settings: {
          commission_ladder: d.settings.commission_ladder,
          default_basis: d.settings.default_basis,
          slow_moving_days: d.settings.slow_moving_days
        },
        stores: d.stores.reduce(function (acc, st) {
          acc[st.id] = {
            commission_rate: st.commission_rate, tech_fee_rate: st.tech_fee_rate,
            payment_fee_rate: st.payment_fee_rate, insurance_rate: st.insurance_rate,
            settlement_days: st.settlement_days
          };
          return acc;
        }, {})
      }));
    } catch (e) { /* 本地存储不可用时忽略 */ }
    compute();
    UI.toast('设置已保存，报表已重算', 'ok');
    render();
  }

  function restoreDemo() {
    if (apiMode()) { UI.toast('服务端模式下数据以数据库为准，不能一键恢复演示数据', 'err'); return; }
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* ignore */ }
    state.data = root.FinDemoData.buildDemoData();
    state.imported = false;
    state.import = null;
    compute();
    UI.toast('已恢复内置演示数据', 'ok');
    render();
  }

  // ---------------- 口径说明 ----------------
  function renderFormulas(ctx) {
    var model = state.model;
    var html = '';
    html += '<div class="page-head"><div><div class="eyebrow">Definitions</div><h2>口径与说明</h2>' +
      '<p>老板要的"数据能对上"，第一步是每个数字都知道怎么来的。</p></div></div>';
    html += '<div class="callout" style="margin-bottom:14px">' + UI.icon('info') +
      '<div><b>核算原则：</b>所有报表由原始明细（订单、账单、面单、采购、工资、费用、发票）计算；平台费用和结算金额以平台账单为准，系统按订单重算一遍用于对账；汇总数都能下钻到明细。</div></div>';

    html += '<div class="grid grid-12">';
    html += '<div class="card span-7"><div class="panel-head"><h3>指标公式</h3><span class="sub">与引擎实现一一对应</span></div><div class="panel-body">' +
      Object.keys(engineFormulas()).map(function (k) {
        return '<div style="padding:9px 0;border-bottom:1px dashed var(--line)"><div style="font-size:12.5px;font-weight:600">' +
          UI.esc(FORMULA_LABELS[k] || k) + '</div><div class="hint">' + UI.esc(engineFormulas()[k]) + '</div></div>';
      }).join('') + '</div></div>';

    html += '<div class="card span-5"><div class="panel-head"><h3>勾稽校验</h3><span class="sub">每次重算自动执行</span></div><div class="panel-body">' +
      model.checks.map(function (c) {
        return '<div style="padding:9px 0;border-bottom:1px dashed var(--line);display:flex;gap:8px;align-items:flex-start">' +
          (c.ok ? UI.badge('通过', 'ok') : UI.badge('异常', 'bad')) +
          '<div><div style="font-size:12.5px;font-weight:600">' + UI.esc(c.label) + '</div><div class="hint">' + UI.esc(c.detail || '') + '</div></div></div>';
      }).join('') + '</div></div>';
    html += '</div>';

    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>数据来源</h3><span class="sub">每张表的用途与导入方式</span></div><div class="panel-body">' +
      UI.table({
        columns: [
          { key: 'table', label: '数据表', render: function (r) { return '<b>' + UI.esc(r.table) + '</b><span class="sub">' + UI.esc(r.desc) + '</span>'; } },
          { key: 'count', label: '当前记录', num: true },
          { key: 'source', label: '来源' }
        ],
        rows: [
          { table: '订单 / 订单明细', desc: '店铺后台导出，一行一个商品', count: state.data.orders.length + ' / ' + state.data.order_items.length, source: '淘宝、天猫、小红书导出' },
          { table: '物流面单', desc: '首重、区域加价、退回运费', count: state.data.shipments.length, source: '快递 / 电子面单 / 仓配系统' },
          { table: '平台账单', desc: '佣金、服务费、推广、结算金额', count: state.data.platform_bills.length, source: '平台结算中心' },
          { table: '平台打款', desc: '银行回款流水', count: state.data.payouts.length, source: '银行 / 平台资金账户' },
          { table: '采购单 / 明细', desc: '采购入库，用于移动加权成本', count: state.data.purchase_orders.length + ' / ' + state.data.purchase_items.length, source: 'ERP / 采购系统' },
          { table: '费用', desc: '仓储、推广、包装、办公', count: state.data.expenses.length, source: '费用报销 / 对账单' },
          { table: '发票', desc: '进项 / 销项台账与匹配', count: state.data.invoices.length, source: '发票系统 / 手工登记' },
          { table: '员工 / 工资规则', desc: '底薪、补贴、提成份额', count: state.data.employees.length, source: '人事 / 手工维护' }
        ]
      }) + '</div></div>';

    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>演示数据声明</h3></div><div class="panel-body"><p class="hint">' +
      '本系统内置数据为虚构品牌「麓野 LUYE」的 3 个月经营数据，用于演示核算与报表能力，不代表任何真实商家。' +
      '真实使用时，把店铺后台、物流、ERP、采购、工资表导出的文件按模板整理后导入即可；平台 API 直连不在本期范围。' +
      '金额单位人民币元，账期为月，成本核算采用移动加权平均。</p></div></div>';

    return { html: html };
  }
  function engineFormulas() { return Engine.FORMULAS; }

  // ---------------- 下钻 ----------------
  function drill(type, id) {
    var model = state.model;
    if (type === 'store') {
      var sm = model.storeMonth[id];
      var rows = model.months.map(function (m) {
        return Object.assign({ month: m }, sm[m]);
      });
      var skus = model.skuMonth.filter(function (r) { return r.month === (state.month === 'all' ? model.months[model.months.length - 1] : state.month); });
      UI.modal({
        title: storeName(id),
        subtitle: '月度损益 · ' + (state.month === 'all' ? '全部账期' : UI.fullMonth(state.month)) + '（点击表头可导出 CSV 请到对应页面）',
        body: '<div class="kv" style="margin-bottom:14px">' +
          '<div><div class="k">GMV</div><div class="v">' + UI.money(rows.reduce(function (s, r) { return s + r.gmv; }, 0)) + '</div></div>' +
          '<div><div class="k">营业收入</div><div class="v">' + UI.money(rows.reduce(function (s, r) { return s + r.revenue; }, 0)) + '</div></div>' +
          '<div><div class="k">净利润</div><div class="v">' + UI.money(rows.reduce(function (s, r) { return s + r.netProfit; }, 0)) + '</div></div>' +
          '</div>' + UI.table({
            columns: [
              { key: 'month', label: '月份' }, { key: 'gmv', label: 'GMV', num: true, render: function (r) { return UI.money(r.gmv); } },
              { key: 'revenue', label: '营业收入', num: true, render: function (r) { return UI.money(r.revenue); } },
              { key: 'cogs', label: '商品成本', num: true, render: function (r) { return UI.money(r.cogs); } },
              { key: 'freight', label: '物流', num: true, render: function (r) { return UI.money(r.freight); } },
              { key: 'platformFees', label: '平台费', num: true, render: function (r) { return UI.money(r.platformFees); } },
              { key: 'promotion', label: '推广', num: true, render: function (r) { return UI.money(r.promotion); } },
              { key: 'labor', label: '人工', num: true, render: function (r) { return UI.money(r.labor); } },
              { key: 'netProfit', label: '净利润', num: true, render: function (r) { return '<b>' + UI.money(r.netProfit) + '</b>'; } },
              { key: 'netMargin', label: '净利率', num: true, render: function (r) { return UI.pct(r.netMargin); } }
            ],
            rows: rows
          }) +
          '<p class="hint" style="margin-top:12px">口径：营业收入 = GMV − 退款 + 平台补贴；平台费用取账单实际值；人工含底薪分摊与提成。</p>' +
          recentOrdersTable(id)
      });
      return;
    }
    if (type === 'sku' || type === 'product') {
      var sku = state.data.skus.filter(function (s) { return s.id === id; })[0] || {};
      var invRow = model.inventory.bySku.filter(function (b) { return b.sku_id === id; })[0] || {};
      var srows = model.skuMonth.filter(function (r) { return r.sku_id === id; });
      UI.modal({
        title: sku.name || id,
        subtitle: (sku.category || '') + ' · ' + (sku.spec || '') + ' · 零售价 ' + UI.money(sku.list_price || 0),
        body: '<div class="kv" style="margin-bottom:14px">' +
          '<div><div class="k">累计收入</div><div class="v">' + UI.money(srows.reduce(function (s, r) { return s + r.netRevenue; }, 0)) + '</div></div>' +
          '<div><div class="k">累计毛利</div><div class="v">' + UI.money(srows.reduce(function (s, r) { return s + r.grossProfit; }, 0)) + '</div></div>' +
          '<div><div class="k">期末库存</div><div class="v">' + UI.num(invRow.closingQty || 0) + ' 件 / ' + UI.money(invRow.closingValue || 0) + '</div></div>' +
          '</div>' + UI.table({
            columns: [
              { key: 'month', label: '月份' }, { key: 'qty', label: '销量', num: true },
              { key: 'revenue', label: '收入', num: true, render: function (r) { return UI.money(r.revenue); } },
              { key: 'refundAmount', label: '退款', num: true, render: function (r) { return UI.money(r.refundAmount); } },
              { key: 'cogs', label: '成本', num: true, render: function (r) { return UI.money(r.cogs); } },
              { key: 'grossProfit', label: '毛利', num: true, render: function (r) { return UI.money(r.grossProfit); } },
              { key: 'grossMargin', label: '毛利率', num: true, render: function (r) { return UI.pct(r.grossMargin); } }
            ],
            rows: srows
          }) + recentSkuOrdersTable(id)
      });
      return;
    }
    if (type === 'bill') {
      var b = model.reconciliation.bills.filter(function (x) { return x.bill_id === id; })[0];
      if (!b) return;
      UI.modal({
        title: b.store_name + ' · ' + b.period + ' 平台账单',
        subtitle: '账单号 ' + b.bill_id + ' · ' + (b.status === 'settled' ? '已结算' : '待结算'),
        body: '<div class="kv" style="margin-bottom:14px">' +
          '<div><div class="k">账单 GMV</div><div class="v">' + UI.money(b.gmv) + '</div></div>' +
          '<div><div class="k">结算金额</div><div class="v">' + UI.money(b.settledAmount) + '</div></div>' +
          '<div><div class="k">重算金额</div><div class="v">' + UI.money(b.recomputed) + '</div></div>' +
          '<div><div class="k">差异</div><div class="v" style="color:' + (Math.abs(b.diff) > 0.01 ? 'var(--red)' : 'var(--jade)') + '">' + UI.money2(b.diff) + '</div></div>' +
          '</div>' + UI.table({
            columns: [{ key: 'item', label: '项目' }, { key: 'amount', label: '金额', num: true, render: function (r) { return UI.money2(r.amount); } }],
            rows: [
              { item: 'GMV（订单实付）', amount: b.gmv }, { item: '退款', amount: -b.refund },
              { item: '平台补贴', amount: b.subsidy }, { item: '佣金', amount: -b.commission },
              { item: '软件服务费', amount: -b.techFee }, { item: '支付手续费', amount: -b.paymentFee },
              { item: '推广费（代扣）', amount: -b.promotion }, { item: '运费险', amount: -b.insurance },
              { item: '其他扣款', amount: -b.otherDeduction }, { item: '应结算（重算）', amount: b.recomputed }
            ]
          }) + (b.note ? '<p class="callout" style="margin-top:12px">' + UI.icon('info') + '<span>' + UI.esc(b.note) + '</span></p>' : '')
      });
      return;
    }
    if (type === 'employee') {
      var rows2 = [];
      model.months.forEach(function (m) {
        var r = model.payroll.byMonth[m].rows.filter(function (x) { return x.employee_id === id; })[0];
        if (r) rows2.push(r);
      });
      var emp = state.data.employees.filter(function (e) { return e.id === id; })[0] || {};
      UI.modal({
        title: emp.name || id,
        subtitle: (emp.role || '') + ' · 底薪 ' + UI.money(emp.base_salary || 0) + ' · 提成基数 ' + (emp.basis === 'revenue' ? '净销售额' : '贡献毛利'),
        body: '<div class="kv" style="margin-bottom:14px">' +
          '<div><div class="k">累计应发</div><div class="v">' + UI.money(rows2.reduce(function (s, r) { return s + r.gross; }, 0)) + '</div></div>' +
          '<div><div class="k">累计提成</div><div class="v">' + UI.money(rows2.reduce(function (s, r) { return s + r.commission; }, 0)) + '</div></div>' +
          '<div><div class="k">负责店铺</div><div class="v">' + ((emp.store_ids || []).map(function (sid) { return storeName(sid); }).join('、') || '公共（按收入分摊）') + '</div></div>' +
          '</div>' + UI.table({
            columns: [
              { key: 'month', label: '月份' }, { key: 'base_salary', label: '底薪', num: true, render: function (r) { return UI.money(r.base_salary); } },
              { key: 'allowance', label: '补贴', num: true, render: function (r) { return UI.money(r.allowance); } },
              { key: 'commission', label: '提成', num: true, render: function (r) { return UI.money(r.commission); } },
              { key: 'deduction', label: '代扣', num: true, render: function (r) { return UI.money(r.deduction); } },
              { key: 'gross', label: '应发', num: true, render: function (r) { return UI.money(r.gross); } },
              { key: 'net', label: '实发', num: true, render: function (r) { return UI.money(r.net); } }
            ],
            rows: rows2
          })
      });
      return;
    }
    if (type === 'invoice') {
      var all = model.invoices.input.list.concat(model.invoices.output.list);
      var inv = all.filter(function (x) { return x.id === id; })[0];
      if (!inv) return;
      UI.modal({
        title: '发票 ' + (inv.number || inv.id),
        subtitle: (inv.direction === 'output' ? '销项' : '进项') + ' · ' + inv.date,
        body: '<div class="kv">' +
          ['seller:销方', 'buyer:购方', 'amount:价税合计', 'tax_amount:税额', 'related_type:关联类型', 'related_id:关联单据', 'expected:应匹配金额', 'status:状态'].map(function (pair) {
            var k = pair.split(':')[0], label = pair.split(':')[1];
            var v = inv[k];
            if (/amount|expected/.test(k)) v = UI.money2(v);
            return '<div><div class="k">' + label + '</div><div class="v">' + UI.esc(v) + '</div></div>';
          }).join('') + '</div>' + (inv.note ? '<p class="hint" style="margin-top:12px">' + UI.esc(inv.note) + '</p>' : '')
      });
      return;
    }
    if (type === 'check') {
      var c = model.checks.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      UI.modal({
        title: c.label, subtitle: c.ok ? '校验通过' : '校验异常',
        body: '<div class="kv"><div><div class="k">期望值</div><div class="v">' + UI.money2(c.expected) + '</div></div>' +
          '<div><div class="k">实际值</div><div class="v">' + UI.money2(c.actual) + '</div></div>' +
          '<div><div class="k">差异</div><div class="v">' + UI.money2(c.diff) + '</div></div></div>' +
          '<p class="hint" style="margin-top:12px">' + UI.esc(c.detail || '') + '</p>'
      });
      return;
    }
    if (type === 'bill-note') {
      UI.modal({ title: '差异说明', body: '<p>' + UI.esc(id) + '</p>' });
    }
  }

  function recentOrdersTable(storeId) {
    var data = state.data, model = state.model;
    var orderMap = {};
    data.orders.forEach(function (o) { orderMap[o.id] = o; });
    var rows = data.orders.filter(function (o) {
      return o.store_id === storeId && (state.month === 'all' || o.order_date.slice(0, 7) === state.month);
    }).slice(-10).reverse();
    if (!rows.length) return '';
    return '<div style="margin-top:16px"><div class="panel-head" style="padding:0 0 8px"><h3 style="font-size:13px">最近订单明细（' + rows.length + ' 笔）</h3>' +
      '<span class="sub" style="margin-left:auto">汇总数由这些明细计算</span></div>' + UI.table({
        columns: [
          { key: 'id', label: '订单号', render: function (r) { return '<span class="mono">' + r.id + '</span>'; } },
          { key: 'order_date', label: '下单日期' },
          { key: 'paid_amount', label: '实付', num: true, render: function (r) { return UI.money2(r.paid_amount); } },
          { key: 'refund_amount', label: '退款', num: true, render: function (r) { return UI.money2(r.refund_amount); } },
          { key: 'status', label: '状态', render: function (r) { return r.status === 'paid' ? UI.badge('已支付', 'ok') : r.status === 'refunded' ? UI.badge('已退款', 'bad') : UI.badge('部分退款', 'warn'); } },
          { key: 'province', label: '省份' }
        ],
        rows: rows
      }) + '<p class="hint" style="margin-top:6px">演示环境只显示最近 10 笔；导入真实数据后可按同样口径查看。</p></div>';
  }

  function recentSkuOrdersTable(skuId) {
    var data = state.data;
    var orderMap = {};
    data.orders.forEach(function (o) { orderMap[o.id] = o; });
    var rows = [];
    data.order_items.forEach(function (it) {
      var o = orderMap[it.order_id];
      if (!o || it.sku_id !== skuId) return;
      if (state.month !== 'all' && o.order_date.slice(0, 7) !== state.month) return;
      if (state.store !== 'all' && o.store_id !== state.store) return;
      rows.push({ order_id: it.order_id, order_date: o.order_date, qty: it.qty, amount: it.amount, refund_amount: it.refund_amount, store: o.store_id });
    });
    rows = rows.slice(-10).reverse();
    if (!rows.length) return '';
    return '<div style="margin-top:16px"><div class="panel-head" style="padding:0 0 8px"><h3 style="font-size:13px">最近订单明细（' + rows.length + ' 笔）</h3></div>' + UI.table({
      columns: [
        { key: 'order_id', label: '订单号', render: function (r) { return '<span class="mono">' + r.order_id + '</span>'; } },
        { key: 'order_date', label: '下单日期' },
        { key: 'qty', label: '数量', num: true },
        { key: 'amount', label: '金额', num: true, render: function (r) { return UI.money2(r.amount); } },
        { key: 'refund_amount', label: '退款', num: true, render: function (r) { return UI.money2(r.refund_amount); } }
      ],
      rows: rows
    }) + '</div>';
  }

  // ---------------- 事件 ----------------
  function bindEvents() {
    document.addEventListener('click', function (e) {
      var navBtn = e.target.closest('[data-page]');
      if (navBtn && navBtn.classList.contains('nav-item') || navBtn && navBtn.classList.contains('btn')) {
        if (navBtn.getAttribute('data-page')) { go(navBtn.getAttribute('data-page')); return; }
      }
      var monthBtn = e.target.closest('[data-month]');
      if (monthBtn) { state.month = monthBtn.getAttribute('data-month'); render(); return; }
      var sortTh = e.target.closest('th[data-sort]');
      if (sortTh) {
        var key = sortTh.getAttribute('data-sort');
        var cur = state.sort[state.page] || {};
        state.sort[state.page] = { key: key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc' };
        render(); return;
      }
      var drillEl = e.target.closest('[data-drill]');
      if (drillEl) { drill(drillEl.getAttribute('data-drill'), drillEl.getAttribute('data-id')); return; }
      var alertEl = e.target.closest('[data-alert-index]');
      if (alertEl) {
        var a = state.model.alerts[Number(alertEl.getAttribute('data-alert-index'))];
        if (a && a.page) go(a.page === 'settlement' ? 'settlement' : a.page === 'stores' ? 'stores' : a.page);
        return;
      }
      var closeEl = e.target.closest('[data-close-modal]');
      if (closeEl) { UI.closeModal(); return; }
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');
      if (action === 'go') { go(actionEl.getAttribute('data-page')); return; }
      if (action === 'print') { window.print(); return; }
      if (action === 'export') {
        if (!state.lastExport) { UI.toast('当前页面没有可导出的表格', 'err'); return; }
        UI.downloadCsv(state.lastExport.name, state.lastExport.headers, state.lastExport.rows);
        return;
      }
      if (action === 'template') {
        var tid = actionEl.getAttribute('data-table');
        var t = root.FinTemplates.getTable(tid);
        UI.download(t.label + '导入模板.csv', root.FinTemplates.templateCsv(tid), 'text/csv;charset=utf-8');
        return;
      }
      if (action === 'pick-file') {
        var input = document.querySelector('[data-import-file="' + actionEl.getAttribute('data-table') + '"]');
        if (input) input.click();
        return;
      }
      if (action === 'import-cancel') { state.import = null; render(); return; }
      if (action === 'apply-import') { applyImport(); return; }
      if (action === 'import-reset') { state.import = null; render(); return; }
      if (action === 'export-errors') {
        var res = state.import && state.import.result;
        if (!res) return;
        UI.downloadCsv('导入错误清单-' + res.tableId + '.csv', ['行号', '字段', '原值', '原因'],
          res.errors.map(function (x) { return [x.row, x.field, x.value, x.message]; }));
        return;
      }
      if (action === 'save-settings') { saveSettings(); return; }
      if (action === 'add-ladder') {
        var ed = document.getElementById('ladder-editor');
        var n = ed.querySelectorAll('[data-ladder-row]').length;
        var div = document.createElement('div');
        div.className = 'ladder-row';
        div.setAttribute('data-ladder-row', n);
        div.innerHTML = '<div class="field"><label>下限</label><input class="input num" data-ladder="min" value="0"></div>' +
          '<div class="field"><label>上限(空=不限)</label><input class="input num" data-ladder="max" value=""></div>' +
          '<div class="field"><label>提成率 %</label><input class="input num" data-ladder="rate" value="0"></div><span></span>' +
          '<button class="btn ghost small" data-action="del-ladder" data-index="' + n + '">✕</button>';
        ed.appendChild(div);
        return;
      }
      if (action === 'del-ladder') {
        var row = actionEl.closest('[data-ladder-row]');
        if (row) row.remove();
        return;
      }
      if (action === 'snapshot-export') {
        UI.download('电商财务数据快照-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state.data, null, 1), 'application/json');
        return;
      }
      if (action === 'restore-demo') { restoreDemo(); return; }
      if (action === 'logout') { root.FinApi.logout(); return; }
    });

    document.addEventListener('change', function (e) {
      if (e.target.id === 'store-filter') {
        state.store = e.target.value;
        render();
        return;
      }
      var fileInput = e.target.closest('[data-import-file]');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        importFile(fileInput.getAttribute('data-import-file'), fileInput.files[0]);
        fileInput.value = '';
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') UI.closeModal();
    });

    window.addEventListener('hashchange', function () {
      var page = (location.hash || '').replace(/^#\//, '');
      if (PAGE_META[page]) { state.page = page; render(); }
    });
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    var start = function (data) {
      state.data = data;
      compute();
      renderSidebar();
      bindEvents();
      var page = (location.hash || '').replace(/^#\//, '');
      state.page = PAGE_META[page] ? page : 'overview';
      render();
    };
    if (!root.FinApi) { start(applySavedSettings(root.FinDemoData.buildDemoData())); return; }
    root.FinApi.boot().then(function (data) {
      start(data || applySavedSettings(root.FinDemoData.buildDemoData()));
    }).catch(function (e) {
      document.getElementById('view').innerHTML = '<div class="card pad"><h3>无法加载数据</h3><p class="muted">' + UI.esc(e.message) + '</p></div>';
    });
  }

  root.App = {
    state: state,
    boot: boot,
    go: go,
    render: render,
    recompute: function () { compute(); render(); },
    drill: drill,
    scopeStores: scopeStores
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
