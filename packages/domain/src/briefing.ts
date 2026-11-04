/**
 * 月度经营简报：本期 P0 的“AI 草稿 → 人工审核 → 通知”业务闭环。
 *
 * 原则（CLAUDE.md 第 6 条）：
 * - 所有数字由核算引擎算出（facts），AI 只写文字解读，不得产生新数字；
 * - AI 输出必须通过结构化校验；文字里出现的数字逐个与 facts 比对，对不上的标记出来给审核人看；
 * - 草稿必须经老板（OWNER）审核通过后才能发出通知。
 */
import { z } from 'zod';
import type { FinanceModel, Row } from './legacy';

// ---------------- 状态机 ----------------
export const BRIEFING_STATUSES = ['DRAFT', 'FAILED', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type BriefingStatus = (typeof BRIEFING_STATUSES)[number];
export type BriefingAction = 'generate' | 'edit' | 'submit' | 'approve' | 'reject';

const TRANSITIONS: Record<BriefingAction, { from: BriefingStatus[]; to: BriefingStatus | null }> = {
  generate: { from: ['DRAFT', 'FAILED', 'REJECTED'], to: null }, // 结果是 DRAFT 或 FAILED
  edit: { from: ['DRAFT', 'REJECTED'], to: 'DRAFT' },
  submit: { from: ['DRAFT'], to: 'SUBMITTED' },
  approve: { from: ['SUBMITTED'], to: 'APPROVED' },
  reject: { from: ['SUBMITTED'], to: 'REJECTED' }
};

export class TransitionError extends Error {
  constructor(public readonly action: BriefingAction, public readonly status: BriefingStatus) {
    super(`当前状态「${STATUS_LABELS[status]}」不能执行「${ACTION_LABELS[action]}」`);
  }
}

export const STATUS_LABELS: Record<BriefingStatus, string> = {
  DRAFT: '草稿', FAILED: '生成失败', SUBMITTED: '待审核', APPROVED: '已通过', REJECTED: '已退回'
};
export const ACTION_LABELS: Record<BriefingAction, string> = {
  generate: '重新生成', edit: '修改', submit: '提交审核', approve: '审核通过', reject: '退回'
};

export function assertTransition(action: BriefingAction, status: BriefingStatus): void {
  if (!TRANSITIONS[action].from.includes(status)) throw new TransitionError(action, status);
}
export function nextStatus(action: Exclude<BriefingAction, 'generate'>, status: BriefingStatus): BriefingStatus {
  assertTransition(action, status);
  return TRANSITIONS[action].to as BriefingStatus;
}

// ---------------- 事实表（确定性计算，不经过 AI） ----------------
export interface BriefingFact { key: string; label: string; value: number; unit: '元' | '%' | '天' | '单' | '个' }

export interface BriefingFacts {
  month: string;
  prevMonth: string | null;
  company: string;
  facts: BriefingFact[];
  stores: { store_id: string; name: string; revenue: number; netProfit: number; netMargin: number }[];
  failedChecks: { id: string; label: string; detail: string }[];
  billDiffs: { bill_id: string; store_name: string; period: string; diff: number; explained: boolean; note: string }[];
  payoutDiffs: { bill_id: string; store_name: string; diff: number }[];
  alerts: { level: string; title: string; detail: string }[];
}

const r2 = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;

export function buildBriefingFacts(model: FinanceModel, month: string): BriefingFacts {
  if (!model.months.includes(month)) throw new Error(`账期 ${month} 不在数据范围内（${model.months.join('、')}）`);
  const k = model.kpis[month] || {};
  const c = model.companyMonth[month] || {};
  const idx = model.months.indexOf(month);
  const prevMonth = idx > 0 ? model.months[idx - 1] : null;
  const p = prevMonth ? model.companyMonth[prevMonth] : null;
  const facts: BriefingFact[] = [
    { key: 'revenue', label: '营业收入', value: r2(c.revenue), unit: '元' },
    { key: 'netProfit', label: '净利润', value: r2(c.netProfit), unit: '元' },
    { key: 'netMargin', label: '净利率', value: r2(c.netMargin), unit: '%' },
    { key: 'gmv', label: 'GMV', value: r2(c.gmv), unit: '元' },
    { key: 'refundRate', label: '退款率', value: r2(c.refundRate), unit: '%' },
    { key: 'orders', label: '订单数', value: Number(c.orders || 0), unit: '单' },
    { key: 'cogsRate', label: '商品成本占比', value: r2(c.cogsRate), unit: '%' },
    { key: 'promoRate', label: '推广费占比', value: r2(c.promoRate), unit: '%' },
    { key: 'laborRate', label: '人工成本占比', value: r2(c.laborRate), unit: '%' },
    { key: 'platformRate', label: '平台费占比', value: r2(c.platformRate), unit: '%' },
    { key: 'freightRate', label: '物流成本占比', value: r2(c.freightRate), unit: '%' },
    { key: 'cashReceived', label: '平台已回款（累计）', value: r2(k.cashReceived), unit: '元' },
    { key: 'cashPending', label: '待结算', value: r2(k.cashPending), unit: '元' },
    { key: 'cashOccupied', label: '账期占款', value: r2(k.cashOccupied), unit: '元' },
    { key: 'inventoryValue', label: '库存金额', value: r2(k.inventoryValue), unit: '元' },
    { key: 'turnoverDays', label: '库存周转天数', value: Number(k.turnoverDays || 0), unit: '天' },
    { key: 'slowMovingValue', label: '滞销占用资金', value: r2(k.slowMovingValue), unit: '元' }
  ];
  if (p) {
    const mom = (a: number, b: number) => (b ? r2(((a - b) / Math.abs(b)) * 100) : 0);
    facts.push({ key: 'revenueMoM', label: '营业收入环比', value: mom(c.revenue, p.revenue), unit: '%' });
    facts.push({ key: 'netProfitMoM', label: '净利润环比', value: mom(c.netProfit, p.netProfit), unit: '%' });
    facts.push({ key: 'prevNetProfit', label: '上月净利润', value: r2(p.netProfit), unit: '元' });
  }
  const stores = ((k.storeRanking as Row[]) || []).map((s) => ({
    store_id: s.store_id, name: s.name, revenue: r2(s.revenue), netProfit: r2(s.netProfit), netMargin: r2(s.netMargin)
  }));
  return {
    month,
    prevMonth,
    company: String(model.meta?.company_name || ''),
    facts,
    stores,
    failedChecks: model.checks.filter((x) => !x.ok).map((x) => ({ id: x.id, label: x.label, detail: String(x.detail || '') })),
    billDiffs: model.reconciliation.bills
      .filter((b: Row) => b.period === month && Math.abs(Number(b.diff || 0)) > 0.011)
      .map((b: Row) => ({ bill_id: b.bill_id, store_name: b.store_name, period: b.period, diff: r2(b.diff), explained: !!b.explained, note: String(b.note || '') })),
    payoutDiffs: model.reconciliation.payoutDiffs.map((d: Row) => ({ bill_id: d.bill_id, store_name: d.store_name, diff: r2(d.diff) })),
    alerts: model.alerts.map((a: Row) => ({ level: a.level, title: a.title, detail: a.detail }))
  };
}

/** 事实表中所有可被文字引用的数字（含店铺、差异） */
export function factNumbers(f: BriefingFacts): number[] {
  const nums: number[] = [];
  f.facts.forEach((x) => nums.push(x.value));
  f.stores.forEach((s) => nums.push(s.revenue, s.netProfit, s.netMargin));
  f.billDiffs.forEach((d) => nums.push(d.diff, Math.abs(d.diff)));
  f.payoutDiffs.forEach((d) => nums.push(d.diff, Math.abs(d.diff)));
  nums.push(f.stores.length, f.failedChecks.length, f.billDiffs.length, f.alerts.length);
  f.alerts.forEach((a) => extractNumbers(a.title + ' ' + a.detail).forEach((n) => nums.push(n.value)));
  return nums;
}

// ---------------- AI 输出结构 ----------------
export const BriefingDraftSchema = z.object({
  headline: z.string().min(4).max(80),
  highlights: z.array(z.string().min(2).max(200)).min(1).max(5),
  risks: z.array(z.object({ title: z.string().min(2).max(60), detail: z.string().min(2).max(300) })).max(6),
  actions: z.array(z.object({
    owner: z.enum(['老板', '财务', '运营']),
    title: z.string().min(2).max(60),
    detail: z.string().min(2).max(300)
  })).max(6)
}).strict();
export type BriefingDraft = z.infer<typeof BriefingDraftSchema>;

/** 从文字中抽取数字（支持 1,234.5 / 12.3% / 12.3万） */
export function extractNumbers(text: string): { raw: string; value: number; scale: 1 | 10000; decimals: number }[] {
  const out: { raw: string; value: number; scale: 1 | 10000; decimals: number }[] = [];
  const re = /(-?\d[\d,]*(?:\.\d+)?)\s*(万)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const v = Number(m[1].replace(/,/g, ''));
    if (!isFinite(v)) continue;
    const decimals = (m[1].split('.')[1] || '').length;
    out.push({ raw: m[0].trim(), value: m[2] ? v * 10000 : v, scale: m[2] ? 10000 : 1, decimals });
  }
  return out;
}

