import {
  buildDemoData, buildMappingPrompt, cellToText, checkMapping, DEFAULT_TEMPLATE_TABLES, dropErrorRows, mergeSuggestions,
  parseMappingSuggestion, planSourceSync, prepareImport, Provenance, recordsToParsedTable, removeUnits, ruleSuggestMapping,
  snippetAround, stableStringify, templateFieldsFor, Unit, unitsFrom
} from '../src';

const demo = buildDemoData();

describe('模板（情况一：客户没用智能表）', () => {
  it('默认模板是订单（含明细）、费用、平台账单', () => {
    expect([...DEFAULT_TEMPLATE_TABLES]).toEqual(['orders', 'expenses', 'platform_bills']);
  });
  it('模板字段名就是导入模板中文名，规则映射可以全部对上', () => {
    for (const t of DEFAULT_TEMPLATE_TABLES) {
      const fields = templateFieldsFor(t);
      const s = ruleSuggestMapping(fields.map((f) => f.name), t);
      expect(Object.values(s.by).every((b) => b === 'rule')).toBe(true);
      expect(checkMapping(s.mapping, t).ok).toBe(true);
    }
  });
  it('枚举字段变成单选并带选项，金额变数字', () => {
    const f = templateFieldsFor('orders');
    expect(f.find((x) => x.key === 'status')).toMatchObject({ type: 'singleSelect', options: ['paid', 'refunded', 'partial'] });
    expect(f.find((x) => x.key === 'amount')!.type).toBe('number');
    expect(f.find((x) => x.key === 'order_date')!.type).toBe('date');
  });
});

describe('字段映射（情况二：已有智能表）', () => {
  it('规则按别名对上，对不上的留空', () => {
    const s = ruleSuggestMapping(['订单编号', '店铺名称', '下单时间', '商家编码', '件数', '商品实付', '买家留言'], 'orders');
    expect(s.mapping).toMatchObject({ 订单编号: 'order_id', 店铺名称: 'store_id', 下单时间: 'order_date', 商家编码: 'sku_id', 件数: 'qty', 商品实付: 'amount', 买家留言: null });
    expect(checkMapping(s.mapping, 'orders').ok).toBe(true);
  });
  it('缺必填或重复对应时不可用', () => {
    expect(checkMapping({ 单号: 'order_id' }, 'orders').missing).toContain('店铺');
    const dup = checkMapping({ a: 'order_id', b: 'order_id', c: 'store_id', d: 'order_date', e: 'sku_id', f: 'qty', g: 'amount' }, 'orders');
    expect(dup.duplicates).toEqual(['订单号']);
    expect(dup.ok).toBe(false);
  });
  it('费用表没有编号列也能用（系统用平台记录 ID 补）', () => {
    expect(checkMapping({ 日期: 'date', 类别: 'category', 金额: 'amount' }, 'expenses').ok).toBe(true);
  });
  it('AI 输出被收紧：未知列、未知字段、重复对应丢弃', () => {
    const r = parseMappingSuggestion(JSON.stringify({ mapping: { 单号: 'order_id', 编号2: 'order_id', 店: 'store_x', 不存在: 'qty', 数: 'qty' } }), 'orders', ['单号', '编号2', '店', '数']);
    expect(r).toEqual({ ok: true, mapping: { 单号: 'order_id', 数: 'qty' } });
    expect(parseMappingSuggestion('不是json', 'orders', []).ok).toBe(false);
  });
  it('规则优先，AI 只补空位', () => {
    const rule = ruleSuggestMapping(['订单号', '单店'], 'orders');
    const m = mergeSuggestions(rule, { 订单号: 'sku_id', 单店: 'store_id' });
    expect(m.mapping).toEqual({ 订单号: 'order_id', 单店: 'store_id' });
    expect(m.by).toEqual({ 订单号: 'rule', 单店: 'ai' });
  });
  it('提示词只带字段名和截断样例', () => {
    const p = buildMappingPrompt('orders', [{ name: '单号', samples: ['x'.repeat(100)] }]);
    expect(p.user).toContain('单号');
    expect(p.user).not.toContain('x'.repeat(31));
  });
});

