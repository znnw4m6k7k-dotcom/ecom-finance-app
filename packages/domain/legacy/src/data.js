/* 电商财务集成系统 · 演示数据生成器
 * 虚构美妆品牌「麓野 LUYE」：3 个月（2026-08 ~ 2026-10）、3 个店铺、36 个 SKU。
 * 只生成原始明细（订单/明细/面单/采购/账单/打款/费用/发票），所有汇总由引擎计算。
 * 固定随机种子，Node 与浏览器生成结果一致，便于测试断言。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinDemoData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MONTHS = ['2026-08', '2026-09', '2026-10'];
  var GROWTH = { '2026-08': 1.0, '2026-09': 1.06, '2026-10': 1.13 };
  var WEEKDAY = [0.9, 0.92, 0.95, 0.97, 1.05, 1.12, 1.1]; // 周日..周六

  var STORE_CFG = [
    {
      id: 'TB01', platform: 'taobao', name: '麓野旗舰店（天猫）', short: 'TB01',
      commission_rate: 0.05, tech_fee_rate: 0.02, payment_fee_rate: 0.006, insurance_rate: 0.008,
      settlement_days: 15, promo_rate: 0.075, discount: 0.92, daily: 75, subsidy_rate: 0.003
    },
    {
      id: 'TB02', platform: 'taobao', name: '麓野官方奥莱店（淘宝）', short: 'TB02',
      commission_rate: 0.05, tech_fee_rate: 0.005, payment_fee_rate: 0.006, insurance_rate: 0.004,
      settlement_days: 15, promo_rate: 0.045, discount: 0.78, daily: 32, subsidy_rate: 0
    },
    {
      id: 'XHS01', platform: 'xhs', name: '麓野品牌店（小红书）', short: 'XHS',
      commission_rate: 0.05, tech_fee_rate: 0.02, payment_fee_rate: 0.006, insurance_rate: 0.008,
      settlement_days: 20, promo_rate: 0.09, discount: 0.88, daily: 48, subsidy_rate: 0
    }
  ];

  // [名称, 类目, 规格, 零售价, 成本占比, 权重, 停售月份]
  var SKU_CFG = [
    ['玻尿酸水光精华', '精华', '30ml', 139, 0.44, 95],
    ['烟酰胺焕亮精华', '精华', '30ml', 129, 0.43, 55],
    ['早C晚A精华套装', '精华', '30ml×2', 299, 0.42, 35],
    ['视黄醇紧致晚霜', '面霜', '50g', 219, 0.45, 60],
    ['神经酰胺修护面霜', '面霜', '50g', 159, 0.44, 88],
    ['冰川水面霜', '面霜', '50g', 129, 0.45, 45],
    ['氨基酸洁面乳', '洁面', '120g', 79, 0.42, 80],
    ['卸妆膏', '洁面', '90g', 89, 0.46, 50],
    ['水杨酸清痘洁面', '洁面', '100g', 69, 0.44, 32],
    ['补水保湿面膜', '面膜', '10片', 99, 0.42, 98],
    ['美白淡斑面膜', '面膜', '5片', 79, 0.43, 50],
    ['修护睡眠面膜', '面膜', '80g', 109, 0.45, 40],
    ['持妆粉底液', '彩妆', '30ml', 199, 0.46, 65],
    ['绒雾口红', '彩妆', '3.5g', 119, 0.44, 75],
    ['空气感散粉', '彩妆', '8g', 129, 0.45, 40],
    ['防水睫毛膏', '彩妆', '8g', 89, 0.46, 30],
    ['轻透防晒乳 SPF50', '防晒', '50ml', 129, 0.43, 85],
    ['冰感防晒喷雾', '防晒', '150ml', 99, 0.45, 45],
    ['烟酰胺身体乳', '身体护理', '250ml', 89, 0.42, 45],
    ['海盐磨砂膏', '身体护理', '200g', 79, 0.44, 25],
    ['乳木果护手霜', '身体护理', '50g', 39, 0.4, 35],
    ['头皮舒缓精华', '头皮护理', '60ml', 149, 0.46, 20],
    ['氨基酸洗发水', '洗护', '400ml', 99, 0.43, 30],
    ['护发精油', '洗护', '50ml', 89, 0.45, 25],
    ['多肽紧致眼霜', '眼部', '15g', 189, 0.45, 40],
    ['咖啡因眼部精华', '眼部', '20ml', 159, 0.44, 25],
    ['懒人素颜霜', '面霜', '50g', 139, 0.45, 35],
    ['定妆喷雾', '彩妆', '100ml', 119, 0.46, 25],
    ['镜面唇釉', '彩妆', '4g', 99, 0.43, 40],
    ['细头眉笔', '彩妆', '0.2g', 59, 0.42, 30, ['2026-08']],
    ['四色修容盘', '彩妆', '12g', 149, 0.45, 20],
    ['高光粉饼', '彩妆', '7g', 129, 0.45, 20],
    ['温和卸妆水', '洁面', '300ml', 69, 0.42, 30],
    ['角鲨烷精华油', '精华', '30ml', 239, 0.46, 16, ['2026-08']],
    ['冻干粉修护套组', '精华', '7支', 169, 0.44, 20, []],
    ['弹润颈霜', '面霜', '50g', 159, 0.45, 12, ['2026-08']]
  ];

  var SUPPLIERS = [
    { id: 'SUP01', name: '广州植萃生物科技（虚构）', tax_rate: 0.13, terms: '预付 30% / 到货 70%' },
    { id: 'SUP02', name: '上海色彩化妆品制造（虚构）', tax_rate: 0.13, terms: '月结 30 天' },
    { id: 'SUP03', name: '杭州净研日化（虚构）', tax_rate: 0.13, terms: '月结 45 天' }
  ];

  var EMPLOYEES = [
    { id: 'EMP01', name: '杨清', role: '运营', base_salary: 20000, allowance: 2000, deduction: 3200, basis: 'gross_profit', store_ids: ['TB01', 'TB02', 'XHS01'], commission_share: 0.25, joined_at: '2025-03-01' },
    { id: 'EMP02', name: '陈默', role: '运营', base_salary: 13000, allowance: 1000, deduction: 2100, basis: 'gross_profit', store_ids: ['TB01'], commission_share: 0.75, joined_at: '2025-05-12' },
    { id: 'EMP03', name: '林夏', role: '运营', base_salary: 10000, allowance: 800, deduction: 1600, basis: 'gross_profit', store_ids: ['TB02'], commission_share: 1, joined_at: '2025-08-01' },
    { id: 'EMP04', name: '苏禾', role: '运营', base_salary: 10000, allowance: 800, deduction: 1600, basis: 'gross_profit', store_ids: ['XHS01'], commission_share: 0.6, joined_at: '2025-09-15' },
    { id: 'EMP05', name: '阿泽', role: '主播', base_salary: 8000, allowance: 500, deduction: 1200, basis: 'gross_profit', store_ids: ['XHS01'], commission_share: 0.4, joined_at: '2026-02-20' },
    { id: 'EMP06', name: '周宁', role: '客服', base_salary: 6500, allowance: 300, deduction: 900, basis: 'gross_profit', store_ids: ['TB01'], commission_share: 0, joined_at: '2025-11-03' },
    { id: 'EMP07', name: '吴桐', role: '客服', base_salary: 6500, allowance: 300, deduction: 900, basis: 'gross_profit', store_ids: ['TB01', 'TB02', 'XHS01'], commission_share: 0, joined_at: '2026-01-06' },
    { id: 'EMP08', name: '郑凯', role: '仓管', base_salary: 7500, allowance: 400, deduction: 1000, basis: 'gross_profit', store_ids: [], commission_share: 0, joined_at: '2025-04-18' },
    { id: 'EMP09', name: '许澄', role: '财务', base_salary: 8500, allowance: 300, deduction: 1100, basis: 'gross_profit', store_ids: [], commission_share: 0, joined_at: '2025-06-09' }
  ];

  var PROVINCES = [
    ['广东', 160], ['浙江', 140], ['江苏', 120], ['上海', 90], ['北京', 80], ['山东', 70],
    ['四川', 50], ['河南', 40], ['湖北', 40], ['湖南', 30], ['福建', 40], ['安徽', 30],
    ['河北', 30], ['陕西', 20], ['辽宁', 20], ['江西', 20], ['重庆', 20], ['云南', 10],
    ['广西', 10], ['山西', 10], ['贵州', 10], ['新疆', 10], ['内蒙古', 10], ['吉林', 5],
    ['黑龙江', 5], ['甘肃', 4], ['海南', 4], ['宁夏', 2], ['青海', 2], ['西藏', 1]
  ];
  var CARRIER_MULT = { '中通': 1.0, '圆通': 1.0, '顺丰': 1.55, '京东': 1.15 };

  function rngFactory(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function round2(n) { return Math.round((n + 1e-9) * 100) / 100; }
  function pickWeighted(rng, items, weightFn) {
    var total = 0;
    for (var i = 0; i < items.length; i++) total += weightFn(items[i], i);
    var r = rng() * total;
    for (var j = 0; j < items.length; j++) {
      r -= weightFn(items[j], j);
      if (r <= 0) return items[j];
    }
    return items[items.length - 1];
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(dateStr, days) {
    var t = Date.parse(dateStr + 'T00:00:00Z') + days * 86400000;
    return ymd(new Date(t));
  }
  function monthEndOf(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    return ymd(new Date(Date.UTC(y, m, 0)));
  }
  function daysOfMonth(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function weekdayOf(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); }
  function regionSurcharge(province) {
    if (['新疆', '西藏', '青海', '内蒙古'].indexOf(province) >= 0) return 5;
    if (['宁夏', '甘肃', '海南'].indexOf(province) >= 0) return 2;
    return 0;
  }

  function buildDemoData(options) {
    var opts = options || {};
    var rng = rngFactory(opts.seed || 20260801);
    var stores = STORE_CFG.map(function (s) {
      return {
        id: s.id, platform: s.platform, name: s.name,
        commission_rate: s.commission_rate, tech_fee_rate: s.tech_fee_rate,
        payment_fee_rate: s.payment_fee_rate, insurance_rate: s.insurance_rate,
        settlement_days: s.settlement_days
      };
    });
    var cfgById = {};
    STORE_CFG.forEach(function (s) { cfgById[s.id] = s; });

    var skus = SKU_CFG.map(function (row, i) {
      return {
        id: 'SKU' + pad(i + 1, 3),
        name: row[0], category: row[1], spec: row[2],
        list_price: row[3], supplier_id: supplierOf(row[1]),
        launch_month: i % 5 === 0 ? '2026-07' : '2025-0' + (1 + (i % 8)),
        status: 'active',
        _cost: round2(row[3] * row[4]),
        _weight: row[5],
        _activeMonths: row[6] || MONTHS
      };
    });
    var skuById = {};
    skus.forEach(function (s) { skuById[s.id] = s; });

    function supplierOf(category) {
      if (['彩妆'].indexOf(category) >= 0) return 'SUP02';
      if (['身体护理', '洗护', '头皮护理'].indexOf(category) >= 0) return 'SUP03';
      return 'SUP01';
    }

    var orders = [], orderItems = [], shipments = [];
    var seq = {};
    var demand = {}; // sku|month -> units sold
    MONTHS.forEach(function (m) { demand[m] = {}; });

    STORE_CFG.forEach(function (cfg) {
      MONTHS.forEach(function (month) {
        var nDays = daysOfMonth(month);
        for (var d = 1; d <= nDays; d++) {
          var date = month + '-' + pad(d, 2);
          var wd = weekdayOf(date);
          var factor = GROWTH[month] * WEEKDAY[wd] * (0.88 + rng() * 0.24);
          var count = Math.round(cfg.daily * factor);
          for (var k = 0; k < count; k++) {
            var prefix = cfg.platform === 'xhs' ? 'XHS' : cfg.id;
            var key = prefix + date;
            seq[key] = (seq[key] || 0) + 1;
            var orderId = prefix + date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10) + pad(seq[key], 4);

            var active = skus.filter(function (s) { return s._activeMonths.indexOf(month) >= 0; });
            var nItems = rng() < 0.55 ? 1 : (rng() < 0.72 ? 2 : 3);
            var chosen = [];
            var pool = active.slice();
            for (var t = 0; t < nItems && pool.length; t++) {
              var pick = pickWeighted(rng, pool, function (s) { return s._weight; });
              chosen.push(pick);
              pool = pool.filter(function (s) { return s.id !== pick.id; });
            }
            var discount = Math.min(1, Math.max(0.6, cfg.discount + (rng() - 0.5) * 0.12));
            var items = [], paid = 0;
            chosen.forEach(function (sku) {
              var qty = (sku.category === '面膜' || sku.category === '洁面') && rng() < 0.15 ? 2 : 1;
              var amount = round2(sku.list_price * discount * qty);
              items.push({ order_id: orderId, sku_id: sku.id, qty: qty, amount: amount, refund_amount: 0, refund_qty: 0 });
              paid = round2(paid + amount);
              demand[month][sku.id] = (demand[month][sku.id] || 0) + qty;
            });

            var shipDate = addDays(date, rng() < 0.75 ? 1 : (rng() < 0.9 ? 2 : 0));
            if (shipDate > '2026-10-31') shipDate = '2026-10-31';
            var province = pickWeighted(rng, PROVINCES, function (p) { return p[1]; })[0];
            var carrier = pickWeighted(rng, ['中通', '圆通', '顺丰', '京东'], function () { return 1; });
            if (rng() > 0.55) carrier = '中通';
            else carrier = pickWeighted(rng, ['中通', '圆通', '顺丰', '京东'], function (c) { return c === '中通' ? 55 : c === '圆通' ? 20 : c === '顺丰' ? 12 : 13; });

            var refundRate = cfg.platform === 'xhs' ? 0.10 : (cfg.id === 'TB02' ? 0.08 : 0.06);
            var refunded = rng() < refundRate;
            var partial = refunded && rng() < 0.3;
            var refundAmount = 0, refundDate = '';
            if (refunded) {
              refundAmount = partial ? round2(paid * (0.2 + rng() * 0.3)) : paid;
              var gap = Math.floor(rng() * 18) + 2;
              refundDate = addDays(date, gap);
              if (refundDate > '2026-10-31') refundDate = '2026-10-31';
              var left = refundAmount;
              items.forEach(function (it, idx) {
                if (partial) {
                  var share = idx === items.length - 1 ? left : round2(refundAmount * (it.amount / paid));
                  it.refund_amount = round2(Math.min(share, it.amount));
                  left = round2(left - it.refund_amount);
                } else {
                  it.refund_qty = it.qty;
                  it.refund_amount = it.amount;
                }
              });
            }
            items.forEach(function (it) { orderItems.push(it); });
            orders.push({
              id: orderId, store_id: cfg.id, order_date: date,
              status: !refunded ? 'paid' : (partial ? 'partial' : 'refunded'),
              paid_amount: paid, refund_amount: refundAmount,
              refund_date: refundDate, ship_date: shipDate,
              carrier: carrier, province: province, returned: refunded && !partial
            });

            var weight = 0.15;
            items.forEach(function (it) { weight += it.qty * 0.18; });
            weight = round2(weight);
            var mult = CARRIER_MULT[carrier] || 1;
            var firstFee = round2(3.2 * mult);
            var overFee = round2(Math.max(0, weight - 0.5) * 1.1 * mult);
            var baseTotal = round2(firstFee + overFee);
            shipments.push({
              id: 'SH' + orderId, order_id: orderId, carrier: carrier, province: province,
              weight_kg: weight, base_fee: firstFee, overweight_fee: overFee,
              surcharge: regionSurcharge(province),
              return_fee: refunded && !partial ? round2(baseTotal * 0.8) : 0,
              shipped_at: shipDate, returned: refunded && !partial
            });
          }
        }
      });
    });

    // ---- 采购与期初库存 ----
    var openingInventory = [];
    var purchaseOrders = [], purchaseItems = [];
    var nextMonth = { '2026-08': '2026-09', '2026-09': '2026-10', '2026-10': '2026-11' };
    var novDemand = {};
    Object.keys(demand['2026-10']).forEach(function (k) { novDemand[k] = Math.round(demand['2026-10'][k] * 1.05); });

    skus.forEach(function (sku) {
      var augQty = demand['2026-08'][sku.id] || 0;
      var openQty = Math.max(120, Math.ceil((augQty * 1.35 + 40) / 10) * 10);
      openingInventory.push({ sku_id: sku.id, qty: openQty, unit_cost: round2(sku._cost * 0.98) });
    });

    MONTHS.forEach(function (month) {
      var target = nextMonth[month];
      var monthDemand = target === '2026-11' ? novDemand : demand[target];
      var bySupplier = {};
      skus.forEach(function (sku) {
        var need = Math.round(((monthDemand[sku.id] || 0) * 1.15 + 30) / 10) * 10;
        if (need <= 0) return;
        if (sku._activeMonths === MONTHS && month === '2026-10' && !monthDemand[sku.id]) need = 50;
        (bySupplier[sku.supplier_id] = bySupplier[sku.supplier_id] || []).push({ sku: sku, qty: need });
      });
      Object.keys(bySupplier).forEach(function (supId) {
        var poId = 'PO' + month.slice(2, 4) + month.slice(5, 7) + '-' + supId;
        var total = 0;
        bySupplier[supId].forEach(function (row) {
          var unitPrice = round2(row.sku._cost * (0.96 + rng() * 0.08));
          var amount = round2(unitPrice * row.qty);
          total = round2(total + amount);
          purchaseItems.push({ po_id: poId, sku_id: row.sku.id, qty: row.qty, unit_price: unitPrice, amount: amount });
        });
        purchaseOrders.push({
          id: poId, supplier_id: supId, date: month + '-02', status: 'received',
          invoice_no: (month === '2026-10' && supId === 'SUP03') ? '' : 'FP' + poId
        });
      });
    });

    // ---- 平台账单 ----
    var platformBills = [], payouts = [];
    STORE_CFG.forEach(function (cfg) {
      MONTHS.forEach(function (month) {
        var gmv = 0, refund = 0;
        orders.forEach(function (o) {
          if (o.store_id !== cfg.id) return;
          if (o.order_date.slice(0, 7) === month) gmv += o.paid_amount;
          if (o.refund_amount > 0 && o.refund_date.slice(0, 7) === month) refund += o.refund_amount;
        });
        gmv = round2(gmv); refund = round2(refund);
        var netSales = round2(gmv - refund);
        var commission = round2(netSales * cfg.commission_rate);
        var tech = round2(netSales * cfg.tech_fee_rate);
        var payment = round2(gmv * cfg.payment_fee_rate);
        var insurance = round2(netSales * cfg.insurance_rate);
        var promotion = round2(gmv * cfg.promo_rate);
        var subsidy = round2(netSales * cfg.subsidy_rate);
        var settled = round2(gmv - refund + subsidy - commission - tech - payment - promotion - insurance);
        var bill = {
          id: 'BILL-' + cfg.id + '-' + month.replace('-', ''),
          store_id: cfg.id, period: month,
          gmv: gmv, refund_amount: refund, commission: commission,
          tech_service_fee: tech, payment_fee: payment, promotion_fee: promotion,
          freight_insurance: insurance, subsidy: subsidy, other_deduction: 0,
          settled_amount: settled,
          status: month === '2026-10' ? 'pending' : 'settled',
          payout_date: month === '2026-10' ? '' : addDays(monthEndOf(month), cfg.settlement_days),
          note: ''
        };
        // 刻意留下的三处差异，均带说明，用于演示对账清单
        if (cfg.id === 'TB01' && month === '2026-08') {
          bill.gmv = round2(bill.gmv - 12);
          bill.settled_amount = round2(bill.settled_amount - 12);
          bill.note = '跨月结算：8 月 31 日 1 笔订单（12.00 元）计入 9 月账单';
        }
        if (cfg.id === 'TB01' && month === '2026-09') {
          bill.gmv = round2(bill.gmv + 12);
          bill.settled_amount = round2(bill.settled_amount + 12);
          bill.note = '含 8 月跨月订单 1 笔（12.00 元）';
        }
        if (cfg.id === 'TB02' && month === '2026-09') {
          bill.settled_amount = round2(bill.settled_amount + 35.2);
          bill.note = '类目活动返佣，账单佣金减免 35.20 元';
        }
        if (cfg.id === 'XHS01' && month === '2026-10') {
          bill.settled_amount = round2(bill.settled_amount - 0.5);
          bill.note = '平台结算分位取整差异 0.50 元';
        }
        platformBills.push(bill);

        if (bill.status === 'settled') {
          var payoutAmount = bill.settled_amount;
          if (cfg.id === 'TB01' && month === '2026-09') payoutAmount = round2(payoutAmount - 0.5);
          payouts.push({
            id: 'PAY-' + bill.id, store_id: cfg.id, bill_id: bill.id,
            date: bill.payout_date, amount: payoutAmount, bank_ref: 'BANK' + bill.id
          });
        }
      });
    });

    // ---- 费用 ----
    var expenses = [];
    var expSeq = 0;
    function addExpense(date, category, storeId, vendor, amount, invoiceNo) {
      expSeq++;
      expenses.push({
        id: 'EXP' + pad(expSeq, 4), date: date, category: category,
        store_id: storeId || '', vendor: vendor, amount: round2(amount), invoice_no: invoiceNo || ''
      });
    }
    MONTHS.forEach(function (month) {
      STORE_CFG.forEach(function (cfg) {
        var mOrders = orders.filter(function (o) { return o.store_id === cfg.id && o.order_date.slice(0, 7) === month; }).length;
        var gmv = platformBills.filter(function (b) { return b.store_id === cfg.id && b.period === month; })[0].gmv;
        addExpense(month + '-05', '仓储费', cfg.id, '华东云仓（虚构）', gmv * 0.008, 'FP-WH-' + month.replace('-', '') + cfg.id);
        addExpense(month + '-08', '包装耗材', cfg.id, '安成包装（虚构）', mOrders * 0.6, 'FP-PK-' + month.replace('-', '') + cfg.id);
        var promo = cfg.id === 'TB01' ? 9000 : (cfg.id === 'TB02' ? 3500 : 6500);
        addExpense(month + '-10', '推广费', cfg.id, cfg.platform === 'xhs' ? '小红书薯条（虚构）' : '站外投放代理（虚构）',
          promo + rng() * 800,
          (cfg.id === 'XHS01' && month === '2026-10') ? '' : 'FP-PR-' + month.replace('-', '') + cfg.id);
      });
      addExpense(month + '-01', '办公费', '', '云栖联合办公（虚构）', 12000, 'FP-OFF-' + month.replace('-', ''));
      addExpense(month + '-15', '其他', '', '财务代理（虚构）', 2000, 'FP-FIN-' + month.replace('-', ''));
      addExpense(month + '-20', '其他', '', '顺丰月结差额（虚构）', 1800, '');
    });
    addExpense('2026-08-12', '其他', '', '内容拍摄工作室（虚构）', 15000, 'FP-SHOOT-01');
    addExpense('2026-09-12', '其他', '', '内容拍摄工作室（虚构）', 9000, '');

    // ---- 发票 ----
    var invoices = [];
    var invSeq = 0;
    purchaseOrders.forEach(function (po) {
      if (!po.invoice_no) return;
      invSeq++;
      var amount = round2(purchaseItems.filter(function (pi) { return pi.po_id === po.id; })
        .reduce(function (s, pi) { return s + pi.amount; }, 0));
      invoices.push({
        id: 'INV-IN-' + pad(invSeq, 3), direction: 'input', number: po.invoice_no,
        date: addDays(po.date, 3), seller: (SUPPLIERS.filter(function (s) { return s.id === po.supplier_id; })[0] || {}).name || '',
        buyer: '麓野（杭州）品牌管理有限公司（虚构）', amount: amount,
        tax_amount: round2(amount / 1.13 * 0.13), related_type: 'purchase', related_id: po.id, note: ''
      });
    });
    expenses.forEach(function (ex) {
      if (!ex.invoice_no) return;
      invSeq++;
      var rate = ex.category === '推广费' ? 0.06 : 0.06;
      invoices.push({
        id: 'INV-IN-' + pad(invSeq, 3), direction: 'input', number: ex.invoice_no,
        date: addDays(ex.date, 2), seller: ex.vendor, buyer: '麓野（杭州）品牌管理有限公司（虚构）',
        amount: ex.amount, tax_amount: round2(ex.amount / (1 + rate) * rate),
        related_type: 'expense', related_id: ex.id, note: ''
      });
    });
    platformBills.forEach(function (b) {
      invSeq++;
      var amount = round2(b.commission + b.tech_service_fee);
      invoices.push({
        id: 'INV-IN-' + pad(invSeq, 3), direction: 'input', number: 'FP-PLAT-' + b.id,
        date: addDays(b.period + '-01', 25), seller: (b.store_id.charAt(0) === 'X' ? '小红书（虚构）' : '淘宝（中国）软件有限公司'),
        buyer: '麓野（杭州）品牌管理有限公司（虚构）', amount: amount,
        tax_amount: round2(amount / 1.06 * 0.06), related_type: 'platform_fee',
        related_id: b.store_id + '|' + b.period, note: '平台服务费'
      });
    });
    platformBills.forEach(function (b) {
      invSeq++;
      var amount = round2(b.gmv - b.refund_amount);
      invoices.push({
        id: 'INV-OUT-' + pad(invSeq, 3), direction: 'output', number: 'FP-OUT-' + b.id,
        date: addDays(b.period + '-01', 25), seller: '麓野（杭州）品牌管理有限公司（虚构）',
        buyer: '平台消费者（汇总开票）', amount: amount, tax_amount: round2(amount / 1.13 * 0.13),
        related_type: 'sales', related_id: b.id, note: '店铺月度销售汇总'
      });
    });
    invoices.push({
      id: 'INV-IN-999', direction: 'input', number: 'FP-UNKNOWN-01', date: '2026-09-28',
      seller: '未登记供应商（虚构）', buyer: '麓野（杭州）品牌管理有限公司（虚构）',
      amount: 3200, tax_amount: 181.13, related_type: 'purchase', related_id: 'PO-UNKNOWN', note: '关联单据不存在'
    });

    // 清理生成器内部字段
    var cleanSkus = skus.map(function (s) {
      return { id: s.id, name: s.name, category: s.category, spec: s.spec, list_price: s.list_price, supplier_id: s.supplier_id, launch_month: s.launch_month, status: s.status };
    });

    return {
      meta: {
        company_name: '麓野（杭州）品牌管理有限公司（虚构）',
        brand: '麓野 LUYE（虚构品牌）',
        currency: 'CNY',
        start_month: '2026-08',
        end_month: '2026-10',
        current_month: '2026-10',
        demo: true,
        generated_by: 'FinDemoData v1',
        seed: opts.seed || 20260801
      },
      settings: {
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
      },
      stores: stores,
      suppliers: SUPPLIERS,
      skus: cleanSkus,
      employees: EMPLOYEES,
      opening_inventory: openingInventory,
      orders: orders,
      order_items: orderItems,
      shipments: shipments,
      purchase_orders: purchaseOrders,
      purchase_items: purchaseItems,
      platform_bills: platformBills,
      payouts: payouts,
      expenses: expenses,
      invoices: invoices
    };
  }

  return { buildDemoData: buildDemoData, MONTHS: MONTHS, SKU_COUNT: SKU_CFG.length };
});
