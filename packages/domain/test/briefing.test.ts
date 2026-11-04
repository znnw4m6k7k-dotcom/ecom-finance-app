import {
  assertTransition, buildBriefingFacts, buildBriefingPrompt, buildDemoData, can, computeModel, findUnverifiedNumbers,
  nextStatus, parseBriefingDraft, renderBriefingMarkdown, TransitionError, BriefingDraft
} from '../src';

const model = computeModel(buildDemoData());

describe('经营简报事实表', () => {
  const f = buildBriefingFacts(model, '2026-10');
  it('数字全部来自核算引擎', () => {
    const get = (k: string) => f.facts.find((x) => x.key === k)!.value;
    expect(get('netProfit')).toBeCloseTo(model.companyMonth['2026-10'].netProfit, 2);
    expect(get('revenue')).toBeCloseTo(model.companyMonth['2026-10'].revenue, 2);
    expect(f.stores).toHaveLength(3);
    expect(f.prevMonth).toBe('2026-09');
    expect(f.facts.some((x) => x.key === 'netProfitMoM')).toBe(true);
  });
  it('首月没有环比', () => {
    const f8 = buildBriefingFacts(model, '2026-08');
    expect(f8.prevMonth).toBeNull();
    expect(f8.facts.some((x) => x.key === 'netProfitMoM')).toBe(false);
  });
  it('超出数据范围的账期报错', () => {
    expect(() => buildBriefingFacts(model, '2025-01')).toThrow(/不在数据范围/);
  });
  it('prompt 包含预警与差异，并要求不得编造数字', () => {
    const p = buildBriefingPrompt(f);
    expect(p.system).toMatch(/不得编造/);
    expect(p.user).toContain('【系统预警】');
    expect(p.user).toContain('滞销');
  });
});

describe('AI 输出校验', () => {
  const ok: BriefingDraft = { headline: '10 月净利润 11.06 万元', highlights: ['营业收入 920603.27 元'], risks: [], actions: [] };
  it('接受合规 JSON（含代码块包裹）', () => {
    expect(parseBriefingDraft('```json\n' + JSON.stringify(ok) + '\n```').ok).toBe(true);
  });
  it('拒绝非 JSON、缺字段、多余字段', () => {
    expect(parseBriefingDraft('hello').ok).toBe(false);
    expect(parseBriefingDraft(JSON.stringify({ headline: 'abcd' })).ok).toBe(false);
    expect(parseBriefingDraft(JSON.stringify({ ...ok, price: 1 })).ok).toBe(false);
  });
  it('标出与事实表对不上的数字', () => {
    const f = buildBriefingFacts(model, '2026-10');
    expect(findUnverifiedNumbers(ok, f)).toEqual([]);
    const bad = { ...ok, highlights: ['净利润 999999.99 元，增长 37.5%'] };
    expect(findUnverifiedNumbers(bad, f)).toEqual(expect.arrayContaining(['999999.99', '37.5']));
  });
  it('通知文本带“AI 起草、数字以系统为准”的声明', () => {
    const f = buildBriefingFacts(model, '2026-10');
    const md = renderBriefingMarkdown(f, ok, { reviewer: '老板' }).markdown;
    expect(md).toContain('已由 老板 审核');
    expect(md).toContain('数字以系统核算为准');
  });
});

describe('状态机与权限', () => {
  it('只能按 草稿→待审核→通过/退回 流转', () => {
    expect(nextStatus('submit', 'DRAFT')).toBe('SUBMITTED');
    expect(nextStatus('approve', 'SUBMITTED')).toBe('APPROVED');
    expect(nextStatus('reject', 'SUBMITTED')).toBe('REJECTED');
    expect(nextStatus('edit', 'REJECTED')).toBe('DRAFT');
    expect(() => assertTransition('approve', 'DRAFT')).toThrow(TransitionError);
    expect(() => assertTransition('edit', 'APPROVED')).toThrow(TransitionError);
    expect(() => assertTransition('generate', 'SUBMITTED')).toThrow(TransitionError);
  });
  it('只有老板能审核，只读不能导入', () => {
    expect(can('OWNER', 'briefing:approve')).toBe(true);
    expect(can('FINANCE', 'briefing:approve')).toBe(false);
    expect(can('VIEWER', 'data:import')).toBe(false);
    expect(can(undefined, 'report:read')).toBe(false);
  });
});
