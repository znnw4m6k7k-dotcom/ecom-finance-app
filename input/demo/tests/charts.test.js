'use strict';

/**
 * charts.js 验收测试
 * 运行：node --test tests/charts.test.js
 *
 * 说明：不引入 DOM/第三方库，用轻量标记解析器读 SVG 属性做真实几何断言。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Charts = require('../src/charts.js');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'charts.js'), 'utf8');

/* ------------------------------------------------------------------ */
/* 轻量 SVG 标记工具                                                   */
/* ------------------------------------------------------------------ */

function parseAttrs(source) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g;
  let match;
  while ((match = re.exec(source))) attrs[match[1]] = match[2];
  return attrs;
}

function tagsOf(svg, tagName) {
  const re = new RegExp('<' + tagName + '\\b([^>]*)>', 'g');
  return [...svg.matchAll(re)].map((match) => ({
    raw: match[0],
    attrs: parseAttrs(match[1]),
  }));
}

function hasClass(tag, name) {
  return String(tag.attrs.class || '')
    .split(/\s+/)
    .filter(Boolean)
    .includes(name);
}

function byClass(svg, tagName, className) {
  return tagsOf(svg, tagName).filter((tag) => hasClass(tag, className));
}

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textsOf(svg, className) {
  const re = new RegExp(
    '<text\\b[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>([\\s\\S]*?)</text>',
    'g'
  );
  return [...svg.matchAll(re)].map((match) => decodeXml(match[1]));
}

