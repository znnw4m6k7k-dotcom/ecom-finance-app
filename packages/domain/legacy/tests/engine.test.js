/* 核算引擎测试：真实断言，覆盖利润、成本、工资、对账、库存与勾稽 */
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

function tinyData() {
  return {
    meta: { company_name: '测试公司', brand: 'T', start_month: '2026-08', end_month: '2026-08', current_month: '2026-08' },
    stores: [{ id: 'TB01', platform: 'taobao', name: '测试店', commission_rate: 0.05, tech_fee_rate: 0.02, payment_fee_rate: 0.006, insurance_rate: 0.008 }],
    suppliers: [{ id: 'S1', name: '供应商', tax_rate: 0.13 }],
    skus: [{ id: 'A', name: '商品A', category: '精华', list_price: 59 }],
    employees: [{ id: 'E1', name: '员工', role: '运营', base_salary: 8000, allowance: 500, deduction: 1000, store_ids: ['TB01'], basis: 'gross_profit', joined_at: '2025-01-01' }],
    opening_inventory: [{ sku_id: 'A', qty: 100, unit_cost: 20 }],
    purchase_orders: [{ id: 'PO1', supplier_id: 'S1', date: '2026-08-05', status: 'received', invoice_no: 'FP1' }],
    purchase_items: [{ po_id: 'PO1', sku_id: 'A', qty: 100, unit_price: 22, amount: 2200 }],
    orders: [], order_items: [], shipments: [], platform_bills: [], payouts: [], expenses: [],
    invoices: [{ id: 'I1', direction: 'input', number: 'FP1', date: '2026-08-06', seller: '供应商', buyer: '测试公司', amount: 2200, tax_amount: 253.1, related_type: 'purchase', related_id: 'PO1' }]
  };
}

function buildTiny() {
  const d = tinyData();
  for (let i = 0; i < 10; i++) {
    const id = 'TB2608' + String(i + 1).padStart(4, '0');
    const day = String(10 + i).padStart(2, '0');
    d.orders.push({
      id, store_id: 'TB01', order_date: '2026-08-' + day, paid_amount: 59, refund_amount: 0,
      ship_date: '2026-08-' + day, carrier: '中通', province: '浙江', status: 'paid'
    });
    d.order_items.push({ order_id: id, sku_id: 'A', qty: 1, amount: 59, refund_amount: 0, refund_qty: 0 });
    d.shipments.push({
      id: 'SH' + i, order_id: id, carrier: '中通', province: '浙江', weight_kg: 0.3,
      base_fee: 3.5, surcharge: 0, return_fee: 0, shipped_at: '2026-08-' + day, returned: false
    });
  }
  d.platform_bills.push({
    id: 'B1', store_id: 'TB01', period: '2026-08', gmv: 590, refund_amount: 0,
    commission: 29.5, tech_service_fee: 11.8, payment_fee: 3.54, promotion_fee: 100,
    freight_insurance: 4.72, subsidy: 0, other_deduction: 0, settled_amount: 440.44,
    status: 'settled', payout_date: '2026-09-15', note: ''
  });
  d.payouts.push({ id: 'P1', store_id: 'TB01', bill_id: 'B1', date: '2026-09-15', amount: 440.44 });
  d.expenses.push({ id: 'EX1', date: '2026-08-20', category: '仓储费', store_id: 'TB01', vendor: '仓', amount: 200 });
  d.expenses.push({ id: 'EX2', date: '2026-08-21', category: '推广费', store_id: 'TB01', vendor: '平台', amount: 50 });
  return d;
}

test('阶梯提成：分档累进与边界', () => {
  const ladder = [
    { min: 0, max: 50000, rate: 0.02 },
    { min: 50000, max: 100000, rate: 0.03 },
    { min: 100000, max: null, rate: 0.04 }
  ];
  assert.equal(E.ladderCommission(0, ladder), 0);
  assert.equal(E.ladderCommission(30000, ladder), 600);
  assert.equal(E.ladderCommission(50000, ladder), 1000);
  assert.equal(E.ladderCommission(75000, ladder), 1750);
  assert.equal(E.ladderCommission(120000, ladder), 3300);
  assert.equal(E.round2(E.ladderCommission(123456, ladder)), 3438.24);
});

test('按权重分摊金额时尾差补齐、合计精确', () => {
  const r = E.allocate(100, [1, 2, 3]);
  assert.equal(E.round2(r.reduce((a, b) => a + b, 0)), 100);
  assert.deepEqual(r, [16.67, 33.33, 50]);
  const r2 = E.allocate(0.03, [1, 1, 1]);
  assert.equal(E.round2(r2.reduce((a, b) => a + b, 0)), 0.03);
});

