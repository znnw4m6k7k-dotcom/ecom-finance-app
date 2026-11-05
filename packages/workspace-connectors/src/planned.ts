/**
 * 飞书、企业微信：本期只保留接口和能力矩阵，不实现任何调用。
 * capabilities() 全部返回 false，所有方法抛 NotSupportedError，避免被误当作“已接通”。
 * 计划能力见 PLANNED_CAPABILITIES 与 docs/连接器能力矩阵.md。
 */
import { Capabilities, DataCapabilities, NO_DATA_CAPABILITIES, NotSupportedError, PlatformDataSource, ProviderId, WorkspaceConnector } from './types';

const NONE: Capabilities = { login: false, appEntry: false, sendNotification: false, receiveEvents: false, nativeApproval: false };

abstract class PlannedConnector implements WorkspaceConnector, PlatformDataSource {
  abstract readonly provider: ProviderId;
  readonly isMock = false;
  capabilities(): Capabilities { return { ...NONE }; }
  dataCapabilities(): DataCapabilities { return { ...NO_DATA_CAPABILITIES }; }
  async verifyAndNormalizeEvent(): Promise<never> { throw new NotSupportedError(this.provider, 'receiveEvents'); }
  async resolveIdentity(): Promise<never> { throw new NotSupportedError(this.provider, 'login'); }
  async sendNotification(): Promise<never> { throw new NotSupportedError(this.provider, 'sendNotification'); }
  async buildAppEntry(): Promise<never> { throw new NotSupportedError(this.provider, 'appEntry'); }
  parseTableLink(): never { throw new NotSupportedError(this.provider, 'readTables'); }
  parseKnowledgeLink(): never { throw new NotSupportedError(this.provider, 'readKnowledge'); }
  async listSheets(): Promise<never> { throw new NotSupportedError(this.provider, 'readTables'); }
  async listFields(): Promise<never> { throw new NotSupportedError(this.provider, 'readTables'); }
  async listRecords(): Promise<never> { throw new NotSupportedError(this.provider, 'readTables'); }
  async createSheet(): Promise<never> { throw new NotSupportedError(this.provider, 'createTables'); }
  async listKnowledgeNodes(): Promise<never> { throw new NotSupportedError(this.provider, 'readKnowledge'); }
  async getDocText(): Promise<never> { throw new NotSupportedError(this.provider, 'readDocText'); }
}

export class FeishuConnector extends PlannedConnector { readonly provider = 'feishu' as const; }
/** 企业微信文档接口只能读写应用自己创建的文档，员工在客户端自建的智能表读不到；知识库未找到开放接口 */
export class WecomConnector extends PlannedConnector { readonly provider = 'wecom' as const; }