function coordsOfPath(d) {
  return (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

/** 对每个图表都执行的结构合法性检查。 */
function assertSvg(svg, expectedType) {
  assert.equal(typeof svg, 'string', '返回值必须是字符串');
  assert.ok(svg.length > 0, '返回值不能为空');
  assert.ok(svg.startsWith('<svg'), 'SVG 必须以 <svg 开头');
  assert.ok(svg.endsWith('</svg>'), 'SVG 必须以 </svg> 结尾');
  assert.match(svg, /viewBox="0 0 [\d.]+ [\d.]+"/, '必须包含 viewBox');
  assert.ok(svg.includes('width="100%"'), '必须响应式 width=100%');
  assert.ok(svg.includes('preserveAspectRatio="xMidYMid meet"'), '必须等比适配');
  assert.ok(svg.includes('role="img"'), '必须声明 role=img');
  assert.ok(/<title>[\s\S]*<\/title>/.test(svg), '必须有 <title> 描述');
  if (expectedType) {
    assert.ok(svg.includes('data-chart="' + expectedType + '"'), '图表类型标记');
  }
  assert.ok(!/<style\b/i.test(svg), '不允许内联 <style> 标签');
  assert.ok(!/<foreignObject\b/i.test(svg), '不允许 <foreignObject>');
  assert.ok(!/<script\b/i.test(svg), '不允许脚本');
  assert.ok(!/NaN|undefined|\[object Object\]/.test(svg), '不能出现 NaN/undefined');
  assert.ok(svg.includes('var(--font-num, ui-sans-serif)'), '必须继承数值字体变量');
  // 除合法实体外不允许裸 &，否则说明转义链断了。
  assert.ok(
    !/&(?!(?:amp|lt|gt|quot|#39|apos|#x?[0-9a-fA-F]+);)/.test(svg),
    '存在未转义的 &'
  );
  // 简易标签平衡检查（属性中不含 >，文本中的 < > 均已转义）。
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)([^>]*)>/g;
  const stack = [];
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(svg))) {
    assert.equal(svg.slice(lastIndex, match.index).indexOf('<'), -1, '文本中出现裸 <');
    lastIndex = tagRe.lastIndex;
    if (match[1] === '/') {
      assert.equal(stack.pop(), match[2], '闭合标签不匹配：' + match[2]);
    } else if (!match[3].trim().endsWith('/')) {
      stack.push(match[2]);
    }
  }
  assert.equal(stack.length, 0, '存在未闭合标签：' + stack.join(','));
}

/* ------------------------------------------------------------------ */
/* 样例数据                                                            */
/* ------------------------------------------------------------------ */

function lineSample(extra) {
  return Charts.lineChart(
    Object.assign(
      {
        xLabels: ['8月', '9月', '10月'],
        series: [
          { name: '净利润', color: '#2F6B5E', points: [120000, 135000, 128000] },
          { name: '毛利', color: '#C08A44', points: [180000, 190000, 200000] },
        ],
      },
      extra
    )
  );
}

function stackedSample(extra) {
  return Charts.stackedBarChart(
    Object.assign(
      {
        categories: ['8月', '9月'],
        series: [
          { name: '商品成本', color: '#2F6B5E', values: [100, 50] },
          { name: '物流', color: '#C08A44', values: [50, 150] },
        ],
        valueFormat: (value) => '¥' + value,
      },
      extra
    )
  );
}

function hBarSample(extra) {
  return Charts.hBarChart(
    Object.assign(
      {
        items: [
          { label: '淘宝旗舰店', value: 400, color: '#2F6B5E', meta: '第一名' },
          { label: '小红书店', value: 200, color: '#C08A44' },
          { label: '抖音店', value: 100, color: '#5B7C99' },
        ],
      },
      extra
    )
  );
}

function donutSample(extra) {
  return Charts.donutChart(
    Object.assign(
      {
        items: [
          { label: '商品', value: 50, color: '#2F6B5E' },
          { label: '物流', value: 30, color: '#C08A44' },
          { label: '人工', value: 20, color: '#5B7C99' },
        ],
        centerLabel: '净利润',
        centerValue: '¥3,250',
      },
      extra
    )
  );
}

function waterfallSample(extra) {
  return Charts.waterfallChart(
    Object.assign(
      {
        items: [
          { label: '期初', value: 100, type: 'start' },
          { label: '退款', value: -20, type: 'delta' },
          { label: '新增', value: 15, type: 'delta' },
          { label: '期末', value: 95, type: 'total' },
        ],
        valueFormat: (value) => value.toFixed(0),
      },
      extra
    )
  );
}

function sparkSample(extra) {
  return Charts.sparkline(Object.assign({ values: [3, 5, 2, 8, 6] }, extra));
}

/* ------------------------------------------------------------------ */
/* 1. 返回合法 SVG                                                     */
/* ------------------------------------------------------------------ */

test('每个图表函数都返回以 <svg 开头、</svg> 结尾且包含 viewBox 的合法字符串', () => {
  const cases = [
    ['line', lineSample()],
    ['stacked-bar', stackedSample()],
    ['h-bar', hBarSample()],
    ['donut', donutSample()],
    ['waterfall', waterfallSample()],
    ['sparkline', sparkSample()],
    ['progress', Charts.progressBar({ value: 68, max: 100, label: '库存周转目标' })],
  ];
  for (const [type, svg] of cases) assertSvg(svg, type);
});

/* ------------------------------------------------------------------ */
/* 2. 折线图的点数 / 路径                                              */
/* ------------------------------------------------------------------ */

test('lineChart：2 条线 × 3 个点，路径坐标与数据点数量一致', () => {
  const svg = lineSample();
  assertSvg(svg, 'line');

  const lines = byClass(svg, 'path', 'lc-line');
  assert.equal(lines.length, 2, '应生成两条折线路径');
  for (const line of lines) {
    const d = line.attrs.d;
    assert.equal((d.match(/\bM\b/g) || []).length, 1, '每条连续折线应有 1 个 M');
    assert.equal((d.match(/\bL\b/g) || []).length, 2, '3 个点之间应有 2 段 L');
    assert.equal(coordsOfPath(d).length, 6, '3 个点的路径应有 6 个坐标数字');
    assert.equal(line.attrs['data-points'], '3');
  }

  const points = byClass(svg, 'circle', 'lc-point');
  assert.equal(points.length, 6, '2 条线 × 3 个点 = 6 个数据点');
  assert.equal(points.filter((p) => p.attrs['data-series'] === '0').length, 3);
  assert.equal(points.filter((p) => p.attrs['data-series'] === '1').length, 3);
  for (const point of points) {
    assert.ok(point.raw.includes('class="lc-point"'));
    assert.ok(point.attrs['data-value'] !== undefined);
  }

  // 每个数据点一个 tooltip，加上根节点描述。
  assert.equal((svg.match(/<title>/g) || []).length, 7, '6 个点 + 根标题');
  assert.equal(byClass(svg, 'text', 'lc-endlabel').length, 2, '每条线末端标注数值');
  assert.ok(textsOf(svg, 'lc-endlabel').includes('128,000'));
  assert.equal(byClass(svg, 'line', 'lc-grid').length, 4, '默认 y 轴 4 档网格线');
});

test('lineChart：x 轴标签过多时自动抽稀，且保留最后一帧', () => {
  const labels = Array.from({ length: 24 }, (_, i) => i + 1 + '月');
  const points = labels.map((_, i) => 100 + i * 3);
  const svg = Charts.lineChart({
    xLabels: labels,
    series: [{ name: '销售额', points }],
  });
  assertSvg(svg, 'line');
  const shown = textsOf(svg, 'lc-xlabel');
  assert.ok(shown.length < labels.length, '标签应被抽稀');
  assert.ok(shown.length >= 2, '至少保留首尾标签');
  assert.equal(shown[shown.length - 1], '24月', '最后一个标签必须保留');
  assert.equal(byClass(svg, 'circle', 'lc-point').length, 24);
});

test('lineChart：负值折线包含 0 轴，showArea=false 时不生成面积', () => {
  const svg = Charts.lineChart({
    xLabels: ['Q1', 'Q2', 'Q3'],
    series: [{ name: '净现金流', points: [-120, 80, 210] }],
    showArea: false,
  });
  assertSvg(svg, 'line');
  assert.equal(byClass(svg, 'path', 'lc-area').length, 0);
  assert.equal(byClass(svg, 'path', 'lc-line').length, 1);
  assert.equal(byClass(svg, 'line', 'lc-zero').length, 1, '负值图表应画出 0 轴');
  assert.equal(byClass(svg, 'circle', 'lc-point').length, 3);
});

/* ------------------------------------------------------------------ */
/* 3. 堆叠柱状图                                                       */
/* ------------------------------------------------------------------ */

test('stackedBarChart：柱段高度与堆叠值成比例，合计标签正确', () => {
  const svg = stackedSample();
  assertSvg(svg, 'stacked-bar');

  const columns = byClass(svg, 'g', 'sb-col');
  assert.equal(columns.length, 2);
  assert.equal(columns[0].attrs['data-total'], '150');
  assert.equal(columns[1].attrs['data-total'], '200');

  const segments = byClass(svg, 'rect', 'sb-seg');
  assert.equal(segments.length, 4, '2 列 × 2 段非零堆叠');
  const sum = (col) =>
    segments
      .filter((seg) => seg.attrs['data-col'] === col)
      .reduce((acc, seg) => acc + Number(seg.attrs.height), 0);
  const heightA = sum('0');
  const heightB = sum('1');
  assert.ok(heightA > 0 && heightB > 0);
  assert.ok(
    Math.abs(heightA / heightB - 150 / 200) < 0.005,
    '柱高总和应与 150:200 成比例，实际 ' + heightA + ':' + heightB
  );

  const totals = textsOf(svg, 'sb-total');
  assert.deepEqual(totals, ['¥150', '¥200'], '顶部合计标签应使用传入的 valueFormat');
  assert.equal((svg.match(/<title>/g) || []).length, 5, '4 段 + 根标题，每段都有 tooltip');
});

test('stackedBarChart：负值堆叠向下画，并包含 0 轴', () => {
  const svg = Charts.stackedBarChart({
    categories: ['本月'],
    series: [
      { name: '收入', values: [100] },
      { name: '退款', values: [-40] },
    ],
    valueFormat: (value) => value + '元',
  });
  assertSvg(svg, 'stacked-bar');
  assert.equal(byClass(svg, 'line', 'sb-zero').length, 1);
  const segments = byClass(svg, 'rect', 'sb-seg');
  assert.equal(segments.length, 2);
  assert.equal(segments[0].attrs['data-value'], '100');
  assert.equal(segments[1].attrs['data-value'], '-40');
  assert.equal(textsOf(svg, 'sb-total')[0], '60元');
});

/* ------------------------------------------------------------------ */
/* 4. 横向条形图                                                       */
/* ------------------------------------------------------------------ */

test('hBarChart：最大值占满轨道，其余条长按比例缩放', () => {
  const svg = hBarSample();
  assertSvg(svg, 'h-bar');

  const plot = byClass(svg, 'g', 'hb-plot')[0];
  const trackWidth = Number(plot.attrs['data-track-width']);
  const bars = byClass(svg, 'rect', 'hb-bar');
  assert.equal(bars.length, 3);
  assert.equal(Number(bars[0].attrs.width), trackWidth, '最大值那条应占满宽度');
  assert.ok(Math.abs(Number(bars[1].attrs.width) / trackWidth - 0.5) < 0.001);
  assert.ok(Math.abs(Number(bars[2].attrs.width) / trackWidth - 0.25) < 0.001);

  const labels = byClass(svg, 'text', 'hb-label');
  assert.equal(labels.length, 3);
  for (const label of labels) assert.equal(label.attrs['text-anchor'], 'end', '左侧标签右对齐');
  assert.ok(textsOf(svg, 'hb-value').includes('400'));
  assert.equal(byClass(svg, 'rect', 'hb-track').length, 3);
  assert.equal((svg.match(/<title>/g) || []).length, 4, '每根条 + 根标题');
});

test('hBarChart：负值从 0 轴向左延伸', () => {
  const svg = Charts.hBarChart({
    items: [
      { label: '回款', value: 300 },
      { label: '退款', value: -100 },
    ],
  });
  assertSvg(svg, 'h-bar');
  assert.equal(byClass(svg, 'line', 'hb-zero').length, 1);
  const bars = byClass(svg, 'rect', 'hb-bar');
  assert.equal(bars.length, 2);
  const plot = byClass(svg, 'g', 'hb-plot')[0];
  const zeroX = Number(plot.attrs['data-zero-x']);
  const negativeX = Number(bars[1].attrs.x);
  const negativeWidth = Number(bars[1].attrs.width);
  assert.ok(negativeX < zeroX, '负值条起点应在 0 轴左侧');
  assert.ok(negativeX + negativeWidth <= zeroX + 0.01, '负值条不应越过 0 轴');
});

test('hBarChart：全负数据把 0 轴放在右端，条向左画', () => {
  const svg = Charts.hBarChart({
    items: [
      { label: '退款 A', value: -100 },
      { label: '退款 B', value: -50 },
    ],
  });
  assertSvg(svg, 'h-bar');
  const plot = byClass(svg, 'g', 'hb-plot')[0];
  const trackWidth = Number(plot.attrs['data-track-width']);
  const zeroX = Number(plot.attrs['data-zero-x']);
  const bars = byClass(svg, 'rect', 'hb-bar');
  assert.equal(bars.length, 2);
  assert.equal(Number(bars[0].attrs.x) + Number(bars[0].attrs.width), zeroX, '最大值条应贴住 0 轴');
  assert.equal(Number(bars[0].attrs.width), trackWidth, '全负时最大绝对值仍占满轨道');
  assert.ok(Number(bars[1].attrs.x) + Number(bars[1].attrs.width) <= zeroX + 0.01);
});

/* ------------------------------------------------------------------ */
/* 5. 环形图                                                           */
/* ------------------------------------------------------------------ */

test('donutChart：扇形数量、中心文字与百分比合计正确', () => {
  const svg = donutSample();
  assertSvg(svg, 'donut');

  const segments = byClass(svg, 'path', 'donut-segment');
  assert.equal(segments.length, 3, '3 个 items 应生成 3 个扇形');
  assert.equal((svg.match(/<title>/g) || []).length, 4, '3 个扇形 + 根标题');

  assert.deepEqual(textsOf(svg, 'donut-center-label'), ['净利润']);
  assert.deepEqual(textsOf(svg, 'donut-center-value'), ['¥3,250']);

  const pcts = textsOf(svg, 'donut-pct').map((text) => Number(text.replace('%', '')));
  assert.equal(pcts.length, 3);
  const sum = pcts.reduce((acc, value) => acc + value, 0);
  assert.ok(Math.abs(sum - 100) < 0.2, '百分比合计应约为 100，实际 ' + sum);
  assert.deepEqual(pcts, [50, 30, 20]);

  // 图例两列：前两项同一行，第三项换行到第一列。
  const labels = byClass(svg, 'text', 'donut-legend-label');
  assert.equal(labels.length, 3);
  assert.equal(Number(labels[2].attrs.x), Number(labels[0].attrs.x));
  assert.notEqual(Number(labels[1].attrs.x), Number(labels[0].attrs.x));
});

test('donutChart：单项 100% 也能画成完整圆环', () => {
  const svg = Charts.donutChart({
    items: [{ label: '商品成本', value: 120 }],
    centerLabel: '合计',
    centerValue: '120',
  });
  assertSvg(svg, 'donut');
  const segments = byClass(svg, 'path', 'donut-segment');
  assert.equal(segments.length, 1);
  assert.equal((segments[0].attrs.d.match(/\bA\b/g) || []).length, 4, '整圆需 4 段圆弧');
  assert.deepEqual(textsOf(svg, 'donut-pct'), ['100.0%']);
});

test('donutChart：legendPosition=bottom 时图例位于环下方', () => {
  const svg = Charts.donutChart({
    items: [
      { label: '商品', value: 60 },
      { label: '物流', value: 40 },
    ],
    legendPosition: 'bottom',
    size: 180,
  });
  assertSvg(svg, 'donut');
  const segments = byClass(svg, 'path', 'donut-segment');
  assert.equal(segments.length, 2);
  const labelYs = byClass(svg, 'text', 'donut-legend-label').map((tag) => Number(tag.attrs.y));
  assert.ok(labelYs.every((y) => y > 180), '图例应位于直径 180 的圆环下方');
});

/* ------------------------------------------------------------------ */
/* 6. XML 转义                                                         */
/* ------------------------------------------------------------------ */

test('escapeXml 与所有图表标签都正确转义 < & " \'', () => {
  assert.equal(Charts.escapeXml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(
    Charts.escapeXml('净利润 < 100 & "增长"'),
    '净利润 &lt; 100 &amp; &quot;增长&quot;',
    '中文应保留，只有特殊字符被转义'
  );

  const nasty = '退款 A&B <script>alert("x")</script> \'引号\' 中文';
  const charts = [
    Charts.lineChart({
      xLabels: [nasty, nasty],
      series: [{ name: nasty, points: [1, 2] }],
    }),
    Charts.stackedBarChart({
      categories: [nasty],
      series: [{ name: nasty, values: [1] }],
    }),
    Charts.hBarChart({ items: [{ label: nasty, value: 1 }] }),
    Charts.donutChart({ items: [{ label: nasty, value: 1 }] }),
    Charts.waterfallChart({
      items: [
        { label: nasty, value: 10, type: 'start' },
        { label: nasty, value: 5, type: 'delta' },
      ],
    }),
    Charts.progressBar({ value: 5, max: 10, label: nasty }),
  ];

  for (const svg of charts) {
    assertSvg(svg);
    assert.ok(!svg.includes('<script>'), '原始 <script> 不应出现在 SVG 中');
    assert.ok(svg.includes('&lt;script&gt;'), '标签尖括号应被转义');
    assert.ok(svg.includes('&amp;'), '& 应被转义');
    assert.ok(svg.includes('&quot;'), '双引号应被转义');
    assert.ok(svg.includes('&#39;'), '单引号应被转义');
    assert.ok(svg.includes('中文'), '中文标签应原样保留');
  }
});

/* ------------------------------------------------------------------ */
/* 7. 空数据 / 全 0                                                    */
/* ------------------------------------------------------------------ */

test('空数组与全 0 数据不抛异常，统一返回可显示占位 SVG', () => {
  const emptyCases = [
    ['line-empty', () => Charts.lineChart({ series: [], xLabels: [] })],
    [
      'line-zero',
      () => Charts.lineChart({ series: [{ name: '净利润', points: [0, 0, 0] }], xLabels: ['a', 'b', 'c'] }),
    ],
    ['stacked-empty', () => Charts.stackedBarChart({ categories: [], series: [] })],
    [
      'stacked-zero',
      () =>
        Charts.stackedBarChart({
          categories: ['a', 'b'],
          series: [{ name: '成本', values: [0, 0] }],
        }),
    ],
    ['hbar-empty', () => Charts.hBarChart({ items: [] })],
    ['hbar-zero', () => Charts.hBarChart({ items: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] })],
    ['donut-empty', () => Charts.donutChart({ items: [] })],
    ['donut-zero', () => Charts.donutChart({ items: [{ label: 'A', value: 0 }] })],
    ['waterfall-empty', () => Charts.waterfallChart({ items: [] })],
    [
      'waterfall-zero',
      () =>
        Charts.waterfallChart({
          items: [
            { label: '期初', value: 0, type: 'start' },
            { label: '变动', value: 0, type: 'delta' },
            { label: '期末', value: 0, type: 'total' },
          ],
        }),
    ],
    ['spark-empty', () => Charts.sparkline({ values: [] })],
    ['spark-zero', () => Charts.sparkline({ values: [0, 0, 0] })],
  ];

  for (const [name, make] of emptyCases) {
    let svg;
    assert.doesNotThrow(() => {
      svg = make();
    }, name + ' 不应抛异常');
    assertSvg(svg);
    assert.ok(svg.includes('data-empty="true"'), name + ' 应标记为空图');
    assert.ok(svg.includes('暂无数据'), name + ' 应显示占位文字');
  }

  // 完全无参数调用也不应崩溃。
  assert.doesNotThrow(() => Charts.lineChart());
  assert.doesNotThrow(() => Charts.donutChart());
  assert.ok(Charts.lineChart().includes('data-empty="true"'));
});

/* ------------------------------------------------------------------ */
/* 8. 瀑布图                                                           */
/* ------------------------------------------------------------------ */

test('waterfallChart：start/total 从 0 起，delta 浮动，净变化位置正确', () => {
  const svg = waterfallSample();
  assertSvg(svg, 'waterfall');

  const bars = byClass(svg, 'rect', 'wf-bar');
  assert.equal(bars.length, 4);
  const start = bars[0].attrs;
  const drop = bars[1].attrs;
  const gain = bars[2].attrs;
  const total = bars[3].attrs;

  assert.deepEqual(
    [start['data-role'], start['data-base'], start['data-top'], start['data-value']],
    ['start', '0', '100', '100'],
    'start 柱从 0 画到 100'
  );
  assert.deepEqual(
    [drop['data-role'], drop['data-base'], drop['data-top'], drop['data-value']],
    ['delta', '100', '80', '-20'],
    '第一笔 delta 从 100 降到 80'
  );
  assert.deepEqual(
    [gain['data-role'], gain['data-base'], gain['data-top'], gain['data-value']],
    ['delta', '80', '95', '15'],
    '第二笔 delta 从 80 升到 95'
  );
  assert.deepEqual(
    [total['data-role'], total['data-base'], total['data-top'], total['data-value']],
    ['total', '0', '95', '95'],
    'total 柱从 0 画到净结果 95'
  );

  // 几何一致性：柱高按同一比例映射；start 顶 = 第一笔 delta 顶；期末 total 顶 = 第二笔 delta 顶。
  const startHeight = Number(start.height);
  const totalHeight = Number(total.height);
  assert.ok(Math.abs(startHeight / totalHeight - 100 / 95) < 0.01);
  assert.ok(Math.abs(Number(drop.height) / startHeight - 20 / 100) < 0.01);
  assert.ok(Math.abs(Number(gain.height) / startHeight - 15 / 100) < 0.01);
  assert.ok(Math.abs(Number(start.y) - Number(drop.y)) < 0.01, '下降柱顶部应与 start 顶部同高');
  assert.ok(Math.abs(Number(gain.y) - Number(total.y)) < 0.01, '期末 total 顶部应与累计值同高');

  assert.equal(byClass(svg, 'line', 'wf-connector').length, 2);
  assert.equal(byClass(svg, 'text', 'wf-value').length, 4);
  assert.ok(textsOf(svg, 'wf-value').includes('+15'), '正向 delta 显示带符号的数值');
});

/* ------------------------------------------------------------------ */
/* 9. Sparkline / 格式化 / 导出方式                                    */
/* ------------------------------------------------------------------ */

test('sparkline：点数量与输入一致，每个点有 tooltip', () => {
  const values = [3, 5, 2, 8, 6];
  const svg = sparkSample({ values });
  assertSvg(svg, 'sparkline');
  assert.match(svg, /viewBox="0 0 120 32"/);

  const points = byClass(svg, 'circle', 'spark-point');
  assert.equal(points.length, values.length, '每个值一个点');
  assert.equal(byClass(svg, 'circle', 'spark-last').length, 1, '最后一个点突出显示');
  assert.equal(byClass(svg, 'path', 'spark-line').length, 1);
  assert.equal(coordsOfPath(byClass(svg, 'path', 'spark-line')[0].attrs.d).length, values.length * 2);
  assert.equal((svg.match(/<title>/g) || []).length, values.length + 1, '每个点都有 tooltip');
});

test('formatCompact / formatNumber / 默认千分位符合预期', () => {
  assert.equal(Charts.formatCompact(124000), '12.4万');
  assert.equal(Charts.formatCompact(-124000), '-12.4万');
  assert.equal(Charts.formatCompact(100000000), '1亿');
  assert.equal(Charts.formatCompact(9999), '9,999');
  assert.equal(Charts.formatCompact(0), '0');
  assert.equal(Charts.formatNumber(1234567.5), '1,234,567.5');
  assert.equal(Charts.formatNumber(-0.5), '-0.5');
  assert.equal(typeof Charts.escapeXml, 'function');
  assert.equal(typeof Charts.progressBar, 'function');

  // 未传 valueFormat 时，图表内部使用千分位。
  const svg = Charts.hBarChart({ items: [{ label: '销售额', value: 1234567 }] });
  assert.ok(textsOf(svg, 'hb-value').includes('1,234,567'));
  assert.ok(svg.includes('var(--chart-1, #2F6B5E)'), '默认色应使用带 fallback 的 CSS 变量');

  // 界面层会传入不带 fallback 的主题变量（如 var(--chart-4)），必须原样保留，
  // 否则会丢失“店铺/成本项”的颜色语义。
  const themed = Charts.lineChart({
    xLabels: ['8月', '9月'],
    series: [{ name: '净利润', color: 'var(--chart-4)', points: [1, 2] }],
  });
  assert.ok(themed.includes('stroke:var(--chart-4)'), '必须接受 var(--chart-N) 形式的颜色');
  const donut = Charts.donutChart({
    items: [{ label: '商品', value: 1, color: 'var(--chart-4)' }],
  });
  assert.ok(donut.includes('fill:var(--chart-4)'));
});

test('模块同时可通过 module.exports 与 window.Charts 使用（无 DOM 依赖）', () => {
  assert.equal(typeof Charts.lineChart, 'function');
  assert.equal(typeof Charts.stackedBarChart, 'function');
  assert.equal(typeof Charts.hBarChart, 'function');
  assert.equal(typeof Charts.donutChart, 'function');
  assert.equal(typeof Charts.waterfallChart, 'function');
  assert.equal(typeof Charts.sparkline, 'function');
  assert.equal(typeof Charts.progressBar, 'function');
  assert.equal(typeof Charts.formatCompact, 'function');
  assert.equal(typeof Charts.escapeXml, 'function');

  assert.ok(!/\bdocument\s*\./.test(SOURCE), 'charts.js 不应操作 DOM');
  assert.ok(!/innerHTML/.test(SOURCE), 'charts.js 不应操作 innerHTML');

  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'charts.js' });
  assert.equal(typeof sandbox.window.Charts, 'object');
  assert.equal(typeof sandbox.window.Charts.lineChart, 'function');
  assert.equal(sandbox.window.Charts.escapeXml('<'), '&lt;');
});

test('progressBar：常规进度与非法输入', () => {
  const svg = Charts.progressBar({ value: 68, max: 100, label: '库存周转目标', color: '#2F6B5E' });
  assertSvg(svg, 'progress');
  assert.ok(textsOf(svg, 'pb-label').includes('库存周转目标'));
  assert.ok(textsOf(svg, 'pb-value').includes('68%'));
  const fill = byClass(svg, 'rect', 'pb-fill')[0];
  assert.ok(Math.abs(Number(fill.attrs.width) / 320 - 0.68) < 0.001);

  const zero = Charts.progressBar({ value: 0, max: 100 });
  assertSvg(zero, 'progress');
  assert.equal(Number(byClass(zero, 'rect', 'pb-fill')[0].attrs.width), 0);

  const invalid = Charts.progressBar({ value: 10, max: 0 });
  assertSvg(invalid);
  assert.ok(invalid.includes('data-empty="true"'));
  assert.ok(invalid.includes('暂无进度'));
});