const IGNORABLE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 30, 60, 90, 100, 2025, 2026, 2027]);

/** 找出 AI 文字中与事实表对不上的数字，交给审核人确认（不自动拦截，避免误杀） */
export function findUnverifiedNumbers(draft: BriefingDraft, facts: BriefingFacts): string[] {
  const known = factNumbers(facts);
  const texts = [draft.headline, ...draft.highlights, ...draft.risks.flatMap((r) => [r.title, r.detail]), ...draft.actions.flatMap((a) => [a.title, a.detail])];
  const bad = new Set<string>();
  for (const t of texts) {
    for (const n of extractNumbers(t.replace(/\d{4}-\d{2}(-\d{2})?/g, ' ').replace(/\d{1,2}\s*月/g, ' '))) {
      if (IGNORABLE.has(n.value)) continue;
      // 容差按文字写出的精度：写“11.06万”允许 ±50 元，写“12.0%”允许 ±0.05
      const tol = 0.5 * Math.pow(10, -n.decimals) * n.scale + 1e-6;
      const ok = known.some((k) => Math.abs(Math.abs(k) - Math.abs(n.value)) <= tol);
      if (!ok) bad.add(n.raw);
    }
  }
  return [...bad];
}

// ---------------- Prompt（版本化） ----------------
export const BRIEFING_PROMPT_VERSION = 'briefing-v1';

