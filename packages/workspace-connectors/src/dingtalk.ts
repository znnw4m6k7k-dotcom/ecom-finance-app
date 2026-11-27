/**
 * 钉钉连接器（P0 测试平台）。
 *
 * 状态：按钉钉开放平台公开文档实现，**尚未用真实企业应用联调**。
 * 联调前需要客户管理员在钉钉开放平台创建企业内部应用并授权，凭证只通过环境变量注入。
 *
 * 通知支持两种通道：
 *  - robot：群自定义机器人 Webhook + 加签（最快验证；消息进指定群）
 *  - work_notice：企业内部应用“工作通知”（发给指定员工；需要 AgentId 与通讯录 userid 授权范围）
 * 身份：H5 微应用免登，前端 JSAPI 取 authCode，后端换 userid（login 能力）。
 * 事件接收：P0 不做（钉钉推荐 Stream 模式，后续增量实现），receiveEvents = false。
 */
import { createHmac } from 'node:crypto';
import {
  Capabilities, ConnectorConfigError, ConnectorContext, DataCapabilities, DeliveryResult, EntryLinkInput, ExternalIdentity,
  InternalUserIdentity, KnowledgeNode, KnowledgeRef, NormalizedEvent, NotSupportedError, NotificationInput, Operator, Page,
  PlatformDataSource, PlatformField, PlatformRecord, SheetInfo, TableRef, TemplateFieldInput, WorkspaceConnector
} from './types';

export interface DingTalkConfig {
  notifyChannel: 'robot' | 'work_notice';
  /** 企业内部应用 AppKey / AppSecret（work_notice 与免登需要） */
  appKey?: string;
  appSecret?: string;
  agentId?: string;
  /** 群机器人 webhook 的 access_token 与加签密钥（robot 需要） */
  robotAccessToken?: string;
  robotSecret?: string;
  apiBase?: string; // 默认 https://api.dingtalk.com
  oapiBase?: string; // 默认 https://oapi.dingtalk.com
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** 钉钉群机器人加签：base64(HmacSHA256(secret, `${timestamp}\n${secret}`))，再 URL 编码 */
export function dingtalkRobotSign(timestamp: number, secret: string): string {
  const raw = createHmac('sha256', secret).update(`${timestamp}\n${secret}`, 'utf8').digest('base64');
  return encodeURIComponent(raw);
}

export class DingTalkConnector implements WorkspaceConnector, PlatformDataSource {
  readonly provider = 'dingtalk' as const;
  readonly isMock = false;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly apiBase: string;
  private readonly oapiBase: string;

  constructor(private readonly cfg: DingTalkConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? Date.now;
    this.apiBase = (cfg.apiBase ?? 'https://api.dingtalk.com').replace(/\/+$/, '');
    this.oapiBase = (cfg.oapiBase ?? 'https://oapi.dingtalk.com').replace(/\/+$/, '');
    if (cfg.notifyChannel === 'robot' && (!cfg.robotAccessToken || !cfg.robotSecret)) {
      throw new ConnectorConfigError('钉钉群机器人模式需要 DINGTALK_ROBOT_ACCESS_TOKEN 与 DINGTALK_ROBOT_SECRET');
    }
    if (cfg.notifyChannel === 'work_notice' && (!cfg.appKey || !cfg.appSecret || !cfg.agentId)) {
      throw new ConnectorConfigError('钉钉工作通知模式需要 DINGTALK_APP_KEY、DINGTALK_APP_SECRET、DINGTALK_AGENT_ID');
    }
  }

  capabilities(): Capabilities {
    const hasApp = !!(this.cfg.appKey && this.cfg.appSecret);
    return { login: hasApp, appEntry: true, sendNotification: true, receiveEvents: false, nativeApproval: false };
  }

  async verifyAndNormalizeEvent(_input: unknown, _ctx: ConnectorContext): Promise<NormalizedEvent> {
    throw new NotSupportedError('dingtalk', 'receiveEvents', 'P0 不接收钉钉事件，后续用 Stream 模式实现');
  }

