/**
 * 带重试与计量的调用包装：每一次尝试（成功或失败）都回调 onAttempt，由业务层写入数据库做成本与失败率统计。
 */
import { CompletionRequest, CompletionResult, ModelError, ModelProvider } from './types';

export interface AttemptRecord {
  attempt: number;
  ok: boolean;
  provider: string;
  model: string;
  isMock: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costCny: number | null;
  error?: string;
  errorKind?: string;
}

export interface RunOptions<T> {
  /** 解析/校验模型输出；返回 ok:false 视为本次失败并重试 */
  parse: (text: string) => { ok: true; value: T } | { ok: false; error: string };
  maxAttempts?: number;
  onAttempt?: (rec: AttemptRecord) => void | Promise<void>;
  /** 第二次起追加的纠错提示 */
  repairHint?: (error: string) => string;
}

export type RunResult<T> =
  | { ok: true; value: T; result: CompletionResult; attempts: number }
  | { ok: false; error: string; attempts: number };

export async function runStructured<T>(provider: ModelProvider, req: CompletionRequest, opts: RunOptions<T>): Promise<RunResult<T>> {
  const max = Math.max(1, opts.maxAttempts ?? 2);
  let lastError = '未知错误';
  let messages = req.messages;
  for (let attempt = 1; attempt <= max; attempt++) {
    const started = Date.now();
    try {
      const res = await provider.complete({ ...req, messages });
      const parsed = opts.parse(res.text);
      await opts.onAttempt?.({
        attempt, ok: parsed.ok, provider: res.provider, model: res.model, isMock: provider.isMock, latencyMs: res.latencyMs,
        inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costCny: res.costCny,
        error: parsed.ok ? undefined : parsed.error, errorKind: parsed.ok ? undefined : 'schema'
      });
      if (parsed.ok) return { ok: true, value: parsed.value, result: res, attempts: attempt };
      lastError = parsed.error;
      const hint = opts.repairHint ? opts.repairHint(parsed.error) : `上一次输出不合格：${parsed.error}。请只输出符合要求的 JSON 对象。`;
      messages = [...req.messages, { role: 'assistant', content: res.text.slice(0, 2000) }, { role: 'user', content: hint }];
    } catch (e) {
      const err = e as ModelError;
      lastError = err.message;
      await opts.onAttempt?.({
        attempt, ok: false, provider: provider.id, model: provider.model, isMock: provider.isMock, latencyMs: Date.now() - started,
        inputTokens: 0, outputTokens: 0, costCny: null, error: err.message, errorKind: err.kind ?? 'unknown'
      });
      if (err.kind === 'config') break; // 配置错误重试无意义
    }
  }
  return { ok: false, error: lastError, attempts: max };
}
