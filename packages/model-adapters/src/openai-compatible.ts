/**
 * OpenAI 兼容 Chat Completions 适配器。
 * 国内多家模型厂商提供 OpenAI 兼容接口（见 presets.ts），由客户公司自行选择厂商、模型和密钥。
 * 密钥只从环境变量 / 密钥管理读取，不写入代码、日志或数据库。
 */
import { CompletionRequest, CompletionResult, ModelError, ModelProvider, PriceTable, estimateCost } from './types';

export interface OpenAICompatibleConfig {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  price?: PriceTable | null;
  /** 部分厂商不支持 response_format，可关闭 */
  supportsJsonMode?: boolean;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly isMock = false;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: OpenAICompatibleConfig) {
    if (!cfg.baseUrl) throw new ModelError('未配置模型 baseUrl', 'config');
    if (!cfg.apiKey) throw new ModelError('未配置模型 API Key（请通过环境变量提供）', 'config');
    if (!cfg.model) throw new ModelError('未配置模型名称', 'config');
    this.id = cfg.providerId;
    this.model = cfg.model;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = this.cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 1200
    };
    if (req.json && this.cfg.supportsJsonMode !== false) body.response_format = { type: 'json_object' };
    const timeoutMs = req.timeoutMs ?? this.cfg.defaultTimeoutMs ?? 60000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === 'AbortError') throw new ModelError(`模型调用超时（${timeoutMs}ms）`, 'timeout');
      throw new ModelError('模型网络错误：' + (e as Error).message, 'network');
    }
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // 不回显响应体全文，避免把厂商返回的账户信息写进日志
      throw new ModelError(`模型接口返回 HTTP ${res.status}`, 'http', res.status);
    }
    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? '';
    if (!text) throw new ModelError('模型返回内容为空', 'empty');
    const usage = {
      inputTokens: Number(json?.usage?.prompt_tokens ?? 0),
      outputTokens: Number(json?.usage?.completion_tokens ?? 0)
    };
    return { text, usage, model: String(json?.model ?? this.cfg.model), provider: this.id, latencyMs, costCny: estimateCost(usage, this.cfg.price) };
  }
}
