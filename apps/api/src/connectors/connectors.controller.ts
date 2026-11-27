import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CAPABILITY_MATRIX, DATA_CAPABILITY_MATRIX } from '@efa/workspace-connectors';
import type { WorkspaceConnector } from '@efa/workspace-connectors';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { parseBody } from '../common/zod';
import { WORKSPACE_CONNECTOR } from '../config';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';

const BindBody = z.object({ userId: z.string().uuid(), externalUserId: z.string().min(1).max(128), unionId: z.string().min(1).max(128).optional() }).strict();

@Controller('connectors')
export class ConnectorsController {
  constructor(@Inject(WORKSPACE_CONNECTOR) private readonly connector: WorkspaceConnector, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** 当前启用的连接器、是否模拟、能力与三平台能力矩阵 */
  @Get() @RequirePermission('report:read')
  info() {
    return { active: { provider: this.connector.provider, isMock: this.connector.isMock, capabilities: this.connector.capabilities() }, matrix: CAPABILITY_MATRIX, dataMatrix: DATA_CAPABILITY_MATRIX };
  }

  @Get('identities') @RequirePermission('connector:admin')
  identities(@CurrentUser() u: AuthUser) {
    return this.prisma.externalIdentity.findMany({ where: { tenantId: u.tenantId }, include: { user: { select: { id: true, displayName: true, role: true } } } });
  }

  /** 管理员手动绑定员工的平台账号（不读取平台通讯录） */
  @Post('identities') @RequirePermission('connector:admin')
  async bind(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: any) {
    const b = parseBody(BindBody, body);
    if (this.connector.provider === 'mock') throw new BadRequestException('当前是模拟连接器，无需绑定');
    const user = await this.prisma.user.findFirst({ where: { id: b.userId, tenantId: u.tenantId } });
    if (!user) throw new NotFoundException('用户不存在');
    const rec = await this.prisma.externalIdentity.upsert({
      where: { tenantId_provider_externalUserId: { tenantId: u.tenantId, provider: this.connector.provider, externalUserId: b.externalUserId } },
      update: { userId: user.id, ...(b.unionId ? { unionId: b.unionId } : {}) },
      create: { tenantId: u.tenantId, userId: user.id, provider: this.connector.provider, externalUserId: b.externalUserId, unionId: b.unionId }
    });
    await this.audit.record(u, 'connector.identity_bound', { type: 'user', id: user.id }, { provider: rec.provider }, undefined, req.ip);
    return rec;
  }

  @Delete('identities/:id') @RequirePermission('connector:admin')
  async unbind(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: any) {
    const r = await this.prisma.externalIdentity.deleteMany({ where: { id, tenantId: u.tenantId } });
    if (!r.count) throw new NotFoundException('绑定不存在');
    await this.audit.record(u, 'connector.identity_unbound', { type: 'identity', id }, undefined, undefined, req.ip);
    return { ok: true };
  }
}
