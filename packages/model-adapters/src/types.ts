/** 模型适配层合同：业务代码只依赖 ModelProvider，不依赖任何具体厂商 SDK。 */
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface CompletionRequest {
  messages: ChatMessage[];
  /** 要求模型返回 JSON 对象（支持的厂商会传 response_format） */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface Usage { inputTokens: number; outputTokens: number }

export interface CompletionResult {
  text: string;
  usage: Usage;
  model: string;
  provider: string;
  latencyMs: number;
  /** 按配置单价估算的费用（元），未配置单价时为 null */
  costCny: number | null;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  /** 是否为模拟实现（Mock 不得被当作真实模型接入） */
  readonly isMock: boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export interface PriceTable { inputPer1k: number; outputPer1k: number }

export class ModelError extends Error {
  constructor(message: string, public readonly kind: 'timeout' | 'http' | 'network' | 'config' | 'empty', public readonly status?: number) {
    super(message);
  }
}

export function estimateCost(usage: Usage, price?: PriceTable | null): number | null {
  if (!price) return null;
  return Math.round(((usage.inputTokens / 1000) * price.inputPer1k + (usage.outputTokens / 1000) * price.outputPer1k) * 10000) / 10000;
}
