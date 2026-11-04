/* 演示数据自洽性与端到端集成测试 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../src/data.js');
const E = require('../src/engine.js');
const I = require('../src/importer.js');
const T = require('../src/templates.js');

const data = D.buildDemoData();
const model = E.computeModel(data);

test('演示数据：3 个月、3 个店、36 个 SKU、上万条订单', () => {
  assert.equal(data.stores.length, 3);
  assert.equal(data.skus.length, 36);
  assert.equal(data.meta.start_month, '2026-08');
  assert.equal(data.meta.end_month, '2026-10');
  assert.ok(data.orders.length > 14000, '订单数应超过 14000，实际 ' + data.orders.length);
  assert.ok(data.order_items.length > data.orders.length);
  assert.equal(data.platform_bills.length, 9);
  assert.equal(data.invoices.length > 50, true);
});

test('演示数据生成可复现：两次生成结果一致', () => {
  const a = D.buildDemoData();
  const b = D.buildDemoData();
  assert.equal(a.orders.length, b.orders.length);
  assert.equal(a.orders[0].id, b.orders[0].id);
  assert.equal(a.orders[a.orders.length - 1].paid_amount, b.orders[b.orders.length - 1].paid_amount);
});

test('公司合计 = 各店逐项相加', () => {
  ['revenue', 'cogs', 'freight', 'platformFees', 'promotion', 'labor', 'other', 'netProfit'].forEach((k) => {
    const sum = data.stores.reduce((s, st) => s + model.storeTotal[st.id][k], 0);
    assert.ok(Math.abs(E.round2(sum) - model.total[k]) < 0.05, k + ' 合计不一致：' + sum + ' vs ' + model.total[k]);
  });
});

test('利润恒等式与全部 8 项勾稽通过', () => {
  assert.equal(model.checks.filter((c) => !c.ok).length, 0);
  const t = model.total;
  const calc = E.round2(t.revenue - t.cogs - t.freight - t.platformFees - t.promotion - t.labor - t.other);
  assert.equal(calc, t.netProfit);
});

test('库存滚动：每个 SKU 期初 + 入库 + 退货 - 出库 = 期末', () => {
  model.inventory.bySku.forEach((b) => {
    const roll = E.round2(b.openingQty + b.inboundQty + b.returnQty - b.outboundQty);
    assert.equal(roll, b.closingQty, b.sku_name + ' 库存滚动不平');
  });
  assert.ok(model.inventory.summary.value > 1000000);
  assert.ok(model.inventory.summary.turnoverDays > 0);
  assert.ok(model.inventory.summary.slowMovingCount >= 2);
});

test('工资合计 = 计入利润的人工成本', () => {
  assert.ok(Math.abs(model.payroll.total.gross - model.total.labor) < 0.05);
  assert.equal(model.payroll.total.headcount, 9);
  model.months.forEach((m) => {
    const gross = model.payroll.byMonth[m].rows.reduce((s, r) => s + r.gross, 0);
    const labor = data.stores.reduce((s, st) => s + model.storeMonth[st.id][m].labor, 0);
    assert.ok(Math.abs(gross - labor) < 0.05, m + ' 工资与人工成本不一致');
  });
});

test('平台账单：4 处差异全部有说明，且结算总额可核对', () => {
  const recon = model.reconciliation;
  assert.equal(recon.bills.length, 9);
  assert.equal(recon.summary.diffCount, 4);
  assert.equal(recon.summary.unexplainedCount, 0);
  recon.bills.forEach((b) => {
    if (b.hasDiff) assert.ok(b.note && b.note.length > 0, b.bill_id + ' 差异没有说明');
  });
  const settled = recon.bills.filter((b) => b.status === 'settled').reduce((s, b) => s + b.settledAmount, 0);
  const paid = data.payouts.reduce((s, p) => s + p.amount, 0);
  assert.ok(Math.abs(settled - paid - 0.5) < 0.01, '打款应比结算少 0.5 元（银行手续费）');
});

test('现金流：已回款 + 待结算 + 账期占款为正且有口径', () => {
  assert.ok(model.cash.total.received > 1000000);
  assert.ok(model.cash.total.pending > 700000);
  assert.ok(model.cash.total.occupied > model.cash.total.pending);
  assert.equal(model.cash.total.received, E.round2(data.payouts.reduce((s, p) => s + p.amount, 0)));
});

test('发票：销项全部匹配账单，进项有 1 张未匹配、5 笔费用缺票', () => {
  assert.equal(model.invoices.output.count, 9);
  assert.equal(model.invoices.output.unmatched, 0);
  assert.equal(model.invoices.output.matched, 9);
  assert.equal(model.invoices.input.unmatched, 1);
  assert.equal(model.invoices.missing.expenses.length, 5);
  assert.equal(model.invoices.missing.purchases.length, 1);
  assert.ok(model.invoices.missingAmount > 0);
});

test('KPI：三个月的收入、净利润与店铺排名齐备', () => {
  assert.equal(model.months.length, 3);
  model.months.forEach((m) => {
    const k = model.kpis[m];
    assert.ok(k.revenue > 0);
    assert.ok(k.netProfit > 0);
    assert.equal(k.storeRanking.length, 3);
    assert.ok(k.turnoverDays > 0);
    assert.ok(k.cashOccupied > 0);
  });
  assert.equal(model.kpis['2026-10'].netProfit, model.companyMonth['2026-10'].netProfit);
});

test('导入订单 CSV：校验通过、写入后自动重算且对账能发现新差异', () => {
  const csv = [
    '订单号,店铺,下单日期,支付金额,退款金额,退款日期,发货日期,快递公司,收货省份,订单状态,商品编码,数量,商品金额,退款数量,明细退款金额',
    'TB2608123456,TB01,2026-10-28,139,0,,2026-10-29,中通,浙江,paid,SKU001,1,139,0,0'
  ].join('\n');
  const parsed = I.parseCsv(csv);
  const res = I.prepare('orders', parsed, data, 'append');
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.patch.orders.length, 1);
  assert.equal(res.patch.order_items.length, 1);
  const next = I.apply(data, res.patch, 'append');
  assert.equal(next.orders.length, data.orders.length + 1);
  const m2 = E.computeModel(next);
  const check = m2.checks.find((c) => c.id === 'bill-vs-orders');
  assert.equal(check.ok, false, '新增订单未进账单，应产生未说明差异');
  assert.ok(m2.total.gmv > model.total.gmv);
});

test('导入 xlsx：真实 Excel 文件可解析、映射并通过校验', async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'orders-sample.xlsx'));
  const parsed = await require('../src/xlsx.js').parseXlsx(buf);
  assert.deepEqual(parsed.sheetNames, ['订单明细']);
  assert.equal(parsed.rows.length, 3);
  const res = I.prepare('orders', { headers: parsed.rows[0], rows: parsed.rows.slice(1) }, data, 'append');
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.patch.orders.length, 2);
  assert.equal(res.patch.order_items.length, 2);
  const next = I.apply(data, res.patch, 'append');
  assert.equal(next.orders.length, data.orders.length + 2);
  const m2 = E.computeModel(next);
  assert.equal(m2.checks.find((c) => c.id === 'pnl-identity').ok, true);
});

test('模板 CSV 带 BOM、中文表头与示例行', () => {
  const csv = T.templateCsv('orders');
  assert.ok(csv.charCodeAt(0) === 0xfeff || csv.startsWith('\ufeff'));
  const lines = csv.split('\r\n');
  assert.ok(lines.length >= 2);
  assert.ok(lines[0].includes('订单号') && lines[0].includes('商品编码'));
  assert.ok(lines[1].includes('TB2608010001'));
});
