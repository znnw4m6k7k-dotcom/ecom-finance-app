/**
 * 钉钉连接器（P0 测试平台）。
 *
 * 状态：按钉钉开放平台公开文档实现，**尚未用真实企业应用联调**。
 * 联调前需要客户管理员在钉钉开放平台创建企业内部应用并授权，凭证只通过环境变量注入。
 *
 * 通知支持两种通道：
 *  - robot：群自定义机器人 Webhook + 加签（最快验证；消息进指定群）
 *  - work_notice：企业内部应用“工作通知”（发给指定员工；需要 AgentId 与通讯录 userid 授权范围）
 * 身份：H5 微应用免登，前端 JSAPI 取 authCode，后端换 userid（login 能力）。
 * 事件接收：P0 不做（钉钉推荐 Stream 模式，后续增量实现），receiveEvents = false。
 */
import { createHmac } from 'node:crypto';
import {
  Capabilities, ConnectorConfigError, ConnectorContext, DeliveryResult, EntryLinkInput, ExternalIdentity,
  InternalUserIdentity, NormalizedEvent, NotSupportedError, NotificationInput, WorkspaceConnector
} from './types';

export interface DingTalkConfig {
  notifyChannel: 'robot' | 'work_notice';
  /** 企业内部应用 AppKey / AppSecret（work_notice 与免登需要） */
  appKey?: string;
  appSecret?: string;
  agentId?: string;
  /** 群机器人 webhook 的 access_token 与加签密钥（robot 需要） */
  robotAccessToken?: string;
  robotSecret?: string;
  apiBase?: string; // 默认 https://api.dingtalk.com
  oapiBase?: string; // 默认 https://oapi.dingtalk.com
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** 钉钉群机器人加签：base64(HmacSHA256(secret, `${timestamp}\n${secret}`))，再 URL 编码 */
export function dingtalkRobotSign(timestamp: number, secret: string): string {
  const raw = createHmac('sha256', secret).update(`${timestamp}\n${secret}`, 'utf8').digest('base64');
  return encodeURIComponent(raw);
}

export class DingTalkConnector implements WorkspaceConnector {
  readonly provider = 'dingtalk' as const;
  readonly isMock = false;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly apiBase: string;
  private readonly oapiBase: string;

  constructor(private readonly cfg: DingTalkConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? Date.now;
    this.apiBase = (cfg.apiBase ?? 'https://api.dingtalk.com').replace(/\/+$/, '');
    this.oapiBase = (cfg.oapiBase ?? 'https://oapi.dingtalk.com').replace(/\/+$/, '');
    if (cfg.notifyChannel === 'robot' && (!cfg.robotAccessToken || !cfg.robotSecret)) {
      throw new ConnectorConfigError('钉钉群机器人模式需要 DINGTALK_ROBOT_ACCESS_TOKEN 与 DINGTALK_ROBOT_SECRET');
    }
    if (cfg.notifyChannel === 'work_notice' && (!cfg.appKey || !cfg.appSecret || !cfg.agentId)) {
      throw new ConnectorConfigError('钉钉工作通知模式需要 DINGTALK_APP_KEY、DINGTALK_APP_SECRET、DINGTALK_AGENT_ID');
    }
  }

  capabilities(): Capabilities {
    const hasApp = !!(this.cfg.appKey && this.cfg.appSecret);
    return { login: hasApp, appEntry: true, sendNotification: true, receiveEvents: false, nativeApproval: false };
  }

  async verifyAndNormalizeEvent(_input: unknown, _ctx: ConnectorContext): Promise<NormalizedEvent> {
    throw new NotSupportedError('dingtalk', 'receiveEvents', 'P0 不接收钉钉事件，后续用 Stream 模式实现');
  }

  private async postJson(url: string, body: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 10000);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(`钉钉接口 HTTP ${res.status}${json?.code ? '：' + json.code : ''}`);
        (err as any).retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      return json;
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const err = new Error('钉钉接口超时');
        (err as any).retryable = true;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 企业内部应用 accessToken（缓存到过期前 5 分钟） */
  async getAccessToken(): Promise<string> {
    if (!this.cfg.appKey || !this.cfg.appSecret) throw new ConnectorConfigError('未配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET');
    const t = this.now();
    if (this.token && this.token.expiresAt - 300_000 > t) return this.token.value;
    const json = await this.postJson(`${this.apiBase}/v1.0/oauth2/accessToken`, { appKey: this.cfg.appKey, appSecret: this.cfg.appSecret });
    if (!json?.accessToken) throw new Error('钉钉 accessToken 获取失败');
    this.token = { value: json.accessToken, expiresAt: t + Number(json.expireIn || 7200) * 1000 };
    return this.token.value;
  }

  async resolveIdentity(input: ExternalIdentity, _ctx: ConnectorContext): Promise<InternalUserIdentity> {
    if (!input.authCode) throw new Error('缺少钉钉免登 authCode');
    const token = await this.getAccessToken();
    const json = await this.postJson(`${this.oapiBase}/topapi/v2/user/getuserinfo?access_token=${encodeURIComponent(token)}`, { code: input.authCode });
    if (json?.errcode !== 0 || !json?.result?.userid) throw new Error(`钉钉免登失败：errcode=${json?.errcode ?? '?'}`);
    return { provider: 'dingtalk', externalUserId: String(json.result.userid), name: json.result.name, unionId: json.result.unionid };
  }

  async sendNotification(input: NotificationInput, _ctx: ConnectorContext): Promise<DeliveryResult> {
    const msg = { msgtype: 'markdown', markdown: { title: input.title.slice(0, 64), text: input.markdown } };
    try {
      if (this.cfg.notifyChannel === 'robot') {
        const ts = this.now();
        const url = `${this.oapiBase}/robot/send?access_token=${encodeURIComponent(this.cfg.robotAccessToken!)}&timestamp=${ts}&sign=${dingtalkRobotSign(ts, this.cfg.robotSecret!)}`;
        const json = await this.postJson(url, msg);
        if (json?.errcode !== 0) return { ok: false, provider: 'dingtalk', channel: 'robot', isMock: false, error: `钉钉机器人返回 errcode=${json?.errcode}：${json?.errmsg ?? ''}`, retryable: json?.errcode === 130101 };
        return { ok: true, provider: 'dingtalk', channel: 'robot', isMock: false };
      }
      if (!input.recipients.length) return { ok: false, provider: 'dingtalk', channel: 'work_notice', isMock: false, error: '没有可通知的钉钉用户（请先绑定员工钉钉账号）', retryable: false };
      const token = await this.getAccessToken();
      const json = await this.postJson(`${this.oapiBase}/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`, {
        agent_id: Number(this.cfg.agentId), userid_list: input.recipients.join(','), msg
      });
      if (json?.errcode !== 0) return { ok: false, provider: 'dingtalk', channel: 'work_notice', isMock: false, error: `钉钉工作通知返回 errcode=${json?.errcode}：${json?.errmsg ?? ''}`, retryable: false };
      return { ok: true, provider: 'dingtalk', channel: 'work_notice', isMock: false, externalId: String(json.task_id ?? '') };
    } catch (e) {
      return { ok: false, provider: 'dingtalk', channel: this.cfg.notifyChannel, isMock: false, error: (e as Error).message, retryable: (e as any).retryable ?? true };
    }
  }

  /** 在钉钉内打开系统页面的链接（工作台/消息中可点击） */
  async buildAppEntry(input: EntryLinkInput, _ctx: ConnectorContext): Promise<string> {
    return `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(input.url)}&pc_slide=false`;
  }
}
