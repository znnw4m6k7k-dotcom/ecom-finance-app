import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertTransition, BRIEFING_PROMPT_VERSION, BriefingDraft, BriefingDraftSchema, BriefingFacts, BriefingStatus,
  buildBriefingFacts, buildBriefingPrompt, findUnverifiedNumbers, nextStatus, parseBriefingDraft, renderBriefingMarkdown, TransitionError
} from '@efa/domain';
import { ModelProvider, runStructured } from '@efa/model-adapters';
import { APP_CONFIG, AppConfig, MODEL_PROVIDER } from '../config';
import { AuthUser } from '../common/auth';
import { AuditService } from '../audit/audit.service';
import { DatasetService } from '../dataset/dataset.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class BriefingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ds: DatasetService,
    private readonly audit: AuditService,
    private readonly notify: NotificationService,
    @Inject(MODEL_PROVIDER) private readonly model: ModelProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig
  ) {}

  /** 所有查询都带 tenantId：其他租户的简报一律当作不存在 */
  private async getOwned(user: AuthUser, id: string) {
    const b = await this.prisma.briefing.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!b) throw new NotFoundException('简报不存在');
    return b;
  }

  private guard(action: Parameters<typeof assertTransition>[0], status: BriefingStatus) {
    try { assertTransition(action, status); } catch (e) { if (e instanceof TransitionError) throw new ConflictException(e.message); throw e; }
  }

  list(user: AuthUser) {
    return this.prisma.briefing.findMany({
      where: { tenantId: user.tenantId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, month: true, status: true, version: true, modelProvider: true, modelIsMock: true, createdAt: true, updatedAt: true, reviewedAt: true, approvedVersion: true }
    });
  }

  async detail(user: AuthUser, id: string) {
    const b = await this.getOwned(user, id);
    const [versions, notifications, aiCalls] = await Promise.all([
      this.prisma.briefingVersion.findMany({ where: { tenantId: user.tenantId, briefingId: id }, orderBy: { version: 'desc' } }),
      this.prisma.notificationDelivery.findMany({ where: { tenantId: user.tenantId, briefingId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.aiCall.findMany({ where: { tenantId: user.tenantId, refId: id }, orderBy: { createdAt: 'desc' } })
    ]);
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: [b.createdById, b.updatedById, b.reviewedById].filter(Boolean) as string[] } },
      select: { id: true, displayName: true }
    });
    const names = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
    let preview: { title: string; markdown: string } | null = null;
    if (b.draft) preview = renderBriefingMarkdown(b.facts as unknown as BriefingFacts, b.draft as unknown as BriefingDraft, { reviewer: b.reviewedById ? names[b.reviewedById] : undefined });
    return { ...b, names, versions, notifications, aiCalls, preview };
  }

  /** 调用模型生成草稿；失败时状态为 FAILED，可重新生成 */
  private async runModel(user: AuthUser, briefingId: string, facts: BriefingFacts) {
    const prompt = buildBriefingPrompt(facts);
    const result = await runStructured<BriefingDraft>(this.model, {
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], json: true, temperature: 0.2, maxTokens: 1500
    }, {
      maxAttempts: 2,
      parse: (text) => { const r = parseBriefingDraft(text); return r.ok ? { ok: true, value: r.draft } : r; },
      onAttempt: async (a) => {
        await this.prisma.aiCall.create({
          data: {
            tenantId: user.tenantId, purpose: 'briefing', refId: briefingId, provider: a.provider, model: a.model, isMock: a.isMock,
            attempt: a.attempt, ok: a.ok, latencyMs: a.latencyMs, inputTokens: a.inputTokens, outputTokens: a.outputTokens,
            costCny: a.costCny ?? undefined, errorKind: a.errorKind, error: a.error?.slice(0, 500)
          }
        });
      }
    });
    return result;
  }

  async generate(user: AuthUser, month: string, ip?: string) {
    const open = await this.prisma.briefing.findFirst({ where: { tenantId: user.tenantId, month, status: { in: ['DRAFT', 'FAILED', 'REJECTED', 'SUBMITTED'] } } });
    if (open?.status === 'SUBMITTED') throw new ConflictException('该月简报正在审核中，审核完成前不能重新生成');
    if (open) return this.regenerate(user, open.id, ip);
    const { model } = await this.ds.getModel(user.tenantId);
    let facts: BriefingFacts;
    try { facts = buildBriefingFacts(model, month); } catch (e) { throw new BadRequestException((e as Error).message); }
    const b = await this.prisma.briefing.create({
      data: {
        tenantId: user.tenantId, month, status: 'FAILED', version: 0, facts: facts as unknown as Prisma.InputJsonValue, unverified: [],
        promptVersion: BRIEFING_PROMPT_VERSION, modelProvider: this.model.id, modelName: this.model.model, modelIsMock: this.model.isMock,
        createdById: user.id, updatedById: user.id, error: '生成中'
      }
    });
    return this.fillDraft(user, b.id, facts, 0, 'briefing.generated', ip);
  }

  async regenerate(user: AuthUser, id: string, ip?: string) {
    const b = await this.getOwned(user, id);
    this.guard('generate', b.status as BriefingStatus);
    const { model } = await this.ds.getModel(user.tenantId);
    const facts = buildBriefingFacts(model, b.month); // 用最新数据重算事实表
    return this.fillDraft(user, b.id, facts, b.version, 'briefing.regenerated', ip);
  }

  private async fillDraft(user: AuthUser, id: string, facts: BriefingFacts, prevVersion: number, action: string, ip?: string) {
    const res = await this.runModel(user, id, facts);
    if (!res.ok) {
      await this.prisma.briefing.update({ where: { id }, data: { status: 'FAILED', error: res.error.slice(0, 500), facts: facts as unknown as Prisma.InputJsonValue, updatedById: user.id } });
      await this.audit.record(user, 'briefing.generate_failed', { type: 'briefing', id }, { error: res.error.slice(0, 200), attempts: res.attempts }, undefined, ip);
      return this.detail(user, id);
    }
    const version = prevVersion + 1;
    const unverified = findUnverifiedNumbers(res.value, facts);
    await this.prisma.$transaction(async (tx) => {
      await tx.briefing.update({
        where: { id },
        data: {
          status: 'DRAFT', version, draft: res.value as unknown as Prisma.InputJsonValue, facts: facts as unknown as Prisma.InputJsonValue, unverified, error: null,
          modelProvider: this.model.id, modelName: res.result.model, modelIsMock: this.model.isMock, updatedById: user.id,
          reviewComment: null
        }
      });
      await tx.briefingVersion.create({ data: { tenantId: user.tenantId, briefingId: id, version, source: 'ai', draft: res.value as unknown as Prisma.InputJsonValue, createdById: user.id } });
      await this.audit.record(user, action, { type: 'briefing', id }, { version, model: res.result.model, isMock: this.model.isMock, unverified }, tx, ip);
    });
    return this.detail(user, id);
  }

  async edit(user: AuthUser, id: string, draftInput: unknown, ip?: string) {
    const b = await this.getOwned(user, id);
    this.guard('edit', b.status as BriefingStatus);
    const r = BriefingDraftSchema.safeParse(draftInput);
    if (!r.success) throw new BadRequestException('简报内容不符合格式：' + r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；'));
    const version = b.version + 1;
    const unverified = findUnverifiedNumbers(r.data, b.facts as unknown as BriefingFacts);
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.briefing.updateMany({
        where: { id, tenantId: user.tenantId, version: b.version }, // 乐观锁：防止覆盖别人的修改
        data: { status: nextStatus('edit', b.status as BriefingStatus), version, draft: r.data as unknown as Prisma.InputJsonValue, unverified, updatedById: user.id }
      });
      if (upd.count !== 1) throw new ConflictException('简报已被他人修改，请刷新后重试');
      await tx.briefingVersion.create({ data: { tenantId: user.tenantId, briefingId: id, version, source: 'human', draft: r.data as unknown as Prisma.InputJsonValue, createdById: user.id } });
      await this.audit.record(user, 'briefing.edited', { type: 'briefing', id }, { version, unverified }, tx, ip);
    });
    return this.detail(user, id);
  }

  async submit(user: AuthUser, id: string, ip?: string) {
    const b = await this.getOwned(user, id);
    const to = this.transition('submit', b.status as BriefingStatus);
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.briefing.updateMany({ where: { id, tenantId: user.tenantId, status: b.status }, data: { status: to, submittedAt: new Date(), updatedById: user.id } });
      if (upd.count !== 1) throw new ConflictException('状态已变化，请刷新');
      await this.audit.record(user, 'briefing.submitted', { type: 'briefing', id }, { version: b.version }, tx, ip);
    });
    return this.detail(user, id);
  }

  private transition(action: 'submit' | 'approve' | 'reject', status: BriefingStatus) {
    try { return nextStatus(action, status); } catch (e) { if (e instanceof TransitionError) throw new ConflictException(e.message); throw e; }
  }

  /** 审核通过：记录审核人与所审版本 → 发送通知（通知失败不回滚审核，可在页面重试） */
  async approve(user: AuthUser, id: string, version: number, comment: string | undefined, ip?: string) {
    const b = await this.getOwned(user, id);
    const to = this.transition('approve', b.status as BriefingStatus);
    if (version !== b.version) throw new ConflictException(`你审核的是第 ${version} 版，当前已是第 ${b.version} 版，请刷新后再审`);
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.briefing.updateMany({
        where: { id, tenantId: user.tenantId, status: 'SUBMITTED', version },
        data: { status: to, reviewedById: user.id, reviewedAt: new Date(), reviewComment: comment ?? null, approvedVersion: version }
      });
      if (upd.count !== 1) throw new ConflictException('状态已变化，请刷新');
      await this.audit.record(user, 'briefing.approved', { type: 'briefing', id }, { version, comment }, tx, ip);
    });
    await this.sendNotification(user, id);
    return this.detail(user, id);
  }

  async reject(user: AuthUser, id: string, comment: string, ip?: string) {
    const b = await this.getOwned(user, id);
    const to = this.transition('reject', b.status as BriefingStatus);
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.briefing.updateMany({ where: { id, tenantId: user.tenantId, status: 'SUBMITTED' }, data: { status: to, reviewedById: user.id, reviewedAt: new Date(), reviewComment: comment } });
      if (upd.count !== 1) throw new ConflictException('状态已变化，请刷新');
      await this.audit.record(user, 'briefing.rejected', { type: 'briefing', id }, { version: b.version, comment }, tx, ip);
    });
    return this.detail(user, id);
  }

  /** 发送（或重试）已通过简报的通知；同一版本幂等 */
  async sendNotification(user: AuthUser, id: string) {
    const b = await this.getOwned(user, id);
    if (b.status !== 'APPROVED' || !b.draft || !b.approvedVersion) throw new ConflictException('只有审核通过的简报可以发送通知');
    const reviewer = b.reviewedById ? await this.prisma.user.findFirst({ where: { id: b.reviewedById, tenantId: user.tenantId } }) : null;
    const approvedDraft = await this.prisma.briefingVersion.findFirst({ where: { tenantId: user.tenantId, briefingId: id, version: b.approvedVersion } });
    const msg = renderBriefingMarkdown(b.facts as unknown as BriefingFacts, (approvedDraft?.draft ?? b.draft) as unknown as BriefingDraft, {
      reviewer: reviewer?.displayName, link: `${this.cfg.PUBLIC_BASE_URL.replace(/\/+$/, '')}/#/briefing`
    });
    return this.notify.send({
      tenantId: user.tenantId, briefingId: id, idempotencyKey: `briefing:${id}:v${b.approvedVersion}`,
      title: msg.title, markdown: msg.markdown, actor: { id: user.id, displayName: user.displayName }
    });
  }
}
