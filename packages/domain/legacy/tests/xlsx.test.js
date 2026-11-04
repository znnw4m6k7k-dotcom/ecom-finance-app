'use strict';

/**
 * xlsx 读取模块的验收测试。
 * 运行：node --test tests/xlsx.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseXlsx } = require('../src/xlsx.js');

const FIXTURES = path.join(__dirname, 'fixtures');

function fixtureBytes(name) {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
}

function fixtureArrayBuffer(name) {
  const bytes = fixtureBytes(name);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function assertXlsxError(error) {
  assert.ok(error instanceof Error, '应抛出 Error');
  assert.match(error.message, /^xlsx: /, '错误信息应以 "xlsx: " 开头');
  return true;
}

test('1. deflate xlsx：两个工作表、共享/内联字符串、数字、日期、公式缓存、布尔、错误值', async () => {
  const result = await parseXlsx(fixtureArrayBuffer('sample.xlsx'));

  assert.deepEqual(result.sheetNames, ['订单明细', '说明']);
  assert.equal(result.truncated, false);
  assert.equal(result.rows.length, 5, '整行空白应被忽略：1/2/3/4/6 行共 5 行');

  assert.deepEqual(result.rows[0], [
    '订单号', '商品名称', '数量', '金额', '下单日期', '公式金额', '是否加急', '错误码',
  ]);
  assert.deepEqual(result.rows[1], [
    'ORD-001', '中文商品 · 测试', '139', '37.2', '2024-03-15', '176.2', 'TRUE', '#DIV/0!',
  ]);
  assert.deepEqual(result.rows[2], [
    'ORD-002', '第二行', '1000000', '0.5', '2020-01-01', '500000', 'FALSE', '#N/A',
  ]);

  // sheetIndex 指定第二个工作表，sheetNames 仍返回全部工作表名
  const second = await parseXlsx(fixtureBytes('sample.xlsx'), { sheetIndex: 1 });
  assert.deepEqual(second.sheetNames, ['订单明细', '说明']);
  assert.deepEqual(second.rows[0], ['这是第二个工作表']);
  assert.deepEqual(second.rows[1], ['sheet2 数据', '42', '公式文本']);
  // 1900 日期系统：1=1900-01-01，59=1900-02-28，Excel 虚构的 60=1900-02-29，61=1900-03-01
  assert.deepEqual(second.rows[2], ['1900-01-01', '1900-02-28', '1900-02-29', '1900-03-01']);
  // XML 实体要还原，字符串保留原文
  assert.deepEqual(second.rows[3], ['A & B <测试> "引号"']);
});

test('2. stored（不压缩）xlsx 解析结果与 deflate 版本一致', async () => {
  const deflated = await parseXlsx(fixtureBytes('sample.xlsx'));
  const stored = await parseXlsx(fixtureBytes('sample-stored.xlsx'));

  assert.deepEqual(stored.sheetNames, deflated.sheetNames);
  assert.deepEqual(stored.rows, deflated.rows);
  assert.equal(stored.truncated, false);
});

test('3. 行内列跳跃：A4、C4 有值而 B4 缺失时补空字符串且下标与 Excel 列一致', async () => {
  const { rows } = await parseXlsx(fixtureBytes('sample.xlsx'));

  assert.deepEqual(rows[3], ['ORD-003', '', '2'], 'B4 必须补成空字符串，C4 位于下标 2');
  assert.equal(rows[3][2], '2');
  assert.equal(rows[3][1], '');

  // 第 5 行整行空白被跳过，第 6 行仍然是独立的一行
  assert.deepEqual(rows[4], ['ORD-004', '', '7']);
  assert.equal(rows.length, 5);
});

test('4. 超过 maxRows 时截断并标记 truncated', async () => {
  const limited = await parseXlsx(fixtureBytes('sample.xlsx'), { maxRows: 2 });
  assert.equal(limited.truncated, true);
  assert.equal(limited.rows.length, 2);
  assert.deepEqual(limited.rows[0][0], '订单号');
  assert.deepEqual(limited.rows[1][0], 'ORD-001');

  const exact = await parseXlsx(fixtureBytes('sample.xlsx'), { maxRows: 5 });
  assert.equal(exact.truncated, false);
  assert.equal(exact.rows.length, 5);

  const zero = await parseXlsx(fixtureBytes('sample.xlsx'), { maxRows: 0 });
  assert.equal(zero.truncated, true);
  assert.equal(zero.rows.length, 0);
});

test('5. 非 zip / 损坏输入抛出可读中文错误', async () => {
  await assert.rejects(
    () => parseXlsx(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    assertXlsxError
  );

  await assert.rejects(
    () => parseXlsx(new TextEncoder().encode('这不是一个 xlsx 文件')),
    (error) => {
      assertXlsxError(error);
      assert.match(error.message, /zip/);
      return true;
    }
  );

  await assert.rejects(
    () => parseXlsx(fixtureBytes('sample.xlsx'), { sheetIndex: 9 }),
    (error) => {
      assertXlsxError(error);
      assert.match(error.message, /sheetIndex/);
      return true;
    }
  );

  await assert.rejects(() => parseXlsx('not-a-buffer'), assertXlsxError);
});

test('6. 数字格式化：139 / 37.2 / 1000000 不出现 .0，也不出现科学计数法', async () => {
  const { rows } = await parseXlsx(fixtureBytes('sample.xlsx'));
  const numericCells = [
    rows[1][2], rows[1][3], rows[1][5],
    rows[2][2], rows[2][3], rows[2][5],
  ];
  assert.deepEqual(numericCells, ['139', '37.2', '176.2', '1000000', '0.5', '500000']);

  for (const text of numericCells) {
    assert.ok(!/\.0$/.test(text), `${text} 不应带无意义的 .0`);
    assert.ok(!/[eE][+-]?\d/.test(text), `${text} 不应是科学计数法`);
  }
});

test('7. 浏览器全局：window.XLSXReader.parseXlsx 可用', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'xlsx.js'), 'utf8');
  const fakeWindow = {};
  // 用 new Function 模拟浏览器环境（没有 module，只有 window）
  const load = new Function('window', source);
  load(fakeWindow);

  assert.equal(typeof fakeWindow.XLSXReader, 'object');
  assert.equal(typeof fakeWindow.XLSXReader.parseXlsx, 'function');

  const result = await fakeWindow.XLSXReader.parseXlsx(fixtureBytes('sample-stored.xlsx'));
  assert.deepEqual(result.sheetNames, ['订单明细', '说明']);
  assert.equal(result.rows[1][0], 'ORD-001');
  assert.equal(result.rows[1][4], '2024-03-15');
});
