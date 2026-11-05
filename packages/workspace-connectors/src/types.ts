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

// ---------------- 数据源：平台智能表 / 知识库（只读为主，建模板表需写权限） ----------------

/** 以哪个平台用户的身份读取（钉钉要求 operatorId=unionId；按该员工在平台上的可见范围返回） */
export interface Operator { unionId?: string; externalUserId?: string }

export interface DataCapabilities {
  readTables: boolean;
  createTables: boolean;
  readKnowledge: boolean;
  readDocText: boolean;
  /** 能否读员工自己在客户端建的表（企业微信只能读应用自己建的） */
  readUserCreatedTables: boolean;
}

export interface TableRef { baseId: string; sheetId?: string }
export interface SheetInfo { sheetId: string; name: string }
export interface PlatformField { id?: string; name: string; type: string }
export interface PlatformRecord { id: string; fields: Record<string, unknown> }
export interface Page<T> { items: T[]; nextPageToken?: string }

export interface TemplateFieldInput { name: string; type: 'text' | 'number' | 'date' | 'singleSelect'; options?: string[] }

export interface KnowledgeRef { workspaceId?: string; rootNodeId?: string }
export interface KnowledgeNode {
  nodeId: string;
  name: string;
  /** folder 有子节点；doc 可读正文；其余只同步标题 */
  kind: 'folder' | 'doc' | 'table' | 'file' | 'other';
  url?: string;
  updatedAt?: string;
  hasChildren?: boolean;
  /** 读正文用的文档 ID（钉钉 dentryUuid / docKey） */
  docId?: string;
}

/** 平台智能表 / 知识库读取合同。三家平台能力不同，以 dataCapabilities() 为准；不支持的抛 NotSupportedError */
export interface PlatformDataSource {
  readonly provider: ProviderId;
  readonly isMock: boolean;
  dataCapabilities(): DataCapabilities;
  parseTableLink(url: string): TableRef;
  parseKnowledgeLink(url: string): KnowledgeRef;
  listSheets(ref: TableRef, op: Operator): Promise<SheetInfo[]>;
  listFields(ref: TableRef, op: Operator): Promise<PlatformField[]>;
  listRecords(ref: TableRef, op: Operator, pageToken?: string): Promise<Page<PlatformRecord>>;
  /** 在已有的智能表文档里新建一张数据表（情况一：生成模板） */
  createSheet(ref: TableRef, input: { name: string; fields: TemplateFieldInput[] }, op: Operator): Promise<SheetInfo>;
  /** 列出知识库某节点下的子节点（parentNodeId 为空 = 根） */
  listKnowledgeNodes(ref: KnowledgeRef, op: Operator, parentNodeId?: string, pageToken?: string): Promise<Page<KnowledgeNode>>;
  getDocText(node: KnowledgeNode, op: Operator): Promise<string>;
}

export const NO_DATA_CAPABILITIES: DataCapabilities = { readTables: false, createTables: false, readKnowledge: false, readDocText: false, readUserCreatedTables: false };
