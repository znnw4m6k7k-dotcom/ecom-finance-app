import { createHmac } from 'node:crypto';
import { CAPABILITY_MATRIX, createConnectorFromEnv, DingTalkConnector, dingtalkRobotSign, FeishuConnector, MockConnector, NotSupportedError, WecomConnector } from '../src';

function fakeFetch(responses: Record<string, any>) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, body: JSON.parse(init.body) });
    const key = Object.keys(responses).find((k) => u.includes(k));
    const body = key ? responses[key] : { errcode: 404 };
    return { ok: true, status: 200, json: async () => body } as any;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ctx = { tenantId: 't1' };
const note = { title: '简报', markdown: '### 简报', recipients: ['u1', 'u2'], idempotencyKey: 'k1' };

describe('钉钉群机器人', () => {
  it('加签算法：base64(HmacSHA256(secret, ts\\nsecret)) 再 URL 编码', () => {
    const ts = 1700000000000;
    const expected = encodeURIComponent(createHmac('sha256', 'SECfake').update(`${ts}\nSECfake`).digest('base64'));
    expect(dingtalkRobotSign(ts, 'SECfake')).toBe(expected);
  });
  it('发送 markdown 消息并带签名参数', async () => {
    const { f, calls } = fakeFetch({ '/robot/send': { errcode: 0, errmsg: 'ok' } });
    const c = new DingTalkConnector({ notifyChannel: 'robot', robotAccessToken: 'fake-token', robotSecret: 'SECfake', fetchImpl: f, now: () => 1700000000000 });
    const r = await c.sendNotification(note, ctx);
    expect(r).toMatchObject({ ok: true, channel: 'robot', isMock: false });
    expect(calls[0].url).toContain('https://oapi.dingtalk.com/robot/send?access_token=fake-token&timestamp=1700000000000&sign=');
    expect(calls[0].body).toEqual({ msgtype: 'markdown', markdown: { title: '简报', text: '### 简报' } });
  });
  it('平台返回错误码时标记失败', async () => {
    const { f } = fakeFetch({ '/robot/send': { errcode: 310000, errmsg: 'sign not match' } });
    const c = new DingTalkConnector({ notifyChannel: 'robot', robotAccessToken: 't', robotSecret: 's', fetchImpl: f });
    const r = await c.sendNotification(note, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('310000');
  });
  it('缺凭证时拒绝创建', () => {
    expect(() => new DingTalkConnector({ notifyChannel: 'robot' })).toThrow(/ROBOT/);
  });
});

describe('钉钉工作通知与免登', () => {
  const responses = {
    '/v1.0/oauth2/accessToken': { accessToken: 'AT1', expireIn: 7200 },
    '/asyncsend_v2': { errcode: 0, task_id: 123 },
    '/topapi/v2/user/getuserinfo': { errcode: 0, result: { userid: 'ding-u1', name: '张三', unionid: 'un1' } }
  };
  const mk = (f: typeof fetch) => new DingTalkConnector({ notifyChannel: 'work_notice', appKey: 'ak', appSecret: 'as', agentId: '42', fetchImpl: f });
  it('取 token（缓存）后发工作通知', async () => {
    const { f, calls } = fakeFetch(responses);
    const c = mk(f);
    expect((await c.sendNotification(note, ctx)).externalId).toBe('123');
    await c.sendNotification({ ...note, idempotencyKey: 'k2' }, ctx);
    expect(calls.filter((x) => x.url.includes('accessToken'))).toHaveLength(1);
    const send = calls.find((x) => x.url.includes('asyncsend_v2'))!;
    expect(send.url).toContain('access_token=AT1');
    expect(send.body).toMatchObject({ agent_id: 42, userid_list: 'u1,u2', msg: { msgtype: 'markdown' } });
  });
  it('没有收件人时不调用平台', async () => {
    const { f, calls } = fakeFetch(responses);
    const r = await mk(f).sendNotification({ ...note, recipients: [] }, ctx);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('免登 authCode 换 userid', async () => {
    const { f } = fakeFetch(responses);
    const id = await mk(f).resolveIdentity({ provider: 'dingtalk', authCode: 'code1' }, ctx);
    expect(id).toEqual({ provider: 'dingtalk', externalUserId: 'ding-u1', name: '张三', unionId: 'un1' });
  });
  it('事件接收本期未实现，明确报错', async () => {
    const { f } = fakeFetch(responses);
    await expect(mk(f).verifyAndNormalizeEvent({}, ctx)).rejects.toThrow(NotSupportedError);
  });
});

describe('能力矩阵与未实现平台', () => {
  it('飞书、企业微信只保留接口：能力全部为 false，调用即报“暂不支持”', async () => {
    for (const c of [new FeishuConnector(), new WecomConnector()]) {
      expect(Object.values(c.capabilities()).every((v) => v === false)).toBe(true);
      await expect(c.sendNotification()).rejects.toThrow(/暂不支持/);
    }
  });
  it('矩阵与钉钉实现一致', () => {
    const c = new DingTalkConnector({ notifyChannel: 'work_notice', appKey: 'a', appSecret: 'b', agentId: '1' }).capabilities();
    for (const [k, v] of Object.entries(CAPABILITY_MATRIX.dingtalk)) {
      expect((c as any)[k]).toBe(v === 'implemented' || v === 'implemented_unverified');
    }
  });
  it('默认是模拟连接器，并标记 isMock', () => {
    const c = createConnectorFromEnv({});
    expect(c).toBeInstanceOf(MockConnector);
    expect(c.isMock).toBe(true);
  });
});
