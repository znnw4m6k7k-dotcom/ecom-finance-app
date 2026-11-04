/**
 * API 集成测试：真实 PostgreSQL + 真实 HTTP 请求；模型与连接器为 Mock（不对外发送）。
 */
import request from 'supertest';
import { bootTestApp } from './setup';

let ctx: Awaited<ReturnType<typeof bootTestApp>>;
let http: any;
const tokens: Record<string, string> = {};

async function login(tenant: string, username: string, password: string) {
  return request(http).post('/api/v1/auth/login').send({ tenant, username, password });
}
const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

beforeAll(async () => {
  ctx = await bootTestApp();
  http = ctx.app.getHttpServer();
  for (const [key, t, u, p] of [
    ['owner', 'luye-demo', 'owner', 'owner-pass-1'], ['finance', 'luye-demo', 'finance', 'finance-pass-1'], ['viewer', 'luye-demo', 'viewer', 'viewer-pass-1'],
    ['otherOwner', 'other-demo', 'owner', 'owner-pass-1']
  ]) {
    const r = await login(t, u, p);
    expect(r.status).toBe(200);
    tokens[key] = r.body.token;
  }
});
afterAll(async () => { await ctx?.app.close(); await ctx?.prisma.$disconnect(); });

describe('健康检查', () => {
  it('明确报告模型与连接器是模拟的', async () => {
    const r = await request(http).get('/api/v1/health');
    expect(r.body).toMatchObject({ ok: true, db: true, model: { isMock: true }, connector: { isMock: true } });
  });
});

describe('登录与身份', () => {
  it('错误密码 401，连续失败后锁定 429', async () => {
    for (let i = 0; i < 5; i++) expect((await login('luye-demo', 'viewer', 'wrong')).status).toBe(401);
    expect((await login('luye-demo', 'viewer', 'viewer-pass-1')).status).toBe(429);
  });
  it('未登录访问业务接口 401；伪造令牌 401', async () => {
    expect((await request(http).get('/api/v1/dataset/summary')).status).toBe(401);
    expect((await request(http).get('/api/v1/dataset/summary').set({ authorization: 'Bearer abc.def.ghi' })).status).toBe(401);
  });
  it('me 返回角色与权限', async () => {
    const r = await request(http).get('/api/v1/auth/me').set(auth('finance'));
    expect(r.body).toMatchObject({ role: 'FINANCE', tenant: { slug: 'luye-demo' } });
    expect(r.body.permissions).not.toContain('briefing:approve');
  });
});

describe('租户隔离', () => {
  it('两个租户看到各自的数据', async () => {
    const a = await request(http).get('/api/v1/dataset').set(auth('owner'));
    const b = await request(http).get('/api/v1/dataset').set(auth('otherOwner'));
    expect(a.body.orders.length).toBe(15190);
    expect(b.body.orders.length).toBe(20);
  });
  it('改同名店铺（TB01）的费率只影响自己租户', async () => {
    const r = await request(http).put('/api/v1/dataset/settings').set(auth('otherOwner')).send({ stores: { TB01: { commission_rate: 0.09 } } });
    expect(r.status).toBe(200);
    const a = await request(http).get('/api/v1/dataset').set(auth('owner'));
    expect(a.body.stores.find((s: any) => s.id === 'TB01').commission_rate).toBe(0.05);
    const b = await request(http).get('/api/v1/dataset').set(auth('otherOwner'));
    expect(b.body.stores.find((s: any) => s.id === 'TB01').commission_rate).toBe(0.09);
  });
});

describe('角色权限', () => {
  it('只读不能导入、不能生成简报；财务不能审核；只有老板能看审计', async () => {
    expect((await request(http).post('/api/v1/imports/expenses/validate').set(auth('viewer')).attach('file', Buffer.from('a'), 'a.csv')).status).toBe(403);
    expect((await request(http).post('/api/v1/briefings').set(auth('viewer')).send({ month: '2026-10' })).status).toBe(403);
    expect((await request(http).post('/api/v1/briefings/00000000-0000-0000-0000-000000000000/approve').set(auth('finance')).send({ version: 1 })).status).toBe(403);
    expect((await request(http).get('/api/v1/audit').set(auth('finance'))).status).toBe(403);
    expect((await request(http).get('/api/v1/audit').set(auth('owner'))).status).toBe(200);
  });
});

