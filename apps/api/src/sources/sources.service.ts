import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyImport, buildMappingPrompt, getImportTemplate, checkMapping, DatasetTable, dropErrorRows, FieldMapping, IMPORT_TABLE_IDS, KNOWLEDGE_MAX_CHARS,
  KnowledgeMode, mergeSuggestions, parseMappingSuggestion, planSourceSync, prepareImport, Provenance, recordsToParsedTable,
  removeUnits, ruleSuggestMapping, snippetAround, stableStringify, tableShape, tablesTouchedBy, templateFieldsFor, Unit, unitsFrom, unitsToPatch
} from '@efa/domain';
import { ModelProvider, runStructured } from '@efa/model-adapters';
import type { KnowledgeNode, KnowledgeRef, Operator, PlatformDataSource, PlatformRecord, TableRef } from '@efa/workspace-connectors';
import { createHash } from 'node:crypto';
import { APP_CONFIG, AppConfig, DATA_SOURCE, MODEL_PROVIDER } from '../config';
import { AuthUser } from '../common/auth';
import { AuditService } from '../audit/audit.service';
import { DatasetService } from '../dataset/dataset.service';
import { fromDbRow, SPEC_BY_TABLE, toDbRow } from '../dataset/table-specs';
import { PrismaService } from '../prisma.service';

type Actor = AuthUser;
const MAX_RECORDS = 20000;
const MAX_KNOWLEDGE_NODES = 2000;
const PROVIDER_LABEL: Record<string, string> = { dingtalk: '钉钉', feishu: '飞书', wecom: '企业微信', mock: '模拟平台' };

