/* 导入器测试：CSV 解析、日期/金额清洗、表头映射、校验与合并 */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/importer.js');
const T = require('../src/templates.js');
const D = require('../src/data.js');

const data = D.buildDemoData();

test('CSV 解析：BOM、引号、逗号、换行与转义', () => {
  const text = '\ufeff订单号,备注\r\n"A,001","他说""你好"""\r\nB002,"第一行\n第二行"\r\n';
  const p = I.parseCsv(text);
  assert.deepEqual(p.headers, ['订单号', '备注']);
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.rows[0], ['A,001', '他说"你好"']);
  assert.deepEqual(p.rows[1], ['B002', '第一行\n第二行']);
  assert.equal(p.delimiter, ',');
});

test('CSV 自动识别制表符分隔', () => {
  const p = I.parseCsv('订单号\t金额\nA1\t139\n');
  assert.equal(p.delimiter, '\t');
  assert.deepEqual(p.rows[0], ['A1', '139']);
});

test('金额清洗：货币符号、千分位、百分号、负数', () => {
  assert.equal(I.parseMoney('¥1,234.50'), 1234.5);
  assert.equal(I.parseMoney(' ￥ 88 '), 88);
  assert.equal(I.parseMoney('5%'), 0.05);
  assert.equal(I.parseMoney('(120)'), -120);
  assert.ok(Number.isNaN(I.parseMoney('abc')));
});

test('日期清洗：多种格式与非法日期', () => {
  assert.equal(I.normalizeDate('2026-8-3'), '2026-08-03');
  assert.equal(I.normalizeDate('2026/8/3'), '2026-08-03');
  assert.equal(I.normalizeDate('2026年8月3日'), '2026-08-03');
  assert.equal(I.normalizeDate('20260803'), '2026-08-03');
  assert.equal(I.normalizeDate('2026-13-40'), '');
  assert.equal(I.normalizeDate('2026-02-30'), '');
  assert.equal(I.normalizeDate(''), '');
});

test('表头映射：中文标签、别名、未识别列', () => {
  const table = T.getTable('orders');
  const res = I.mapHeaders(['订单编号', '店铺', '下单时间', '买家实付', '商品ID', '购买数量', '商品金额', '无关列'], table.fields);
  assert.equal(res.missing.length, 0);
  assert.equal(res.mapping[0], 'order_id');
  assert.equal(res.mapping[1], 'store_id');
  assert.equal(res.mapping[2], 'order_date');
  assert.equal(res.mapping[3], 'paid_amount');
  assert.equal(res.mapping[4], 'sku_id');
  assert.deepEqual(res.unmatched, ['无关列']);
});

test('订单导入：中文表头、店铺名称解析、日期与数字转换', () => {
  const csv = [
    '订单号,店铺,下单日期,支付金额,商品编码,数量,商品金额,发货日期,快递公司,收货省份',
    'TB2608999001,麓野旗舰店（天猫）,2026/10/28,"1,139",SKU001,1,"1,139",2026-10-29,中通,浙江'
  ].join('\n');
  const res = I.prepare('orders', I.parseCsv(csv), data, 'append');
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const o = res.patch.orders[0];
  assert.equal(o.store_id, 'TB01');
  assert.equal(o.order_date, '2026-10-28');
  assert.equal(o.paid_amount, 1139);
  assert.equal(res.patch.order_items[0].sku_id, 'SKU001');
  assert.equal(res.patch.order_items[0].qty, 1);
});

test('缺少必填列时直接拒绝导入', () => {
  const csv = '订单号,店铺,下单日期,支付金额,数量,商品金额\nA1,TB01,2026-10-01,100,1,100';
  const res = I.prepare('orders', I.parseCsv(csv), data, 'append');
  assert.equal(res.ok, false);
  assert.ok(res.missing.includes('商品编码'));
  assert.match(res.errors[0].message, /缺少必填列/);
});

test('非法店铺 / 商品 / 日期 / 数量都会逐行报错且不写入', () => {
  const csv = [
    '订单号,店铺,下单日期,支付金额,商品编码,数量,商品金额',
    'A1,TB99,2026-13-40,abc,SKU-404,x,100'
  ].join('\n');
  const res = I.prepare('orders', I.parseCsv(csv), data, 'append');
  assert.equal(res.ok, false);
  const fields = res.errors.map((e) => e.field);
  assert.ok(fields.includes('店铺'));
  assert.ok(fields.includes('下单日期'));
  assert.ok(fields.includes('支付金额'));
  assert.ok(fields.includes('商品编码'));
  assert.ok(fields.includes('数量'));
});

test('物流面单：订单号必须已存在', () => {
  const csv = [
    '面单号,订单号,快递公司,首重费用,发货日期',
    'SH-X1,NOT-EXIST,中通,3.5,2026-10-01'
  ].join('\n');
  const res = I.prepare('shipments', I.parseCsv(csv), data, 'append');
  assert.equal(res.ok, false);
  assert.match(res.errors[0].message, /找不到对应记录/);
});

test('费用导入：公共费用 store_id 允许为空', () => {
  const csv = [
    '费用单号,发生日期,费用类别,店铺,供应商/收款方,金额,发票号',
    'EXP-T-1,2026-10-15,办公费,,测试供应商,"1,000",'
  ].join('\n');
  const res = I.prepare('expenses', I.parseCsv(csv), data, 'append');
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.patch.expenses[0].amount, 1000);
  assert.equal(res.patch.expenses[0].id, 'EXP-T-1');
});

test('追加与替换：按主键覆盖，不产生重复订单', () => {
  const csv = [
    '订单号,店铺,下单日期,支付金额,商品编码,数量,商品金额',
    'TB2608999002,TB01,2026-10-28,139,SKU001,1,139'
  ].join('\n');
  const res = I.prepare('orders', I.parseCsv(csv), data, 'append');
  const once = I.apply(data, res.patch, 'append');
  const twice = I.apply(once, res.patch, 'append');
  assert.equal(once.orders.length, data.orders.length + 1);
  assert.equal(twice.orders.length, data.orders.length + 1);
  const replaced = I.apply(data, res.patch, 'replace');
  assert.equal(replaced.orders.length, 1);
  assert.equal(replaced.order_items.length, 1);
});

test('模板：11 张表均可生成带示例的 CSV', () => {
  assert.equal(T.TABLES.length >= 10, true);
  T.TABLES.forEach((t) => {
    const csv = T.templateCsv(t.id);
    assert.ok(csv.startsWith('\ufeff'), t.id + ' 缺 BOM');
    const lines = csv.split('\r\n');
    assert.ok(lines.length >= 2, t.id + ' 缺示例行');
    assert.ok(lines[0].length > 0);
  });
});

test('订单导入：同一订单号多行商品合并成一张订单（不算主键重复）', () => {
  const D = require('../src/data.js');
  const csv = [
    '订单号,店铺,下单日期,支付金额,商品编码,数量,商品金额',
    'TB2610999001,TB01,2026-10-28,239,SKU001,1,139',
    'TB2610999001,TB01,2026-10-28,239,SKU005,1,100'
  ].join('\n');
  const prep = I.prepare('orders', I.parseCsv(csv), D.buildDemoData(), 'append');
  assert.equal(prep.ok, true, JSON.stringify(prep.errors));
  assert.equal(prep.patch.orders.length, 1);
  assert.equal(prep.patch.order_items.length, 2);
});