describe('数据导入', () => {
  const header = '费用单号,日期,费用类别,店铺,供应商,金额,发票号\n';
  it('校验通过后写库并重算，留导入记录与审计', async () => {
    const before = await request(http).get('/api/v1/dataset/summary').set(auth('finance'));
    const csv = '﻿' + header + 'EXP-T-1,2026-10-20,办公费,,测试供应商,1000,FP-T-1\n';
    const v = await request(http).post('/api/v1/imports/expenses/validate').set(auth('finance')).attach('file', Buffer.from(csv), '费用.csv');
    expect(v.status).toBe(201);
    expect(v.body).toMatchObject({ ok: true, stats: { valid: 1 } });
    expect(v.body.patch).toBeUndefined();
    const c = await request(http).post('/api/v1/imports/expenses/commit').set(auth('finance')).field('mode', 'append').attach('file', Buffer.from(csv), '费用.csv');
    expect(c.status).toBe(201);
    expect(c.body.written).toBe(1);
    const after = await request(http).get('/api/v1/dataset/summary').set(auth('finance'));
    expect(after.body.kpis['2026-10'].netProfit).toBeCloseTo(before.body.kpis['2026-10'].netProfit - 1000, 1);
    const batches = await request(http).get('/api/v1/imports').set(auth('finance'));
    expect(batches.body[0]).toMatchObject({ tableId: 'expenses', status: 'committed', fileName: '费用.csv' });
    // 其他租户看不到这条费用
    const other = await request(http).get('/api/v1/dataset').set(auth('otherOwner'));
    expect(other.body.expenses.some((e: any) => e.id === 'EXP-T-1')).toBe(false);
  });
  it('有错误的文件整份拒绝，不写入任何数据', async () => {
    const csv = header + 'EXP-T-2,2026-10-21,办公费,,x,abc,\nEXP-T-3,2026-13-40,办公费,,x,10,\n';
    const c = await request(http).post('/api/v1/imports/expenses/commit').set(auth('finance')).field('mode', 'append').attach('file', Buffer.from(csv), 'bad.csv');
    expect(c.status).toBe(422);
    expect(c.body.errorCount).toBeGreaterThanOrEqual(2);
    const ds = await request(http).get('/api/v1/dataset').set(auth('finance'));
    expect(ds.body.expenses.some((e: any) => e.id === 'EXP-T-2' || e.id === 'EXP-T-3')).toBe(false);
  });
  it('拒绝旧版 .xls', async () => {
    const r = await request(http).post('/api/v1/imports/expenses/validate').set(auth('finance')).attach('file', Buffer.from('x'), 'a.xls');
    expect(r.status).toBe(400);
  });
});

