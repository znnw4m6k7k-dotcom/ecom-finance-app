/**
 * 钉钉工作台免登 + 群机器人通知（钉钉接口用假的 fetch 模拟，不访问真实钉钉）
 */
import request from 'supertest';
import { DingTalkConnector } from '@efa/workspace-connectors';
import { bootTestApp } from './setup';

const calls: { url: string; body: any }[] = [];
const fakeFetch = (async (url: any, init: any) => {
  const u = String(url);
  calls.push({ url: u, body: JSON.parse(init.body) });
  let body: any = { errcode: 404 };
  if (u.includes('/v1.0/oauth2/accessToken')) body = { accessToken: 'AT', expireIn: 7200 };
  if (u.includes('/topapi/v2/user/getuserinfo')) body = init.body.includes('good-code') ? { errcode: 0, result: { userid: 'ding-owner', name: '老板' } } : { errcode: 0, result: { userid: 'ding-stranger' } };
  if (u.includes('/robot/send')) body = { errcode: 0, errmsg: 'ok' };
  return { ok: true, status: 200, json: async () => body } as any;
}) as unknown as typeof fetch;

let ctx: Awaited<ReturnType<typeof bootTestApp>>;
let http: any;
let ownerToken = '';

beforeAll(async () => {
  const connector = new DingTalkConnector({ notifyChannel: 'robot', robotAccessToken: 'fake', robotSecret: 'SECfake', appKey: 'fake-app-key', appSecret: 'fake-secret', fetchImpl: fakeFetch });
  ctx = await bootTestApp({ connector, env: { DINGTALK_CORP_ID: 'dingcorp-test', DINGTALK_APP_KEY: 'fake-app-key' } });
  http = ctx.app.getHttpServer();
  ownerToken = (await request(http).post('/api/v1/auth/login').send({ tenant: 'luye-demo', username: 'owner', password: 'owner-pass-1' })).body.token;
});
afterAll(async () => { await ctx?.app.close(); await ctx?.prisma.$disconnect(); });

it('前端免登配置只给非密钥信息', async () => {
  const r = await request(http).get('/api/v1/auth/dingtalk/config');
  expect(r.body).toMatchObject({ enabled: true, corpId: 'dingcorp-test', clientId: 'fake-app-key' });
  expect(JSON.stringify(r.body)).not.toContain('fake-secret');
});

it('未绑定的钉钉账号不能登录；老板绑定后可以免登', async () => {
  expect((await request(http).post('/api/v1/auth/dingtalk').send({ tenant: 'luye-demo', authCode: 'good-code' })).status).toBe(401);
  const me = (await request(http).get('/api/v1/auth/me').set({ authorization: `Bearer ${ownerToken}` })).body;
  const bind = await request(http).post('/api/v1/connectors/identities').set({ authorization: `Bearer ${ownerToken}` }).send({ userId: me.id, externalUserId: 'ding-owner' });
  expect(bind.status).toBe(201);
  const r = await request(http).post('/api/v1/auth/dingtalk').send({ tenant: 'luye-demo', authCode: 'good-code' });
  expect(r.status).toBe(200);
  expect(r.body.user).toMatchObject({ role: 'OWNER' });
  expect((await request(http).post('/api/v1/auth/dingtalk').send({ tenant: 'luye-demo', authCode: 'other-code' })).status).toBe(401);
  // 同一个钉钉账号在另一家公司没有绑定 → 拒绝
  expect((await request(http).post('/api/v1/auth/dingtalk').send({ tenant: 'other-demo', authCode: 'good-code' })).status).toBe(401);
});

it('审核通过后经钉钉群机器人发送（带加签），投递记录不标模拟', async () => {
  const auth = { authorization: `Bearer ${ownerToken}` };
  const g = await request(http).post('/api/v1/briefings').set(auth).send({ month: '2026-10' });
  await request(http).post(`/api/v1/briefings/${g.body.id}/submit`).set(auth);
  const a = await request(http).post(`/api/v1/briefings/${g.body.id}/approve`).set(auth).send({ version: g.body.version });
  expect(a.body.notifications[0]).toMatchObject({ provider: 'dingtalk', channel: 'robot', isMock: false, status: 'sent' });
  const send = calls.find((c) => c.url.includes('/robot/send'))!;
  expect(send.url).toMatch(/timestamp=\d+&sign=/);
  expect(send.body.msgtype).toBe('markdown');
});