  private async postJson(url: string, body: unknown): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 10000);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(`钉钉接口 HTTP ${res.status}${json?.code ? '：' + json.code : ''}`);
        (err as any).retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      return json;
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const err = new Error('钉钉接口超时');
        (err as any).retryable = true;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 企业内部应用 accessToken（缓存到过期前 5 分钟） */
  async getAccessToken(): Promise<string> {
    if (!this.cfg.appKey || !this.cfg.appSecret) throw new ConnectorConfigError('未配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET');
    const t = this.now();
    if (this.token && this.token.expiresAt - 300_000 > t) return this.token.value;
    const json = await this.postJson(`${this.apiBase}/v1.0/oauth2/accessToken`, { appKey: this.cfg.appKey, appSecret: this.cfg.appSecret });
    if (!json?.accessToken) throw new Error('钉钉 accessToken 获取失败');
    this.token = { value: json.accessToken, expiresAt: t + Number(json.expireIn || 7200) * 1000 };
    return this.token.value;
  }

  async resolveIdentity(input: ExternalIdentity, _ctx: ConnectorContext): Promise<InternalUserIdentity> {
    if (!input.authCode) throw new Error('缺少钉钉免登 authCode');
    const token = await this.getAccessToken();
    const json = await this.postJson(`${this.oapiBase}/topapi/v2/user/getuserinfo?access_token=${encodeURIComponent(token)}`, { code: input.authCode });
    if (json?.errcode !== 0 || !json?.result?.userid) throw new Error(`钉钉免登失败：errcode=${json?.errcode ?? '?'}`);
    return { provider: 'dingtalk', externalUserId: String(json.result.userid), name: json.result.name, unionId: json.result.unionid };
  }

  async sendNotification(input: NotificationInput, _ctx: ConnectorContext): Promise<DeliveryResult> {
    const msg = { msgtype: 'markdown', markdown: { title: input.title.slice(0, 64), text: input.markdown } };
    try {
      if (this.cfg.notifyChannel === 'robot') {
        const ts = this.now();
        const url = `${this.oapiBase}/robot/send?access_token=${encodeURIComponent(this.cfg.robotAccessToken!)}&timestamp=${ts}&sign=${dingtalkRobotSign(ts, this.cfg.robotSecret!)}`;
        const json = await this.postJson(url, msg);
        if (json?.errcode !== 0) return { ok: false, provider: 'dingtalk', channel: 'robot', isMock: false, error: `钉钉机器人返回 errcode=${json?.errcode}：${json?.errmsg ?? ''}`, retryable: json?.errcode === 130101 };
        return { ok: true, provider: 'dingtalk', channel: 'robot', isMock: false };
      }
      if (!input.recipients.length) return { ok: false, provider: 'dingtalk', channel: 'work_notice', isMock: false, error: '没有可通知的钉钉用户（请先绑定员工钉钉账号）', retryable: false };
      const token = await this.getAccessToken();
      const json = await this.postJson(`${this.oapiBase}/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(token)}`, {
        agent_id: Number(this.cfg.agentId), userid_list: input.recipients.join(','), msg
      });
      if (json?.errcode !== 0) return { ok: false, provider: 'dingtalk', channel: 'work_notice', isMock: false, error: `钉钉工作通知返回 errcode=${json?.errcode}：${json?.errmsg ?? ''}`, retryable: false };
      return { ok: true, provider: 'dingtalk', channel: 'work_notice', isMock: false, externalId: String(json.task_id ?? '') };
    } catch (e) {
      return { ok: false, provider: 'dingtalk', channel: this.cfg.notifyChannel, isMock: false, error: (e as Error).message, retryable: (e as any).retryable ?? true };
    }
  }

  /** 在钉钉内打开系统页面的链接（工作台/消息中可点击） */
  async buildAppEntry(input: EntryLinkInput, _ctx: ConnectorContext): Promise<string> {
    return `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(input.url)}&pc_slide=false`;
  }

  // ---------------- 数据源：AI 表格 / 知识库（已实现未联调，接口以钉钉开放平台当前文档为准） ----------------

  dataCapabilities(): DataCapabilities {
    const hasApp = !!(this.cfg.appKey && this.cfg.appSecret);
    return { readTables: hasApp, createTables: hasApp, readKnowledge: hasApp, readDocText: hasApp, readUserCreatedTables: hasApp };
  }

