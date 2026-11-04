/**
 * 模拟连接器：只记录到内存，不发出任何外部请求。isMock = true，投递记录会标注“模拟”，不得说成已接通平台。
 */
import { Capabilities, ConnectorContext, DeliveryResult, EntryLinkInput, ExternalIdentity, InternalUserIdentity, NormalizedEvent, NotificationInput, NotSupportedError, WorkspaceConnector } from './types';

export class MockConnector implements WorkspaceConnector {
  readonly provider = 'mock' as const;
  readonly isMock = true;
  readonly sent: { input: NotificationInput; ctx: ConnectorContext }[] = [];
  failNext = 0;

  capabilities(): Capabilities {
    return { login: false, appEntry: true, sendNotification: true, receiveEvents: false, nativeApproval: false };
  }
  async verifyAndNormalizeEvent(_i: unknown, _c: ConnectorContext): Promise<NormalizedEvent> { throw new NotSupportedError('mock', 'receiveEvents'); }
  async resolveIdentity(_i: ExternalIdentity, _c: ConnectorContext): Promise<InternalUserIdentity> { throw new NotSupportedError('mock', 'login'); }
  async sendNotification(input: NotificationInput, ctx: ConnectorContext): Promise<DeliveryResult> {
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, provider: 'mock', channel: 'memory', isMock: true, error: '模拟投递失败', retryable: true };
    }
    this.sent.push({ input, ctx });
    return { ok: true, provider: 'mock', channel: 'memory', isMock: true, externalId: 'mock-' + this.sent.length };
  }
  async buildAppEntry(input: EntryLinkInput): Promise<string> { return input.url; }
}
