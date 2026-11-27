import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_TEMPLATE_TABLES, KNOWLEDGE_MODES } from '@efa/domain';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { parseBody } from '../common/zod';
import { SourcesService } from './sources.service';

const link = z.string().trim().min(8).max(2000);
const interval = z.number().int().min(0).max(24 * 60).optional();
const InspectBody = z.object({ link }).strict();
const TableBody = z.object({ link, sheetId: z.string().max(200).optional(), tableId: z.string().max(40), name: z.string().max(100).optional(), syncIntervalMin: interval }).strict();
const TemplateBody = z.object({ link, tableIds: z.array(z.string().max(40)).min(1).max(11).default([...DEFAULT_TEMPLATE_TABLES]), syncIntervalMin: interval }).strict();
const KnowledgeBody = z.object({ link, mode: z.enum(KNOWLEDGE_MODES), name: z.string().max(100).optional(), syncIntervalMin: interval }).strict();
const MappingBody = z.object({ mapping: z.record(z.string().max(200), z.string().max(60).nullable()) }).strict();
const UpdateBody = z.object({ name: z.string().trim().min(1).max(100).optional(), active: z.boolean().optional(), syncIntervalMin: interval, knowledgeMode: z.enum(KNOWLEDGE_MODES).optional() }).strict();
const ResolveConflict = z.object({ action: z.enum(['accept', 'reject']) }).strict();
const ResolveDelete = z.object({ tableId: z.string().max(40), rowKey: z.string().max(200), action: z.enum(['delete', 'keep']) }).strict();

/**
 * 数据源：平台智能表 / 知识库 → 工作台（单向）。
 * 所有接口按登录用户的 tenantId 隔离；读平台数据时以“当前员工绑定的平台账号”为操作人，只能读到他本人在平台上能看到的内容。
 */
@Controller('sources')
export class SourcesController {
  constructor(private readonly svc: SourcesService) {}

  @Get('platform') @RequirePermission('source:admin')
  platform() { return this.svc.info(); }

  @Get() @RequirePermission('source:admin')
  list(@CurrentUser() u: AuthUser) { return this.svc.list(u); }

  @Get('conflicts') @RequirePermission('source:admin')
  conflicts(@CurrentUser() u: AuthUser, @Query('dataSourceId') id?: string) { return this.svc.conflicts(u, id); }

  @Post('conflicts/:id/resolve') @HttpCode(200) @RequirePermission('source:admin')
  resolveConflict(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown, @Req() req: any) {
    return this.svc.resolveConflict(u, id, parseBody(ResolveConflict, b).action, req.ip);
  }

  @Get('deletions') @RequirePermission('source:admin')
  deletions(@CurrentUser() u: AuthUser) { return this.svc.pendingDeletes(u); }

  @Post('deletions/resolve') @HttpCode(200) @RequirePermission('source:admin')
  resolveDelete(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: any) {
    const x = parseBody(ResolveDelete, b);
    return this.svc.resolveDelete(u, x.tableId, x.rowKey, x.action, req.ip);
  }

  @Get('knowledge/search') @RequirePermission('knowledge:search')
  search(@CurrentUser() u: AuthUser, @Query('q') q: string, @Req() req: any) { return this.svc.search(u, String(q || '').slice(0, 100), req.ip); }

  @Post('tables/inspect') @HttpCode(200) @RequirePermission('source:admin')
  inspect(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.svc.inspectTable(u, parseBody(InspectBody, b).link); }

  @Post('tables') @RequirePermission('source:admin')
  createTable(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: any) { return this.svc.createTableSource(u, parseBody(TableBody, b), req.ip); }

  @Post('templates') @RequirePermission('source:admin')
  templates(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: any) { return this.svc.createTemplates(u, parseBody(TemplateBody, b), req.ip); }

  @Post('knowledge') @RequirePermission('source:admin')
  createKnowledge(@CurrentUser() u: AuthUser, @Body() b: unknown, @Req() req: any) { return this.svc.createKnowledgeSource(u, parseBody(KnowledgeBody, b), req.ip); }

  @Get(':id') @RequirePermission('source:admin')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.detail(u, id); }

  @Patch(':id') @RequirePermission('source:admin')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown, @Req() req: any) { return this.svc.update(u, id, parseBody(UpdateBody, b), req.ip); }

  @Delete(':id') @RequirePermission('source:admin')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: any) { return this.svc.remove(u, id, req.ip); }

  @Patch(':id/mapping') @RequirePermission('source:admin')
  mapping(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown, @Req() req: any) { return this.svc.updateMapping(u, id, parseBody(MappingBody, b).mapping, req.ip); }

  @Post(':id/mapping/confirm') @HttpCode(200) @RequirePermission('source:admin')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: any) { return this.svc.confirmMapping(u, id, req.ip); }

  @Post(':id/preview') @HttpCode(200) @RequirePermission('source:admin')
  preview(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.preview(u, id); }

  @Post(':id/sync') @HttpCode(200) @RequirePermission('source:admin')
  async sync(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: any) {
    const d = await this.svc.detail(u, id);
    return d.kind === 'table' ? this.svc.syncTable(u, id, 'manual', req.ip) : this.svc.syncKnowledge(u, id, 'manual', req.ip);
  }
}