  /** 新版接口（api.dingtalk.com）：accessToken 放在 x-acs-dingtalk-access-token 头里 */
  private async api(method: 'GET' | 'POST', pathAndQuery: string, body?: unknown): Promise<any> {
    const token = await this.getAccessToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 15000);
    try {
      const res = await this.fetchImpl(`${this.apiBase}${pathAndQuery}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-acs-dingtalk-access-token': token },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = json?.code ? `${json.code}` : `HTTP ${res.status}`;
        const hint = res.status === 403 || /forbidden|permission|NoPermission/i.test(code)
          ? '（没有权限：请确认钉钉应用已开通 AI 表格 / 知识库相关权限并发布，且绑定的员工本人能看到这份文档）'
          : res.status === 404 ? '（找不到：请检查链接是否正确、文档是否已删除）' : '';
        const err = new Error(`钉钉接口返回 ${code}${json?.message ? '：' + json.message : ''}${hint}`);
        (err as any).retryable = res.status >= 500 || res.status === 429;
        (err as any).status = res.status;
        throw err;
      }
      return json;
    } catch (e) {
      if ((e as Error).name === 'AbortError') { const err = new Error('钉钉接口超时'); (err as any).retryable = true; throw err; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private op(op: Operator): string {
    if (!op.unionId) throw new ConnectorConfigError('读取钉钉文档需要操作人的 unionId：请先在钉钉里打开工作台完成免登绑定');
    return encodeURIComponent(op.unionId);
  }

  /** AI 表格链接：https://alidocs.dingtalk.com/i/nodes/{baseId}?…sheetId=… （sheetId 可能在 iframeQuery 里） */
  parseTableLink(url: string): TableRef {
    const u = safeUrl(url);
    const m = u?.pathname.match(/\/nodes\/([A-Za-z0-9_-]{6,})/);
    if (!u || !/dingtalk\.com$/.test(u.hostname) || !m) throw new Error('不是钉钉 AI 表格链接：请在钉钉里打开表格，点右上角“分享/复制链接”后粘贴');
    let sheetId = u.searchParams.get('sheetId') || undefined;
    const iq = u.searchParams.get('iframeQuery');
    if (!sheetId && iq) sheetId = new URLSearchParams(iq).get('sheetId') || undefined;
    return { baseId: m[1], sheetId };
  }

  /** 知识库链接：/i/spaces/{workspaceId}/… 或某个目录节点 /i/nodes/{nodeId} */
  parseKnowledgeLink(url: string): KnowledgeRef {
    const u = safeUrl(url);
    if (!u || !/dingtalk\.com$/.test(u.hostname)) throw new Error('不是钉钉知识库链接');
    const sp = u.pathname.match(/\/spaces\/([A-Za-z0-9_-]{6,})/);
    if (sp) return { workspaceId: sp[1] };
    const nd = u.pathname.match(/\/nodes\/([A-Za-z0-9_-]{6,})/);
    if (nd) return { rootNodeId: nd[1] };
    throw new Error('无法从链接识别知识库：请复制知识库首页或某个目录的链接');
  }

  async listSheets(ref: TableRef, op: Operator): Promise<SheetInfo[]> {
    const json = await this.api('GET', `/v1.0/notable/bases/${encodeURIComponent(ref.baseId)}/sheets?operatorId=${this.op(op)}`);
    const list: any[] = json?.value ?? json?.sheets ?? [];
    return list.map((s) => ({ sheetId: String(s.id ?? s.sheetId), name: String(s.name ?? '') }));
  }

  async listFields(ref: TableRef, op: Operator): Promise<PlatformField[]> {
    if (!ref.sheetId) throw new Error('缺少数据表（sheet）');
    const json = await this.api('GET', `/v1.0/notable/bases/${encodeURIComponent(ref.baseId)}/sheets/${encodeURIComponent(ref.sheetId)}/fields?operatorId=${this.op(op)}`);
    const list: any[] = json?.value ?? json?.fields ?? [];
    return list.map((f) => ({ id: f.id, name: String(f.name), type: String(f.type ?? 'text') }));
  }

  async listRecords(ref: TableRef, op: Operator, pageToken?: string): Promise<Page<PlatformRecord>> {
    if (!ref.sheetId) throw new Error('缺少数据表（sheet）');
    const json = await this.api('POST', `/v1.0/notable/bases/${encodeURIComponent(ref.baseId)}/sheets/${encodeURIComponent(ref.sheetId)}/records/list?operatorId=${this.op(op)}`,
      { maxResults: 100, ...(pageToken ? { nextToken: pageToken } : {}) });
    const items = (json?.records ?? []).map((r: any) => ({ id: String(r.id), fields: r.fields ?? {} }));
    return { items, nextPageToken: json?.hasMore && json?.nextToken ? String(json.nextToken) : undefined };
  }

  async createSheet(ref: TableRef, input: { name: string; fields: TemplateFieldInput[] }, op: Operator): Promise<SheetInfo> {
    const fields = input.fields.map((f) => {
      if (f.type === 'singleSelect') return { name: f.name, type: 'singleSelect', property: { choices: (f.options || []).map((name) => ({ name })) } };
      if (f.type === 'date') return { name: f.name, type: 'date', property: { formatter: 'YYYY-MM-DD' } };
      return { name: f.name, type: f.type };
    });
    const json = await this.api('POST', `/v1.0/notable/bases/${encodeURIComponent(ref.baseId)}/sheets?operatorId=${this.op(op)}`, { name: input.name, fields });
    return { sheetId: String(json?.id ?? json?.sheetId), name: String(json?.name ?? input.name) };
  }

  async listKnowledgeNodes(ref: KnowledgeRef, op: Operator, parentNodeId?: string, pageToken?: string): Promise<Page<KnowledgeNode>> {
    let parent = parentNodeId || ref.rootNodeId;
    if (!parent) {
      if (!ref.workspaceId) throw new Error('缺少知识库 ID');
      const ws = await this.api('GET', `/v2.0/wiki/workspaces/${encodeURIComponent(ref.workspaceId)}?operatorId=${this.op(op)}`);
      parent = ws?.workspace?.rootNodeId;
      if (!parent) throw new Error('钉钉没有返回知识库根目录');
    }
    const q = new URLSearchParams({ parentNodeId: parent, operatorId: op.unionId || '', maxResults: '50' });
    if (!op.unionId) this.op(op);
    if (pageToken) q.set('nextToken', pageToken);
    const json = await this.api('GET', `/v2.0/wiki/nodes?${q.toString()}`);
    const items: KnowledgeNode[] = (json?.nodes ?? []).map((n: any) => {
      const folder = String(n.type).toUpperCase() === 'FOLDER';
      const cat = String(n.category ?? '').toUpperCase();
      const ext = String(n.extension ?? '').toLowerCase();
      const kind: KnowledgeNode['kind'] = folder ? 'folder' : cat === 'DOCUMENT' || ext === 'adoc' ? 'doc' : cat === 'TABLE' || ext === 'able' || ext === 'axls' ? 'table' : cat ? 'file' : 'other';
      return { nodeId: String(n.nodeId), name: String(n.name ?? ''), kind, url: n.url, updatedAt: n.modifiedTime ?? n.updateTime, hasChildren: folder || !!n.hasChildren, docId: String(n.nodeId) };
    });
    return { items, nextPageToken: json?.nextToken ? String(json.nextToken) : undefined };
  }

  /** 读文档正文：查询文档块元素后抽取文字（接口与返回结构需联调确认） */
  async getDocText(node: KnowledgeNode, op: Operator): Promise<string> {
    if (node.kind !== 'doc') return '';
    const json = await this.api('GET', `/v1.0/doc/suites/documents/${encodeURIComponent(node.docId || node.nodeId)}/blocks?operatorId=${this.op(op)}`);
    return extractText(json?.result?.data ?? json?.result ?? json).trim();
  }
}

function safeUrl(s: string): URL | null { try { return new URL(String(s).trim()); } catch { return null; } }

/** 从文档块结构里递归取出所有文字，块之间换行 */
export function extractText(v: unknown, depth = 0): string {
  if (depth > 30 || v == null) return '';
  if (Array.isArray(v)) return v.map((x) => extractText(x, depth + 1)).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const own = typeof o.text === 'string' ? o.text : typeof o.content === 'string' ? o.content : '';
    const kids = Object.entries(o).filter(([k, x]) => k !== 'text' && k !== 'content' && x && typeof x === 'object').map(([, x]) => extractText(x, depth + 1)).filter(Boolean).join(own ? '' : '\n');
    return [own, kids].filter(Boolean).join('');
  }
  return '';
}
