/**
 * 模拟连接器：只记录到内存，不发出任何外部请求。isMock = true，投递记录会标注“模拟”，不得说成已接通平台。
 * 数据源部分用内存里的假表格/假知识库，供本地演示和自动化测试；界面和同步记录会标注“模拟”。
 */
import {
  Capabilities, ConnectorContext, DataCapabilities, DeliveryResult, EntryLinkInput, ExternalIdentity, InternalUserIdentity,
  KnowledgeNode, KnowledgeRef, NormalizedEvent, NotificationInput, NotSupportedError, Operator, Page, PlatformDataSource,
  PlatformField, PlatformRecord, SheetInfo, TableRef, TemplateFieldInput, WorkspaceConnector
} from './types';

export interface MockSheet { sheetId: string; name: string; fields: PlatformField[]; records: PlatformRecord[] }
export interface MockKnowledgeNode extends KnowledgeNode { parentId: string | null; text?: string }

export class MockConnector implements WorkspaceConnector, PlatformDataSource {
  readonly provider = 'mock' as const;
  readonly isMock = true;
  readonly sent: { input: NotificationInput; ctx: ConnectorContext }[] = [];
  failNext = 0;
  /** baseId → 数据表 */
  readonly bases = new Map<string, MockSheet[]>();
  /** workspaceId → 节点 */
  readonly spaces = new Map<string, MockKnowledgeNode[]>();
  readonly operators: Operator[] = [];
  pageSize = 100;

  constructor() { seedMockData(this); }

  capabilities(): Capabilities {
    return { login: false, appEntry: true, sendNotification: true, receiveEvents: false, nativeApproval: false };
  }
  async verifyAndNormalizeEvent(_i: unknown, _c: ConnectorContext): Promise<NormalizedEvent> { throw new NotSupportedError('mock', 'receiveEvents'); }
  async resolveIdentity(_i: ExternalIdentity, _c: ConnectorContext): Promise<InternalUserIdentity> { throw new NotSupportedError('mock', 'login'); }
  async sendNotification(input: NotificationInput, ctx: ConnectorContext): Promise<DeliveryResult> {
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, provider: 'mock', channel: 'memory', isMock: true, error: '模拟投递失败', retryable: true };
    }
    this.sent.push({ input, ctx });
    return { ok: true, provider: 'mock', channel: 'memory', isMock: true, externalId: 'mock-' + this.sent.length };
  }
  async buildAppEntry(input: EntryLinkInput): Promise<string> { return input.url; }

  // ---------------- 模拟数据源 ----------------
  dataCapabilities(): DataCapabilities {
    return { readTables: true, createTables: true, readKnowledge: true, readDocText: true, readUserCreatedTables: true };
  }
  /** 模拟链接：mock://table/{baseId}?sheetId=… / mock://kb/{workspaceId} */
  parseTableLink(url: string): TableRef {
    const m = String(url).match(/^mock:\/\/table\/([\w-]+)(?:\?sheetId=([\w-]+))?$/);
    if (!m) throw new Error('模拟模式下请使用 mock://table/<表格ID> 形式的链接');
    return { baseId: m[1], sheetId: m[2] };
  }
  parseKnowledgeLink(url: string): KnowledgeRef {
    const m = String(url).match(/^mock:\/\/kb\/([\w-]+)$/);
    if (!m) throw new Error('模拟模式下请使用 mock://kb/<知识库ID> 形式的链接');
    return { workspaceId: m[1] };
  }
  private base(ref: TableRef): MockSheet[] {
    const b = this.bases.get(ref.baseId);
    if (!b) throw Object.assign(new Error('模拟表格不存在：' + ref.baseId), { status: 404 });
    return b;
  }
  private sheet(ref: TableRef): MockSheet {
    const s = this.base(ref).find((x) => x.sheetId === ref.sheetId);
    if (!s) throw Object.assign(new Error('模拟数据表不存在：' + ref.sheetId), { status: 404 });
    return s;
  }
  async listSheets(ref: TableRef, op: Operator): Promise<SheetInfo[]> { this.operators.push(op); return this.base(ref).map((s) => ({ sheetId: s.sheetId, name: s.name })); }
  async listFields(ref: TableRef, op: Operator): Promise<PlatformField[]> { this.operators.push(op); return this.sheet(ref).fields; }
  async listRecords(ref: TableRef, op: Operator, pageToken?: string): Promise<Page<PlatformRecord>> {
    this.operators.push(op);
    const all = this.sheet(ref).records;
    const start = Number(pageToken || 0);
    const items = all.slice(start, start + this.pageSize);
    return { items: JSON.parse(JSON.stringify(items)), nextPageToken: start + this.pageSize < all.length ? String(start + this.pageSize) : undefined };
  }
  async createSheet(ref: TableRef, input: { name: string; fields: TemplateFieldInput[] }, op: Operator): Promise<SheetInfo> {
    this.operators.push(op);
    if (!this.bases.has(ref.baseId)) this.bases.set(ref.baseId, []);
    const list = this.bases.get(ref.baseId)!;
    const sheet: MockSheet = { sheetId: 'sheet' + (list.length + 1), name: input.name, fields: input.fields.map((f) => ({ name: f.name, type: f.type })), records: [] };
    list.push(sheet);
    return { sheetId: sheet.sheetId, name: sheet.name };
  }
  async listKnowledgeNodes(ref: KnowledgeRef, op: Operator, parentNodeId?: string): Promise<Page<KnowledgeNode>> {
    this.operators.push(op);
    const nodes = this.spaces.get(ref.workspaceId || '');
    if (!nodes) throw Object.assign(new Error('模拟知识库不存在'), { status: 404 });
    return { items: nodes.filter((n) => n.parentId === (parentNodeId ?? null)).map(({ parentId: _p, text: _t, ...n }) => n) };
  }
  async getDocText(node: KnowledgeNode): Promise<string> {
    for (const nodes of this.spaces.values()) { const n = nodes.find((x) => x.nodeId === node.nodeId); if (n) return n.text || ''; }
    return '';
  }
}

