/**
 * 飞书、企业微信：本期只保留接口和能力矩阵，不实现任何调用。
 * capabilities() 全部返回 false，所有方法抛 NotSupportedError，避免被误当作“已接通”。
 * 计划能力见 PLANNED_CAPABILITIES 与 docs/连接器能力矩阵.md。
 */
import { Capabilities, NotSupportedError, ProviderId, WorkspaceConnector } from './types';

const NONE: Capabilities = { login: false, appEntry: false, sendNotification: false, receiveEvents: false, nativeApproval: false };

abstract class PlannedConnector implements WorkspaceConnector {
  abstract readonly provider: ProviderId;
  readonly isMock = false;
  capabilities(): Capabilities { return { ...NONE }; }
  async verifyAndNormalizeEvent(): Promise<never> { throw new NotSupportedError(this.provider, 'receiveEvents'); }
  async resolveIdentity(): Promise<never> { throw new NotSupportedError(this.provider, 'login'); }
  async sendNotification(): Promise<never> { throw new NotSupportedError(this.provider, 'sendNotification'); }
  async buildAppEntry(): Promise<never> { throw new NotSupportedError(this.provider, 'appEntry'); }
}

export class FeishuConnector extends PlannedConnector { readonly provider = 'feishu' as const; }
export class WecomConnector extends PlannedConnector { readonly provider = 'wecom' as const; }
