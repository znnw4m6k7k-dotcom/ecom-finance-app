/**
 * 数据源（平台智能表 / 知识库 → 工作台）集成测试：真实 PostgreSQL + 模拟平台（MockConnector，不对外请求）。
 * 覆盖 hanson 确认的规则：AI 映射只是草稿须确认；多来源冲突不自动覆盖；来源删除先标记、确认后才删；知识库分数据型/查询型。
 */
import request from 'supertest';
import { bootTestApp } from './setup';
import { SourcesService } from '../src/sources/sources.service';

let ctx: Awaited<ReturnType<typeof bootTestApp>>;
let http: any;
const tokens: Record<string, string> = {};
const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
const tenantOf = async (slug: string) => (await ctx.prisma.tenant.findUniqueOrThrow({ where: { slug } })).id;

beforeAll(async () => {
  ctx = await bootTestApp();
  http = ctx.app.getHttpServer();
  for (const [key, t, u, p] of [['owner', 'luye-demo', 'owner', 'owner-pass-1'], ['finance', 'luye-demo', 'finance', 'finance-pass-1'], ['viewer', 'luye-demo', 'viewer', 'viewer-pass-1'], ['otherOwner', 'other-demo', 'owner', 'owner-pass-1']]) {
    const r = await request(http).post('/api/v1/auth/login').send({ tenant: t, username: u, password: p });
    tokens[key] = r.body.token;
  }
});
afterAll(async () => { await ctx?.app.close(); await ctx?.prisma.$disconnect(); });

const expenseSheet = () => ctx.connector.bases.get('demo-expense')![0];

describe('权限与平台信息', () => {
  it('只读账号不能管理数据源，也不能检索知识库', async () => {
    expect((await request(http).get('/api/v1/sources').set(auth('viewer'))).status).toBe(403);
    expect((await request(http).get('/api/v1/sources/knowledge/search?q=x').set(auth('viewer'))).status).toBe(403);
  });
  it('明确显示是模拟平台', async () => {
    const r = await request(http).get('/api/v1/sources/platform').set(auth('finance'));
    expect(r.body).toMatchObject({ provider: 'mock', isMock: true, capabilities: { readTables: true } });
  });
});

