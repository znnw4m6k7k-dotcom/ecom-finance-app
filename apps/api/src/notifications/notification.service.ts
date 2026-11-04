import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WorkspaceConnector } from '@efa/workspace-connectors';
import { APP_CONFIG, AppConfig, WORKSPACE_CONNECTOR } from '../config';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';

const MAX_ATTEMPTS = 3;

/**
 * 通知投递：幂等（idempotencyKey 唯一）、有限次重试、每次结果可见（NotificationDelivery）。
 * 是否真的发到钉钉取决于 CONNECTOR_PROVIDER；mock 只记录，不对外发送。
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger('Notification');
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(WORKSPACE_CONNECTOR) private readonly connector: WorkspaceConnector,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig
  ) {}

  get info() {
    return { provider: this.connector.provider, isMock: this.connector.isMock, capabilities: this.connector.capabilities() };
  }

  /** 收件人：只用管理员手动绑定的平台账号，不读取通讯录 */
  async recipients(tenantId: string): Promise<string[]> {
    const roles = this.cfg.NOTIFY_ROLES.split(',').map((s) => s.trim()).filter(Boolean);
    const ids = await this.prisma.externalIdentity.findMany({
      where: { tenantId, provider: this.connector.provider, user: { active: true, role: { in: roles as any } } },
      select: { externalUserId: true }
    });
    return [...new Set(ids.map((x) => x.externalUserId))];
  }

  async send(params: { tenantId: string; briefingId?: string; idempotencyKey: string; title: string; markdown: string; actor?: { id: string; displayName: string } }) {
    const recipients = await this.recipients(params.tenantId);
    // 幂等：同一 key 已存在且已成功则直接返回；失败的可继续重试
    let delivery = await this.prisma.notificationDelivery.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
    if (delivery && delivery.tenantId !== params.tenantId) throw new Error('幂等键冲突');
    if (delivery?.status === 'sent') return delivery;
    if (!delivery) {
      delivery = await this.prisma.notificationDelivery.create({
        data: {
          tenantId: params.tenantId, briefingId: params.briefingId, provider: this.connector.provider, channel: 'pending',
          isMock: this.connector.isMock, idempotencyKey: params.idempotencyKey, recipients, title: params.title, status: 'pending'
        }
      }).catch(async (e) => {
        // 并发重复投递：唯一键冲突时读回已有记录
        const existing = await this.prisma.notificationDelivery.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
        if (existing) return existing;
        throw e;
      });
      if (delivery.status === 'sent') return delivery;
    }
    let attempts = delivery.attempts;
    let last: Awaited<ReturnType<WorkspaceConnector['sendNotification']>> | null = null;
    while (attempts < delivery.attempts + MAX_ATTEMPTS) {
      attempts++;
      try {
        last = await this.connector.sendNotification(
          { title: params.title, markdown: params.markdown, recipients, idempotencyKey: params.idempotencyKey },
          { tenantId: params.tenantId, traceId: delivery.id }
        );
      } catch (e) {
        last = { ok: false, provider: this.connector.provider, channel: 'unknown', isMock: this.connector.isMock, error: (e as Error).message, retryable: false };
      }
      if (last.ok || !last.retryable) break;
      await new Promise((r) => setTimeout(r, 200 * attempts));
    }
    const updated = await this.prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: last?.ok ? 'sent' : 'failed', attempts, channel: last?.channel ?? 'unknown', externalId: last?.externalId, error: last?.ok ? null : last?.error ?? '未知错误', recipients }
    });
    await this.audit.record(
      { tenantId: params.tenantId, id: params.actor?.id ?? null, displayName: params.actor?.displayName ?? '系统' },
      last?.ok ? 'notification.sent' : 'notification.failed',
      { type: 'notification', id: updated.id },
      { provider: updated.provider, channel: updated.channel, isMock: updated.isMock, attempts, error: updated.error, recipientCount: recipients.length }
    );
    if (!last?.ok) this.log.warn(`通知失败 ${updated.id}: ${updated.error}`);
    return updated;
  }
}