test('账期序列生成', () => {
  assert.deepEqual(E.monthList({ start_month: '2026-08', end_month: '2026-10' }), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(E.monthList({ start_month: '2025-12', end_month: '2026-02' }), ['2025-12', '2026-01', '2026-02']);
});

test('单店单月：收入、移动加权成本、平台费、工资与净利', () => {
  const m = E.computeModel(buildTiny());
  const s = m.storeMonth.TB01['2026-08'];
  assert.equal(s.gmv, 590);
  assert.equal(s.revenue, 590);
  assert.equal(s.cogs, 210);            // 10 件 × 均价 21
  assert.equal(s.freight, 35);
  assert.equal(s.platformFees, 49.56);  // 佣金 29.5 + 服务费 11.8 + 支付 3.54 + 运费险 4.72
  assert.equal(s.promotion, 150);       // 账单 100 + 费用 50
  assert.equal(s.labor, 8506.9);        // 底薪 8000 + 补贴 500 + 提成 6.9
  assert.equal(s.other, 200);
  assert.equal(s.netProfit, -8561.46);
  assert.equal(s.orders, 10);
  assert.equal(s.aov, 59);
});

test('库存移动加权：期末数量、金额与均价', () => {
  const m = E.computeModel(buildTiny());
  const inv = m.inventory.bySku[0];
  assert.equal(inv.closingQty, 190);
  assert.equal(inv.closingValue, 3990);
  assert.equal(inv.avgCost, 21);
  assert.equal(m.inventory.summary.qty, 190);
  assert.equal(m.inventory.summary.value, 3990);
});

test('演示级勾稽：8 项校验全部通过', () => {
  const m = E.computeModel(buildTiny());
  const failed = m.checks.filter((c) => !c.ok);
  assert.deepEqual(failed, []);
  assert.equal(m.checks.length, 8);
});

test('工资表：提成、代扣、应发与实发', () => {
  const m = E.computeModel(buildTiny());
  const row = m.payroll.byMonth['2026-08'].rows[0];
  assert.equal(row.commission, 6.9);
  assert.equal(row.gross, 8506.9);
  assert.equal(row.net, 7506.9);
  assert.equal(m.payroll.total.gross, 8506.9);
  assert.equal(m.payroll.laborByStore.TB01['2026-08'], 8506.9);
});

test('现金流与对账：已回款、账单重算、发票匹配', () => {
  const m = E.computeModel(buildTiny());
  assert.equal(m.cash.total.received, 440.44);
  assert.equal(m.reconciliation.bills[0].recomputed, 440.44);
  assert.equal(m.reconciliation.bills[0].diff, 0);
  assert.equal(m.reconciliation.payoutDiffs.length, 0);
  assert.equal(m.invoices.input.matched, 1);
  assert.equal(m.invoices.input.unmatched, 0);
});

test('跨月退款：收入与成本按退款月冲减', () => {
  const d = tinyData();
  d.meta.start_month = '2026-08';
  d.meta.end_month = '2026-09';
  d.meta.current_month = '2026-09';
  d.employees = [];
  d.opening_inventory = [{ sku_id: 'A', qty: 10, unit_cost: 20 }];
  d.purchase_orders = [];
  d.purchase_items = [];
  d.invoices = [];
  d.platform_bills = [];
  d.expenses = [];
  d.orders = [{
    id: 'O1', store_id: 'TB01', order_date: '2026-08-31', paid_amount: 100,
    refund_amount: 100, refund_date: '2026-09-02', ship_date: '2026-08-31',
    carrier: '中通', province: '浙江', status: 'refunded', returned: true
  }];
  d.order_items = [{ order_id: 'O1', sku_id: 'A', qty: 1, amount: 100, refund_amount: 100, refund_qty: 1 }];
  d.shipments = [{ id: 'S1', order_id: 'O1', carrier: '中通', province: '浙江', weight_kg: 0.3, base_fee: 4, surcharge: 0, return_fee: 3, shipped_at: '2026-08-31', returned: true }];
  const m = E.computeModel(d);
  assert.equal(m.storeMonth.TB01['2026-08'].revenue, 100);
  assert.equal(m.storeMonth.TB01['2026-09'].revenue, -100);
  assert.equal(m.storeMonth.TB01['2026-08'].cogs, 20);
  assert.equal(m.storeMonth.TB01['2026-09'].cogs, -20);
  assert.equal(m.inventory.bySku[0].closingQty, 10);
  assert.equal(m.checks.find((c) => c.id === 'inventory-roll').ok, true);
});

test('负库存会被识别并让校验失败', () => {
  const d = tinyData();
  d.opening_inventory = [];
  d.purchase_orders = [];
  d.purchase_items = [];
  d.orders = [{
    id: 'O9', store_id: 'TB01', order_date: '2026-08-10', paid_amount: 59,
    refund_amount: 0, ship_date: '2026-08-10', carrier: '中通', province: '浙江', status: 'paid'
  }];
  d.order_items = [{ order_id: 'O9', sku_id: 'A', qty: 1, amount: 59, refund_amount: 0, refund_qty: 0 }];
  d.shipments = [];
  d.platform_bills = [];
  d.payouts = [];
  const m = E.computeModel(d);
  assert.equal(m.inventory.bySku[0].negative, 1);
  assert.equal(m.checks.find((c) => c.id === 'negative-stock').ok, false);
});

test('账单差异必须带说明，否则校验失败', () => {
  const d = buildTiny();
  d.platform_bills[0].settled_amount = 430.44;
  d.platform_bills[0].note = '';
  const m = E.computeModel(d);
  const chk = m.checks.find((c) => c.id === 'bill-vs-orders');
  assert.equal(chk.ok, false);
  const b = m.reconciliation.bills[0];
  assert.equal(b.hasDiff, true);
  assert.equal(b.explained, false);
});
