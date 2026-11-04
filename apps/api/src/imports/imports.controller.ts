import { BadRequestException, Body, Controller, Get, Param, Post, Req, UnprocessableEntityException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { applyImport, IMPORT_TABLE_IDS, ImportPreparation, parseCsv, parseXlsx, prepareImport, tablesTouchedBy } from '@efa/domain';
import { AuthUser, CurrentUser, RequirePermission } from '../common/auth';
import { AuditService } from '../audit/audit.service';
import { DatasetService } from '../dataset/dataset.service';
import { PrismaService } from '../prisma.service';

const MAX_BYTES = 20 * 1024 * 1024;

async function parseUpload(file: Express.Multer.File | undefined) {
  if (!file) throw new BadRequestException('请上传文件（字段名 file）');
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8').toLowerCase();
  if (/\.xls$/.test(name)) throw new BadRequestException('不支持旧版 .xls，请另存为 .xlsx 或 CSV');
  if (/\.xlsx$/.test(name)) return parseXlsx(new Uint8Array(file.buffer));
  const text = file.buffer.toString('utf8').replace(/^﻿/, '');
  return parseCsv(text);
}

function summarize(p: ImportPreparation) {
  const { patch: _patch, ...rest } = p;
  return rest;
}

@Controller('imports')
export class ImportsController {
  constructor(private readonly prisma: PrismaService, private readonly ds: DatasetService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('report:read')
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.importBatch.findMany({
      where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, tableId: true, fileName: true, mode: true, status: true, rows: true, written: true, errorCount: true, createdAt: true, createdById: true }
    });
  }

  /** 只校验不写入 */
  @Post(':tableId/validate')
  @RequirePermission('data:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async validate(@CurrentUser() user: AuthUser, @Param('tableId') tableId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!IMPORT_TABLE_IDS.includes(tableId)) throw new BadRequestException('未知导入表：' + tableId);
    const parsed = await parseUpload(file);
    const { dataset } = await this.ds.getModel(user.tenantId);
    return summarize(prepareImport(tableId, parsed, dataset));
  }

  /** 服务端重新解析与校验后写入（不信任前端预览结果）；整个导入在一个事务里，失败不留半截数据 */
  @Post(':tableId/commit')
  @RequirePermission('data:import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async commit(@CurrentUser() user: AuthUser, @Param('tableId') tableId: string, @Body('mode') modeRaw: string, @Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    if (!IMPORT_TABLE_IDS.includes(tableId)) throw new BadRequestException('未知导入表：' + tableId);
    const mode = modeRaw === 'replace' ? 'replace' : 'append';
    const parsed = await parseUpload(file);
    const { dataset } = await this.ds.getModel(user.tenantId);
    const prep = prepareImport(tableId, parsed, dataset);
    const fileName = file ? Buffer.from(file.originalname, 'latin1').toString('utf8') : '';
    if (!prep.ok) {
      const b = await this.prisma.importBatch.create({
        data: { tenantId: user.tenantId, tableId, fileName, mode, status: 'rejected', rows: prep.stats.rows, written: 0, errorCount: prep.errorCount ?? prep.errors.length, errors: prep.errors.slice(0, 200) as Prisma.InputJsonValue, createdById: user.id }
      });
      await this.audit.record(user, 'import.rejected', { type: 'import', id: b.id }, { tableId, fileName, errorCount: b.errorCount }, undefined, req.ip);
      throw new UnprocessableEntityException({ message: '校验未通过，未写入任何数据', ...summarize(prep) });
    }
    const next = applyImport(dataset, prep.patch, mode);
    const touched = tablesTouchedBy(prep.patch);
    const batch = await this.prisma.$transaction(async (tx) => {
      for (const t of touched) await this.ds.replaceTable(tx, user.tenantId, t, (next as any)[t]);
      const b = await tx.importBatch.create({
        data: { tenantId: user.tenantId, tableId, fileName, mode, status: 'committed', rows: prep.stats.rows, written: prep.stats.outputRows ?? 0, errorCount: 0, errors: [], createdById: user.id }
      });
      await this.audit.record(user, 'import.committed', { type: 'import', id: b.id }, { tableId, fileName, mode, written: b.written, tables: touched }, tx, req.ip);
      return b;
    }, { timeout: 120000, maxWait: 10000 });
    this.ds.invalidate(user.tenantId);
    return { ok: true, batchId: batch.id, written: batch.written, warnings: prep.warnings };
  }
}
