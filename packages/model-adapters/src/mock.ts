/**
 * 模拟模型：只用于本地开发和自动化测试。isMock = true，界面和审计会标注“模拟模型”，不得当作真实接入。
 */
import { CompletionRequest, CompletionResult, ModelError, ModelProvider } from './types';

export type MockBehavior = 'ok' | 'invalid_json' | 'bad_schema' | 'timeout' | 'http_500';

export class MockModelProvider implements ModelProvider {
  readonly id = 'mock';
  readonly model = 'mock-briefing-1';
  readonly isMock = true;
  calls: CompletionRequest[] = [];

  constructor(private behavior: MockBehavior | (() => MockBehavior) = 'ok', private readonly responder?: (req: CompletionRequest) => string) {}

  setBehavior(b: MockBehavior | (() => MockBehavior)) { this.behavior = b; }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(req);
    const b = typeof this.behavior === 'function' ? this.behavior() : this.behavior;
    if (b === 'timeout') throw new ModelError('模型调用超时（模拟）', 'timeout');
    if (b === 'http_500') throw new ModelError('模型接口返回 HTTP 500（模拟）', 'http', 500);
    let text: string;
    if (b === 'invalid_json') text = '这不是 JSON';
    else if (b === 'bad_schema') text = JSON.stringify({ headline: 'x' });
    else text = this.responder ? this.responder(req) : defaultBriefing(req);
    const inputTokens = Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 2);
    const outputTokens = Math.ceil(text.length / 2);
    return { text, usage: { inputTokens, outputTokens }, model: this.model, provider: this.id, latencyMs: 1, costCny: 0 };
  }
}

/** 从 prompt 的事实表里取值拼一份合规草稿（只引用已有数字） */
function defaultBriefing(req: CompletionRequest): string {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const get = (label: string) => {
    const m = user.match(new RegExp('- ' + label + '：(-?[\\d.]+)'));
    return m ? m[1] : null;
  };
  const month = (user.match(/账期：(\d{4}-\d{2})/) || [])[1] || '本月';
  const np = get('净利润');
  const nm = get('净利率');
  const rev = get('营业收入');
  const top = (user.match(/1\. ([^：\n]+)：/) || [])[1];
  const risks: { title: string; detail: string }[] = [];
  const alertBlock = user.split('【系统预警】')[1] || '';
  alertBlock.split('\n').filter((l) => l.startsWith('- [')).slice(0, 3).forEach((l) => {
    const t = l.replace(/^- \[\w+\] /, '');
    const [title, detail] = t.split('：');
    risks.push({ title: title.slice(0, 60), detail: (detail || title).slice(0, 300) });
  });
  return JSON.stringify({
    headline: `${month} 净利润 ${np ?? '—'} 元，净利率 ${nm ?? '—'}%`,
    highlights: [
      `营业收入 ${rev ?? '—'} 元，净利润 ${np ?? '—'} 元。`,
      top ? `利润贡献最高的店铺是${top}。` : '店铺利润排名见报表。'
    ],
    risks,
    actions: [{ owner: '财务', title: '核对预警事项', detail: '逐条核对系统预警与对账差异，确认后在系统中备注原因。' }]
  });
}
