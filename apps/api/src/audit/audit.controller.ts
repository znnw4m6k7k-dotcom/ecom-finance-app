import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get() @RequirePermission('audit:read')
  list(@CurrentUser() u: AuthUser, @Query('limit') limit?: string) { return this.audit.list(u.tenantId, Number(limit) || 100); }
}
