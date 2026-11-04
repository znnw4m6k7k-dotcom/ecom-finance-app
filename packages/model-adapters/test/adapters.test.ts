import { createModelProviderFromEnv, MockModelProvider, ModelError, OpenAICompatibleProvider, PROVIDER_PRESETS, runStructured } from '../src';

function fakeFetch(handler: (url: string, init: any) => { status?: number; body: any } | Promise<never>) {
  const calls: { url: string; init: any }[] = [];
  const f = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as any;
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('OpenAI 兼容适配器', () => {
  it('发送标准请求、带 Bearer、返回用量与费用', async () => {
    const { f, calls } = fakeFetch(() => ({ body: { model: 'deepseek-chat', choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } } }));
    const p = new OpenAICompatibleProvider({ providerId: 'deepseek', baseUrl: 'https://example.test/v1/', apiKey: 'fake-key', model: 'deepseek-chat', price: { inputPer1k: 0.002, outputPer1k: 0.008 }, fetchImpl: f });
    const r = await p.complete({ messages: [{ role: 'user', content: 'hi' }], json: true });
    expect(calls[0].url).toBe('https://example.test/v1/chat/completions');
    expect(calls[0].init.headers.authorization).toBe('Bearer fake-key');
    expect(JSON.parse(calls[0].init.body).response_format).toEqual({ type: 'json_object' });
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
    expect(r.costCny).toBeCloseTo(0.006, 6);
  });
  it('HTTP 错误不回显响应体', async () => {
    const { f } = fakeFetch(() => ({ status: 401, body: { error: { message: 'secret account info' } } }));
    const p = new OpenAICompatibleProvider({ providerId: 'x', baseUrl: 'https://e.test', apiKey: 'k', model: 'm', fetchImpl: f });
    await expect(p.complete({ messages: [] })).rejects.toThrow(/HTTP 401$/);
  });
  it('超时报 timeout', async () => {
    const f = ((_u: any, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }))) as unknown as typeof fetch;
    const p = new OpenAICompatibleProvider({ providerId: 'x', baseUrl: 'https://e.test', apiKey: 'k', model: 'm', fetchImpl: f });
    await expect(p.complete({ messages: [], timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('缺少密钥直接报配置错误', () => {
    expect(() => new OpenAICompatibleProvider({ providerId: 'x', baseUrl: 'https://e.test', apiKey: '', model: 'm' })).toThrow(ModelError);
  });
});

describe('工厂与预设', () => {
  it('默认是模拟模型', () => {
    const p = createModelProviderFromEnv({});
    expect(p.isMock).toBe(true);
  });
  it('按预设创建国内模型（客户自选）', () => {
    const p = createModelProviderFromEnv({ MODEL_PROVIDER: 'qwen', MODEL_API_KEY: 'fake', MODEL_NAME: 'qwen-plus' });
    expect(p.isMock).toBe(false);
    expect(p.id).toBe('qwen');
    expect(PROVIDER_PRESETS.map((x) => x.id)).toEqual(expect.arrayContaining(['deepseek', 'qwen', 'moonshot', 'zhipu', 'doubao']));
  });
  it('未知厂商且无 baseUrl 报错', () => {
    expect(() => createModelProviderFromEnv({ MODEL_PROVIDER: 'nope', MODEL_API_KEY: 'k' })).toThrow(/MODEL_BASE_URL/);
  });
});

describe('结构化调用：重试与计量', () => {
  const parse = (t: string) => { try { return { ok: true as const, value: JSON.parse(t) }; } catch { return { ok: false as const, error: 'bad json' }; } };
  it('第一次输出不合格时带纠错提示重试，每次尝试都计量', async () => {
    let n = 0;
    const m = new MockModelProvider(() => (n++ === 0 ? 'invalid_json' : 'ok'));
    const attempts: any[] = [];
    const r = await runStructured(m, { messages: [{ role: 'user', content: '账期：2026-10' }] }, { parse, onAttempt: (a) => { attempts.push(a); } });
    expect(r.ok).toBe(true);
    expect(attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(m.calls[1].messages.at(-1)!.content).toMatch(/不合格/);
  });
  it('连续失败返回错误，不抛异常', async () => {
    const m = new MockModelProvider('timeout');
    const r = await runStructured(m, { messages: [] }, { parse, maxAttempts: 3 });
    expect(r).toMatchObject({ ok: false, attempts: 3 });
  });
});