describe('情况二：连接客户已有的智能表', () => {
  let id = '';
  it('粘贴链接列出数据表', async () => {
    const r = await request(http).post('/api/v1/sources/tables/inspect').set(auth('finance')).send({ link: 'mock://table/demo-expense' });
    expect(r.status).toBe(200);
    expect(r.body.sheets).toEqual([{ sheetId: 'sheet1', name: '费用登记（客户自建）' }]);
    expect((await request(http).post('/api/v1/sources/tables/inspect').set(auth('finance')).send({ link: 'https://x.example.com/abc' })).status).toBe(400);
  });
  it('规则 + AI 给出字段对应草稿，记录 AI 调用', async () => {
    const r = await request(http).post('/api/v1/sources/tables').set(auth('finance')).send({ link: 'mock://table/demo-expense', sheetId: 'sheet1', tableId: 'expenses' });
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ mappingStatus: 'draft', isMock: true, kind: 'table' });
    expect(r.body.mapping).toMatchObject({ 发生日期: 'date', 收款方: 'vendor', 店铺编码: 'store_id', '金额(元)': 'amount', 费用类型: null });
    expect(r.body.mappingBy).toMatchObject({ 发生日期: 'rule', 店铺编码: 'ai' });
    expect(r.body.check).toMatchObject({ ok: false, missing: ['费用类别'] });
    const calls = await ctx.prisma.aiCall.findMany({ where: { purpose: 'field_mapping', refId: id } });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.isMock)).toBe(true);
  });
  it('没确认不能同步；缺必填不能确认；补上后确认', async () => {
    expect((await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'))).status).toBe(409);
    expect((await request(http).post(`/api/v1/sources/${id}/mapping/confirm`).set(auth('finance'))).status).toBe(400);
    const m = await request(http).patch(`/api/v1/sources/${id}/mapping`).set(auth('finance')).send({ mapping: { 费用类型: 'category' } });
    expect(m.body.mappingBy.费用类型).toBe('manual');
    const c = await request(http).post(`/api/v1/sources/${id}/mapping/confirm`).set(auth('finance'));
    expect(c.status).toBe(200);
    expect(c.body.mappingStatus).toBe('confirmed');
  });
  it('预览不写库；同步写入并记录批次、审计', async () => {
    const before = await ctx.prisma.expense.count();
    const p = await request(http).post(`/api/v1/sources/${id}/preview`).set(auth('finance'));
    expect(p.body).toMatchObject({ read: 2, created: 2, conflicts: 0, isMock: true });
    expect(await ctx.prisma.expense.count()).toBe(before);
    const s = await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'));
    expect(s.body).toMatchObject({ status: 'ok', created: 2, isMock: true });
    const e = await ctx.prisma.expense.findFirst({ where: { id: 'MOCK-rec001' } });
    expect(Number(e!.amount)).toBe(3200);
    expect(e!.category).toBe('仓储费');
    expect(await ctx.prisma.importBatch.count({ where: { mode: 'sync' } })).toBe(1);
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'source.synced', targetId: id } })).toBe(1);
    const ds = await request(http).get('/api/v1/dataset').set(auth('owner'));
    expect(ds.body.expenses.some((x: any) => x.id === 'MOCK-rec002')).toBe(true);
  });
  it('再同步不重复；平台改了本来源写的数据 → 直接更新', async () => {
    expect((await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'))).body).toMatchObject({ created: 0, unchanged: 2 });
    expenseSheet().records[0].fields['金额(元)'] = 3300;
    expect((await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'))).body).toMatchObject({ updated: 1, unchanged: 1, conflicts: 0 });
    expect(Number((await ctx.prisma.expense.findFirst({ where: { id: 'MOCK-rec001' } }))!.amount)).toBe(3300);
  });
  it('工作台里被别人改过的数据：不覆盖，列为冲突，财务选“用平台的”后才写入', async () => {
    await ctx.prisma.expense.updateMany({ where: { id: 'MOCK-rec001' }, data: { amount: 9999 } }); // 模拟文件导入改过
    expenseSheet().records[0].fields['金额(元)'] = 3400;
    const s = await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'));
    expect(s.body).toMatchObject({ status: 'partial', conflicts: 1 });
    expect(Number((await ctx.prisma.expense.findFirst({ where: { id: 'MOCK-rec001' } }))!.amount)).toBe(9999);
    const list = await request(http).get('/api/v1/sources/conflicts').set(auth('finance'));
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ rowKey: 'MOCK-rec001', existingOwnerName: expect.any(String) });
    // 再同步一次：同一条只保留一个待处理冲突
    await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'));
    const list2 = await request(http).get('/api/v1/sources/conflicts').set(auth('finance'));
    expect(list2.body).toHaveLength(1);
    const r = await request(http).post(`/api/v1/sources/conflicts/${list2.body[0].id}/resolve`).set(auth('finance')).send({ action: 'accept' });
    expect(r.status).toBe(200);
    expect(Number((await ctx.prisma.expense.findFirst({ where: { id: 'MOCK-rec001' } }))!.amount)).toBe(3400);
    expect((await request(http).post(`/api/v1/sources/conflicts/${list2.body[0].id}/resolve`).set(auth('finance')).send({ action: 'reject' })).status).toBe(409);
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'source.conflict_accepted' } })).toBe(1);
  });
  it('有错的行不写入、其余照常；平台删掉的行先标记，确认后才删', async () => {
    const sheet = expenseSheet();
    sheet.records.push({ id: 'rec003', fields: { 发生日期: '不是日期', 费用类型: { name: '包装费' }, '金额(元)': 50 } });
    sheet.records.splice(1, 1); // 删掉 rec002
    const s = await request(http).post(`/api/v1/sources/${id}/sync`).set(auth('finance'));
    expect(s.body).toMatchObject({ status: 'partial', errorCount: 1, missingAtSource: 1 });
    expect(await ctx.prisma.expense.count({ where: { id: 'MOCK-rec003' } })).toBe(0);
    expect(await ctx.prisma.expense.count({ where: { id: 'MOCK-rec002' } })).toBe(1); // 还在
    const del = await request(http).get('/api/v1/sources/deletions').set(auth('finance'));
    expect(del.body.map((d: any) => d.rowKey)).toEqual(['MOCK-rec002']);
    const r = await request(http).post('/api/v1/sources/deletions/resolve').set(auth('finance')).send({ tableId: 'expenses', rowKey: 'MOCK-rec002', action: 'delete' });
    expect(r.status).toBe(200);
    expect(await ctx.prisma.expense.count({ where: { id: 'MOCK-rec002' } })).toBe(0);
    expect(await ctx.prisma.auditEvent.count({ where: { action: 'source.row_deleted' } })).toBe(1);
  });
  it('其他企业看不到', async () => {
    expect((await request(http).get(`/api/v1/sources/${id}`).set(auth('otherOwner'))).status).toBe(404);
    expect((await request(http).get('/api/v1/sources/conflicts').set(auth('otherOwner'))).body).toEqual([]);
  });
});

