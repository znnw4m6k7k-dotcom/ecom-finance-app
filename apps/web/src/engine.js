/* 电商财务集成系统 · 核算引擎 v1
 * 输入：原始明细数据（订单/账单/物流/采购/工资/费用/发票）
 * 输出：店铺月度损益、库存成本、工资表、对账、现金流、发票匹配、勾稽校验、KPI
 * 口径见 docs/data-schema.md，公式说明见 FORMULAS
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TOL = 0.011; // 金额校验容差（分位取整）

  var SETTINGS_DEFAULTS = {
    commission_ladder: [
      { min: 0, max: 50000, rate: 0.02 },
      { min: 50000, max: 100000, rate: 0.03 },
      { min: 100000, max: null, rate: 0.04 }
    ],
    default_basis: 'gross_profit',
    slow_moving_days: 60,
    turnover_days: 30,
    allocation_method: 'revenue_share',
    tax_rate_default: 0.13
  };

  var STORE_DEFAULTS = {
    platform: 'taobao',
    commission_rate: 0.05,
    tech_fee_rate: 0.02,
    payment_fee_rate: 0.006,
    insurance_rate: 0.008,
    settlement_days: 15
  };

  var FORMULAS = {
    revenue: '营业收入 = 净销售额 + 平台补贴；净销售额 = GMV − 退款',
    gmv: 'GMV = 当月下单订单的买家实付金额合计（含运费）',
    refund: '退款 = 按退款发生月份归集的退款金额（含退运费）',
    cogs: '商品成本 = 销售出库成本 − 退货入库成本，出库/入库均按移动加权平均单价',
    freight: '物流成本 = Σ（首重费 + 续重费 + 区域加价 + 退回运费），按实际面单归集',
    platformFees: '平台费用 = 佣金 + 软件服务费 + 支付手续费 + 运费险；有平台账单时取账单实际值',
    commission: '佣金 = 净销售额 × 店铺佣金率；实际以平台账单为准',
    promotion: '推广费 = 平台账单代扣推广费 + 费用表推广费（按店铺归集，公共推广按收入占比分摊）',
    labor: '人工成本 = 员工应发工资（底薪 + 补贴 + 提成），提成按店铺贡献毛利阶梯计算',
    other: '其他费用 = 店铺直接费用 + 公共费用按店铺营业收入占比分摊',
    grossProfit: '经营毛利 = 营业收入 − 商品成本',
    contribution: '贡献毛利 = 经营毛利 − 物流成本（也是提成基数）',
    netProfit: '净利润 = 贡献毛利 − 平台费用 − 推广费 − 人工成本 − 其他费用',
    netMargin: '净利率 = 净利润 ÷ 营业收入',
    aov: '客单价 = GMV ÷ 订单数',
    refundRate: '退款率 = 退款 ÷ GMV',
    turnoverDays: '周转天数 = 期间平均库存金额 ÷ 期间出库成本 × 期间天数',
    cashReceived: '已回款 = 平台打款流水合计',
    cashPending: '待结算 = 未结算平台账单的结算金额合计',
    cashOccupied: '账期占款 = 未结算账单对应的订单净额（GMV − 退款）合计',
    invoice: '发票匹配：关联单据存在且金额一致为已匹配，金额不符为差异，找不到单据为未匹配'
  };

  // ---------------- 基础工具 ----------------
  function num(v, dflt) {
    if (v === null || v === undefined || v === '') return dflt === undefined ? 0 : dflt;
    var n = Number(v);
    return isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
  }
  function round2(n) {
    if (!isFinite(n)) return 0;
    return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
  }
  function sum(arr, fn) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += fn ? fn(arr[i], i) : num(arr[i]);
    return t;
  }
  function monthOf(date) {
    if (!date) return '';
    var s = String(date).trim();
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + (m[2].length === 1 ? '0' + m[2] : m[2]);
  }
  function monthEnd(month) {
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7));
    var d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
  }
  function monthList(meta) {
    var out = [];
    var start = monthOf(meta.start_month);
    var end = monthOf(meta.end_month);
    if (!start || !end) return out;
    var y = Number(start.slice(0, 4));
    var m = Number(start.slice(5, 7));
    var ey = Number(end.slice(0, 4));
    var em = Number(end.slice(5, 7));
    while (y < ey || (y === ey && m <= em)) {
      out.push(y + '-' + (m < 10 ? '0' + m : m));
      m++;
      if (m > 12) { m = 1; y++; }
      if (out.length > 120) break;
    }
    return out;
  }
  function daysInMonth(month) {
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function pct(n, d) { return d ? round2((n / d) * 100) : 0; }

  // 按权重分摊金额，保证分摊之和精确等于金额（差额补到最大权重项）
  function allocate(amount, weights) {
    var total = sum(weights);
    var n = weights.length;
    if (!n) return [];
    var res = new Array(n);
    if (total <= 0) {
      var each = round2(amount / n);
      for (var i = 0; i < n; i++) res[i] = each;
    } else {
      for (var j = 0; j < n; j++) res[j] = round2(amount * (weights[j] / total));
    }
    var diff = round2(amount - sum(res));
    if (Math.abs(diff) >= 0.005) {
      var idx = 0;
      for (var k = 1; k < n; k++) if (weights[k] > weights[idx]) idx = k;
      res[idx] = round2(res[idx] + diff);
    }
    return res;
  }

  function ladderCommission(base, ladder) {
    var bands = (ladder && ladder.length ? ladder : SETTINGS_DEFAULTS.commission_ladder).slice().sort(function (a, b) {
      return num(a.min) - num(b.min);
    });
    var total = 0;
    for (var i = 0; i < bands.length; i++) {
      var min = num(bands[i].min, 0);
      var max = bands[i].max === null || bands[i].max === undefined || bands[i].max === '' ? Infinity : num(bands[i].max);
      if (base > min) total += (Math.min(base, max) - min) * num(bands[i].rate);
    }
    return total;
  }

  function grid(ids, months) {
    var g = {};
    for (var i = 0; i < ids.length; i++) {
      g[ids[i]] = {};
      for (var j = 0; j < months.length; j++) g[ids[i]][months[j]] = 0;
    }
    return g;
  }
  function add(g, id, month, val) {
    if (!g[id]) { g[id] = {}; }
    g[id][month] = (g[id][month] || 0) + val;
  }

  // ---------------- 归一化 ----------------
  function normalize(input) {
    var d = input || {};
    var meta = Object.assign({
      company_name: '未命名公司', brand: '', currency: 'CNY',
      start_month: '', end_month: '', current_month: ''
    }, d.meta || {});

    var orders = (d.orders || []).map(function (o) {
      return Object.assign({
        id: '', store_id: '', order_date: '', refund_date: '', status: 'paid',
        paid_amount: 0, refund_amount: 0, ship_date: '', carrier: '', province: '', returned: false
      }, o);
    });
    var orderMap = {};
    orders.forEach(function (o) { orderMap[o.id] = o; });

    var items = (d.order_items || []).map(function (it) {
      return Object.assign({ order_id: '', sku_id: '', qty: 0, amount: 0, refund_amount: 0, refund_qty: 0 }, it);
    });

    if (!meta.start_month || !meta.end_month) {
      var dates = orders.map(function (o) { return monthOf(o.order_date); }).filter(Boolean).sort();
      if (dates.length) {
        meta.start_month = meta.start_month || dates[0];
        meta.end_month = meta.end_month || dates[dates.length - 1];
      }
    }
    if (!meta.current_month) meta.current_month = meta.end_month;

    return {
      meta: meta,
      settings: Object.assign({}, SETTINGS_DEFAULTS, d.settings || {}),
      stores: (d.stores || []).map(function (s) { return Object.assign({}, STORE_DEFAULTS, s); }),
      suppliers: d.suppliers || [],
      skus: (d.skus || []).map(function (s) { return Object.assign({ status: 'active' }, s); }),
      employees: (d.employees || []).map(function (e) {
        return Object.assign({
          base_salary: 0, allowance: 0, deduction: 0, basis: '', store_ids: [], joined_at: '', active: true, commission_share: 1
        }, e);
      }),
      opening_inventory: d.opening_inventory || [],
      orders: orders,
      order_items: items,
      orderMap: orderMap,
      shipments: d.shipments || [],
      purchase_orders: d.purchase_orders || [],
      purchase_items: d.purchase_items || [],
      platform_bills: d.platform_bills || [],
      payouts: d.payouts || [],
      expenses: d.expenses || [],
      invoices: d.invoices || []
    };
  }

  // ---------------- 主计算 ----------------
  function computeModel(input) {
    var d = normalize(input);
    var months = monthList(d.meta);
    if (!months.length) throw new Error('缺少账期：请在 meta.start_month / meta.end_month 提供 YYYY-MM');
    var storeIds = d.stores.map(function (s) { return s.id; });
    var storeById = {};
    d.stores.forEach(function (s) { storeById[s.id] = s; });
    var skuById = {};
    d.skus.forEach(function (s) { skuById[s.id] = s; });
    var currentMonth = months.indexOf(d.meta.current_month) >= 0 ? d.meta.current_month : months[months.length - 1];

    // ---- 订单与退款 ----
    var gmvGrid = grid(storeIds, months);
    var refundGrid = grid(storeIds, months);
    var orderCountGrid = grid(storeIds, months);
    var unitsGrid = grid(storeIds, months);
    var skuRevGrid = {}; // sku|month -> {store, revenue, qty}
    var skuRefundGrid = {};
    var itemsByOrder = {};
    d.order_items.forEach(function (it) {
      (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
    });

    d.orders.forEach(function (o) {
      var m = monthOf(o.order_date);
      if (months.indexOf(m) < 0) return;
      add(gmvGrid, o.store_id, m, num(o.paid_amount));
      add(orderCountGrid, o.store_id, m, 1);
      var its = itemsByOrder[o.id] || [];
      its.forEach(function (it) { add(unitsGrid, o.store_id, m, num(it.qty)); });
    });

    d.order_items.forEach(function (it) {
      var o = d.orderMap[it.order_id];
      if (!o) return;
      var rm = monthOf(it.refund_date || o.refund_date || o.order_date);
      var rq = num(it.refund_qty);
      var ra = num(it.refund_amount);
      if (rq <= 0 && ra <= 0) return;
      if (months.indexOf(rm) < 0) return;
      add(refundGrid, o.store_id, rm, ra);
      var key = it.sku_id + '|' + rm;
      var cell = skuRefundGrid[key] || (skuRefundGrid[key] = { sku_id: it.sku_id, month: rm, store_id: o.store_id, qty: 0, amount: 0 });
      cell.qty += rq;
      cell.amount += ra;
    });

    // 订单主表的退款金额（无明细退款时的兜底）
    d.orders.forEach(function (o) {
      var rm = monthOf(o.refund_date || o.order_date);
      if (num(o.refund_amount) <= 0 || months.indexOf(rm) < 0) return;
      var itemRefund = sum((itemsByOrder[o.id] || []).map(function (it) { return num(it.refund_amount); }));
      var gap = round2(num(o.refund_amount) - itemRefund);
      if (Math.abs(gap) >= 0.01) add(refundGrid, o.store_id, rm, gap);
    });

    // 商品维度销售额
    d.order_items.forEach(function (it) {
      var o = d.orderMap[it.order_id];
      if (!o) return;
      var m = monthOf(o.order_date);
      if (months.indexOf(m) < 0) return;
      var key = it.sku_id + '|' + m + '|' + o.store_id;
      var cell = skuRevGrid[key] || (skuRevGrid[key] = {
        sku_id: it.sku_id, month: m, store_id: o.store_id, qty: 0, revenue: 0, refundQty: 0, refundAmount: 0
      });
      cell.qty += num(it.qty);
      cell.revenue += num(it.amount);
    });

    // ---- 物流面单 ----
    var freightGrid = grid(storeIds, months);
    var shipCountGrid = grid(storeIds, months);
    var carrierAgg = {}, provinceAgg = {}, shipByStore = {};
    d.shipments.forEach(function (s) {
      var m = monthOf(s.shipped_at);
      if (months.indexOf(m) < 0) return;
      var o = d.orderMap[s.order_id];
      var storeId = (o && o.store_id) || s.store_id;
      if (!storeId) return;
      var fee = num(s.base_fee) + num(s.overweight_fee) + num(s.surcharge) + num(s.return_fee);
      add(freightGrid, storeId, m, fee);
      add(shipCountGrid, storeId, m, 1);
      addCarrier(carrierAgg, s.carrier || '未填', m, fee, 1, num(s.return_fee));
      addCarrier(provinceAgg, s.province || '未填', m, fee, 1, num(s.return_fee));
      var st = shipByStore[storeId] || (shipByStore[storeId] = { fee: 0, count: 0, returnFee: 0 });
      st.fee += fee; st.count += 1; st.returnFee += num(s.return_fee);
    });
    function addCarrier(bucket, key, m, fee, cnt, returnFee) {
      var row = bucket[key] || (bucket[key] = { name: key, fee: 0, count: 0, returnFee: 0, months: {} });
      row.fee += fee; row.count += cnt; row.returnFee += returnFee;
      row.months[m] = (row.months[m] || 0) + fee;
    }

    // ---- 库存移动加权平均 ----
    var inv = computeInventory(d, months, storeIds);
    var cogsGrid = inv.cogsGrid;
    var cogsReturnGrid = inv.cogsReturnGrid;
    var skuCostMap = inv.skuCostMap;

    // ---- 费用 ----
    var expStore = {}; // store|month|category
    var publicExp = {}; // month|category
    d.expenses.forEach(function (e) {
      var m = monthOf(e.date);
      if (months.indexOf(m) < 0) return;
      var cat = e.category || '其他';
      var bucket = e.store_id ? expStore : publicExp;
      var key = e.store_id ? (e.store_id + '|' + m + '|' + cat) : (m + '|' + cat);
      bucket[key] = (bucket[key] || 0) + num(e.amount);
    });

    // ---- 平台账单 ----
    var billByStoreMonth = {};
    d.platform_bills.forEach(function (b) { billByStoreMonth[b.store_id + '|' + b.period] = b; });

    // ---- 员工月度工资 ----
    var payroll = computePayroll(d, months, storeIds, {
      gmvGrid: gmvGrid, refundGrid: refundGrid, cogsGrid: cogsGrid,
      cogsReturnGrid: cogsReturnGrid, freightGrid: freightGrid, billByStoreMonth: billByStoreMonth
    });

    // ---- 店铺月度损益 ----
    var storeMonth = {};
    storeIds.forEach(function (sid) {
      storeMonth[sid] = {};
      months.forEach(function (m) {
        var store = storeById[sid];
        var gmv = num(gmvGrid[sid][m]);
        var refund = num(refundGrid[sid][m]);
        var netSales = round2(gmv - refund);
        var bill = billByStoreMonth[sid + '|' + m] || null;
        var subsidy = round2(bill ? num(bill.subsidy) : 0);
        var revenue = round2(netSales + subsidy);
        var cogs = round2(num(cogsGrid[sid][m]) - num(cogsReturnGrid[sid][m]));
        var freight = round2(freightGrid[sid][m]);

        var commission, techFee, paymentFee, insurance;
        if (bill) {
          commission = round2(num(bill.commission));
          techFee = round2(num(bill.tech_service_fee));
          paymentFee = round2(num(bill.payment_fee));
          insurance = round2(num(bill.freight_insurance));
        } else {
          commission = round2(netSales * num(store.commission_rate));
          techFee = round2(netSales * num(store.tech_fee_rate));
          paymentFee = round2(gmv * num(store.payment_fee_rate));
          insurance = round2(netSales * num(store.insurance_rate));
        }
        var platformFees = round2(commission + techFee + paymentFee + insurance);

        // 公共推广费在下方按收入占比分摊，这里只算店铺直接部分
        var promotion = round2((bill ? num(bill.promotion_fee) : 0) + num(expStore[sid + '|' + m + '|推广费']));

        var otherDirect = 0;
        Object.keys(expStore).forEach(function (k) {
          var parts = k.split('|');
          if (parts[0] === sid && parts[1] === m && parts[2] !== '推广费') otherDirect += num(expStore[k]);
        });
        var labor = round2(num(payroll.laborByStore[sid] && payroll.laborByStore[sid][m]));
        var grossProfit = round2(revenue - cogs);
        var contribution = round2(grossProfit - freight);

        storeMonth[sid][m] = {
          store_id: sid, store_name: store.name, platform: store.platform,
          month: m, gmv: round2(gmv), refund: round2(refund), netSales: netSales,
          subsidy: subsidy, revenue: revenue, cogs: cogs, freight: freight,
          commission: commission, techFee: techFee, paymentFee: paymentFee, insurance: insurance,
          platformFees: platformFees,
          promotion: promotion, labor: labor, other: round2(otherDirect),
          grossProfit: grossProfit, contribution: contribution, netProfit: 0, netMargin: 0,
          orders: orderCountGrid[sid][m], units: unitsGrid[sid][m],
          aov: orderCountGrid[sid][m] ? round2(gmv / orderCountGrid[sid][m]) : 0,
          refundRate: gmv ? round2(refund / gmv * 100) : 0,
          shipCount: shipCountGrid[sid][m],
          freightPerOrder: shipCountGrid[sid][m] ? round2(freight / shipCountGrid[sid][m]) : 0,
          feeSource: bill ? 'bill' : 'calc',
          bill_id: bill ? bill.id : ''
        };
      });
    });

    // ---- 公共费用与公共推广按收入占比分摊 ----
    var companyMonth = {};
    months.forEach(function (m) {
      var weights = storeIds.map(function (sid) {
        return Math.max(0, num(storeMonth[sid][m].revenue));
      });
      // 公共推广
      var publicPromo = num(publicExp[m + '|推广费']);
      if (publicPromo) {
        var shares = allocate(publicPromo, weights);
        storeIds.forEach(function (sid, i) { storeMonth[sid][m].promotion = round2(storeMonth[sid][m].promotion + shares[i]); });
      }
      // 其他公共费用
      var publicOther = 0;
      Object.keys(publicExp).forEach(function (k) {
        var parts = k.split('|');
        if (parts[0] === m && parts[1] !== '推广费') publicOther += num(publicExp[k]);
      });
      if (publicOther) {
        var shares2 = allocate(publicOther, weights);
        storeIds.forEach(function (sid, i) { storeMonth[sid][m].other = round2(storeMonth[sid][m].other + shares2[i]); });
      }
      // 净利
      var c = {
        month: m, gmv: 0, refund: 0, netSales: 0, subsidy: 0, revenue: 0, cogs: 0, freight: 0,
        commission: 0, techFee: 0, paymentFee: 0, insurance: 0, platformFees: 0,
        promotion: 0, labor: 0, other: 0, grossProfit: 0, contribution: 0, netProfit: 0,
        orders: 0, units: 0, shipCount: 0
      };
      storeIds.forEach(function (sid) {
        var s = storeMonth[sid][m];
        s.netProfit = round2(s.contribution - s.platformFees - s.promotion - s.labor - s.other);
        s.netMargin = s.revenue ? round2(s.netProfit / s.revenue * 100) : 0;
        ['gmv', 'refund', 'netSales', 'subsidy', 'revenue', 'cogs', 'freight', 'commission', 'techFee',
          'paymentFee', 'insurance', 'platformFees', 'promotion', 'labor', 'other', 'grossProfit',
          'contribution', 'netProfit', 'orders', 'units', 'shipCount'].forEach(function (k) {
          c[k] = round2(c[k] + s[k]);
        });
      });
      c.aov = c.orders ? round2(c.gmv / c.orders) : 0;
      c.refundRate = c.gmv ? round2(c.refund / c.gmv * 100) : 0;
      c.netMargin = c.revenue ? round2(c.netProfit / c.revenue * 100) : 0;
      c.cogsRate = pct(c.cogs, c.revenue);
      c.freightRate = pct(c.freight, c.revenue);
      c.promoRate = pct(c.promotion, c.revenue);
      c.laborRate = pct(c.labor, c.revenue);
      c.platformRate = pct(c.platformFees, c.revenue);
      c.otherRate = pct(c.other, c.revenue);
      companyMonth[m] = c;
    });

    // ---- 商品月度 ----
    var skuMonthMap = {};
    Object.keys(skuRevGrid).forEach(function (k) {
      var r = skuRevGrid[k];
      var key = r.sku_id + '|' + r.month;
      var cell = skuMonthMap[key] || (skuMonthMap[key] = {
        sku_id: r.sku_id, sku_name: (skuById[r.sku_id] || {}).name || r.sku_id,
        category: (skuById[r.sku_id] || {}).category || '未分类',
        month: r.month, qty: 0, revenue: 0, refundQty: 0, refundAmount: 0
      });
      cell.qty += r.qty; cell.revenue += r.revenue;
    });
    Object.keys(skuRefundGrid).forEach(function (k) {
      var r = skuRefundGrid[k];
      var key = r.sku_id + '|' + r.month;
      var cell = skuMonthMap[key] || (skuMonthMap[key] = {
        sku_id: r.sku_id, sku_name: (skuById[r.sku_id] || {}).name || r.sku_id,
        category: (skuById[r.sku_id] || {}).category || '未分类',
        month: r.month, qty: 0, revenue: 0, refundQty: 0, refundAmount: 0
      });
      cell.refundQty += r.qty; cell.refundAmount += r.amount;
    });
    var skuMonth = Object.keys(skuMonthMap).map(function (k) {
      var c = skuMonthMap[k];
      var cost = inv.skuCostMap[k] || { sale: 0, ret: 0 };
      c.cogs = round2(cost.sale - cost.ret);
      c.netRevenue = round2(c.revenue - c.refundAmount);
      c.grossProfit = round2(c.netRevenue - c.cogs);
      c.grossMargin = c.netRevenue ? round2(c.grossProfit / c.netRevenue * 100) : 0;
      return c;
    }).sort(function (a, b) {
      if (a.month !== b.month) return a.month < b.month ? -1 : 1;
      return b.grossProfit - a.grossProfit;
    });

    // ---- 合计（全部账期） ----
    var total = { gmv: 0, refund: 0, netSales: 0, subsidy: 0, revenue: 0, cogs: 0, freight: 0, commission: 0, techFee: 0, paymentFee: 0, insurance: 0, platformFees: 0, promotion: 0, labor: 0, other: 0, grossProfit: 0, contribution: 0, netProfit: 0, orders: 0, units: 0, shipCount: 0 };
    months.forEach(function (m) {
      Object.keys(total).forEach(function (k) { total[k] = round2(total[k] + num(companyMonth[m][k])); });
    });
    total.aov = total.orders ? round2(total.gmv / total.orders) : 0;
    total.refundRate = total.gmv ? round2(total.refund / total.gmv * 100) : 0;
    total.netMargin = total.revenue ? round2(total.netProfit / total.revenue * 100) : 0;

    var storeTotal = {};
    storeIds.forEach(function (sid) {
      var t = { store_id: sid, store_name: storeById[sid].name, platform: storeById[sid].platform, gmv: 0, revenue: 0, netProfit: 0, orders: 0, cogs: 0, freight: 0, promotion: 0, labor: 0, platformFees: 0, other: 0, contribution: 0 };
      months.forEach(function (m) {
        ['gmv', 'revenue', 'netProfit', 'orders', 'cogs', 'freight', 'promotion', 'labor', 'platformFees', 'other', 'contribution'].forEach(function (k) {
          t[k] = round2(t[k] + num(storeMonth[sid][m][k]));
        });
      });
      t.netMargin = t.revenue ? round2(t.netProfit / t.revenue * 100) : 0;
      t.share = total.netProfit > 0 ? round2(t.netProfit / total.netProfit * 100) : 0;
      storeTotal[sid] = t;
    });

    // ---- 现金流 / 对账 ----
    var recon = computeReconciliation(d, months, storeIds, {
      gmvGrid: gmvGrid, refundGrid: refundGrid, billByStoreMonth: billByStoreMonth, storeMonth: storeMonth, storeById: storeById
    });
    var cash = computeCash(d, months, storeIds, recon, billByStoreMonth, storeMonth);

    // ---- 发票 ----
    var invoices = computeInvoices(d, {
      purchaseTotals: inv.purchaseTotals, expenseById: buildMap(d.expenses, 'id'),
      billByStoreMonth: billByStoreMonth
    });

    // ---- 采购汇总 ----
    var purchases = computePurchases(d, months);

    // ---- 勾稽校验 ----
    var checks = computeChecks({
      total: total, companyMonth: companyMonth, storeMonth: storeMonth, storeIds: storeIds,
      inv: inv, recon: recon, payroll: payroll, cash: cash, months: months
    });

    // ---- KPI ----
    var kpis = {};
    months.forEach(function (m) {
      var c = companyMonth[m];
      var invM = inv.monthly[m] || { value: 0, cogs: 0, turnoverDays: 0 };
      kpis[m] = {
        month: m, revenue: c.revenue, netProfit: c.netProfit, netMargin: c.netMargin,
        gmv: c.gmv, orders: c.orders, aov: c.aov, refundRate: c.refundRate,
        cogs: c.cogs, freight: c.freight, platformFees: c.platformFees, promotion: c.promotion,
        labor: c.labor, other: c.other,
        cogsRate: c.cogsRate, freightRate: c.freightRate, promoRate: c.promoRate,
        laborRate: c.laborRate, platformRate: c.platformRate, otherRate: c.otherRate,
        inventoryValue: invM.closingValue, turnoverDays: invM.turnoverDays,
        slowMovingValue: inv.summary.slowMovingValue,
        cashReceived: cash.monthly[m] ? cash.monthly[m].received : 0,
        cashPending: cash.total.pending, cashOccupied: cash.total.occupied,
        storeRanking: storeIds.map(function (sid) {
          return { store_id: sid, name: storeById[sid].name, netProfit: storeMonth[sid][m].netProfit, revenue: storeMonth[sid][m].revenue, netMargin: storeMonth[sid][m].netMargin };
        }).sort(function (a, b) { return b.netProfit - a.netProfit; })
      };
    });

    // ---- 预警（依赖 KPI） ----
    var alerts = buildAlerts({
      checks: checks, total: total, storeTotal: storeTotal, inventory: inv.summary,
      recon: recon, invoices: invoices, months: months, currentMonth: currentMonth,
      settings: d.settings, storeMonth: storeMonth, storeIds: storeIds, kpis: kpis
    });

    var storeRankTotal = storeIds.map(function (sid) {
      var t = storeTotal[sid];
      return { store_id: sid, name: t.store_name, netProfit: t.netProfit, revenue: t.revenue, netMargin: t.netMargin, share: t.share };
    }).sort(function (a, b) { return b.netProfit - a.netProfit; });

    return {
      meta: d.meta,
      settings: d.settings,
      months: months,
      currentMonth: currentMonth,
      stores: d.stores,
      suppliers: d.suppliers,
      skus: d.skus,
      employees: d.employees,
      storeMonth: storeMonth,
      storeTotal: storeTotal,
      storeRankTotal: storeRankTotal,
      companyMonth: companyMonth,
      total: total,
      skuMonth: skuMonth,
      inventory: { bySku: inv.bySku, monthly: inv.monthly, summary: inv.summary, final: inv.final },
      payroll: payroll,
      reconciliation: recon,
      cash: cash,
      invoices: invoices,
      logistics: {
        byCarrier: Object.keys(carrierAgg).map(function (k) { return carrierAgg[k]; }),
        byProvince: Object.keys(provinceAgg).map(function (k) { return provinceAgg[k]; }),
        byStore: shipByStore,
        total: { fee: sum(d.shipments, function (s) { return num(s.base_fee) + num(s.overweight_fee) + num(s.surcharge) + num(s.return_fee); }), count: d.shipments.length, returnFee: sum(d.shipments, function (s) { return num(s.return_fee); }) }
      },
      expenses: { public: publicExp, byStore: expStore, list: d.expenses },
      purchases: purchases,
      checks: checks,
      alerts: alerts,
      kpis: kpis,
      formulas: FORMULAS
    };
  }

  // ---------------- 库存 ----------------
  function computeInventory(d, months, storeIds) {
    var events = [];
    var purchaseTotals = {};
    d.opening_inventory.forEach(function (r) {
      var qty = num(r.qty);
      var amount = num(r.unit_cost) * qty;
      events.push({ date: '0000-01-01', pri: 0, type: 'open', sku: r.sku_id, qty: qty, amount: amount, store: '' });
    });
    d.purchase_orders.forEach(function (po) {
      if (po.status && po.status !== 'received') return;
      var poTotal = 0;
      d.purchase_items.forEach(function (pi) {
        if (pi.po_id !== po.id) return;
        var qty = num(pi.qty);
        var amount = num(pi.amount) || qty * num(pi.unit_price);
        poTotal += amount;
        events.push({ date: po.date, pri: 1, type: 'in', sku: pi.sku_id, qty: qty, amount: amount, store: '', po: po.id });
      });
      purchaseTotals[po.id] = round2(poTotal);
    });

    var itemsByOrder = {};
    d.order_items.forEach(function (it) { (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it); });
    d.orders.forEach(function (o) {
      var ship = o.ship_date || o.order_date;
      (itemsByOrder[o.id] || []).forEach(function (it) {
        var qty = num(it.qty);
        if (qty <= 0) return;
        events.push({ date: ship, pri: 3, type: 'out', sku: it.sku_id, qty: qty, store: o.store_id, month: monthOf(ship), order: o.id, item: it });
        var rq = num(it.refund_qty);
        if (rq > 0) {
          var rd = it.refund_date || o.refund_date || o.order_date;
          events.push({ date: rd, pri: 2, type: 'ret', sku: it.sku_id, qty: rq, store: o.store_id, month: monthOf(rd), order: o.id });
        }
      });
    });

    events.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.pri !== b.pri) return a.pri - b.pri;
      return 0;
    });

    var state = {}; // sku -> {qty, value}
    var cogsGrid = grid(storeIds, months);
    var cogsReturnGrid = grid(storeIds, months);
    var skuCostMap = {}; // sku|month -> {sale, ret}
    var bySku = {};
    d.skus.forEach(function (s) {
      bySku[s.id] = {
        sku_id: s.id, sku_name: s.name, category: s.category, spec: s.spec,
        openingQty: 0, openingValue: 0, inboundQty: 0, inboundValue: 0, outboundQty: 0,
        cogs: 0, returnQty: 0, returnValue: 0, closingQty: 0, closingValue: 0, lastOutDate: '', negative: 0
      };
    });
    d.opening_inventory.forEach(function (r) {
      var b = bySku[r.sku_id];
      if (b) { b.openingQty += num(r.qty); b.openingValue += num(r.qty) * num(r.unit_cost); }
    });

    function snapshot() {
      var qty = 0, value = 0;
      Object.keys(state).forEach(function (k) { qty += state[k].qty; value += state[k].value; });
      return { qty: qty, value: value };
    }
    function skuSnapshot() {
      var o = {};
      Object.keys(state).forEach(function (k) {
        o[k] = { qty: state[k].qty, value: state[k].value, avg: state[k].qty > 0 ? state[k].value / state[k].qty : 0 };
      });
      return o;
    }

    var monthly = {};
    var mi = 0;
    var snapshots = {};
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      while (mi < months.length && ev.date > monthEnd(months[mi])) {
        snapshots[months[mi]] = snapshot();
        mi++;
      }
      var st = state[ev.sku] || (state[ev.sku] = { qty: 0, value: 0 });
      var avg = st.qty > 0 ? st.value / st.qty : 0;
      if (ev.type === 'open' || ev.type === 'in') {
        st.qty += ev.qty;
        st.value += ev.amount;
        if (bySku[ev.sku] && ev.type === 'in') { bySku[ev.sku].inboundQty += ev.qty; bySku[ev.sku].inboundValue += ev.amount; }
      } else if (ev.type === 'ret') {
        var cost = ev.qty * avg;
        st.qty += ev.qty;
        st.value += cost;
        if (bySku[ev.sku]) { bySku[ev.sku].returnQty += ev.qty; bySku[ev.sku].returnValue += cost; }
        if (ev.store) add(cogsReturnGrid, ev.store, ev.month, cost);
        var kr = ev.sku + '|' + ev.month;
        (skuCostMap[kr] = skuCostMap[kr] || { sale: 0, ret: 0 }).ret += cost;
      } else if (ev.type === 'out') {
        var c = ev.qty * avg;
        st.qty -= ev.qty;
        st.value -= c;
        if (st.qty < -0.0001) { if (bySku[ev.sku]) bySku[ev.sku].negative++; st.qty = 0; st.value = 0; }
        if (bySku[ev.sku]) {
          bySku[ev.sku].outboundQty += ev.qty;
          bySku[ev.sku].cogs += c;
          if (!bySku[ev.sku].lastOutDate || ev.date > bySku[ev.sku].lastOutDate) bySku[ev.sku].lastOutDate = ev.date;
        }
        if (ev.store) add(cogsGrid, ev.store, ev.month, c);
        var ks = ev.sku + '|' + ev.month;
        (skuCostMap[ks] = skuCostMap[ks] || { sale: 0, ret: 0 }).sale += c;
      }
    }
    while (mi < months.length) { snapshots[months[mi]] = snapshot(); mi++; }

    var finalSnap = skuSnapshot();
    var lastMonth = months[months.length - 1];
    var slowDays = num(d.settings.slow_moving_days, 60);
    var slowCut = new Date(Date.parse(monthEnd(lastMonth) + 'T00:00:00Z') - slowDays * 86400000).toISOString().slice(0, 10);

    var bySkuArr = Object.keys(bySku).map(function (k) {
      var b = bySku[k];
      var snap = finalSnap[k] || { qty: 0, value: 0, avg: 0 };
      b.closingQty = snap.qty;
      b.closingValue = round2(snap.value);
      b.avgCost = round2(snap.avg);
      b.openingValue = round2(b.openingValue);
      b.inboundValue = round2(b.inboundValue);
      b.cogs = round2(b.cogs - b.returnValue);
      b.slowMoving = snap.qty > 0 && (!b.lastOutDate || b.lastOutDate < slowCut);
      b.stockDays = b.cogs > 0 ? Math.round(snap.value / (b.cogs / months.length) * 30) : (snap.qty > 0 ? 999 : 0);
      return b;
    }).sort(function (a, b) { return b.closingValue - a.closingValue; });

    // 月度库存与周转
    var prevValue = 0;
    d.opening_inventory.forEach(function (r) { prevValue += num(r.qty) * num(r.unit_cost); });
    months.forEach(function (m) {
      var close = snapshots[m] || { qty: 0, value: 0 };
      var monthCogs = 0;
      storeIds.forEach(function (sid) { monthCogs += num(cogsGrid[sid][m]) - num(cogsReturnGrid[sid][m]); });
      var avgInv = (prevValue + close.value) / 2;
      monthly[m] = {
        month: m,
        openingValue: round2(prevValue),
        closingValue: round2(close.value),
        closingQty: close.qty,
        cogs: round2(monthCogs),
        turnoverDays: monthCogs > 0 ? Math.round(avgInv / monthCogs * daysInMonth(m)) : 0,
        avgInventory: round2(avgInv)
      };
      prevValue = close.value;
    });

    var totalCogs = 0;
    months.forEach(function (m) { totalCogs += monthly[m].cogs; });
    var totalDays = 0;
    months.forEach(function (m) { totalDays += daysInMonth(m); });
    var openingValue = 0;
    d.opening_inventory.forEach(function (r) { openingValue += num(r.qty) * num(r.unit_cost); });
    var finalValue = snapshots[lastMonth] ? snapshots[lastMonth].value : 0;
    var totalSummary = {
      qty: snapshots[lastMonth] ? snapshots[lastMonth].qty : 0,
      value: round2(finalValue),
      openingValue: round2(openingValue),
      cogs: round2(totalCogs),
      turnoverDays: totalCogs > 0 ? Math.round(((openingValue + finalValue) / 2) / totalCogs * totalDays) : 0,
      slowMovingValue: round2(sum(bySkuArr.filter(function (b) { return b.slowMoving; }), function (b) { return b.closingValue; })),
      slowMovingCount: bySkuArr.filter(function (b) { return b.slowMoving; }).length,
      skuCount: bySkuArr.length
    };

    return {
      cogsGrid: cogsGrid, cogsReturnGrid: cogsReturnGrid, skuCostMap: skuCostMap,
      bySku: bySkuArr, monthly: monthly, summary: totalSummary,
      final: { qty: totalSummary.qty, value: totalSummary.value },
      purchaseTotals: purchaseTotals
    };
  }

  // ---------------- 工资 ----------------
  function computePayroll(d, months, storeIds, ctx) {
    var byMonth = {};
    var laborByStore = {}; // store -> month -> amount
    storeIds.forEach(function (sid) { laborByStore[sid] = {}; });
    var totalGross = 0, totalNet = 0, totalCommission = 0;

    months.forEach(function (m) {
      var revenue = {};
      storeIds.forEach(function (sid) {
        var gmv = num(ctx.gmvGrid[sid][m]);
        var refund = num(ctx.refundGrid[sid][m]);
        var bill = ctx.billByStoreMonth[sid + '|' + m];
        revenue[sid] = Math.max(0, gmv - refund + (bill ? num(bill.subsidy) : 0));
      });
      var contribution = {};
      storeIds.forEach(function (sid) {
        contribution[sid] = revenue[sid] - num(ctx.cogsGrid[sid][m]) + num(ctx.cogsReturnGrid[sid][m]) - num(ctx.freightGrid[sid][m]);
      });

      var rows = [];
      var pool = 0;
      d.employees.forEach(function (e) {
        if (e.active === false) return;
        if (e.joined_at && e.joined_at > monthEnd(m)) return;
        var storeIdsE = (e.store_ids && e.store_ids.length) ? e.store_ids.filter(function (sid) { return storeIds.indexOf(sid) >= 0; }) : [];
        var basis = e.basis || d.settings.default_basis || 'gross_profit';
        var commissionByStore = {};
        var commission = 0;
        var commissionShare = num(e.commission_share, 1);
        storeIdsE.forEach(function (sid) {
          var base = basis === 'revenue' ? revenue[sid] : contribution[sid];
          var c = round2(ladderCommission(Math.max(0, base), d.settings.commission_ladder) * commissionShare);
          commissionByStore[sid] = c;
          commission += c;
        });
        var base = num(e.base_salary);
        var allowance = num(e.allowance);
        var deduction = num(e.deduction);
        var gross = round2(base + allowance + commission);
        var net = round2(gross - deduction);
        var alloc = [];
        if (storeIdsE.length) {
          var weights = storeIdsE.map(function (sid) { return Math.max(0, revenue[sid]); });
          alloc = allocate(base + allowance, weights);
          storeIdsE.forEach(function (sid, i) { add(laborByStore, sid, m, alloc[i] + (commissionByStore[sid] || 0)); });
        } else {
          pool += base + allowance;
        }
        rows.push({
          employee_id: e.id, name: e.name, role: e.role, month: m,
          base_salary: round2(base), allowance: round2(allowance),
          commission: round2(commission), deduction: round2(deduction),
          gross: gross, net: net, basis: basis,
          store_ids: storeIdsE, commissionByStore: commissionByStore,
          allocatedToStores: storeIdsE.length ? storeIdsE.map(function (sid, i) { return { store_id: sid, amount: round2(alloc[i]) }; }) : []
        });
        totalGross = round2(totalGross + gross);
        totalNet = round2(totalNet + net);
        totalCommission = round2(totalCommission + commission);
      });

      // 无店铺员工薪酬进公共池，按收入占比分摊
      if (pool > 0) {
        var weights2 = storeIds.map(function (sid) { return Math.max(0, revenue[sid]); });
        var shares = allocate(pool, weights2);
        storeIds.forEach(function (sid, i) { add(laborByStore, sid, m, shares[i]); });
      }
      byMonth[m] = { month: m, rows: rows, totalGross: round2(sum(rows, function (r) { return r.gross; })), totalNet: round2(sum(rows, function (r) { return r.net; })), totalCommission: round2(sum(rows, function (r) { return r.commission; })) };
    });

    return {
      byMonth: byMonth,
      laborByStore: laborByStore,
      total: { gross: totalGross, net: totalNet, commission: totalCommission, headcount: d.employees.filter(function (e) { return e.active !== false; }).length },
      settings: { ladder: d.settings.commission_ladder, basis: d.settings.default_basis }
    };
  }

  // ---------------- 对账 ----------------
  function computeReconciliation(d, months, storeIds, ctx) {
    var bills = [];
    d.platform_bills.forEach(function (b) {
      var ordersGmv = num(ctx.gmvGrid[b.store_id] && ctx.gmvGrid[b.store_id][b.period]);
      var ordersRefund = num(ctx.refundGrid[b.store_id] && ctx.refundGrid[b.store_id][b.period]);
      var recomputed = round2(num(b.gmv) - num(b.refund_amount) + num(b.subsidy) - num(b.commission) -
        num(b.tech_service_fee) - num(b.payment_fee) - num(b.promotion_fee) - num(b.freight_insurance) -
        num(b.other_deduction));
      var settled = round2(num(b.settled_amount));
      var diff = round2(settled - recomputed);
      var gmvDiff = round2(num(b.gmv) - ordersGmv);
      var refundDiff = round2(num(b.refund_amount) - ordersRefund);
      var note = b.note || '';
      bills.push({
        bill_id: b.id, store_id: b.store_id,
        store_name: (ctx.storeById[b.store_id] || {}).name || b.store_id,
        platform: (ctx.storeById[b.store_id] || {}).platform || '',
        period: b.period, gmv: round2(num(b.gmv)), refund: round2(num(b.refund_amount)),
        commission: round2(num(b.commission)), techFee: round2(num(b.tech_service_fee)),
        paymentFee: round2(num(b.payment_fee)), promotion: round2(num(b.promotion_fee)),
        insurance: round2(num(b.freight_insurance)), subsidy: round2(num(b.subsidy)),
        otherDeduction: round2(num(b.other_deduction)),
        settledAmount: settled, recomputed: recomputed, diff: diff,
        ordersGmv: round2(ordersGmv), ordersRefund: round2(ordersRefund),
        gmvDiff: gmvDiff, refundDiff: refundDiff,
        status: b.status, payoutDate: b.payout_date || '',
        note: note, explained: !!note || Math.abs(diff) < TOL,
        source: 'platform'
      });
    });

    var payoutDiffs = [];
    var payoutsByBill = {};
    d.payouts.forEach(function (p) {
      var k = p.bill_id || (p.store_id + '|' + monthOf(p.date));
      (payoutsByBill[k] = payoutsByBill[k] || []).push(p);
    });
    bills.forEach(function (b) {
      var ps = payoutsByBill[b.bill_id] || [];
      var paid = round2(sum(ps, function (p) { return num(p.amount); }));
      if (ps.length) {
        b.paid = paid;
        b.payoutDiff = round2(paid - b.settledAmount);
        if (Math.abs(b.payoutDiff) >= TOL) {
          payoutDiffs.push({ bill_id: b.bill_id, store_name: b.store_name, period: b.period, settled: b.settledAmount, paid: paid, diff: b.payoutDiff, note: '打款与账单存在差异，请核对银行流水' });
        }
      } else {
        b.paid = 0;
      }
    });

    var diffTotal = round2(sum(bills, function (b) { return b.diff; }));
    bills.forEach(function (b) {
      b.hasDiff = Math.abs(b.diff) > TOL || Math.abs(b.gmvDiff) > TOL || Math.abs(b.refundDiff) > TOL;
    });
    var unexplained = bills.filter(function (b) { return b.hasDiff && !b.note; });
    var diffBills = bills.filter(function (b) { return b.hasDiff; });
    return {
      bills: bills,
      payoutDiffs: payoutDiffs,
      summary: {
        billCount: bills.length,
        diffTotal: diffTotal,
        billGmv: round2(sum(bills, function (b) { return b.gmv; })),
        orderGmv: round2(sum(bills, function (b) { return b.ordersGmv; })),
        settlementTotal: round2(sum(bills, function (b) { return b.settledAmount; })),
        diffCount: diffBills.length,
        explainedCount: diffBills.length - unexplained.length,
        unexplainedCount: unexplained.length,
        unexplainedAmount: round2(sum(unexplained, function (b) { return b.diff; })),
        unexplainedBills: unexplained.map(function (b) { return b.bill_id; })
      }
    };
  }

  // ---------------- 现金流 ----------------
  function computeCash(d, months, storeIds, recon, billByStoreMonth, storeMonth) {
    var byStore = {};
    storeIds.forEach(function (sid) { byStore[sid] = { store_id: sid, received: 0, pending: 0, occupied: 0 }; });
    var monthly = {};
    months.forEach(function (m) { monthly[m] = { month: m, received: 0, pending: 0, occupied: 0 }; });

    d.payouts.forEach(function (p) {
      if (byStore[p.store_id]) byStore[p.store_id].received = round2(byStore[p.store_id].received + num(p.amount));
      var m = monthOf(p.date);
      if (monthly[m]) monthly[m].received = round2(monthly[m].received + num(p.amount));
    });

    d.platform_bills.forEach(function (b) {
      if (b.status !== 'pending') return;
      if (byStore[b.store_id]) byStore[b.store_id].pending = round2(byStore[b.store_id].pending + num(b.settled_amount));
      if (byStore[b.store_id]) byStore[b.store_id].occupied = round2(byStore[b.store_id].occupied + num(b.gmv) - num(b.refund_amount));
      var m = b.period;
      if (monthly[m]) {
        monthly[m].pending = round2(monthly[m].pending + num(b.settled_amount));
        monthly[m].occupied = round2(monthly[m].occupied + num(b.gmv) - num(b.refund_amount));
      }
    });

    var total = { received: 0, pending: 0, occupied: 0 };
    storeIds.forEach(function (sid) {
      total.received = round2(total.received + byStore[sid].received);
      total.pending = round2(total.pending + byStore[sid].pending);
      total.occupied = round2(total.occupied + byStore[sid].occupied);
    });
    return { byStore: byStore, monthly: monthly, total: total };
  }

  // ---------------- 发票 ----------------
  function computeInvoices(d, ctx) {
    var input = { count: 0, amount: 0, tax: 0, matched: 0, mismatch: 0, unmatched: 0, list: [] };
    var output = { count: 0, amount: 0, tax: 0, matched: 0, mismatch: 0, unmatched: 0, list: [] };
    var issues = [];
    var invoiceNumbers = {};
    var billById = {};
    d.platform_bills.forEach(function (b) { billById[b.id] = b; });

    d.invoices.forEach(function (inv) {
      var row = {
        id: inv.id, number: inv.number, date: inv.date, seller: inv.seller, buyer: inv.buyer,
        amount: round2(num(inv.amount)), tax_amount: round2(num(inv.tax_amount)),
        related_type: inv.related_type, related_id: inv.related_id, note: inv.note || '',
        status: 'unmatched', expected: 0, diff: 0
      };
      if (inv.number) {
        if (invoiceNumbers[inv.number]) issues.push({ type: 'duplicate_number', invoice: inv.number, message: '发票号重复：' + inv.number });
        invoiceNumbers[inv.number] = true;
      }
      var expected = null;
      if (inv.related_type === 'purchase' && inv.related_id) {
        expected = ctx.purchaseTotals[inv.related_id];
      } else if (inv.related_type === 'expense' && inv.related_id) {
        var ex = ctx.expenseById[inv.related_id];
        expected = ex ? num(ex.amount) : null;
      } else if (inv.related_type === 'platform_fee' && inv.related_id) {
        var parts = String(inv.related_id).split('|');
        var bb = ctx.billByStoreMonth[parts[0] + '|' + parts[1]];
        expected = bb ? num(bb.commission) + num(bb.tech_service_fee) : null;
      } else if (inv.related_type === 'sales' && inv.related_id) {
        var bb2 = billById[inv.related_id];
        expected = bb2 ? num(bb2.gmv) - num(bb2.refund_amount) : null;
      }
      if (expected === null || expected === undefined) {
        row.status = 'unmatched';
        issues.push({ type: 'unmatched', invoice: inv.number, message: '发票 ' + inv.number + ' 找不到关联单据（' + (inv.related_type || '未填') + ' / ' + (inv.related_id || '空') + '）' });
      } else if (Math.abs(row.amount - expected) < 0.01) {
        row.status = 'matched';
      } else {
        row.status = 'mismatch';
        row.diff = round2(row.amount - expected);
        issues.push({ type: 'amount_mismatch', invoice: inv.number, message: '发票金额 ' + row.amount + ' 与单据金额 ' + round2(expected) + ' 不一致' });
      }
      row.expected = round2(expected);
      var bucket = inv.direction === 'output' ? output : input;
      bucket.count++;
      bucket.amount = round2(bucket.amount + row.amount);
      bucket.tax = round2(bucket.tax + row.tax_amount);
      bucket[row.status === 'matched' ? 'matched' : row.status === 'mismatch' ? 'mismatch' : 'unmatched']++;
      bucket.list.push(row);
    });

    // 应有发票但缺失
    var missingPurchase = [];
    d.purchase_orders.forEach(function (po) {
      var total = ctx.purchaseTotals[po.id] || 0;
      if (total > 0 && !po.invoice_no) {
        missingPurchase.push({ po_id: po.id, supplier_id: po.supplier_id, date: po.date, amount: round2(total) });
      }
    });
    var missingExpense = [];
    d.expenses.forEach(function (ex) {
      if (num(ex.amount) >= 500 && !ex.invoice_no) {
        missingExpense.push({ expense_id: ex.id, date: ex.date, category: ex.category, vendor: ex.vendor, amount: round2(num(ex.amount)) });
      }
    });

    return {
      input: input, output: output, issues: issues,
      missing: { purchases: missingPurchase, expenses: missingExpense },
      missingAmount: round2(sum(missingPurchase.map(function (m) { return m.amount; })) + sum(missingExpense.map(function (m) { return m.amount; })))
    };
  }

  // ---------------- 采购 ----------------
  function computePurchases(d, months) {
    var bySupplier = {};
    d.suppliers.forEach(function (s) { bySupplier[s.id] = { supplier_id: s.id, name: s.name, amount: 0, poCount: 0, tax_rate: num(s.tax_rate) }; });
    var total = 0;
    d.purchase_orders.forEach(function (po) {
      var amt = 0;
      d.purchase_items.forEach(function (pi) { if (pi.po_id === po.id) amt += num(pi.amount) || num(pi.qty) * num(pi.unit_price); });
      total += amt;
      var s = bySupplier[po.supplier_id];
      if (s) { s.amount = round2(s.amount + amt); s.poCount++; }
    });
    return {
      bySupplier: Object.keys(bySupplier).map(function (k) { return bySupplier[k]; }).sort(function (a, b) { return b.amount - a.amount; }),
      total: round2(total),
      poCount: d.purchase_orders.length
    };
  }

  // ---------------- 勾稽校验 ----------------
  function computeChecks(ctx) {
    var checks = [];
    var total = ctx.total;

    checks.push(checkItem('pnl-identity', '利润恒等式',
      round2(total.revenue - total.cogs - total.freight - total.platformFees - total.promotion - total.labor - total.other),
      total.netProfit, 0.02));

    var storeSum = round2(sum(ctx.storeIds.map(function (sid) {
      var t = 0;
      ctx.months.forEach(function (m) { t += ctx.storeMonth[sid][m].netProfit; });
      return round2(t);
    })));
    checks.push(checkItem('store-sum', '店铺利润合计 = 公司净利润', total.netProfit, storeSum, 0.02));

    // 库存滚动
    var rollOk = true, rollDetail = [];
    ctx.inv.bySku.forEach(function (b) {
      var rolled = round2(b.openingQty + b.inboundQty - b.outboundQty + b.returnQty - b.closingQty);
      if (Math.abs(rolled) > 0.001) { rollOk = false; rollDetail.push(b.sku_name + ' 差异 ' + rolled); }
    });
    checks.push({ id: 'inventory-roll', label: '库存滚动（期初 + 入库 − 出库 = 期末）', ok: rollOk, expected: 0, actual: 0, diff: 0, detail: rollDetail.join('；') });

    var cogsTotal = 0, grossCogs = 0, returnCogs = 0;
    ctx.months.forEach(function (m) {
      ctx.storeIds.forEach(function (sid) {
        cogsTotal += ctx.storeMonth[sid][m].cogs;
      });
    });
    ctx.inv.bySku.forEach(function (b) { grossCogs += b.cogs + b.returnValue; returnCogs += b.returnValue; });
    checks.push(checkItem('cost-consistency', '商品成本 = 出库 − 退货入库', round2(grossCogs - returnCogs), round2(cogsTotal), 0.2));

    checks.push({
      id: 'bill-vs-orders', label: '账单与订单/结算差异均有说明',
      ok: ctx.recon.summary.unexplainedCount === 0,
      expected: ctx.recon.summary.diffCount,
      actual: ctx.recon.summary.explainedCount,
      diff: -ctx.recon.summary.unexplainedCount,
      detail: ctx.recon.summary.unexplainedCount ? '未说明账单：' + ctx.recon.summary.unexplainedBills.join('、') : '差异均已说明（' + ctx.recon.summary.diffCount + ' 笔）'
    });

    var settledTotal = round2(sum(ctx.recon.bills.filter(function (b) { return b.status === 'settled'; }), function (b) { return b.settledAmount; }));
    var payoutDiffTotal = round2(sum(ctx.recon.payoutDiffs, function (p) { return p.diff; }));
    var payoutOk = Math.abs(round2(ctx.cash.total.received - settledTotal - payoutDiffTotal)) <= 0.02;
    checks.push({
      id: 'payout-vs-bill', label: '已回款 = 已结算账单金额（含已列明的打款差异）',
      ok: payoutOk, expected: settledTotal, actual: ctx.cash.total.received,
      diff: round2(ctx.cash.total.received - settledTotal),
      detail: payoutOk ? '一致' : '差异 ' + round2(ctx.cash.total.received - settledTotal) + ' 元（其中已列明 ' + payoutDiffTotal + ' 元）'
    });

    checks.push(checkItem('payroll-total', '工资合计 = 计入利润的人工成本', ctx.payroll.total.gross, total.labor, 0.1));

    var negative = ctx.inv.bySku.filter(function (b) { return b.negative > 0; });
    checks.push({ id: 'negative-stock', label: '无负库存', ok: negative.length === 0, expected: 0, actual: negative.length, diff: 0, detail: negative.map(function (b) { return b.sku_name + ' ×' + b.negative; }).join('；') });

    return checks;
  }

  function checkItem(id, label, expected, actual, tol, extra) {
    var diff = round2(actual - expected);
    var ok = Math.abs(diff) <= tol;
    if (extra && typeof extra.explained === 'boolean') ok = extra.explained;
    return Object.assign({
      id: id, label: label, ok: ok, expected: round2(expected), actual: round2(actual), diff: diff,
      detail: extra && extra.note ? extra.note : (ok ? '一致' : '差异 ' + diff)
    }, extra || {});
  }

  // ---------------- 预警 ----------------
  function buildAlerts(ctx) {
    var alerts = [];
    ctx.checks.forEach(function (c) {
      if (!c.ok) alerts.push({ level: 'error', title: '勾稽异常：' + c.label, detail: c.detail || ('差异 ' + c.diff), page: 'overview' });
    });
    if (ctx.recon.payoutDiffs.length) {
      alerts.push({ level: 'warn', title: ctx.recon.payoutDiffs.length + ' 张账单打款与结算金额不符', detail: '合计差异 ' + round2(sum(ctx.recon.payoutDiffs, function (p) { return p.diff; })) + ' 元，建议核对银行流水', page: 'settlement' });
    }
    if (ctx.recon.summary.unexplainedCount) {
      alerts.push({ level: 'warn', title: ctx.recon.summary.unexplainedCount + ' 张平台账单存在未说明差异', detail: '差异合计 ' + ctx.recon.summary.unexplainedAmount + ' 元', page: 'settlement' });
    }
    if (ctx.inventory.slowMovingValue > 0) {
      alerts.push({ level: 'warn', title: '滞销库存 ' + ctx.inventory.slowMovingCount + ' 个 SKU', detail: '占用资金 ' + ctx.inventory.slowMovingValue + ' 元，超过 ' + (ctx.settings.slow_moving_days || 60) + ' 天无出库', page: 'inventory' });
    }
    Object.keys(ctx.storeTotal).forEach(function (sid) {
      var s = ctx.storeTotal[sid];
      if (s.revenue > 0 && s.netProfit < 0) {
        alerts.push({ level: 'warn', title: s.store_name + ' 累计亏损', detail: '净亏损 ' + Math.abs(s.netProfit) + ' 元，净利率 ' + s.netMargin + '%', page: 'stores' });
      }
    });
    if (ctx.invoices.missingAmount > 0) {
      alerts.push({ level: 'info', title: '有 ' + (ctx.invoices.missing.purchases.length + ctx.invoices.missing.expenses.length) + ' 笔支出缺少发票', detail: '合计 ' + ctx.invoices.missingAmount + ' 元，可抵扣进项可能未取得', page: 'invoices' });
    }
    var m = ctx.currentMonth;
    if (m && ctx.kpis[m] && ctx.kpis[m].netMargin < 5 && ctx.kpis[m].revenue > 0) {
      alerts.push({ level: 'warn', title: '本月净利率偏低', detail: '净利率 ' + ctx.kpis[m].netMargin + '%，低于 5% 警戒线', page: 'overview' });
    }
    return alerts;
  }

  function buildMap(arr, key) {
    var m = {};
    (arr || []).forEach(function (r) { m[r[key]] = r; });
    return m;
  }

  // ---------------- 对外 ----------------
  return {
    computeModel: computeModel,
    normalize: normalize,
    ladderCommission: ladderCommission,
    allocate: allocate,
    monthList: monthList,
    round2: round2,
    FORMULAS: FORMULAS
  };
});
