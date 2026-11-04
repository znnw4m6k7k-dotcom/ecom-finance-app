import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { parseBody } from '../common/zod';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { DatasetService } from './dataset.service';

const rate = z.number().min(0).max(1);
const SettingsBody = z.object({
  settings: z.object({
    commission_ladder: z.array(z.object({ min: z.number().min(0), max: z.number().positive().nullable(), rate })).min(1).max(10).optional(),
    default_basis: z.enum(['revenue', 'gross_profit']).optional(),
    slow_moving_days: z.number().int().min(1).max(365).optional()
  }).strict().default({}),
  stores: z.record(z.string(), z.object({
    commission_rate: rate.optional(), tech_fee_rate: rate.optional(), payment_fee_rate: rate.optional(), insurance_rate: rate.optional(),
    settlement_days: z.number().int().min(0).max(180).optional()
  }).strict()).default({})
}).strict();

@Controller('dataset')
export class DatasetController {
  constructor(private readonly ds: DatasetService, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** 前端渲染用的全量明细（本租户）。P0 由前端复用同一核算引擎做交互筛选 */
  @Get()
  @RequirePermission('report:read')
  async get(@CurrentUser() user: AuthUser) {
    const { dataset } = await this.ds.getModel(user.tenantId);
    return dataset;
  }

  /** 服务端核算结果摘要（KPI + 勾稽 + 预警），供通知、简报与对账核验使用 */
  @Get('summary')
  @RequirePermission('report:read')
  async summary(@CurrentUser() user: AuthUser) {
    const { model } = await this.ds.getModel(user.tenantId);
    return { months: model.months, kpis: model.kpis, checks: model.checks, alerts: model.alerts, total: model.total };
  }

  @Put('settings')
  @RequirePermission('settings:write')
  async saveSettings(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: any) {
    const input = parseBody(SettingsBody, body);
    if (input.settings.commission_ladder) {
      const l = [...input.settings.commission_ladder].sort((a, b) => a.min - b.min);
      input.settings.commission_ladder = l;
    }
    await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      const next = { ...(tenant.settings as object), ...input.settings };
      await tx.tenant.update({ where: { id: user.tenantId }, data: { settings: next as Prisma.InputJsonValue } });
      for (const [storeId, patch] of Object.entries(input.stores)) {
        // where 同时带 tenantId：不能改到其他租户的店铺
        await tx.store.updateMany({ where: { tenantId: user.tenantId, id: storeId }, data: patch });
      }
      await this.audit.record(user, 'settings.update', { type: 'tenant', id: user.tenantId }, { settings: input.settings, stores: input.stores }, tx, req.ip);
    });
    this.ds.invalidate(user.tenantId);
    return { ok: true };
  }
}
