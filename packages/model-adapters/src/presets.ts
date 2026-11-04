/**
 * 国内模型厂商的 OpenAI 兼容接口预设。
 * 仅为便于配置的默认值：上线前必须按厂商当前官方文档核对 baseUrl、模型名、计费和数据合规条款，
 * 由客户公司自行选择并与厂商签约；本仓库不内置任何密钥。
 */
export interface ProviderPreset { id: string; name: string; baseUrl: string; exampleModel: string; supportsJsonMode: boolean; docs: string }

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', exampleModel: 'deepseek-chat', supportsJsonMode: true, docs: 'https://api-docs.deepseek.com/' },
  { id: 'qwen', name: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', exampleModel: 'qwen-plus', supportsJsonMode: true, docs: 'https://help.aliyun.com/zh/model-studio/' },
  { id: 'moonshot', name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', exampleModel: 'moonshot-v1-8k', supportsJsonMode: true, docs: 'https://platform.moonshot.cn/docs' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', exampleModel: 'glm-4-plus', supportsJsonMode: true, docs: 'https://open.bigmodel.cn/dev/api' },
  { id: 'doubao', name: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', exampleModel: '<推理接入点 ID>', supportsJsonMode: false, docs: 'https://www.volcengine.com/docs/82379' }
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