@Injectable()
export class SourcesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Sources');
  private readonly running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ds: DatasetService,
    private readonly audit: AuditService,
    @Inject(DATA_SOURCE) private readonly platform: PlatformDataSource,
    @Inject(MODEL_PROVIDER) private readonly model: ModelProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig
  ) {}

  // ---------------- 定时同步 ----------------
  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test' || this.cfg.SOURCE_SYNC_SCHEDULER === 'off') return;
    this.timer = setInterval(() => { this.runDue().catch((e) => this.log.warn('定时同步出错：' + (e as Error).message)); }, 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** 到期的数据源按创建人身份同步；创建人停用则跳过 */
  async runDue(now = new Date()): Promise<string[]> {
    const list = await this.prisma.dataSource.findMany({ where: { active: true, syncIntervalMin: { gt: 0 }, provider: this.platform.provider } });
    const done: string[] = [];
    for (const s of list) {
      if (s.kind === 'table' && s.mappingStatus !== 'confirmed') continue;
      if (s.lastSyncAt && now.getTime() - s.lastSyncAt.getTime() < s.syncIntervalMin * 60_000) continue;
      const u = await this.prisma.user.findFirst({ where: { id: s.createdById, tenantId: s.tenantId, active: true } });
      if (!u) continue;
      const actor: Actor = { id: u.id, tenantId: u.tenantId, role: u.role as any, username: u.username, displayName: u.displayName };
      try {
        if (s.kind === 'table') await this.syncTable(actor, s.id, 'schedule');
        else await this.syncKnowledge(actor, s.id, 'schedule');
        done.push(s.id);
      } catch (e) { this.log.warn(`数据源 ${s.id} 定时同步失败：${(e as Error).message}`); }
    }
    return done;
  }

  // ---------------- 公共 ----------------
  info() {
    return { provider: this.platform.provider, providerLabel: PROVIDER_LABEL[this.platform.provider] ?? this.platform.provider, isMock: this.platform.isMock, capabilities: this.platform.dataCapabilities() };
  }

  private async getOwned(user: Actor, id: string, kind?: 'table' | 'knowledge') {
    const s = await this.prisma.dataSource.findFirst({ where: { id, tenantId: user.tenantId, ...(kind ? { kind } : {}) } });
    if (!s) throw new NotFoundException('数据源不存在');
    return s;
  }

  /** 读平台数据时的操作人：当前员工绑定的平台账号（unionId）。模拟平台不需要 */
  private async operator(user: Actor): Promise<Operator> {
    if (this.platform.isMock) return { unionId: 'mock-' + user.id };
    const ident = await this.prisma.externalIdentity.findFirst({ where: { tenantId: user.tenantId, userId: user.id, provider: this.platform.provider } });
    if (!ident) throw new BadRequestException(`你的账号还没绑定${PROVIDER_LABEL[this.platform.provider] ?? ''}账号：请先在${PROVIDER_LABEL[this.platform.provider] ?? '平台'}里打开工作台完成免登`);
    if (!ident.unionId) throw new BadRequestException('还没有记录你的平台 unionId：请在钉钉里重新打开一次工作台（免登时会自动记录）');
    return { unionId: ident.unionId, externalUserId: ident.externalUserId };
  }

  private wrap<T>(p: Promise<T>): Promise<T> {
    return p.catch((e) => {
      if (e instanceof BadRequestException || e instanceof NotFoundException || e instanceof ConflictException) throw e;
      throw new BadRequestException((e as Error).message);
    });
  }

  private requireCap(cap: 'readTables' | 'createTables' | 'readKnowledge') {
    if (!this.platform.dataCapabilities()[cap]) {
      throw new BadRequestException(`当前平台（${PROVIDER_LABEL[this.platform.provider] ?? this.platform.provider}）暂不支持这个操作，或还没配置应用凭证`);
    }
  }

  list(user: Actor) {
    return this.prisma.dataSource.findMany({ where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async detail(user: Actor, id: string) {
    const s = await this.getOwned(user, id);
    const [runs, openConflicts, pendingDeletes, docs] = await Promise.all([
      this.prisma.syncRun.findMany({ where: { tenantId: user.tenantId, dataSourceId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.syncConflict.count({ where: { tenantId: user.tenantId, dataSourceId: id, status: 'open' } }),
      this.prisma.sourceRow.count({ where: { tenantId: user.tenantId, dataSourceId: id, deletedAtSource: true } }),
      s.kind === 'knowledge' ? this.prisma.knowledgeDoc.count({ where: { tenantId: user.tenantId, dataSourceId: id, deletedAtSource: false } }) : Promise.resolve(0)
    ]);
    const fields = s.tableId ? templateFieldsFor(s.tableId).map((f) => ({ key: f.key, label: f.name, required: f.required })) : [];
    const check = s.tableId && s.mapping ? checkMapping(s.mapping as FieldMapping, s.tableId) : null;
    return { ...s, runs, openConflicts, pendingDeletes, docs, targetFields: fields, check };
  }

  // ---------------- 情况二：连接已有智能表 ----------------

  /** 粘贴链接后先列出表格里的数据表，让用户选 */
  async inspectTable(user: Actor, link: string) {
    this.requireCap('readTables');
    return this.wrap((async () => {
      const ref = this.platform.parseTableLink(link);
      const sheets = await this.platform.listSheets(ref, await this.operator(user));
      return { baseId: ref.baseId, sheetId: ref.sheetId ?? null, sheets };
    })());
  }

  async createTableSource(user: Actor, input: { link: string; sheetId?: string; tableId: string; name?: string; syncIntervalMin?: number }, ip?: string) {
    this.requireCap('readTables');
    if (!IMPORT_TABLE_IDS.includes(input.tableId)) throw new BadRequestException('未知业务表：' + input.tableId);
    const op = await this.operator(user);
    const { ref, fields, sample } = await this.wrap((async () => {
      const r = this.platform.parseTableLink(input.link);
      const ref: TableRef = { baseId: r.baseId, sheetId: input.sheetId || r.sheetId };
      if (!ref.sheetId) {
        const sheets = await this.platform.listSheets(ref, op);
        if (sheets.length !== 1) throw new BadRequestException('这个表格里有多张数据表，请先选择一张');
        ref.sheetId = sheets[0].sheetId;
      }
      const fields = await this.platform.listFields(ref, op);
      const sample = (await this.platform.listRecords(ref, op)).items.slice(0, 3);
      return { ref, fields, sample };
    })());
    const s = await this.prisma.dataSource.create({
      data: {
        tenantId: user.tenantId, kind: 'table', provider: this.platform.provider, isMock: this.platform.isMock,
        name: (input.name || '').trim() || `${PROVIDER_LABEL[this.platform.provider] ?? ''}表格 → ${templateLabel(input.tableId)}`,
        link: input.link, ref: ref as unknown as Prisma.InputJsonValue, tableId: input.tableId, syncIntervalMin: input.syncIntervalMin ?? 60, createdById: user.id
      }
    });
    const suggestion = await this.suggestMapping(user, s.id, input.tableId, fields.map((f) => f.name), sample);
    await this.prisma.dataSource.update({ where: { id: s.id }, data: { mapping: suggestion.mapping as Prisma.InputJsonValue, mappingBy: suggestion.by as Prisma.InputJsonValue, mappingStatus: 'draft' } });
    await this.audit.record(user, 'source.created', { type: 'data_source', id: s.id }, { kind: 'table', provider: s.provider, tableId: input.tableId, isMock: s.isMock, aiUsed: suggestion.aiUsed }, undefined, ip);
    return this.detail(user, s.id);
  }

  /** 规则先对；没对上的列交给 AI 给建议（草稿），AI 失败不影响，只是留空让人选 */
  private async suggestMapping(user: Actor, sourceId: string, tableId: string, fieldNames: string[], sample: PlatformRecord[]) {
    const rule = ruleSuggestMapping(fieldNames, tableId);
    const unmatched = fieldNames.filter((f) => !rule.mapping[f]);
    let ai: FieldMapping | null = null;
    if (unmatched.length) {
      const prompt = buildMappingPrompt(tableId, unmatched.map((name) => ({ name, samples: sample.map((r) => cellPreview(r.fields[name])).filter(Boolean) })));
      const res = await runStructured<FieldMapping>(this.model, { messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], json: true, temperature: 0, maxTokens: 800 }, {
        maxAttempts: 2,
        parse: (text) => { const r = parseMappingSuggestion(text, tableId, unmatched); return r.ok ? { ok: true, value: r.mapping } : r; },
        onAttempt: async (a) => {
          await this.prisma.aiCall.create({ data: {
            tenantId: user.tenantId, purpose: 'field_mapping', refId: sourceId, provider: a.provider, model: a.model, isMock: a.isMock, attempt: a.attempt, ok: a.ok,
            latencyMs: a.latencyMs, inputTokens: a.inputTokens, outputTokens: a.outputTokens, costCny: a.costCny ?? undefined, errorKind: a.errorKind, error: a.error?.slice(0, 500)
          } });
        }
      });
      if (res.ok) ai = res.value;
    }
    const merged = mergeSuggestions(rule, ai);
    return { ...merged, aiUsed: !!ai };
  }

  async updateMapping(user: Actor, id: string, mapping: FieldMapping, ip?: string) {
    const s = await this.getOwned(user, id, 'table');
    const prev = (s.mapping || {}) as FieldMapping;
    const by = { ...((s.mappingBy || {}) as Record<string, string>) };
    for (const col of Object.keys(prev)) if (!(col in mapping)) mapping[col] = prev[col];
    for (const [col, key] of Object.entries(mapping)) if ((prev[col] ?? null) !== (key ?? null)) by[col] = 'manual';
    const check = checkMapping(mapping, s.tableId!);
    if (check.unknown.length) throw new BadRequestException('未知字段：' + check.unknown.join('、'));
    await this.prisma.dataSource.update({ where: { id }, data: { mapping: mapping as Prisma.InputJsonValue, mappingBy: by as Prisma.InputJsonValue, mappingStatus: 'draft', mappingConfirmedAt: null, mappingConfirmedById: null } });
    await this.audit.record(user, 'source.mapping_updated', { type: 'data_source', id }, { mapping }, undefined, ip);
    return this.detail(user, id);
  }

  /** 财务确认字段对应后才能同步（AI 建议只是草稿） */
  async confirmMapping(user: Actor, id: string, ip?: string) {
    const s = await this.getOwned(user, id, 'table');
    const check = checkMapping((s.mapping || {}) as FieldMapping, s.tableId!);
    if (!check.ok) throw new BadRequestException('字段对应还不完整：' + [check.missing.length ? '缺少 ' + check.missing.join('、') : '', check.duplicates.length ? '重复 ' + check.duplicates.join('、') : ''].filter(Boolean).join('；'));
    await this.prisma.dataSource.update({ where: { id }, data: { mappingStatus: 'confirmed', mappingConfirmedAt: new Date(), mappingConfirmedById: user.id } });
    await this.audit.record(user, 'source.mapping_confirmed', { type: 'data_source', id }, { mapping: s.mapping, mappingBy: s.mappingBy }, undefined, ip);
    return this.detail(user, id);
  }

  // ---------------- 情况一：在平台生成模板表 ----------------

  /** 在客户已建好的空智能表文档里，为每张业务表新建一张数据表；字段名 = 系统字段，映射自动确认 */
  async createTemplates(user: Actor, input: { link: string; tableIds: string[]; syncIntervalMin?: number }, ip?: string) {
    this.requireCap('createTables');
    for (const t of input.tableIds) if (!IMPORT_TABLE_IDS.includes(t)) throw new BadRequestException('未知业务表：' + t);
    const op = await this.operator(user);
    const ref = await this.wrap(Promise.resolve().then(() => this.platform.parseTableLink(input.link)));
    const created: string[] = [];
    for (const tableId of input.tableIds) {
      const fields = templateFieldsFor(tableId);
      const sheet = await this.wrap(this.platform.createSheet({ baseId: ref.baseId }, { name: templateLabel(tableId), fields: fields.map(({ name, type, options }) => ({ name, type, options })) }, op));
      const mapping = Object.fromEntries(fields.map((f) => [f.name, f.key]));
      const by = Object.fromEntries(fields.map((f) => [f.name, 'template']));
      const s = await this.prisma.dataSource.create({
        data: {
          tenantId: user.tenantId, kind: 'table', provider: this.platform.provider, isMock: this.platform.isMock, name: `${templateLabel(tableId)}（模板）`,
          link: input.link, ref: { baseId: ref.baseId, sheetId: sheet.sheetId } as Prisma.InputJsonValue, tableId, fromTemplate: true,
          mapping: mapping as Prisma.InputJsonValue, mappingBy: by as Prisma.InputJsonValue, mappingStatus: 'confirmed', mappingConfirmedAt: new Date(), mappingConfirmedById: user.id,
          syncIntervalMin: input.syncIntervalMin ?? 60, createdById: user.id
        }
      });
      await this.audit.record(user, 'source.template_created', { type: 'data_source', id: s.id }, { tableId, provider: s.provider, sheetId: sheet.sheetId, isMock: s.isMock }, undefined, ip);
      created.push(s.id);
    }
    return { created };
  }

  // ---------------- 同步智能表 ----------------

  private async readAll(ref: TableRef, op: Operator): Promise<PlatformRecord[]> {
    const out: PlatformRecord[] = [];
    let token: string | undefined;
    do {
      const page = await this.platform.listRecords(ref, op, token);
      out.push(...page.items);
      token = page.nextPageToken;
      if (out.length > MAX_RECORDS) throw new BadRequestException(`表格超过 ${MAX_RECORDS} 行，本期不支持，请按月份拆分`);
    } while (token);
    return out;
  }

  /** 按数据库字段类型规范化后算指纹，避免“1”与 1、空日期写法不同被误判为冲突 */
  private hashUnit(tableId: string, u: Unit): string {
    const shape = tableShape(tableId);
    const norm = (table: DatasetTable, r: Record<string, any>) => fromDbRow(SPEC_BY_TABLE[table], toDbRow(SPEC_BY_TABLE[table], 'x', r));
    const main = norm(shape.main, u.main);
    const children = shape.child ? u.children.map((c) => norm(shape.child!.table, c)).map(stableStringify).sort() : [];
    return createHash('sha256').update(stableStringify({ main, children })).digest('hex').slice(0, 32);
  }

  /** 读平台 → 映射 → 复用导入校验 → 剔除有错的整单 → 生成同步计划（不写库） */
  private async buildPlan(user: Actor, s: { id: string; tableId: string | null; ref: any; mapping: any }) {
    const tableId = s.tableId!;
    const op = await this.operator(user);
    const records = await this.wrap(this.readAll(s.ref as TableRef, op));
    const parsed = recordsToParsedTable(records, s.mapping as FieldMapping, tableId, `${this.platform.provider.toUpperCase()}-`);
    const { dataset } = await this.ds.getModel(user.tenantId);
    let prep = prepareImport(tableId, parsed, dataset);
    const errors = prep.errors;
    let skippedKeys: string[] = [];
    let skippedRows = 0;
    if (!prep.ok) {
      if (errors.some((e) => e.row < 2)) return { fatal: errors[0].message, records: records.length, errors, plan: null, dataset, prep };
      const d = dropErrorRows(parsed, tableId, errors.map((e) => e.row));
      skippedKeys = d.droppedKeys; skippedRows = d.droppedRows;
      prep = prepareImport(tableId, d.parsed, dataset);
      if (!prep.ok) return { fatal: '剔除错误行后仍未通过校验：' + prep.errors[0]?.message, records: records.length, errors: [...errors, ...prep.errors], plan: null, dataset, prep };
    }
    const rows = await this.prisma.sourceRow.findMany({ where: { tenantId: user.tenantId, tableId } });
    const provenance = new Map<string, Provenance>(rows.map((r) => [r.rowKey, { dataSourceId: r.dataSourceId, hash: r.hash, deletedAtSource: r.deletedAtSource }]));
    const plan = planSourceSync({
      tableId, dataSourceId: s.id, incoming: unitsFrom(tableId, prep.patch), existing: unitsFrom(tableId, dataset), provenance, skippedKeys,
      hash: (u) => this.hashUnit(tableId, u)
    });
    return { fatal: null as string | null, records: records.length, errors, skippedRows, plan, dataset, prep };
  }

  async preview(user: Actor, id: string) {
    const s = await this.getOwned(user, id, 'table');
    const r = await this.buildPlan(user, s);
    const p = r.plan;
    return {
      isMock: this.platform.isMock, read: r.records, fatal: r.fatal, errors: r.errors.slice(0, 100), errorCount: r.errors.length, skippedRows: r.skippedRows ?? 0,
      created: p?.created.length ?? 0, updated: p?.updated.length ?? 0, unchanged: p?.unchanged.length ?? 0, conflicts: p?.conflicts.length ?? 0, missingAtSource: p?.missingAtSource.length ?? 0,
      sample: p ? p.accept.slice(0, 5).map((u) => u.main) : [],
      conflictSample: p ? p.conflicts.slice(0, 5).map((c) => ({ key: c.key, existing: c.existing.main, incoming: c.incoming.main })) : []
    };
  }

  async syncTable(user: Actor, id: string, trigger: 'manual' | 'schedule' = 'manual', ip?: string) {
    const s = await this.getOwned(user, id, 'table');
    if (s.mappingStatus !== 'confirmed') throw new ConflictException('字段对应还没确认，不能同步');
    if (this.running.has(id)) throw new ConflictException('这个数据源正在同步，请稍后');
    this.running.add(id);
    try {
      let r: Awaited<ReturnType<SourcesService['buildPlan']>>;
      try { r = await this.buildPlan(user, s); } catch (e) {
        await this.recordRun(user, s.id, trigger, { status: 'failed', error: (e as Error).message });
        throw e;
      }
      if (!r.plan) {
        const run = await this.recordRun(user, s.id, trigger, { status: 'failed', read: r.records, errorCount: r.errors.length, errors: r.errors.slice(0, 200), error: r.fatal ?? '校验未通过' });
        await this.audit.record(user, 'source.sync_failed', { type: 'data_source', id }, { trigger, error: r.fatal }, undefined, ip);
        return run;
      }
      const plan = r.plan;
      const tableId = s.tableId!;
      const status = r.errors.length || plan.conflicts.length ? 'partial' : 'ok';
      const run = await this.prisma.$transaction(async (tx) => {
        if (plan.accept.length) {
          const patch = unitsToPatch(tableId, plan.accept);
          const next = applyImport(r.dataset, patch, 'append');
          for (const t of tablesTouchedBy(patch)) await this.ds.replaceTable(tx, user.tenantId, t, (next as any)[t]);
          for (const u of plan.accept) {
            const key = String(u.main[tableShape(tableId).key]);
            const hash = this.hashUnit(tableId, u);
            await tx.sourceRow.upsert({
              where: { tenantId_tableId_rowKey: { tenantId: user.tenantId, tableId, rowKey: key } },
              update: { dataSourceId: s.id, hash, deletedAtSource: false, deletedDetectedAt: null },
              create: { tenantId: user.tenantId, tableId, rowKey: key, dataSourceId: s.id, hash }
            });
          }
          await tx.importBatch.create({ data: {
            tenantId: user.tenantId, tableId, fileName: `${PROVIDER_LABEL[s.provider] ?? s.provider}${s.isMock ? '（模拟）' : ''}：${s.name}`, mode: 'sync', status: 'committed',
            rows: r.records, written: plan.accept.length, errorCount: r.errors.length, errors: r.errors.slice(0, 200) as Prisma.InputJsonValue, createdById: user.id
          } });
        }
        if (plan.missingAtSource.length) {
          await tx.sourceRow.updateMany({ where: { tenantId: user.tenantId, tableId, dataSourceId: s.id, rowKey: { in: plan.missingAtSource } }, data: { deletedAtSource: true, deletedDetectedAt: new Date() } });
        }
        if (plan.reappeared.length) {
          await tx.sourceRow.updateMany({ where: { tenantId: user.tenantId, tableId, dataSourceId: s.id, rowKey: { in: plan.reappeared } }, data: { deletedAtSource: false, deletedDetectedAt: null } });
        }
        // 同一来源同一编号只保留最新一条待处理冲突
        const keys = [...plan.conflicts.map((c) => c.key), ...plan.accept.map((u) => String(u.main[tableShape(tableId).key])), ...plan.unchanged];
        if (keys.length) await tx.syncConflict.updateMany({ where: { tenantId: user.tenantId, dataSourceId: s.id, tableId, rowKey: { in: keys }, status: 'open' }, data: { status: 'superseded' } });
        for (const c of plan.conflicts) {
          await tx.syncConflict.create({ data: {
            tenantId: user.tenantId, dataSourceId: s.id, tableId, rowKey: c.key, existingOwner: c.existingOwner,
            existing: c.existing as unknown as Prisma.InputJsonValue, incoming: c.incoming as unknown as Prisma.InputJsonValue
          } });
        }
        const run = await tx.syncRun.create({ data: {
          tenantId: user.tenantId, dataSourceId: s.id, trigger, status, isMock: s.isMock, read: r.records, created: plan.created.length, updated: plan.updated.length,
          unchanged: plan.unchanged.length, conflicts: plan.conflicts.length, missingAtSource: plan.missingAtSource.length, errorCount: r.errors.length,
          errors: r.errors.slice(0, 200) as Prisma.InputJsonValue, createdById: user.id
        } });
        await tx.dataSource.update({ where: { id: s.id }, data: { lastSyncAt: new Date(), lastSyncStatus: status } });
        await this.audit.record(user, 'source.synced', { type: 'data_source', id: s.id }, {
          trigger, tableId, isMock: s.isMock, read: r.records, created: plan.created.length, updated: plan.updated.length, conflicts: plan.conflicts.length,
          missingAtSource: plan.missingAtSource.length, errorCount: r.errors.length
        }, tx, ip);
        return run;
      }, { timeout: 120000, maxWait: 10000 });
      if (plan.accept.length) this.ds.invalidate(user.tenantId);
      return run;
    } finally {
      this.running.delete(id);
    }
  }

  private async recordRun(user: Actor, dataSourceId: string, trigger: string, d: { status: string; read?: number; errorCount?: number; errors?: unknown[]; error?: string }) {
    await this.prisma.dataSource.update({ where: { id: dataSourceId }, data: { lastSyncAt: new Date(), lastSyncStatus: d.status } });
    return this.prisma.syncRun.create({ data: {
      tenantId: user.tenantId, dataSourceId, trigger, status: d.status, isMock: this.platform.isMock, read: d.read ?? 0, errorCount: d.errorCount ?? 0,
      errors: (d.errors ?? []) as Prisma.InputJsonValue, error: d.error?.slice(0, 1000), createdById: user.id
    } });
  }

  // ---------------- 冲突 / 来源已删除：财务处理 ----------------

  async conflicts(user: Actor, dataSourceId?: string) {
    const list = await this.prisma.syncConflict.findMany({ where: { tenantId: user.tenantId, status: 'open', ...(dataSourceId ? { dataSourceId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const names = await this.sourceNames(user.tenantId);
    return list.map((c) => ({ ...c, sourceName: names[c.dataSourceId] ?? '', existingOwnerName: c.existingOwner === c.dataSourceId ? '本数据源写入后，在工作台被改过' : c.existingOwner ? names[c.existingOwner] ?? '其他数据源' : '文件导入或手工数据' }));
  }

  private async sourceNames(tenantId: string) {
    const all = await this.prisma.dataSource.findMany({ where: { tenantId }, select: { id: true, name: true } });
    return Object.fromEntries(all.map((x) => [x.id, x.name]));
  }

  /** accept = 用平台的新数据覆盖；reject = 保留工作台现有数据 */
  async resolveConflict(user: Actor, conflictId: string, action: 'accept' | 'reject', ip?: string) {
    const c = await this.prisma.syncConflict.findFirst({ where: { id: conflictId, tenantId: user.tenantId } });
    if (!c) throw new NotFoundException('冲突不存在');
    if (c.status !== 'open') throw new ConflictException('这条冲突已经处理过了');
    const incoming = c.incoming as unknown as Unit;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.syncConflict.updateMany({ where: { id: c.id, status: 'open' }, data: { status: action === 'accept' ? 'accepted' : 'rejected', resolvedById: user.id, resolvedAt: new Date() } });
      if (!claimed.count) throw new ConflictException('这条冲突已经处理过了');
      if (action === 'accept') {
        const { dataset } = await this.ds.getModel(user.tenantId);
        const patch = unitsToPatch(c.tableId, [incoming]);
        const next = applyImport(dataset, patch, 'append');
        for (const t of tablesTouchedBy(patch)) await this.ds.replaceTable(tx, user.tenantId, t, (next as any)[t]);
        const hash = this.hashUnit(c.tableId, incoming);
        await tx.sourceRow.upsert({
          where: { tenantId_tableId_rowKey: { tenantId: user.tenantId, tableId: c.tableId, rowKey: c.rowKey } },
          update: { dataSourceId: c.dataSourceId, hash, deletedAtSource: false, deletedDetectedAt: null },
          create: { tenantId: user.tenantId, tableId: c.tableId, rowKey: c.rowKey, dataSourceId: c.dataSourceId, hash }
        });
      }
      await this.audit.record(user, action === 'accept' ? 'source.conflict_accepted' : 'source.conflict_rejected', { type: 'sync_conflict', id: c.id }, { tableId: c.tableId, rowKey: c.rowKey, dataSourceId: c.dataSourceId }, tx, ip);
    }, { timeout: 120000, maxWait: 10000 });
    if (action === 'accept') this.ds.invalidate(user.tenantId);
    return { ok: true };
  }

  async pendingDeletes(user: Actor) {
    const rows = await this.prisma.sourceRow.findMany({ where: { tenantId: user.tenantId, deletedAtSource: true }, orderBy: { deletedDetectedAt: 'desc' }, take: 500 });
    const names = await this.sourceNames(user.tenantId);
    return rows.map((r) => ({ ...r, sourceName: r.dataSourceId ? names[r.dataSourceId] ?? '' : '', tableLabel: templateLabel(r.tableId) }));
  }

  /** delete = 确认删除（会改变核算数字）；keep = 保留并转为手工数据，以后同步不再管它 */
  async resolveDelete(user: Actor, tableId: string, rowKey: string, action: 'delete' | 'keep', ip?: string) {
    const row = await this.prisma.sourceRow.findFirst({ where: { tenantId: user.tenantId, tableId, rowKey, deletedAtSource: true } });
    if (!row) throw new NotFoundException('没有这条待确认删除的数据');
    await this.prisma.$transaction(async (tx) => {
      if (action === 'delete') {
        const { dataset } = await this.ds.getModel(user.tenantId);
        const next = removeUnits(dataset, tableId, [rowKey]);
        const shape = tableShape(tableId);
        for (const t of [shape.main, ...(shape.child ? [shape.child.table] : [])]) await this.ds.replaceTable(tx, user.tenantId, t, (next as any)[t]);
        await tx.sourceRow.delete({ where: { tenantId_tableId_rowKey: { tenantId: user.tenantId, tableId, rowKey } } });
      } else {
        await tx.sourceRow.update({ where: { tenantId_tableId_rowKey: { tenantId: user.tenantId, tableId, rowKey } }, data: { dataSourceId: null, deletedAtSource: false, deletedDetectedAt: null } });
      }
      await this.audit.record(user, action === 'delete' ? 'source.row_deleted' : 'source.row_kept', { type: 'source_row', id: `${tableId}:${rowKey}` }, { tableId, rowKey, dataSourceId: row.dataSourceId }, tx, ip);
    }, { timeout: 120000, maxWait: 10000 });
    if (action === 'delete') this.ds.invalidate(user.tenantId);
    return { ok: true };
  }

  async update(user: Actor, id: string, patch: { name?: string; active?: boolean; syncIntervalMin?: number; knowledgeMode?: KnowledgeMode }, ip?: string) {
    const s = await this.getOwned(user, id);
    if (patch.knowledgeMode && s.kind !== 'knowledge') throw new BadRequestException('只有知识库可以设置类型');
    await this.prisma.$transaction(async (tx) => {
      await tx.dataSource.update({ where: { id }, data: patch });
      // 改成查询型：立即清掉已存的正文（不再进入检索和 AI）
      if (patch.knowledgeMode === 'reference') await tx.knowledgeDoc.updateMany({ where: { tenantId: user.tenantId, dataSourceId: id }, data: { mode: 'reference', content: null, contentChars: 0, truncated: false } });
      await this.audit.record(user, 'source.updated', { type: 'data_source', id }, patch, tx, ip);
    });
    return this.detail(user, id);
  }

  // ---------------- 知识库 ----------------

  async createKnowledgeSource(user: Actor, input: { link: string; mode: KnowledgeMode; name?: string; syncIntervalMin?: number }, ip?: string) {
    this.requireCap('readKnowledge');
    const ref = await this.wrap(Promise.resolve().then(() => this.platform.parseKnowledgeLink(input.link)));
    const op = await this.operator(user);
    await this.wrap(this.platform.listKnowledgeNodes(ref, op)); // 先读一次，确认有权限
    const s = await this.prisma.dataSource.create({ data: {
      tenantId: user.tenantId, kind: 'knowledge', provider: this.platform.provider, isMock: this.platform.isMock,
      name: (input.name || '').trim() || `${PROVIDER_LABEL[this.platform.provider] ?? ''}知识库`, link: input.link, ref: ref as unknown as Prisma.InputJsonValue,
      knowledgeMode: input.mode, syncIntervalMin: input.syncIntervalMin ?? 60, createdById: user.id
    } });
    await this.audit.record(user, 'source.created', { type: 'data_source', id: s.id }, { kind: 'knowledge', mode: input.mode, provider: s.provider, isMock: s.isMock }, undefined, ip);
    return this.detail(user, s.id);
  }

  /** 遍历知识库目录。数据型读正文（只读文档类节点）；查询型只存标题、路径和链接 */
  async syncKnowledge(user: Actor, id: string, trigger: 'manual' | 'schedule' = 'manual', ip?: string) {
    const s = await this.getOwned(user, id, 'knowledge');
    if (this.running.has(id)) throw new ConflictException('这个数据源正在同步，请稍后');
    this.running.add(id);
    try {
      const mode = (s.knowledgeMode || 'reference') as KnowledgeMode;
      const op = await this.operator(user);
      const ref = s.ref as KnowledgeRef;
      const seen = new Set<string>();
      const errors: { node: string; message: string }[] = [];
      let created = 0, updated = 0;
      const queue: { parent?: string; path: string; depth: number }[] = [{ path: '', depth: 0 }];
      try {
        while (queue.length && seen.size < MAX_KNOWLEDGE_NODES) {
          const cur = queue.shift()!;
          let token: string | undefined;
          do {
            const page = await this.platform.listKnowledgeNodes(ref, op, cur.parent, token);
            for (const n of page.items) {
              if (seen.has(n.nodeId) || seen.size >= MAX_KNOWLEDGE_NODES) continue;
              seen.add(n.nodeId);
              const path = cur.path ? `${cur.path} / ${n.name}` : n.name;
              if (n.kind === 'folder' || n.hasChildren) { if (cur.depth < 10) queue.push({ parent: n.nodeId, path, depth: cur.depth + 1 }); }
              if (n.kind === 'folder') continue;
              let content: string | null = null; let truncated = false;
              if (mode === 'data' && n.kind === 'doc') {
                try {
                  const text = await this.platform.getDocText(n, op);
                  truncated = text.length > KNOWLEDGE_MAX_CHARS;
                  content = truncated ? text.slice(0, KNOWLEDGE_MAX_CHARS) : text;
                } catch (e) { errors.push({ node: n.name, message: (e as Error).message }); }
              }
              const r = await this.upsertDoc(user.tenantId, s.id, n, path, mode, content, truncated);
              if (r === 'created') created++; else updated++;
            }
            token = page.nextPageToken;
          } while (token);
        }
      } catch (e) {
        const msg = e instanceof BadRequestException ? (e.getResponse() as any).message ?? e.message : (e as Error).message;
        await this.recordRun(user, s.id, trigger, { status: 'failed', error: String(msg) });
        await this.audit.record(user, 'source.sync_failed', { type: 'data_source', id }, { trigger, error: String(msg).slice(0, 300) }, undefined, ip);
        throw new BadRequestException(String(msg));
      }
      // 平台上已不存在的条目：标记删除并从检索中隐藏（知识条目不参与核算，无需财务确认）
      const gone = await this.prisma.knowledgeDoc.updateMany({ where: { tenantId: user.tenantId, dataSourceId: s.id, deletedAtSource: false, externalId: { notIn: [...seen] } }, data: { deletedAtSource: true } });
      const status = errors.length ? 'partial' : 'ok';
      const run = await this.prisma.syncRun.create({ data: {
        tenantId: user.tenantId, dataSourceId: s.id, trigger, status, isMock: s.isMock, read: seen.size, created, updated, missingAtSource: gone.count,
        errorCount: errors.length, errors: errors.slice(0, 200) as Prisma.InputJsonValue, createdById: user.id
      } });
      await this.prisma.dataSource.update({ where: { id: s.id }, data: { lastSyncAt: new Date(), lastSyncStatus: status } });
      await this.audit.record(user, 'source.synced', { type: 'data_source', id: s.id }, { trigger, kind: 'knowledge', mode, isMock: s.isMock, read: seen.size, created, removed: gone.count, errorCount: errors.length }, undefined, ip);
      return run;
    } finally {
      this.running.delete(id);
    }
  }

  private async upsertDoc(tenantId: string, dataSourceId: string, n: KnowledgeNode, path: string, mode: KnowledgeMode, content: string | null, truncated: boolean) {
    const key = { tenantId_dataSourceId_externalId: { tenantId, dataSourceId, externalId: n.nodeId } };
    const data = { title: n.name.slice(0, 500), path: path.slice(0, 1000), url: n.url ?? null, kind: n.kind, mode, content, contentChars: content?.length ?? 0, truncated, updatedAtSource: n.updatedAt ?? null, deletedAtSource: false, syncedAt: new Date() };
    const exists = await this.prisma.knowledgeDoc.findUnique({ where: key, select: { id: true } });
    if (exists) { await this.prisma.knowledgeDoc.update({ where: key, data }); return 'updated' as const; }
    await this.prisma.knowledgeDoc.create({ data: { tenantId, dataSourceId, externalId: n.nodeId, ...data } });
    return 'created' as const;
  }

  /** 检索：数据型搜标题+正文，查询型只搜标题和目录路径；结果带来源和原文链接 */
  async search(user: Actor, q: string, ip?: string) {
    const term = q.trim();
    if (term.length < 1) return { items: [] };
    const docs = await this.prisma.knowledgeDoc.findMany({
      where: {
        tenantId: user.tenantId, deletedAtSource: false,
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { path: { contains: term, mode: 'insensitive' } },
          { mode: 'data', content: { contains: term, mode: 'insensitive' } }
        ]
      },
      orderBy: { syncedAt: 'desc' }, take: 50,
      select: { id: true, dataSourceId: true, title: true, path: true, url: true, mode: true, kind: true, content: true, truncated: true, syncedAt: true }
    });
    const names = await this.sourceNames(user.tenantId);
    const srcs = await this.prisma.dataSource.findMany({ where: { tenantId: user.tenantId, id: { in: [...new Set(docs.map((d) => d.dataSourceId))] } }, select: { id: true, provider: true, isMock: true } });
    const meta = Object.fromEntries(srcs.map((x) => [x.id, x]));
    await this.audit.record(user, 'knowledge.search', { type: 'knowledge' }, { q: term.slice(0, 100), hits: docs.length }, undefined, ip);
    return {
      items: docs.map(({ content, ...d }) => ({
        ...d, sourceName: names[d.dataSourceId] ?? '', provider: meta[d.dataSourceId]?.provider, isMock: meta[d.dataSourceId]?.isMock ?? false,
        snippet: d.mode === 'data' && content ? snippetAround(content, term) : ''
      }))
    };
  }

  async remove(user: Actor, id: string, ip?: string) {
    const s = await this.getOwned(user, id);
    // 只停用并删除知识条目；已写入的业务数据保留，来源记录转为手工数据（不删核算数据）
    await this.prisma.$transaction(async (tx) => {
      await tx.dataSource.update({ where: { id }, data: { active: false } });
      await tx.knowledgeDoc.deleteMany({ where: { tenantId: user.tenantId, dataSourceId: id } });
      await tx.sourceRow.updateMany({ where: { tenantId: user.tenantId, dataSourceId: id }, data: { dataSourceId: null, deletedAtSource: false, deletedDetectedAt: null } });
      await tx.syncConflict.updateMany({ where: { tenantId: user.tenantId, dataSourceId: id, status: 'open' }, data: { status: 'superseded' } });
      await this.audit.record(user, 'source.disconnected', { type: 'data_source', id }, { kind: s.kind, name: s.name }, tx, ip);
    });
    return { ok: true };
  }
}

function templateLabel(tableId: string): string {
  return getImportTemplate(tableId)?.label ?? tableId;
}

function cellPreview(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}
