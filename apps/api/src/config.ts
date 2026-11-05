import { z } from 'zod';

/** 环境变量校验：缺关键配置时启动即失败，不带默认密钥上线 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET 至少 16 位，生产环境用密钥管理注入'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  WEB_DIR: z.string().optional(),
  MODEL_PROVIDER: z.string().default('mock'),
  CONNECTOR_PROVIDER: z.string().default('mock'),
  /** 审核通过后通知谁：robot 模式发群；work_notice 模式发给这些角色里已绑定钉钉的员工 */
  NOTIFY_ROLES: z.string().default('OWNER,FINANCE'),
  /** 钉钉企业 CorpId（非密钥）：工作台 H5 微应用前端免登时需要 */
  DINGTALK_CORP_ID: z.string().optional(),
  /** 钉钉 AppKey（即 clientId，非密钥；AppSecret 只由连接器读取） */
  DINGTALK_APP_KEY: z.string().optional(),
  /** 钉钉 JSAPI 脚本地址（版本以钉钉官方文档为准） */
  /** 数据源定时同步：on（默认，测试环境自动关闭）| off */
  SOURCE_SYNC_SCHEDULER: z.enum(['on', 'off']).default('on'),
  DINGTALK_JSAPI_URL: z.string().default('https://g.alicdn.com/dingding/dingtalk-jsapi/2.10.3/dingtalk.open.js')
});
export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const r = EnvSchema.safeParse(env);
  if (!r.success) {
    throw new Error('环境变量配置错误：' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'));
  }
  if (r.data.NODE_ENV === 'production' && (r.data.MODEL_PROVIDER === 'mock' || r.data.CONNECTOR_PROVIDER === 'mock')) {
    // 生产环境允许启动，但在 /health 与界面中明确显示为“模拟”，不得对外宣称已接通
    // eslint-disable-next-line no-console
    console.warn('[warn] 生产环境仍在使用模拟模型或模拟连接器');
  }
  return r.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');
export const WORKSPACE_CONNECTOR = Symbol('WORKSPACE_CONNECTOR');
/** 平台智能表/知识库读取（与当前连接器同一平台） */
export const DATA_SOURCE = Symbol('DATA_SOURCE');
