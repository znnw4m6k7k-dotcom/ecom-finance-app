import { MockModelProvider } from './mock';
import { OpenAICompatibleProvider } from './openai-compatible';
import { getPreset } from './presets';
import { ModelError, ModelProvider } from './types';

/**
 * 从环境变量创建模型：
 *   MODEL_PROVIDER=mock | deepseek | qwen | moonshot | zhipu | doubao | openai_compatible
 *   MODEL_BASE_URL（可覆盖预设）  MODEL_NAME  MODEL_API_KEY
 *   MODEL_PRICE_INPUT_PER_1K / MODEL_PRICE_OUTPUT_PER_1K（元 / 千 tokens，用于成本计量）
 */
export function createModelProviderFromEnv(env: Record<string, string | undefined> = process.env): ModelProvider {
  const id = (env.MODEL_PROVIDER || 'mock').trim();
  if (id === 'mock') return new MockModelProvider();
  const preset = getPreset(id);
  const baseUrl = env.MODEL_BASE_URL || preset?.baseUrl;
  if (!baseUrl) throw new ModelError(`MODEL_PROVIDER=${id} 需要配置 MODEL_BASE_URL`, 'config');
  const pin = Number(env.MODEL_PRICE_INPUT_PER_1K);
  const pout = Number(env.MODEL_PRICE_OUTPUT_PER_1K);
  return new OpenAICompatibleProvider({
    providerId: id,
    baseUrl,
    apiKey: env.MODEL_API_KEY || '',
    model: env.MODEL_NAME || preset?.exampleModel || '',
    supportsJsonMode: env.MODEL_JSON_MODE ? env.MODEL_JSON_MODE !== 'false' : preset?.supportsJsonMode ?? true,
    price: isFinite(pin) && isFinite(pout) && env.MODEL_PRICE_INPUT_PER_1K ? { inputPer1k: pin, outputPer1k: pout } : null,
    defaultTimeoutMs: Number(env.MODEL_TIMEOUT_MS) || 60000
  });
}