describe('平台记录 → 导入表', () => {
  it('选项/人员对象取名称，日期时间戳按北京时间', () => {
    expect(cellToText({ name: '已支付' })).toBe('已支付');
    expect(cellToText([{ name: 'A' }, { name: 'B' }])).toBe('A,B');
    expect(cellToText(Date.UTC(2026, 7, 31, 17, 0), 'date')).toBe('2026-09-01');
    expect(cellToText(Date.UTC(2026, 7, 31, 17, 0), 'month')).toBe('2026-09');
    expect(cellToText(12.5)).toBe('12.5');
  });
  it('复用文件导入校验：转换后能直接导入', () => {
    const recs = [
      { id: 'r1', fields: { 订单号: 'DT001', 店铺: 'TB01', 下单日期: Date.UTC(2026, 9, 3), 商品编码: 'SKU001', 数量: 1, 商品金额: 139, 支付金额: 139 } },
      { id: 'r2', fields: { 订单号: 'DT001', 店铺: 'TB01', 下单日期: Date.UTC(2026, 9, 3), 商品编码: 'SKU005', 数量: 2, 商品金额: 100, 支付金额: 239 } }
    ];
    const mapping = ruleSuggestMapping(Object.keys(recs[0].fields), 'orders').mapping;
    const prep = prepareImport('orders', recordsToParsedTable(recs, mapping, 'orders'), demo);
    expect(prep.ok).toBe(true);
    expect(prep.patch.orders).toHaveLength(1);
    expect(prep.patch.order_items).toHaveLength(2);
  });
  it('费用表自动补稳定主键（反复同步不重复）', () => {
    const recs = [{ id: 'rec9', fields: { 日期: '2026-10-05', 类别: '仓储费', 金额: 100 } }];
    const p = recordsToParsedTable(recs, { 日期: 'date', 类别: 'category', 金额: 'amount' }, 'expenses', 'DT-');
    const prep = prepareImport('expenses', p, demo);
    expect(prep.ok).toBe(true);
    expect(prep.patch.expenses![0].id).toBe('DT-rec9');
  });
  it('有错的行整单剔除', () => {
    const parsed = { headers: ['订单号', '数量'], rows: [['A', '1'], ['A', 'x'], ['B', '1']] };
    const r = dropErrorRows(parsed, 'orders', [3]);
    expect(r.droppedKeys).toEqual(['A']);
    expect(r.parsed.rows).toEqual([['B', '1']]);
    expect(r.droppedRows).toBe(2);
  });
});

describe('同步计划（多来源，冲突不自动覆盖）', () => {
  const hash = (u: Unit) => stableStringify(u);
  const unit = (id: string, amount: number): Unit => ({ main: { id, amount }, children: [] });
  const m = (...us: Unit[]) => new Map(us.map((u) => [String(u.main.id), u]));

  it('新增 / 本来源更新 / 不变 / 冲突 / 来源已删除', () => {
    const existing = m(unit('mine', 1), unit('same', 5), unit('file', 7), unit('other', 8), unit('gone', 9), unit('touched', 3));
    const prov = new Map<string, Provenance>([
      ['mine', { dataSourceId: 'S1', hash: hash(unit('mine', 1)) }],
      ['other', { dataSourceId: 'S2', hash: hash(unit('other', 8)) }],
      ['gone', { dataSourceId: 'S1', hash: hash(unit('gone', 9)) }],
      ['touched', { dataSourceId: 'S1', hash: hash(unit('touched', 2)) }] // 写入后被别人改过
    ]);
    const incoming = m(unit('new', 1), unit('mine', 2), unit('same', 5), unit('file', 70), unit('other', 80), unit('touched', 4));
    const p = planSourceSync({ tableId: 'expenses', dataSourceId: 'S1', incoming, existing, provenance: prov, hash });
    expect(p.created).toEqual(['new']);
    expect(p.updated).toEqual(['mine']);
    expect(p.unchanged).toEqual(['same']);
    expect(p.conflicts.map((c) => [c.key, c.existingOwner])).toEqual([['file', null], ['other', 'S2'], ['touched', 'S1']]);
    expect(p.missingAtSource).toEqual(['gone']);
    expect(p.accept.map((u) => u.main.id)).toEqual(['new', 'mine']);
  });
  it('校验没通过而跳过的行不算来源已删除；重新出现的取消标记', () => {
    const prov = new Map<string, Provenance>([['a', { dataSourceId: 'S1', hash: 'h' }], ['b', { dataSourceId: 'S1', hash: 'h', deletedAtSource: true }]]);
    const existing = m(unit('a', 1), unit('b', 1));
    const p = planSourceSync({ tableId: 'expenses', dataSourceId: 'S1', incoming: m(unit('b', 1)), existing, provenance: prov, skippedKeys: ['a'], hash });
    expect(p.missingAtSource).toEqual([]);
    expect(p.reappeared).toEqual(['b']);
  });
  it('订单按“订单+明细”整体比较和删除', () => {
    const units = unitsFrom('orders', demo);
    const first = [...units.keys()][0];
    expect(units.get(first)!.children.length).toBeGreaterThan(0);
    const after = removeUnits(demo, 'orders', [first]);
    expect(after.orders.length).toBe(demo.orders.length - 1);
    expect(after.order_items.some((i) => i.order_id === first)).toBe(false);
    expect(demo.orders.length).toBe(units.size); // 未改入参
  });
});

describe('知识库搜索摘要', () => {
  it('取命中附近', () => {
    expect(snippetAround('a'.repeat(100) + '佣金费率5%' + 'b'.repeat(100), '佣金', 5)).toBe('…aaaaa佣金费率5%b…');
  });
});