describe('经营简报：AI 草稿 → 修改 → 审核 → 通知', () => {
  let id = '';
  it('生成草稿：数字来自核算，记录模型调用', async () => {
    const r = await request(http).post('/api/v1/briefings').set(auth('finance')).send({ month: '2026-10' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'DRAFT', version: 1, modelIsMock: true, unverified: [] });
    id = r.body.id;
    expect(r.body.aiCalls).toHaveLength(1);
    expect(r.body.facts.facts.find((f: any) => f.key === 'netProfit').value).toBeGreaterThan(0);
  });
  it('其他租户读不到、改不了这份简报', async () => {
    expect((await request(http).get(`/api/v1/briefings/${id}`).set(auth('otherOwner'))).status).toBe(404);
    expect((await request(http).post(`/api/v1/briefings/${id}/approve`).set(auth('otherOwner')).send({ version: 1 })).status).toBe(404);
  });
  it('人工修改生成新版本，并标出对不上的数字', async () => {
    const cur = (await request(http).get(`/api/v1/briefings/${id}`).set(auth('finance'))).body;
    const draft = { ...cur.draft, highlights: [...cur.draft.highlights, '预计下月净利润 888888.88 元'] };
    const r = await request(http).patch(`/api/v1/briefings/${id}`).set(auth('finance')).send({ draft });
    expect(r.body).toMatchObject({ version: 2, status: 'DRAFT' });
    expect(r.body.unverified).toContain('888888.88');
    expect(r.body.versions.map((v: any) => v.source)).toEqual(['human', 'ai']);
  });
  it('格式不对的修改被拒绝', async () => {
    const r = await request(http).patch(`/api/v1/briefings/${id}`).set(auth('finance')).send({ draft: { headline: '' } });
    expect(r.status).toBe(400);
  });
  it('未提交不能审核；提交后不能再改', async () => {
    expect((await request(http).post(`/api/v1/briefings/${id}/approve`).set(auth('owner')).send({ version: 2 })).status).toBe(409);
    expect((await request(http).post(`/api/v1/briefings/${id}/submit`).set(auth('finance'))).body.status).toBe('SUBMITTED');
    const cur = (await request(http).get(`/api/v1/briefings/${id}`).set(auth('finance'))).body;
    expect((await request(http).patch(`/api/v1/briefings/${id}`).set(auth('finance')).send({ draft: cur.draft })).status).toBe(409);
  });
  it('审核旧版本号被拒（防止批准没看过的内容）', async () => {
    expect((await request(http).post(`/api/v1/briefings/${id}/approve`).set(auth('owner')).send({ version: 1 })).status).toBe(409);
  });
  it('老板审核通过 → 记录审核人与版本 → 通过连接器发出一次通知', async () => {
    const r = await request(http).post(`/api/v1/briefings/${id}/approve`).set(auth('owner')).send({ version: 2, comment: '可以发' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'APPROVED', approvedVersion: 2, reviewComment: '可以发' });
    expect(r.body.notifications).toHaveLength(1);
    expect(r.body.notifications[0]).toMatchObject({ status: 'sent', isMock: true, provider: 'mock' });
    expect(ctx.connector.sent).toHaveLength(1);
    expect(ctx.connector.sent[0].input.markdown).toContain('已由 老板（演示） 审核');
    expect(ctx.connector.sent[0].input.idempotencyKey).toBe(`briefing:${id}:v2`);
  });
  it('重复触发通知是幂等的，不会重复发送', async () => {
    await request(http).post(`/api/v1/briefings/${id}/notify`).set(auth('owner'));
    expect(ctx.connector.sent).toHaveLength(1);
  });
  it('审计记录完整', async () => {
    const r = await request(http).get('/api/v1/audit?limit=200').set(auth('owner'));
    const actions = r.body.filter((e: any) => e.targetId === id || e.action.startsWith('notification')).map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['briefing.generated', 'briefing.edited', 'briefing.submitted', 'briefing.approved', 'notification.sent']));
    expect(r.body.every((e: any) => e.tenantId === r.body[0].tenantId)).toBe(true);
  });
});

describe('失败路径', () => {
  it('模型输出不合格：重试后仍失败 → FAILED，可重新生成', async () => {
    ctx.model.setBehavior('invalid_json');
    const r = await request(http).post('/api/v1/briefings').set(auth('finance')).send({ month: '2026-09' });
    expect(r.body.status).toBe('FAILED');
    expect(r.body.aiCalls.filter((a: any) => !a.ok)).toHaveLength(2);
    ctx.model.setBehavior('ok');
    const r2 = await request(http).post(`/api/v1/briefings/${r.body.id}/regenerate`).set(auth('finance'));
    expect(r2.body).toMatchObject({ status: 'DRAFT', version: 1 });
  });
  it('通知失败不影响审核结果，可重试成功', async () => {
    const b = (await request(http).get('/api/v1/briefings').set(auth('finance'))).body.find((x: any) => x.month === '2026-09');
    await request(http).post(`/api/v1/briefings/${b.id}/submit`).set(auth('finance'));
    ctx.connector.failNext = 3;
    const r = await request(http).post(`/api/v1/briefings/${b.id}/approve`).set(auth('owner')).send({ version: 1 });
    expect(r.body.status).toBe('APPROVED');
    expect(r.body.notifications[0]).toMatchObject({ status: 'failed', attempts: 3 });
    const retry = await request(http).post(`/api/v1/briefings/${b.id}/notify`).set(auth('owner'));
    expect(retry.body).toMatchObject({ status: 'sent', attempts: 4 });
  });
  it('超出数据范围的账期 400', async () => {
    expect((await request(http).post('/api/v1/briefings').set(auth('finance')).send({ month: '2030-01' })).status).toBe(400);
  });
});