export function buildBriefingPrompt(f: BriefingFacts): { system: string; user: string } {
  const system = [
    '你是电商公司的财务分析助手，为老板写月度经营简报的“文字解读”部分。',
    '规则：',
    '1. 只能使用用户提供的事实数据，不得编造、推算或补充任何新数字；引用数字时照抄事实表中的值（可写成“万”）。',
    '2. 不做对外承诺，不给出价格、税务或法律结论；建议必须是公司内部可执行的核对或经营动作。',
    '3. 事实表中的勾稽异常、对账差异、预警必须在 risks 中体现。',
    '4. 只输出一个 JSON 对象，不要 Markdown 代码块，字段：',
    '{"headline":string,"highlights":string[1..5],"risks":[{"title":string,"detail":string}],"actions":[{"owner":"老板"|"财务"|"运营","title":string,"detail":string}]}'
  ].join('\n');
  const lines: string[] = [];
  lines.push(`公司：${f.company}`);
  lines.push(`账期：${f.month}${f.prevMonth ? `（上月 ${f.prevMonth}）` : ''}`);
  lines.push('【核心指标】');
  f.facts.forEach((x) => lines.push(`- ${x.label}：${x.value}${x.unit}`));
  lines.push('【店铺利润排名】');
  f.stores.forEach((s, i) => lines.push(`${i + 1}. ${s.name}：营业收入 ${s.revenue} 元，净利润 ${s.netProfit} 元，净利率 ${s.netMargin}%`));
  lines.push('【勾稽校验异常】');
  lines.push(f.failedChecks.length ? f.failedChecks.map((x) => `- ${x.label}：${x.detail}`).join('\n') : '- 无');
  lines.push('【本月账单与订单重算差异】');
  lines.push(f.billDiffs.length ? f.billDiffs.map((d) => `- ${d.store_name} ${d.bill_id}：差异 ${d.diff} 元，${d.explained ? '已有说明' : '未说明'}${d.note ? '（' + d.note + '）' : ''}`).join('\n') : '- 无');
  lines.push('【打款与账单差异】');
  lines.push(f.payoutDiffs.length ? f.payoutDiffs.map((d) => `- ${d.store_name} ${d.bill_id}：差异 ${d.diff} 元`).join('\n') : '- 无');
  lines.push('【系统预警】');
  lines.push(f.alerts.length ? f.alerts.map((a) => `- [${a.level}] ${a.title}：${a.detail}`).join('\n') : '- 无');
  return { system, user: lines.join('\n') };
}

