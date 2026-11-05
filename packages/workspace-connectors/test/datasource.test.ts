import { DATA_CAPABILITY_MATRIX, DingTalkConnector, extractText, FeishuConnector, MockConnector, WecomConnector } from '../src';

/** 记录请求的假 fetch：按 URL 片段返回固定 JSON */
function fakeApi(routes: [string, any, number?][]) {
  const calls: { url: string; method: string; headers: any; body: any }[] = [];
  const f = (async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const hit = routes.find(([k]) => u.includes(k));
    const status = hit?.[2] ?? (hit ? 200 : 404);
    return { ok: status < 400, status, json: async () => (hit ? hit[1] : { code: 'NotFound' }) } as any;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const TOKEN: [string, any] = ['/v1.0/oauth2/accessToken', { accessToken: 'AT1', expireIn: 7200 }];
const mk = (f: typeof fetch) => new DingTalkConnector({ notifyChannel: 'robot', robotAccessToken: 'x', robotSecret: 'y', appKey: 'ak', appSecret: 'as', fetchImpl: f });
const op = { unionId: 'UN1' };

describe('钉钉 AI 表格（已实现未联调）', () => {
  it('解析表格链接（sheetId 在参数或 iframeQuery 里）', () => {
    const c = mk(fakeApi([]).f);
    expect(c.parseTableLink('https://alidocs.dingtalk.com/i/nodes/AbCdEf123456?utm=x')).toEqual({ baseId: 'AbCdEf123456', sheetId: undefined });
    expect(c.parseTableLink('https://alidocs.dingtalk.com/i/nodes/AbCdEf123456?iframeQuery=sheetId%3Dst1%26viewId%3Dv1').sheetId).toBe('st1');
    expect(() => c.parseTableLink('https://example.com/i/nodes/AbCdEf123456')).toThrow(/不是钉钉/);
  });
  it('读字段与分页读记录：带 token 头和操作人 unionId', async () => {
    const { f, calls } = fakeApi([TOKEN,
      ['/fields', { value: [{ id: 'f1', name: '订单号', type: 'text' }] }],
      ['/records/list', { hasMore: true, nextToken: 'n2', records: [{ id: 'r1', fields: { 订单号: 'A' } }] }]]);
    const c = mk(f);
    const ref = { baseId: 'B1', sheetId: 'S1' };
    expect(await c.listFields(ref, op)).toEqual([{ id: 'f1', name: '订单号', type: 'text' }]);
    const page = await c.listRecords(ref, op);
    expect(page).toEqual({ items: [{ id: 'r1', fields: { 订单号: 'A' } }], nextPageToken: 'n2' });
    const rec = calls.find((x) => x.url.includes('/records/list'))!;
    expect(rec.url).toContain('/v1.0/notable/bases/B1/sheets/S1/records/list?operatorId=UN1');
    expect(rec.headers['x-acs-dingtalk-access-token']).toBe('AT1');
    expect(rec.body).toEqual({ maxResults: 100 });
  });
  it('建模板表：单选带选项、日期带格式', async () => {
    const { f, calls } = fakeApi([TOKEN, ['/sheets?operatorId', { id: 'S9', name: '订单明细' }]]);
    const s = await mk(f).createSheet({ baseId: 'B1' }, { name: '订单明细', fields: [{ name: '状态', type: 'singleSelect', options: ['paid'] }, { name: '日期', type: 'date' }, { name: '金额', type: 'number' }] }, op);
    expect(s).toEqual({ sheetId: 'S9', name: '订单明细' });
    expect(calls.at(-1)!.body.fields).toEqual([
      { name: '状态', type: 'singleSelect', property: { choices: [{ name: 'paid' }] } },
      { name: '日期', type: 'date', property: { formatter: 'YYYY-MM-DD' } },
      { name: '金额', type: 'number' }
    ]);
  });
  it('没有 unionId 时不调用平台', async () => {
    const { f, calls } = fakeApi([TOKEN]);
    await expect(mk(f).listFields({ baseId: 'B', sheetId: 'S' }, {})).rejects.toThrow(/unionId/);
    expect(calls.filter((c) => c.url.includes('notable'))).toHaveLength(0);
  });
  it('403 给出权限提示', async () => {
    const { f } = fakeApi([TOKEN, ['/fields', { code: 'Forbidden.AccessDenied', message: 'no' }, 403]]);
    await expect(mk(f).listFields({ baseId: 'B', sheetId: 'S' }, op)).rejects.toThrow(/没有权限/);
  });
});

describe('钉钉知识库（已实现未联调）', () => {
  it('从知识库链接取根目录再列子节点', async () => {
    const { f, calls } = fakeApi([TOKEN,
      ['/v2.0/wiki/workspaces/Wk12345', { workspace: { rootNodeId: 'R1' } }],
      ['/v2.0/wiki/nodes?', { nodes: [{ nodeId: 'n1', name: '规则', type: 'FOLDER' }, { nodeId: 'n2', name: '费率', type: 'FILE', category: 'DOCUMENT', url: 'u2' }] }]]);
    const c = mk(f);
    const ref = c.parseKnowledgeLink('https://alidocs.dingtalk.com/i/spaces/Wk12345/overview');
    const p = await c.listKnowledgeNodes(ref, op);
    expect(p.items.map((n) => [n.name, n.kind])).toEqual([['规则', 'folder'], ['费率', 'doc']]);
    expect(calls.at(-1)!.url).toContain('parentNodeId=R1');
  });
  it('正文：从块结构里取文字；非文档不读', async () => {
    const { f } = fakeApi([TOKEN, ['/blocks', { result: { data: [{ paragraph: { text: '佣金 5%' } }, { heading: { text: '提成' } }] } }]]);
    const c = mk(f);
    expect(await c.getDocText({ nodeId: 'n2', name: 'x', kind: 'doc' }, op)).toBe('佣金 5%\n提成');
    expect(await c.getDocText({ nodeId: 'n3', name: 'x', kind: 'file' }, op)).toBe('');
    expect(extractText({ a: [{ text: 'x' }, { b: { content: 'y' } }] })).toBe('x\ny');
  });
});

describe('数据源能力矩阵', () => {
  it('钉钉实现与矩阵一致', () => {
    const c = mk(fakeApi([]).f).dataCapabilities();
    for (const [k, v] of Object.entries(DATA_CAPABILITY_MATRIX.dingtalk)) expect((c as any)[k]).toBe(v === 'implemented' || v === 'implemented_unverified');
  });
  it('飞书/企微：调用即报“暂不支持”；企微标注平台限制', async () => {
    for (const c of [new FeishuConnector(), new WecomConnector()]) {
      expect(Object.values(c.dataCapabilities()).every((v) => v === false)).toBe(true);
      await expect(c.listRecords()).rejects.toThrow(/暂不支持/);
    }
    expect(DATA_CAPABILITY_MATRIX.wecom.readUserCreatedTables).toBe('platform_limited');
  });
  it('模拟数据源：分页、建表、知识库，均标记模拟', async () => {
    const m = new MockConnector();
    m.pageSize = 1;
    const ref = { baseId: 'demo-expense', sheetId: 'sheet1' };
    const p1 = await m.listRecords(ref, op);
    expect(p1.items).toHaveLength(1);
    expect((await m.listRecords(ref, op, p1.nextPageToken)).nextPageToken).toBeUndefined();
    const s = await m.createSheet({ baseId: 'new' }, { name: '费用支出', fields: [{ name: '日期', type: 'date' }] }, op);
    expect((await m.listFields({ baseId: 'new', sheetId: s.sheetId }, op))[0].name).toBe('日期');
    const root = await m.listKnowledgeNodes({ workspaceId: 'demo-kb' }, op);
    expect(root.items.map((n) => n.name)).toEqual(['财务规则', '报销操作手册']);
    expect(m.isMock).toBe(true);
  });
});