describe('情况一：在平台生成模板表', () => {
  it('生成订单、费用、平台账单三张模板，字段对应自动确认，填表后可同步', async () => {
    const r = await request(http).post('/api/v1/sources/templates').set(auth('owner')).send({ link: 'mock://table/newbase' });
    expect(r.status).toBe(201);
    expect(r.body.created).toHaveLength(3);
    const sheets = ctx.connector.bases.get('newbase')!;
    expect(sheets.map((s) => s.name)).toEqual(['订单明细', '费用支出', '平台账单']);
    const orderSrc = await ctx.prisma.dataSource.findFirstOrThrow({ where: { tableId: 'orders', fromTemplate: true } });
    expect(orderSrc.mappingStatus).toBe('confirmed');
    sheets[0].records.push(
      { id: 'o1', fields: { 订单号: 'DT-T-001', 店铺: 'TB01', 下单日期: Date.UTC(2026, 9, 20), 商品编码: 'SKU001', 数量: 1, 商品金额: 139, 支付金额: 239 } },
      { id: 'o2', fields: { 订单号: 'DT-T-001', 店铺: 'TB01', 下单日期: Date.UTC(2026, 9, 20), 商品编码: 'SKU005', 数量: 1, 商品金额: 100, 支付金额: 239 } }
    );
    const s = await request(http).post(`/api/v1/sources/${orderSrc.id}/sync`).set(auth('owner'));
    expect(s.body).toMatchObject({ status: 'ok', created: 1 });
    expect(await ctx.prisma.orderItem.count({ where: { order_id: 'DT-T-001' } })).toBe(2);
  });
  it('定时同步：到期的数据源按创建人身份同步', async () => {
    const svc = ctx.app.get(SourcesService);
    const done = await svc.runDue(new Date(Date.now() + 2 * 3600_000));
    expect(done.length).toBeGreaterThanOrEqual(4);
    expect(await ctx.prisma.syncRun.count({ where: { trigger: 'schedule' } })).toBe(done.length);
  });
});

describe('知识库：数据型全文检索，查询型只看目录', () => {
  let dataId = '', refId = '';
  it('接入并同步两类知识库', async () => {
    const a = await request(http).post('/api/v1/sources/knowledge').set(auth('finance')).send({ link: 'mock://kb/demo-kb', mode: 'data', name: '财务规则库' });
    expect(a.status).toBe(201);
    dataId = a.body.id;
    const s = await request(http).post(`/api/v1/sources/${dataId}/sync`).set(auth('finance'));
    expect(s.body).toMatchObject({ status: 'ok', read: 4 });
    const docs = await ctx.prisma.knowledgeDoc.findMany({ where: { dataSourceId: dataId } });
    expect(docs.map((d) => d.title).sort()).toEqual(['店铺费率说明', '报销操作手册', '运营提成规则']);
    expect(docs.find((d) => d.title === '店铺费率说明')).toMatchObject({ path: '财务规则 / 店铺费率说明', mode: 'data' });
    const b = await request(http).post('/api/v1/sources/knowledge').set(auth('finance')).send({ link: 'mock://kb/demo-kb', mode: 'reference', name: '只查询库' });
    refId = b.body.id;
    await request(http).post(`/api/v1/sources/${refId}/sync`).set(auth('finance'));
    expect(await ctx.prisma.knowledgeDoc.count({ where: { dataSourceId: refId, content: { not: null } } })).toBe(0);
  });
  it('搜正文只命中数据型；搜标题两类都命中', async () => {
    const r = await request(http).get('/api/v1/sources/knowledge/search').query({ q: '佣金' }).set(auth('owner'));
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ title: '店铺费率说明', mode: 'data', sourceName: '财务规则库', isMock: true });
    expect(r.body.items[0].snippet).toContain('佣金费率 5%');
    const t = await request(http).get('/api/v1/sources/knowledge/search').query({ q: '报销' }).set(auth('owner'));
    expect(t.body.items.map((x: any) => x.mode).sort()).toEqual(['data', 'reference']);
    expect((await request(http).get('/api/v1/sources/knowledge/search').query({ q: '佣金' }).set(auth('otherOwner'))).body.items).toEqual([]);
  });
  it('改成查询型后正文立即清除；平台删除的条目从检索中消失', async () => {
    await request(http).patch(`/api/v1/sources/${dataId}`).set(auth('finance')).send({ knowledgeMode: 'reference' });
    expect((await request(http).get('/api/v1/sources/knowledge/search').query({ q: '佣金' }).set(auth('owner'))).body.items).toHaveLength(0);
    const nodes = ctx.connector.spaces.get('demo-kb')!;
    nodes.splice(nodes.findIndex((n) => n.nodeId === 'n-manual'), 1);
    await request(http).post(`/api/v1/sources/${refId}/sync`).set(auth('finance'));
    const t = await request(http).get('/api/v1/sources/knowledge/search').query({ q: '报销' }).set(auth('owner'));
    expect(t.body.items.map((x: any) => x.sourceName)).toEqual(['财务规则库']);
  });
});