/** 解析模型返回文本：容忍 ```json 包裹，严格按 schema 校验 */
export function parseBriefingDraft(text: string): { ok: true; draft: BriefingDraft } | { ok: false; error: string } {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: '模型输出不是 JSON 对象' };
  let obj: unknown;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch (e) { return { ok: false, error: '模型输出 JSON 解析失败：' + (e as Error).message }; }
  const r = BriefingDraftSchema.safeParse(obj);
  if (!r.success) return { ok: false, error: '模型输出不符合结构：' + r.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('；') };
  return { ok: true, draft: r.data };
}

// ---------------- 通知文本 ----------------
const fmtMoney = (n: number) => (Math.abs(n) >= 10000 ? (n / 10000).toFixed(2) + ' 万' : n.toFixed(2)) + ' 元';
const fmtFact = (x: BriefingFact) => (x.unit === '元' ? fmtMoney(x.value) : `${x.value}${x.unit === '%' ? '%' : ' ' + x.unit}`);

export function renderBriefingMarkdown(f: BriefingFacts, d: BriefingDraft, opts: { link?: string; reviewer?: string } = {}): { title: string; markdown: string } {
  const title = `${f.month} 经营简报`;
  const pick = (key: string) => f.facts.find((x) => x.key === key);
  const head = ['revenue', 'netProfit', 'netMargin', 'cashPending', 'inventoryValue']
    .map(pick).filter(Boolean).map((x) => `- ${x!.label}：**${fmtFact(x!)}**`);
  const md = [
    `### ${title}`,
    `**${d.headline}**`,
    '',
    '**核心指标（系统核算）**',
    ...head,
    '',
    '**要点**',
    ...d.highlights.map((h) => `- ${h}`),
    ...(d.risks.length ? ['', '**风险与异常**', ...d.risks.map((r) => `- ${r.title}：${r.detail}`)] : []),
    ...(d.actions.length ? ['', '**建议动作**', ...d.actions.map((a) => `- 【${a.owner}】${a.title}：${a.detail}`)] : []),
    '',
    `> 文字由 AI 起草${opts.reviewer ? `，已由 ${opts.reviewer} 审核` : ''}；数字以系统核算为准。`,
    ...(opts.link ? [`[查看完整报表](${opts.link})`] : [])
  ].join('\n');
  return { title, markdown: md };
}
