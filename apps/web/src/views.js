/* 业务页面：店铺 / 商品 / 结算 / 物流 / 库存 / 工资 / 发票 */
(function (root) {
  'use strict';
  var UI = root.UI, Charts = root.Charts;
  var Views = {};

  function monthLabel(ctx) { return UI.fullMonth(ctx.month); }
  function scopeName(ctx) { return ctx.store === 'all' ? '全部店铺' : '单店'; }
  function sortOf(ctx, fallbackKey, fallbackDir) {
    var s = ctx.sort || {};
    return { key: s.key || fallbackKey, dir: s.dir || fallbackDir || 'desc' };
  }
  function exportBtn() { return ''; }

  // ================= 店铺利润 =================
  Views.stores = function (ctx) {
    var model = ctx.model, month = ctx.month;
    var rows = ctx.storeRows().filter(function (r) { return ctx.store === 'all' || r.store_id === ctx.store; });
    var sort = sortOf(ctx, 'netProfit', 'desc');
    rows = UI.sortRows(rows, sort.key, sort.dir, true);
    var tot = rows.reduce(function (a, r) {
      ['gmv', 'revenue', 'cogs', 'freight', 'platformFees', 'promotion', 'labor', 'other', 'netProfit'].forEach(function (k) { a[k] = (a[k] || 0) + (r[k] || 0); });
      return a;
    }, {});
    var totalNet = tot.netProfit || 1;

    var html = '<div class="page-head"><div><div class="eyebrow">Stores</div><h2>店铺利润</h2>' +
      '<p>' + monthLabel(ctx) + ' · ' + scopeName(ctx) + ' · 平台费用取账单实际值，公共费用按收入占比分摊</p></div>' +
      '<div class="head-actions"><button class="btn" data-action="go" data-page="settlement">' + UI.icon('settlement') + '查看对账</button></div></div>';

    html += '<div class="card"><div class="panel-head"><h3>店铺损益表</h3><span class="sub">' + monthLabel(ctx) + ' · 点击行看月度明细</span></div><div class="panel-body flush">' +
      UI.table({
        sort: sort,
        rowAttrs: function (r) { return 'class="clickable" data-drill="store" data-id="' + r.store_id + '"'; },
        columns: [
          { key: 'name', label: '店铺', render: function (r) { return '<span class="name">' + UI.esc(r.name) + '</span><span class="sub">' + UI.esc(UI.platformName(r.platform)) + ' · ' + r.store_id + '</span>'; } },
          { key: 'gmv', label: 'GMV', num: true, sortable: true, render: function (r) { return UI.money(r.gmv); } },
          { key: 'revenue', label: '营业收入', num: true, sortable: true, render: function (r) { return UI.money(r.revenue); } },
          { key: 'cogs', label: '商品成本', num: true, sortable: true, render: function (r) { return UI.money(r.cogs); } },
          { key: 'freight', label: '物流', num: true, sortable: true, render: function (r) { return UI.money(r.freight); } },
          { key: 'platformFees', label: '平台费', num: true, sortable: true, render: function (r) { return UI.money(r.platformFees); } },
          { key: 'promotion', label: '推广', num: true, sortable: true, render: function (r) { return UI.money(r.promotion); } },
          { key: 'labor', label: '人工', num: true, sortable: true, render: function (r) { return UI.money(r.labor); } },
          { key: 'other', label: '其他', num: true, sortable: true, render: function (r) { return UI.money(r.other); } },
          { key: 'netProfit', label: '净利润', num: true, sortable: true, render: function (r) { return '<b class="' + UI.signCls(r.netProfit) + '">' + UI.money(r.netProfit) + '</b>'; } },
          { key: 'netMargin', label: '净利率', num: true, sortable: true, render: function (r) { return UI.pct(r.netMargin); } },
          { key: 'share', label: '利润占比', num: true, sortable: true, render: function (r) { return UI.pct(r.netProfit / totalNet * 100); } }
        ],
        rows: rows,
        footer: [{ html: '<b>合计</b>' },
          { html: '<b>' + UI.money(tot.gmv) + '</b>', num: true }, { html: '<b>' + UI.money(tot.revenue) + '</b>', num: true },
          { html: UI.money(tot.cogs), num: true }, { html: UI.money(tot.freight), num: true }, { html: UI.money(tot.platformFees), num: true },
          { html: UI.money(tot.promotion), num: true }, { html: UI.money(tot.labor), num: true }, { html: UI.money(tot.other), num: true },
          { html: '<b>' + UI.money(tot.netProfit) + '</b>', num: true },
          { html: UI.pct(tot.revenue ? tot.netProfit / tot.revenue * 100 : 0), num: true }, { html: '100%', num: true }]
      }) + '</div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px"><div class="card span-7"><div class="panel-head"><h3>各店净利润走势</h3><span class="sub">按订单与账单计算</span></div>' +
      '<div class="panel-body"><div class="chart">' + Charts.lineChart({
        xLabels: model.months.map(function (m) { return Number(m.slice(5, 7)) + '月'; }),
        series: model.stores.filter(function (s) { return ctx.store === 'all' || s.id === ctx.store; }).map(function (s, i) {
          var colors = ['var(--chart-1)', 'var(--chart-4)', 'var(--chart-6)'];
          return { name: s.name.replace(/（.*?）/, ''), color: colors[i % 3], points: model.months.map(function (m) { return model.storeMonth[s.id][m].netProfit; }) };
        }),
        height: 240, valueFormat: function (v) { return UI.wan(v); }
      }) + '</div></div></div>' +
      '<div class="card span-5"><div class="panel-head"><h3>成本率对比</h3><span class="sub">占营业收入</span></div><div class="panel-body">' +
      rows.map(function (r) {
        return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px"><span>' + UI.esc(r.name) + '</span>' +
          '<span class="mono">净利率 ' + UI.pct(r.netMargin) + '</span></div>' +
          '<div style="height:6px;background:var(--paper-2);border-radius:3px;margin-top:5px;overflow:hidden"><i style="display:block;height:100%;width:' +
          Math.max(2, Math.min(100, r.revenue ? (r.cogs / r.revenue) * 100 : 0)) + '%;background:var(--chart-1)"></i></div>' +
          '<div class="tiny muted" style="margin-top:3px">商品成本率 ' + UI.pct(r.revenue ? r.cogs / r.revenue * 100 : 0) +
          ' · 推广率 ' + UI.pct(r.revenue ? r.promotion / r.revenue * 100 : 0) + '</div></div>';
      }).join('') + '</div></div></div>';

    ctx.setExport('店铺利润-' + (month === 'all' ? '全部' : month) + '.csv',
      ['店铺', '平台', 'GMV', '营业收入', '商品成本', '物流', '平台费', '推广', '人工', '其他', '净利润', '净利率(%)', '利润占比(%)'],
      rows.map(function (r) {
        return [r.name, UI.platformName(r.platform), r.gmv, r.revenue, r.cogs, r.freight, r.platformFees, r.promotion, r.labor, r.other, r.netProfit, r.netMargin, r.netProfit / totalNet * 100];
      }));
    return { html: html };
  };

  // ================= 商品利润 =================
  Views.products = function (ctx) {
    var model = ctx.model;
    var rows = model.skuMonth.filter(function (r) {
      return (ctx.month === 'all' || r.month === ctx.month) && (ctx.store === 'all' || r.store_id === ctx.store);
    });
    var agg = {};
    rows.forEach(function (r) {
      var a = agg[r.sku_id] || (agg[r.sku_id] = {
        sku_id: r.sku_id, sku_name: r.sku_name, category: r.category,
        qty: 0, revenue: 0, refundAmount: 0, cogs: 0, grossProfit: 0, refundQty: 0
      });
      a.qty += r.qty; a.revenue += r.revenue; a.refundAmount += r.refundAmount;
      a.cogs += r.cogs; a.grossProfit += r.grossProfit; a.refundQty += r.refundQty;
    });
    var invMap = {};
    model.inventory.bySku.forEach(function (b) { invMap[b.sku_id] = b; });
    var list = Object.keys(agg).map(function (k) {
      var a = agg[k];
      var inv = invMap[k] || {};
      a.netRevenue = a.revenue - a.refundAmount;
      a.grossMargin = a.netRevenue ? a.grossProfit / a.netRevenue * 100 : 0;
      a.stockQty = inv.closingQty || 0;
      a.stockValue = inv.closingValue || 0;
      a.slow = !!inv.slowMoving;
      return a;
    });
    var sort = sortOf(ctx, 'grossProfit', 'desc');
    list = UI.sortRows(list, sort.key, sort.dir, true);
    var top = list.slice().sort(function (a, b) { return b.grossProfit - a.grossProfit; }).slice(0, 10);
    var total = list.reduce(function (a, r) { a.revenue += r.revenue; a.refundAmount += r.refundAmount; a.cogs += r.cogs; a.grossProfit += r.grossProfit; a.qty += r.qty; return a; }, { revenue: 0, refundAmount: 0, cogs: 0, grossProfit: 0, qty: 0 });

    var html = '<div class="page-head"><div><div class="eyebrow">Products</div><h2>商品利润</h2>' +
      '<p>' + monthLabel(ctx) + ' · ' + list.length + ' 个 SKU 有成交 · 成本按移动加权平均</p></div></div>';

    html += '<div class="grid grid-12"><div class="card span-8"><div class="panel-head"><h3>SKU 毛利排行</h3><span class="sub">' + monthLabel(ctx) + ' · 按毛利</span></div>' +
      '<div class="panel-body">' + UI.table({
        sort: sort,
        rowAttrs: function (r) { return 'class="clickable" data-drill="sku" data-id="' + r.sku_id + '"'; },
        columns: [
          { key: 'sku_name', label: '商品', render: function (r) { return '<span class="name">' + UI.esc(r.sku_name) + '</span><span class="sub">' + UI.esc(r.category) + (r.slow ? ' · 滞销' : '') + '</span>'; } },
          { key: 'qty', label: '销量', num: true, sortable: true },
          { key: 'netRevenue', label: '净收入', num: true, sortable: true, render: function (r) { return UI.money(r.netRevenue); } },
          { key: 'cogs', label: '成本', num: true, sortable: true, render: function (r) { return UI.money(r.cogs); } },
          { key: 'grossProfit', label: '毛利', num: true, sortable: true, render: function (r) { return '<b>' + UI.money(r.grossProfit) + '</b>'; } },
          { key: 'grossMargin', label: '毛利率', num: true, sortable: true, render: function (r) { return UI.pct(r.grossMargin); } },
          { key: 'stockQty', label: '库存', num: true, sortable: true, render: function (r) { return UI.num(r.stockQty); } },
          { key: 'stockValue', label: '库存金额', num: true, sortable: true, render: function (r) { return UI.money(r.stockValue); } }
        ],
        rows: list,
        footer: [{ html: '<b>合计</b>' }, { html: '<b>' + UI.num(total.qty) + '</b>', num: true },
          { html: '<b>' + UI.money(total.revenue - total.refundAmount) + '</b>', num: true }, { html: UI.money(total.cogs), num: true },
          { html: '<b>' + UI.money(total.grossProfit) + '</b>', num: true },
          { html: UI.pct((total.revenue - total.refundAmount) ? total.grossProfit / (total.revenue - total.refundAmount) * 100 : 0), num: true },
          { html: '—', num: true }, { html: '—', num: true }]
      }) + '</div></div>';

    html += '<div class="card span-4"><div class="panel-head"><h3>毛利 Top 10</h3><span class="sub">金额</span></div><div class="panel-body"><div class="chart">' +
      Charts.hBarChart({
        items: top.map(function (r, i) { return { label: r.sku_name, value: r.grossProfit, meta: UI.pct(r.grossMargin) }; }),
        height: 330, valueFormat: function (v) { return UI.wan(v); }
      }) + '</div><p class="hint" style="margin-top:8px">毛利率为「净收入 − 商品成本」口径，不含物流与平台费用。</p></div></div></div>';

    ctx.setExport('商品利润-' + (ctx.month === 'all' ? '全部' : ctx.month) + '.csv',
      ['商品编码', '商品', '类目', '销量', '收入', '退款', '净收入', '商品成本', '毛利', '毛利率(%)', '期末库存', '库存金额', '滞销'],
      list.map(function (r) {
        return [r.sku_id, r.sku_name, r.category, r.qty, r.revenue, r.refundAmount, r.netRevenue, r.cogs, r.grossProfit, r.grossMargin, r.stockQty, r.stockValue, r.slow ? '是' : '否'];
      }));
    return { html: html };
  };

  // ================= 平台结算 =================
  Views.settlement = function (ctx) {
    var model = ctx.model;
    var bills = model.reconciliation.bills.filter(function (b) { return ctx.store === 'all' || b.store_id === ctx.store; });
    if (ctx.month !== 'all') bills = bills.filter(function (b) { return b.period === ctx.month; });
    bills = bills.slice().sort(function (a, b) { return a.period < b.period ? 1 : -1; });
    var sum = bills.reduce(function (a, b) {
      ['gmv', 'refund', 'commission', 'techFee', 'paymentFee', 'promotion', 'insurance', 'subsidy', 'settledAmount', 'recomputed', 'diff'].forEach(function (k) { a[k] = (a[k] || 0) + b[k]; });
      return a;
    }, {});
    var pending = bills.filter(function (b) { return b.status === 'pending'; });
    var pendingAmt = pending.reduce(function (s, b) { return s + b.settledAmount; }, 0);
    var diffBills = bills.filter(function (b) { return b.hasDiff; });

    var html = '<div class="page-head"><div><div class="eyebrow">Settlement</div><h2>平台结算与对账</h2>' +
      '<p>' + monthLabel(ctx) + ' · 账单实际值 vs 按订单重算 · 差异逐笔说明</p></div></div>';

    html += '<div class="grid grid-12"><div class="card kpi span-3"><div class="kpi-label">账单 GMV</div><div class="kpi-value">' + UI.wan(sum.gmv) + '</div><div class="kpi-foot">退款 ' + UI.money(sum.refund) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">结算金额</div><div class="kpi-value">' + UI.wan(sum.settledAmount) + '</div><div class="kpi-foot">佣金 + 服务费 ' + UI.money(sum.commission + sum.techFee) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">差异</div><div class="kpi-value">' + diffBills.length + '<span class="unit">笔</span></div><div class="kpi-foot">金额 ' + UI.money2(sum.diff) + ' · 均已有说明</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">待结算</div><div class="kpi-value">' + UI.wan(pendingAmt) + '</div><div class="kpi-foot">' + pending.length + ' 张账单 · 账期占款 ' + UI.wan(model.cash.total.occupied) + '</div></div></div>';

    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>账单明细</h3><span class="sub">点击行查看账单构成</span></div><div class="panel-body flush">' +
      UI.table({
        rowAttrs: function (r) { return 'class="clickable" data-drill="bill" data-id="' + r.bill_id + '"'; },
        columns: [
          { key: 'store_name', label: '店铺', render: function (r) { return '<span class="name">' + UI.esc(r.store_name) + '</span><span class="sub">' + r.bill_id + '</span>'; } },
          { key: 'period', label: '账期' },
          { key: 'gmv', label: '账单 GMV', num: true, render: function (r) { return UI.money(r.gmv); } },
          { key: 'refund', label: '退款', num: true, render: function (r) { return UI.money(r.refund); } },
          { key: 'commission', label: '佣金', num: true, render: function (r) { return UI.money(r.commission); } },
          { key: 'techFee', label: '软件服务费', num: true, render: function (r) { return UI.money(r.techFee); } },
          { key: 'paymentFee', label: '支付手续费', num: true, render: function (r) { return UI.money(r.paymentFee); } },
          { key: 'promotion', label: '推广', num: true, render: function (r) { return UI.money(r.promotion); } },
          { key: 'insurance', label: '运费险', num: true, render: function (r) { return UI.money(r.insurance); } },
          { key: 'settledAmount', label: '结算金额', num: true, render: function (r) { return '<b>' + UI.money2(r.settledAmount) + '</b>'; } },
          { key: 'recomputed', label: '重算', num: true, render: function (r) { return UI.money2(r.recomputed); } },
          { key: 'diff', label: '差异', num: true, render: function (r) { return '<span class="' + (Math.abs(r.diff) > 0.01 ? 'neg' : 'muted') + '">' + UI.money2(r.diff) + '</span>'; } },
          { key: 'status', label: '状态', render: function (r) { return r.status === 'settled' ? UI.badge('已结算', 'ok') : UI.badge('待结算', 'warn'); } }
        ],
        rows: bills
      }) + '</div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px">';
    html += '<div class="card span-7"><div class="panel-head"><h3>差异清单</h3><span class="sub">账单与订单 / 重算的差异及原因</span></div><div class="panel-body">';
    if (diffBills.length) {
      html += diffBills.map(function (b) {
        var parts = [];
        if (Math.abs(b.gmvDiff) > 0.01) parts.push('账单 GMV 与订单差 ' + UI.money2(b.gmvDiff));
        if (Math.abs(b.refundDiff) > 0.01) parts.push('退款差 ' + UI.money2(b.refundDiff));
        if (Math.abs(b.diff) > 0.01) parts.push('结算差 ' + UI.money2(b.diff));
        return '<div style="padding:10px 0;border-bottom:1px dashed var(--line)"><div style="display:flex;justify-content:space-between;gap:10px">' +
          '<b style="font-size:12.5px">' + UI.esc(b.store_name) + ' · ' + b.period + '</b>' + UI.badge('已说明', 'ok') + '</div>' +
          '<div class="hint" style="margin-top:3px">' + parts.join('；') + '</div>' +
          '<div class="hint" style="margin-top:3px;color:var(--ink-2)">原因：' + UI.esc(b.note || '—') + '</div></div>';
      }).join('');
    } else {
      html += '<div class="callout">' + UI.icon('check') + '<span>本账期账单与订单、重算结果一致。</span></div>';
    }
    html += '</div></div>';

    html += '<div class="card span-5"><div class="panel-head"><h3>打款核对</h3><span class="sub">银行到账 vs 账单结算</span></div><div class="panel-body">' +
      UI.table({
        columns: [
          { key: 'bill_id', label: '账单', render: function (r) { return '<span class="mono">' + UI.esc(r.bill_id.replace('BILL-', '')) + '</span>'; } },
          { key: 'settledAmount', label: '应结算', num: true, render: function (r) { return UI.money2(r.settledAmount); } },
          { key: 'paid', label: '已到账', num: true, render: function (r) { return UI.money2(r.paid); } },
          { key: 'payoutDiff', label: '差异', num: true, render: function (r) { return '<span class="' + (Math.abs(r.payoutDiff || 0) > 0.01 ? 'neg' : 'muted') + '">' + UI.money2(r.payoutDiff || 0) + '</span>'; } }
        ],
        rows: bills.filter(function (b) { return b.status === 'settled'; })
      }) + '<p class="hint" style="margin-top:8px">已回款合计 ' + UI.money2(model.cash.total.received) + '；待结算 ' + UI.money2(model.cash.total.pending) + '。</p></div></div>';
    html += '</div>';

    ctx.setExport('平台结算-' + (ctx.month === 'all' ? '全部' : ctx.month) + '.csv',
      ['账单号', '店铺', '账期', '账单GMV', '退款', '佣金', '软件服务费', '支付手续费', '推广', '运费险', '结算金额', '重算金额', '差异', '状态', '差异说明'],
      bills.map(function (b) {
        return [b.bill_id, b.store_name, b.period, b.gmv, b.refund, b.commission, b.techFee, b.paymentFee, b.promotion, b.insurance, b.settledAmount, b.recomputed, b.diff, b.status, b.note || ''];
      }));
    return { html: html };
  };

  // ================= 物流成本 =================
  Views.logistics = function (ctx) {
    var data = ctx.state.data, model = ctx.model;
    var orderMap = {};
    data.orders.forEach(function (o) { orderMap[o.id] = o; });
    var rows = data.shipments.filter(function (s) {
      var o = orderMap[s.order_id];
      if (!o) return false;
      if (ctx.store !== 'all' && o.store_id !== ctx.store) return false;
      var m = (s.shipped_at || o.ship_date || o.order_date || '').slice(0, 7);
      return ctx.month === 'all' || m === ctx.month;
    });
    var fee = function (s) { return Number(s.base_fee || 0) + Number(s.overweight_fee || 0) + Number(s.surcharge || 0) + Number(s.return_fee || 0); };
    var totalFee = rows.reduce(function (a, s) { return a + fee(s); }, 0);
    var totalCount = rows.length;
    var returnFee = rows.reduce(function (a, s) { return a + Number(s.return_fee || 0); }, 0);
    var weight = rows.reduce(function (a, s) { return a + Number(s.weight_kg || 0); }, 0);

    var byCarrier = {};
    rows.forEach(function (s) {
      var key = s.carrier || '未填';
      var b = byCarrier[key] || (byCarrier[key] = { name: key, count: 0, fee: 0, returnFee: 0 });
      b.count++; b.fee += fee(s); b.returnFee += Number(s.return_fee || 0);
    });
    var carriers = Object.keys(byCarrier).map(function (k) { return byCarrier[k]; }).sort(function (a, b) { return b.fee - a.fee; });
    var byProvince = {};
    rows.forEach(function (s) {
      var key = s.province || '未填';
      var b = byProvince[key] || (byProvince[key] = { name: key, count: 0, fee: 0 });
      b.count++; b.fee += fee(s);
    });
    var provinces = Object.keys(byProvince).map(function (k) { return byProvince[k]; }).sort(function (a, b) { return b.fee - a.fee; });

    var html = '<div class="page-head"><div><div class="eyebrow">Logistics</div><h2>物流成本</h2>' +
      '<p>' + monthLabel(ctx) + ' · ' + scopeName(ctx) + ' · 按实际面单归集：首重 + 续重 + 区域加价 + 退回运费</p></div></div>';

    html += '<div class="grid grid-12">' +
      '<div class="card kpi span-3"><div class="kpi-label">物流总成本</div><div class="kpi-value">' + UI.wan(totalFee) + '</div><div class="kpi-foot">' + UI.num(totalCount) + ' 张面单</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">单均运费</div><div class="kpi-value">' + UI.money2(totalCount ? totalFee / totalCount : 0) + '</div><div class="kpi-foot">平均重量 ' + (totalCount ? (weight / totalCount).toFixed(2) : '0') + ' kg</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">退回运费</div><div class="kpi-value">' + UI.wan(returnFee) + '</div><div class="kpi-foot">占物流成本 ' + UI.pct(totalFee ? returnFee / totalFee * 100 : 0) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">物流费率</div><div class="kpi-value">' + UI.pct(model.total.revenue ? (ctx.month === 'all' ? totalFee / model.total.revenue * 100 : totalFee / (ctx.month ? model.companyMonth[ctx.month].revenue : 1) * 100) : 0) + '</div><div class="kpi-foot">占营业收入</div></div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px"><div class="card span-6"><div class="panel-head"><h3>承运商成本</h3><span class="sub">按运费</span></div><div class="panel-body flush">' +
      UI.table({
        columns: [
          { key: 'name', label: '承运商' },
          { key: 'count', label: '面单', num: true },
          { key: 'fee', label: '运费', num: true, render: function (r) { return UI.money2(r.fee); } },
          { key: 'avg', label: '单均', num: true, render: function (r) { return UI.money2(r.count ? r.fee / r.count : 0); } },
          { key: 'share', label: '占比', num: true, render: function (r) { return UI.pct(totalFee ? r.fee / totalFee * 100 : 0); } }
        ],
        rows: carriers,
        footer: [{ html: '<b>合计</b>' }, { html: '<b>' + UI.num(totalCount) + '</b>', num: true },
          { html: '<b>' + UI.money2(totalFee) + '</b>', num: true }, { html: UI.money2(totalCount ? totalFee / totalCount : 0), num: true }, { html: '100%', num: true }]
      }) + '</div></div>' +
      '<div class="card span-6"><div class="panel-head"><h3>省份分布 Top 12</h3><span class="sub">看偏远地区加价影响</span></div><div class="panel-body flush">' +
      UI.table({
        columns: [
          { key: 'name', label: '省份' }, { key: 'count', label: '面单', num: true },
          { key: 'fee', label: '运费', num: true, render: function (r) { return UI.money2(r.fee); } },
          { key: 'avg', label: '单均', num: true, render: function (r) { return UI.money2(r.count ? r.fee / r.count : 0); } }
        ],
        rows: provinces.slice(0, 12)
      }) + '</div></div></div>';

    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>各店物流成本</h3><span class="sub">含单均与费率</span></div><div class="panel-body flush">' +
      UI.table({
        columns: [
          { key: 'name', label: '店铺' },
          { key: 'count', label: '面单', num: true },
          { key: 'fee', label: '物流成本', num: true, render: function (r) { return UI.money2(r.fee); } },
          { key: 'avg', label: '单均', num: true, render: function (r) { return UI.money2(r.count ? r.fee / r.count : 0); } },
          { key: 'revenue', label: '营业收入', num: true, render: function (r) { return UI.money(r.revenue); } },
          { key: 'rate', label: '物流费率', num: true, render: function (r) { return UI.pct(r.revenue ? r.fee / r.revenue * 100 : 0); } }
        ],
        rows: ctx.storeRows().map(function (s) {
          var b = rows.filter(function (x) { return orderMap[x.order_id] && orderMap[x.order_id].store_id === s.store_id; });
          return { name: s.name, count: b.length, fee: b.reduce(function (a, x) { return a + fee(x); }, 0), revenue: s.revenue };
        })
      }) + '</div></div>';

    ctx.setExport('物流成本-' + (ctx.month === 'all' ? '全部' : ctx.month) + '.csv',
      ['承运商', '面单数', '运费', '退回运费', '单均'], carriers.map(function (r) { return [r.name, r.count, r.fee.toFixed(2), r.returnFee.toFixed(2), (r.count ? r.fee / r.count : 0).toFixed(2)]; }));
    return { html: html };
  };

  // ================= 采购与库存 =================
  Views.inventory = function (ctx) {
    var model = ctx.model, inv = model.inventory;
    var summary = inv.summary;
    var list = inv.bySku.slice();
    var sort = sortOf(ctx, 'closingValue', 'desc');
    list = UI.sortRows(list, sort.key, sort.dir, true);

    var html = '<div class="page-head"><div><div class="eyebrow">Inventory</div><h2>采购与库存</h2>' +
      '<p>移动加权平均成本 · 当前演示数据为全公司口径（店铺筛选不作用于库存）</p></div></div>';

    html += '<div class="grid grid-12">' +
      '<div class="card kpi span-3"><div class="kpi-label">库存金额</div><div class="kpi-value">' + UI.wan(summary.value) + '</div><div class="kpi-foot">' + UI.num(summary.qty) + ' 件 · 均价 ' + UI.money2(summary.qty ? summary.value / summary.qty : 0) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">周转天数</div><div class="kpi-value">' + summary.turnoverDays + '<span class="unit">天</span></div><div class="kpi-foot">期间出库成本 ' + UI.money(summary.cogs) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">滞销库存</div><div class="kpi-value">' + UI.wan(summary.slowMovingValue) + '</div><div class="kpi-foot">' + summary.slowMovingCount + ' 个 SKU · 超 ' + (ctx.state.data.settings.slow_moving_days || 60) + ' 天无出库</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">采购金额</div><div class="kpi-value">' + UI.wan(model.purchases.total) + '</div><div class="kpi-foot">' + model.purchases.poCount + ' 张采购单 · ' + model.suppliers.length + ' 个供应商</div></div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px"><div class="card span-5"><div class="panel-head"><h3>月度库存与周转</h3><span class="sub">期初 + 入库 − 出库 = 期末</span></div><div class="panel-body flush">' +
      UI.table({
        columns: [
          { key: 'month', label: '月份' },
          { key: 'openingValue', label: '期初', num: true, render: function (r) { return UI.money(r.openingValue); } },
          { key: 'closingValue', label: '期末', num: true, render: function (r) { return UI.money(r.closingValue); } },
          { key: 'cogs', label: '出库成本', num: true, render: function (r) { return UI.money(r.cogs); } },
          { key: 'turnoverDays', label: '周转天数', num: true, render: function (r) { return r.turnoverDays + ' 天'; } }
        ],
        rows: model.months.map(function (m) { return inv.monthly[m]; })
      }) + '</div></div>' +
      '<div class="card span-7"><div class="panel-head"><h3>供应商采购</h3><span class="sub">含税金额</span></div><div class="panel-body flush">' +
      UI.table({
        columns: [
          { key: 'name', label: '供应商' },
          { key: 'poCount', label: '采购单', num: true },
          { key: 'amount', label: '采购金额', num: true, render: function (r) { return UI.money2(r.amount); } },
          { key: 'share', label: '占比', num: true, render: function (r) { return UI.pct(model.purchases.total ? r.amount / model.purchases.total * 100 : 0); } }
        ],
        rows: model.purchases.bySupplier,
        footer: [{ html: '<b>合计</b>' }, { html: '<b>' + model.purchases.poCount + '</b>', num: true }, { html: '<b>' + UI.money2(model.purchases.total) + '</b>', num: true }, { html: '100%', num: true }]
      }) + '</div></div></div>';

    html += '<div class="card" style="margin-top:14px"><div class="panel-head"><h3>SKU 库存明细</h3><span class="sub">点击表头排序 · 滞销按最后出库日判定</span></div><div class="panel-body flush">' +
      UI.table({
        sort: sort,
        columns: [
          { key: 'sku_name', label: '商品', render: function (r) { return '<span class="name">' + UI.esc(r.sku_name) + '</span><span class="sub">' + UI.esc(r.category || '') + ' · ' + r.sku_id + '</span>'; } },
          { key: 'openingQty', label: '期初', num: true, sortable: true },
          { key: 'inboundQty', label: '入库', num: true, sortable: true },
          { key: 'outboundQty', label: '出库', num: true, sortable: true },
          { key: 'returnQty', label: '退货入库', num: true, sortable: true },
          { key: 'closingQty', label: '期末', num: true, sortable: true },
          { key: 'avgCost', label: '均价', num: true, sortable: true, render: function (r) { return UI.money2(r.avgCost); } },
          { key: 'closingValue', label: '库存金额', num: true, sortable: true, render: function (r) { return UI.money2(r.closingValue); } },
          { key: 'stockDays', label: '可售天数', num: true, sortable: true, render: function (r) { return r.stockDays >= 999 ? '—' : r.stockDays + ' 天'; } },
          { key: 'slowMoving', label: '状态', render: function (r) { return r.slowMoving ? UI.badge('滞销', 'warn') : UI.badge('正常', 'ok'); } }
        ],
        rows: list,
        footer: [{ html: '<b>合计</b>' }, { html: '', num: true }, { html: '', num: true }, { html: '', num: true }, { html: '', num: true },
          { html: '<b>' + UI.num(summary.qty) + '</b>', num: true }, { html: '', num: true }, { html: '<b>' + UI.money2(summary.value) + '</b>', num: true }, { html: '', num: true }, { html: '', num: true }]
      }) + '</div></div>';

    ctx.setExport('库存明细-' + (ctx.month === 'all' ? '全部' : ctx.month) + '.csv',
      ['商品编码', '商品', '类目', '期初', '入库', '出库', '退货入库', '期末', '均价', '库存金额', '滞销', '最后出库'],
      list.map(function (r) {
        return [r.sku_id, r.sku_name, r.category, r.openingQty, r.inboundQty, r.outboundQty, r.returnQty, r.closingQty, r.avgCost, r.closingValue, r.slowMoving ? '是' : '否', r.lastOutDate || ''];
      }));
    return { html: html };
  };

  // ================= 工资与提成 =================
  Views.payroll = function (ctx) {
    var model = ctx.model, month = ctx.month;
    var rows = [];
    if (month === 'all') {
      var agg = {};
      model.months.forEach(function (m) {
        model.payroll.byMonth[m].rows.forEach(function (r) {
          var a = agg[r.employee_id] || (agg[r.employee_id] = {
            employee_id: r.employee_id, name: r.name, role: r.role, month: '3 个月合计',
            base_salary: 0, allowance: 0, commission: 0, deduction: 0, gross: 0, net: 0, store_ids: r.store_ids
          });
          a.base_salary += r.base_salary; a.allowance += r.allowance; a.commission += r.commission;
          a.deduction += r.deduction; a.gross += r.gross; a.net += r.net;
        });
      });
      rows = Object.keys(agg).map(function (k) { return agg[k]; });
    } else {
      rows = model.payroll.byMonth[month].rows.slice();
    }
    rows.sort(function (a, b) { return b.gross - a.gross; });
    var totals = rows.reduce(function (a, r) { a.gross += r.gross; a.net += r.net; a.commission += r.commission; a.base += r.base_salary; return a; }, { gross: 0, net: 0, commission: 0, base: 0 });

    var html = '<div class="page-head"><div><div class="eyebrow">Payroll</div><h2>工资与提成</h2>' +
      '<p>' + monthLabel(ctx) + ' · ' + rows.length + ' 人 · 提成按店铺' + (model.payroll.settings.basis === 'revenue' ? '净销售额' : '贡献毛利') + '阶梯计算</p></div></div>';

    html += '<div class="grid grid-12">' +
      '<div class="card kpi span-3"><div class="kpi-label">应发工资</div><div class="kpi-value">' + UI.wan(totals.gross) + '</div><div class="kpi-foot">占营业收入 ' + UI.pct(model.total.revenue ? totals.gross / (month === 'all' ? model.total.revenue : model.companyMonth[month].revenue) * 100 : 0) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">实发工资</div><div class="kpi-value">' + UI.wan(totals.net) + '</div><div class="kpi-foot">代扣 ' + UI.money(totals.gross - totals.net) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">提成支出</div><div class="kpi-value">' + UI.wan(totals.commission) + '</div><div class="kpi-foot">占应发 ' + UI.pct(totals.gross ? totals.commission / totals.gross * 100 : 0) + '</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">人均应发</div><div class="kpi-value">' + UI.money(rows.length ? totals.gross / rows.length : 0) + '</div><div class="kpi-foot">' + (month === 'all' ? '3 个月合计' : '本月') + ' · 含提成</div></div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px"><div class="card span-8"><div class="panel-head"><h3>工资表</h3><span class="sub">' + (month === 'all' ? '全部账期合计' : monthLabel(ctx)) + ' · 点击行看月度明细</span></div><div class="panel-body flush">' +
      UI.table({
        rowAttrs: function (r) { return 'class="clickable" data-drill="employee" data-id="' + r.employee_id + '"'; },
        columns: [
          { key: 'name', label: '员工', render: function (r) { return '<span class="name">' + UI.esc(r.name) + '</span><span class="sub">' + UI.esc(r.role) + '</span>'; } },
          { key: 'store_ids', label: '负责店铺', render: function (r) { return r.store_ids && r.store_ids.length ? UI.esc(r.store_ids.map(function (id) { return storeName(ctx, id); }).join('、')) : '<span class="muted">公共（按收入分摊）</span>'; } },
          { key: 'base_salary', label: '底薪', num: true, render: function (r) { return UI.money(r.base_salary); } },
          { key: 'allowance', label: '补贴', num: true, render: function (r) { return UI.money(r.allowance); } },
          { key: 'commission', label: '提成', num: true, render: function (r) { return UI.money(r.commission); } },
          { key: 'deduction', label: '代扣', num: true, render: function (r) { return UI.money(r.deduction); } },
          { key: 'gross', label: '应发', num: true, render: function (r) { return '<b>' + UI.money(r.gross) + '</b>'; } },
          { key: 'net', label: '实发', num: true, render: function (r) { return UI.money(r.net); } }
        ],
        rows: rows,
        footer: [{ html: '<b>合计</b>' }, { html: '' }, { html: UI.money(totals.base), num: true }, { html: '', num: true },
          { html: UI.money(totals.commission), num: true }, { html: UI.money(totals.gross - totals.net), num: true },
          { html: '<b>' + UI.money(totals.gross) + '</b>', num: true }, { html: '<b>' + UI.money(totals.net) + '</b>', num: true }]
      }) + '</div></div>';

    html += '<div class="card span-4"><div class="panel-head"><h3>提成规则</h3><span class="sub">可在设置中修改</span></div><div class="panel-body">' +
      '<div class="hint" style="margin-bottom:9px">基数：' + (model.payroll.settings.basis === 'revenue' ? '店铺净销售额' : '店铺贡献毛利（收入 − 商品成本 − 物流）') + '；按店铺分别计算后相加。</div>' +
      (model.payroll.settings.ladder || []).map(function (b) {
        var range = b.max === null || b.max === undefined ? '≥ ' + UI.wan(b.min) : UI.wan(b.min) + ' – ' + UI.wan(b.max);
        return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed var(--line);font-size:12px"><span>' + range + '</span><b>' + (Number(b.rate) * 100).toFixed(1) + '%</b></div>';
      }).join('') +
      '<p class="hint" style="margin-top:10px">退货在发生当月冲减提成基数；跨月退款在次月扣回。代扣为社保公积金与个税的固定口径，不做申报计算。</p>' +
      '<button class="btn small" data-action="go" data-page="settings" style="margin-top:10px">去修改规则</button></div></div></div>';

    ctx.setExport('工资表-' + (month === 'all' ? '全部' : month) + '.csv',
      ['员工', '岗位', '负责店铺', '底薪', '补贴', '提成', '代扣', '应发', '实发'],
      rows.map(function (r) {
        return [r.name, r.role, (r.store_ids || []).map(function (id) { return storeName(ctx, id); }).join('、'), r.base_salary, r.allowance, r.commission, r.deduction, r.gross, r.net];
      }));
    return { html: html };
  };

  function storeName(ctx, id) {
    var s = ctx.model.stores.filter(function (x) { return x.id === id; })[0];
    return s ? s.name.replace(/（.*?）/, '') : id;
  }

  // ================= 费用与发票 =================
  Views.invoices = function (ctx) {
    var model = ctx.model, inv = model.invoices;
    var data = ctx.state.data;
    var expenses = data.expenses.filter(function (e) {
      return ctx.month === 'all' || (e.date || '').slice(0, 7) === ctx.month;
    });
    var expTotal = expenses.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
    var byCat = {};
    expenses.forEach(function (e) {
      var k = e.category || '其他';
      byCat[k] = (byCat[k] || 0) + Number(e.amount || 0);
    });
    var catRows = Object.keys(byCat).map(function (k) { return { category: k, amount: byCat[k], share: expTotal ? byCat[k] / expTotal * 100 : 0 }; }).sort(function (a, b) { return b.amount - a.amount; });

    var input = inv.input, output = inv.output;
    var html = '<div class="page-head"><div><div class="eyebrow">Expenses & Invoices</div><h2>费用与发票</h2>' +
      '<p>' + monthLabel(ctx) + ' · 进项 ' + input.count + ' 张 / 销项 ' + output.count + ' 张 · 未匹配 ' + (input.unmatched + output.unmatched) + ' 张</p></div></div>';

    html += '<div class="grid grid-12">' +
      '<div class="card kpi span-3"><div class="kpi-label">进项发票</div><div class="kpi-value">' + UI.wan(input.amount) + '</div><div class="kpi-foot">税额 ' + UI.money(input.tax) + ' · 已匹配 ' + input.matched + ' 张</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">销项发票</div><div class="kpi-value">' + UI.wan(output.amount) + '</div><div class="kpi-foot">税额 ' + UI.money(output.tax) + ' · 已匹配 ' + output.matched + ' 张</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">发票差异</div><div class="kpi-value">' + (input.mismatch + output.mismatch) + '<span class="unit">张</span></div><div class="kpi-foot">未匹配 ' + (input.unmatched + output.unmatched) + ' 张</div></div>' +
      '<div class="card kpi span-3"><div class="kpi-label">缺失发票</div><div class="kpi-value">' + UI.wan(inv.missingAmount) + '</div><div class="kpi-foot">采购 ' + inv.missing.purchases.length + ' 笔 · 费用 ' + inv.missing.expenses.length + ' 笔</div></div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px"><div class="card span-5"><div class="panel-head"><h3>费用结构</h3><span class="sub">' + monthLabel(ctx) + ' · 合计 ' + UI.money(expTotal) + '</span></div><div class="panel-body flush">' +
      UI.table({
        columns: [
          { key: 'category', label: '类别' },
          { key: 'amount', label: '金额', num: true, render: function (r) { return UI.money2(r.amount); } },
          { key: 'share', label: '占比', num: true, render: function (r) { return UI.pct(r.share); } }
        ],
        rows: catRows,
        footer: [{ html: '<b>合计</b>' }, { html: '<b>' + UI.money2(expTotal) + '</b>', num: true }, { html: '100%', num: true }]
      }) + '</div></div>' +
      '<div class="card span-7"><div class="panel-head"><h3>发票异常</h3><span class="sub">数量不符、未匹配、重复与缺失</span></div><div class="panel-body">';
    var issues = [];
    inv.issues.forEach(function (x) { issues.push({ level: 'bad', title: '发票 ' + (x.invoice || ''), detail: x.message }); });
    inv.missing.purchases.forEach(function (p) { issues.push({ level: 'warn', title: '采购单 ' + p.po_id + ' 缺少发票', detail: '金额 ' + UI.money2(p.amount) + ' · ' + p.date }); });
    inv.missing.expenses.forEach(function (e) { issues.push({ level: 'warn', title: (e.category || '') + ' ' + e.expense_id + ' 缺少发票', detail: '金额 ' + UI.money2(e.amount) + ' · ' + (e.vendor || '') }); });
    if (!issues.length) html += '<div class="callout">' + UI.icon('check') + '<span>发票全部匹配，没有缺失。</span></div>';
    else {
      html += '<div class="alert-list">' + issues.slice(0, 10).map(function (x) {
        return '<div class="alert-item ' + (x.level === 'bad' ? 'error' : 'warn') + '"><span class="icon">!</span><div><div class="t">' + UI.esc(x.title) + '</div><div class="d">' + UI.esc(x.detail) + '</div></div></div>';
      }).join('') + '</div>';
      if (issues.length > 10) html += '<p class="hint" style="margin-top:8px">另有 ' + (issues.length - 10) + ' 条，见导入后的错误清单或发票台账导出。</p>';
    }
    html += '</div></div></div>';

    html += '<div class="grid grid-12" style="margin-top:14px"><div class="card span-6"><div class="panel-head"><h3>进项发票</h3><span class="sub">采购 / 费用 / 平台服务费</span></div><div class="panel-body flush">' +
      invoiceTable(input.list, true) + '</div></div>' +
      '<div class="card span-6"><div class="panel-head"><h3>销项发票</h3><span class="sub">平台销售汇总</span></div><div class="panel-body flush">' +
      invoiceTable(output.list, false) + '</div></div></div>';

    ctx.setExport('发票台账-' + (ctx.month === 'all' ? '全部' : ctx.month) + '.csv',
      ['记录号', '方向', '发票号', '日期', '销方', '购方', '价税合计', '税额', '关联类型', '关联单据', '匹配状态'],
      input.list.concat(output.list).map(function (x) {
        return [x.id, x.direction === 'output' ? '销项' : '进项', x.number, x.date, x.seller, x.buyer, x.amount, x.tax_amount, x.related_type, x.related_id, x.status];
      }));
    return { html: html };
  };

  function invoiceTable(list, input) {
    if (!list.length) return '<div class="empty">暂无发票</div>';
    var note = list.length > 30 ? '<p class="hint" style="padding:8px 12px">共 ' + list.length + ' 张，页面显示前 30 张；导出 CSV 可看全部。</p>' : '';
    return UI.table({
      rowAttrs: function (r) { return 'class="clickable" data-drill="invoice" data-id="' + r.id + '"'; },
      columns: [
        { key: 'number', label: '发票号', render: function (r) { return '<span class="mono">' + UI.esc(r.number || r.id) + '</span><span class="sub">' + r.date + '</span>'; } },
        { key: 'party', label: input ? '销方' : '购方', render: function (r) { return UI.esc(input ? r.seller : r.buyer); } },
        { key: 'amount', label: '价税合计', num: true, render: function (r) { return UI.money2(r.amount); } },
        { key: 'tax_amount', label: '税额', num: true, render: function (r) { return UI.money2(r.tax_amount); } },
        { key: 'status', label: '匹配', render: function (r) { return r.status === 'matched' ? UI.badge('已匹配', 'ok') : r.status === 'mismatch' ? UI.badge('金额差异', 'warn') : UI.badge('未匹配', 'bad'); } }
      ],
      rows: list.slice(0, 30)
    }) + note;
  }

  root.Views = Views;
})(typeof window !== 'undefined' ? window : globalThis);
