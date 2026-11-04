/**
 * 企业办公平台连接器统一合同（docs/总体方案.md §五）。
 * 统一的是“我们系统需要什么”，不是假设三家平台能力相同：每家能力以 capabilities() 和 docs/连接器能力矩阵.md 为准。
 */
export type ProviderId = 'dingtalk' | 'feishu' | 'wecom' | 'mock';

export interface Capabilities {
  login: boolean;
  appEntry: boolean;
  sendNotification: boolean;
  receiveEvents: boolean;
  nativeApproval: boolean;
}

export interface ConnectorContext {
  tenantId: string;
  /** 请求链路 ID，写进投递记录便于排查 */
  traceId?: string;
}

export interface ExternalIdentity { provider: ProviderId; authCode?: string; externalUserId?: string }
export interface InternalUserIdentity { provider: ProviderId; externalUserId: string; name?: string; unionId?: string }

export interface NotificationInput {
  title: string;
  markdown: string;
  /** 平台侧用户 ID（工作通知用）；群机器人模式忽略 */
  recipients: string[];
  /** 幂等键：同一键只投递一次（由业务层持久化去重） */
  idempotencyKey: string;
}

export interface DeliveryResult {
  ok: boolean;
  provider: ProviderId;
  channel: string;
  isMock: boolean;
  externalId?: string;
  error?: string;
  /** 平台错误是否值得重试 */
  retryable?: boolean;
}

export interface NormalizedEvent { provider: ProviderId; eventId: string; type: string; occurredAt: string; payload: Record<string, unknown> }

export interface EntryLinkInput { url: string }

export interface WorkspaceConnector {
  readonly provider: ProviderId;
  readonly isMock: boolean;
  capabilities(): Capabilities;
  verifyAndNormalizeEvent(input: unknown, context: ConnectorContext): Promise<NormalizedEvent>;
  resolveIdentity(input: ExternalIdentity, context: ConnectorContext): Promise<InternalUserIdentity>;
  sendNotification(input: NotificationInput, context: ConnectorContext): Promise<DeliveryResult>;
  buildAppEntry(input: EntryLinkInput, context: ConnectorContext): Promise<string>;
}

export class NotSupportedError extends Error {
  constructor(provider: ProviderId, capability: keyof Capabilities | string, reason = '本期未实现') {
    super(`${provider} 连接器暂不支持「${capability}」：${reason}`);
  }
}

export class ConnectorConfigError extends Error {}
