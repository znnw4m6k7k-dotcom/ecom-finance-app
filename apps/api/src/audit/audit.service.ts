import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/auth';
import { PrismaService } from '../prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 记录审计事件。detail 中不得放密钥、密码、完整个人信息 */
  async record(
    actor: Pick<AuthUser, 'id' | 'tenantId' | 'displayName'> | { tenantId: string; id?: null; displayName?: string | null },
    action: string,
    target: { type?: string; id?: string } = {},
    detail?: Record<string, unknown>,
    tx: Tx = this.prisma,
    ip?: string
  ) {
    await tx.auditEvent.create({
      data: {
        tenantId: actor.tenantId, actorId: actor.id ?? null, actorName: actor.displayName ?? null, action,
        targetType: target.type, targetId: target.id, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined, ip
      }
    });
  }

  list(tenantId: string, limit = 100) {
    return this.prisma.auditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: Math.min(500, limit) });
  }
}
