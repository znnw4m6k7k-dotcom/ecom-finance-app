import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { parseBody } from '../common/zod';
import { BriefingService } from './briefing.service';

const GenerateBody = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, '账期格式应为 YYYY-MM') }).strict();
const ApproveBody = z.object({ version: z.number().int().positive(), comment: z.string().max(500).optional() }).strict();
const RejectBody = z.object({ comment: z.string().min(2, '退回需要填写原因').max(500) }).strict();
const EditBody = z.object({ draft: z.unknown() }).strict();

@Controller('briefings')
export class BriefingController {
  constructor(private readonly svc: BriefingService) {}

  @Get() @RequirePermission('briefing:read')
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u); }

  @Get(':id') @RequirePermission('briefing:read')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.detail(u, id); }

  @Post() @RequirePermission('briefing:generate')
  generate(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: any) { return this.svc.generate(u, parseBody(GenerateBody, body).month, req.ip); }

  @Post(':id/regenerate') @RequirePermission('briefing:generate')
  regenerate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: any) { return this.svc.regenerate(u, id, req.ip); }

  @Patch(':id') @RequirePermission('briefing:edit')
  edit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) { return this.svc.edit(u, id, parseBody(EditBody, body).draft, req.ip); }

  @Post(':id/submit') @RequirePermission('briefing:submit')
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: any) { return this.svc.submit(u, id, req.ip); }

  @Post(':id/approve') @RequirePermission('briefing:approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const b = parseBody(ApproveBody, body);
    return this.svc.approve(u, id, b.version, b.comment, req.ip);
  }

  @Post(':id/reject') @RequirePermission('briefing:approve')
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) { return this.svc.reject(u, id, parseBody(RejectBody, body).comment, req.ip); }

  @Post(':id/notify') @RequirePermission('briefing:approve')
  notify(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.sendNotification(u, id); }
}