/** 演示用假数据：一张客户自建的“费用登记”表（字段名与系统不同，需要映射）+ 一个知识库 */
function seedMockData(c: MockConnector) {
  c.bases.set('demo-expense', [{
    sheetId: 'sheet1', name: '费用登记（客户自建）',
    fields: [{ name: '发生日期', type: 'date' }, { name: '费用类型', type: 'singleSelect' }, { name: '店铺编码', type: 'text' }, { name: '收款方', type: 'text' }, { name: '金额(元)', type: 'number' }, { name: '经办人', type: 'user' }],
    records: [
      { id: 'rec001', fields: { 发生日期: Date.UTC(2026, 9, 8), 费用类型: { name: '仓储费' }, 店铺编码: 'TB01', 收款方: '华东云仓（虚构）', '金额(元)': 3200, 经办人: [{ name: '王芳' }] } },
      { id: 'rec002', fields: { 发生日期: Date.UTC(2026, 9, 12), 费用类型: { name: '办公费' }, 店铺编码: '', 收款方: '文具店（虚构）', '金额(元)': 186.5, 经办人: [{ name: '王芳' }] } }
    ]
  }]);
  c.spaces.set('demo-kb', [
    { nodeId: 'n-rules', parentId: null, name: '财务规则', kind: 'folder', hasChildren: true },
    { nodeId: 'n-fee', parentId: 'n-rules', name: '店铺费率说明', kind: 'doc', url: 'mock://doc/n-fee', text: '天猫旗舰店佣金费率 5%，技术服务费 2%。小红书店铺佣金 5%。' },
    { nodeId: 'n-comm', parentId: 'n-rules', name: '运营提成规则', kind: 'doc', url: 'mock://doc/n-comm', text: '提成按店铺毛利阶梯计算：10 万以内 3%，10–30 万 4%，30 万以上 5%。' },
    { nodeId: 'n-manual', parentId: null, name: '报销操作手册', kind: 'doc', url: 'mock://doc/n-manual', text: '报销需在钉钉审批里提交，附发票照片。' }
  ]);
}
