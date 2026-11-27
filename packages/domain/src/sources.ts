/**
 * 平台智能表 / 知识库 → 工作台（数据源同步）的纯业务规则，不含任何平台调用。
 *
 * 业务规则（hanson 2026-11-05 确认，见 docs/待确认事项.md Q14–Q17）：
 *  - 平台智能表是工作台真实数据的入口，方向单向：平台 → 工作台，工作台不回写平台。
 *  - 情况一：客户没用智能表 → 工作台在平台生成标准模板表（字段与导入模板一致，无需映射）。
 *  - 情况二：客户已有智能表 → 规则 + AI 给出字段对应建议（草稿），财务确认后才能同步。
 *  - 同一张业务表可以有多个来源；同一编号的数据来源之间不一致时不自动覆盖，列为冲突由财务选择。
 *  - 平台上删掉的行不直接删，先标记“来源已删除”，财务确认后再删。
 *  - 知识库分两类：数据型（全文进检索，可被 AI 引用）、查询型（只同步目录/标题，点开跳回原文）。
 */
import { z } from 'zod';
import { Dataset, DatasetTable, getImportTemplate, ImportTemplate, ParsedTable, Row } from './legacy';

// ---------------- 模板与字段 ----------------

/** 情况一默认生成的模板（hanson 确认：订单+订单明细、费用、平台账单；订单与明细在同一张表，一行一个商品，与现有导入一致） */
export const DEFAULT_TEMPLATE_TABLES = ['orders', 'expenses', 'platform_bills'] as const;

export type PlatformFieldType = 'text' | 'number' | 'date' | 'singleSelect';
export interface TemplateFieldSpec { key: string; name: string; type: PlatformFieldType; required: boolean; options?: string[] }

const TYPE_MAP: Record<string, PlatformFieldType> = { text: 'text', money: 'number', int: 'number', date: 'date', month: 'text', enum: 'singleSelect', ids: 'text' };

/** 某张导入表在平台上建模板时的字段（字段名 = 导入模板的中文标签，同步时天然对得上） */
export function templateFieldsFor(tableId: string): TemplateFieldSpec[] {
  const t = mustTemplate(tableId);
  return t.fields.map((f) => ({
    key: f.key,
    name: f.label,
    type: TYPE_MAP[f.type] ?? 'text',
    required: !!f.required,
    options: f.type === 'enum' && Array.isArray(f.values) ? f.values.map(String) : undefined
  }));
}

function mustTemplate(tableId: string): ImportTemplate {
  const t = getImportTemplate(tableId);
  if (!t) throw new Error('未知业务表：' + tableId);
  return t;
}

/** 每张导入表的业务主键字段（导入模板里的 key） */
export const SOURCE_PK: Record<string, string> = {
  orders: 'order_id', shipments: 'shipment_id', platform_bills: 'bill_id', payouts: 'payout_id', purchase: 'po_id',
  employees: 'employee_id', expenses: 'expense_id', invoices: 'invoice_id', skus: 'sku_id', stores: 'store_id', opening_inventory: 'sku_id'
};
/** 主键可以由系统补（平台记录 ID）的表；其余表主键必须由平台表提供 */
const PK_AUTOFILL = new Set(['shipments', 'payouts', 'expenses', 'invoices']);

// ---------------- 字段映射 ----------------

/** 平台字段名 → 导入模板字段 key（null 表示不导入） */
export type FieldMapping = Record<string, string | null>;
export interface MappingSuggestion { mapping: FieldMapping; by: Record<string, 'rule' | 'ai' | 'none'> }

export function normalizeFieldName(s: unknown): string {
  return String(s == null ? '' : s).replace(/^﻿/, '').replace(/[\s　]/g, '').replace(/[（）()]/g, '').replace(/[:：*]/g, '').toLowerCase();
}

/** 规则映射：按导入模板的中文名、别名、英文 key 完全匹配（与文件导入同一套别名） */
export function ruleSuggestMapping(platformFields: string[], tableId: string): MappingSuggestion {
  const t = mustTemplate(tableId);
  const used = new Set<string>();
  const mapping: FieldMapping = {};
  const by: MappingSuggestion['by'] = {};
  for (const pf of platformFields) {
    const n = normalizeFieldName(pf);
    const hit = t.fields.find((f) => !used.has(f.key) && [f.label, f.key, ...(f.aliases || [])].some((x) => normalizeFieldName(x) === n));
    if (hit) { mapping[pf] = hit.key; used.add(hit.key); by[pf] = 'rule'; } else { mapping[pf] = null; by[pf] = 'none'; }
  }
  return { mapping, by };
}

export interface MappingCheck { ok: boolean; missing: string[]; duplicates: string[]; unknown: string[] }

/** 映射是否可用：必填字段都有来源、一个模板字段只对应一个平台字段 */
export function checkMapping(mapping: FieldMapping, tableId: string): MappingCheck {
  const t = mustTemplate(tableId);
  const keys = new Set(t.fields.map((f) => f.key));
  const count: Record<string, number> = {};
  const unknown: string[] = [];
  for (const v of Object.values(mapping)) {
    if (!v) continue;
    if (!keys.has(v)) { unknown.push(v); continue; }
    count[v] = (count[v] || 0) + 1;
  }
  const pk = SOURCE_PK[tableId];
  const missing = t.fields.filter((f) => f.required && !count[f.key] && !(f.key === pk && PK_AUTOFILL.has(tableId))).map((f) => f.label);
  const duplicates = Object.keys(count).filter((k) => count[k] > 1).map((k) => t.fields.find((f) => f.key === k)!.label);
  return { ok: !missing.length && !duplicates.length && !unknown.length, missing, duplicates, unknown };
}

export const MAPPING_PROMPT_MARK = 'FIELD_MAPPING_V1';

/** AI 映射提示词：只给字段名和少量样例值（脱敏截断），只让 AI 选对应关系，不让它改数据 */
export function buildMappingPrompt(tableId: string, fields: { name: string; samples: string[] }[]) {
  const t = mustTemplate(tableId);
  const targets = t.fields.map((f) => `- ${f.key}：${f.label}（${f.type}${f.required ? '，必填' : ''}）`).join('\n');
  const src = fields.map((f) => `- ${f.name}：${f.samples.slice(0, 3).map((s) => String(s).slice(0, 30)).join(' | ') || '（无样例）'}`).join('\n');
  return {
    system: `${MAPPING_PROMPT_MARK}\n你是电商财务系统的数据导入助手。任务：把客户表格的列对应到系统字段。只输出 JSON：{"mapping": {"客户列名": "系统字段key或null"}}。不确定就填 null；一个系统字段最多对应一列；不要编造列名。`,
    user: `系统表：${t.label}\n系统字段：\n${targets}\n\n客户表格的列（列名：样例值）：\n${src}`
  };
}

const MappingOut = z.object({ mapping: z.record(z.string(), z.string().nullable()) });

/** 解析并收紧 AI 输出：未知列、未知字段、重复对应一律丢弃（AI 结果只是草稿） */
export function parseMappingSuggestion(text: string, tableId: string, platformFields: string[]): { ok: true; mapping: FieldMapping } | { ok: false; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return { ok: false, error: '不是合法 JSON' }; }
  const r = MappingOut.safeParse(raw);
  if (!r.success) return { ok: false, error: '结构不符：需要 {mapping:{列名:字段key|null}}' };
  const keys = new Set(mustTemplate(tableId).fields.map((f) => f.key));
  const allowed = new Set(platformFields);
  const used = new Set<string>();
  const out: FieldMapping = {};
  for (const [col, key] of Object.entries(r.data.mapping)) {
    if (!allowed.has(col) || !key || !keys.has(key) || used.has(key)) continue;
    out[col] = key; used.add(key);
  }
  return { ok: true, mapping: out };
}

/** 合并：规则命中优先，AI 只补规则没对上的列 */
export function mergeSuggestions(rule: MappingSuggestion, ai: FieldMapping | null): MappingSuggestion {
  const mapping = { ...rule.mapping };
  const by = { ...rule.by };
  const used = new Set(Object.values(mapping).filter(Boolean) as string[]);
  for (const [col, key] of Object.entries(ai || {})) {
    if (!(col in mapping) || mapping[col] || !key || used.has(key)) continue;
    mapping[col] = key; by[col] = 'ai'; used.add(key);
  }
  return { mapping, by };
}

// ---------------- 平台记录 → 导入表 ----------------

export interface PlatformRecord { id: string; fields: Record<string, unknown> }

function pad(n: number) { return String(n).padStart(2, '0'); }

/** 平台单元格值 → 文本（选项/人员/链接等对象取名称；日期时间戳按北京时间取日期） */
export function cellToText(v: unknown, fieldType?: string): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => cellToText(x, fieldType)).filter(Boolean).join(',');
  if (typeof v === 'number') {
    if ((fieldType === 'date' || fieldType === 'month') && v > 1e11) {
      const d = new Date(v + 8 * 3600_000);
      const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      return fieldType === 'month' ? ymd.slice(0, 7) : ymd;
    }
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['name', 'text', 'value', 'title', 'link', 'url']) if (o[k] != null && typeof o[k] !== 'object') return cellToText(o[k], fieldType);
    return '';
  }
  return String(v);
}

/**
 * 按映射把平台记录转成导入器认识的表（表头 = 模板中文名），之后完全复用文件导入的校验与转换。
 * 主键没映射、且该表允许系统补主键时，用平台记录 ID 生成稳定主键，保证反复同步不会重复。
 */
export function recordsToParsedTable(records: PlatformRecord[], mapping: FieldMapping, tableId: string, idPrefix = 'SRC-'): ParsedTable {
  const t = mustTemplate(tableId);
  const cols = Object.entries(mapping).filter(([, k]) => !!k) as [string, string][];
  const fieldOf = (k: string) => t.fields.find((f) => f.key === k)!;
  const headers = cols.map(([, k]) => fieldOf(k).label);
  const pk = SOURCE_PK[tableId];
  const autofill = PK_AUTOFILL.has(tableId) && !cols.some(([, k]) => k === pk);
  if (autofill) headers.push(fieldOf(pk).label);
  const rows = records.map((r) => {
    const row = cols.map(([col, k]) => cellToText(r.fields[col], fieldOf(k).type));
    if (autofill) row.push(idPrefix + r.id);
    return row;
  });
  return { headers, rows, source: 'platform' };
}

/** 导入器的行号（含表头，从 2 开始）→ 该行所属业务主键，用于整单剔除有错的行 */
export function rowKeysOf(parsed: ParsedTable, tableId: string): (string | null)[] {
  const t = mustTemplate(tableId);
  const pk = SOURCE_PK[tableId];
  const label = t.fields.find((f) => f.key === pk)!.label;
  const idx = parsed.headers.indexOf(label);
  return parsed.rows.map((r) => (idx >= 0 && r[idx] != null && String(r[idx]).trim() ? String(r[idx]).trim() : null));
}

/**
 * 去掉有错的行：同一业务主键（如同一订单的多行商品）只要一行有错就整单不写，避免写进半张订单。
 * 返回剩下的表和被剔除的主键。
 */
export function dropErrorRows(parsed: ParsedTable, tableId: string, errorRowNos: number[]): { parsed: ParsedTable; droppedKeys: string[]; droppedRows: number } {
  const keys = rowKeysOf(parsed, tableId);
  const badIdx = new Set(errorRowNos.filter((n) => n >= 2).map((n) => n - 2));
  const badKeys = new Set<string>();
  badIdx.forEach((i) => { if (keys[i]) badKeys.add(keys[i]!); });
  const rows: any[][] = [];
  let dropped = 0;
  parsed.rows.forEach((r, i) => {
    if (badIdx.has(i) || (keys[i] && badKeys.has(keys[i]!))) { dropped++; return; }
    rows.push(r);
  });
  return { parsed: { ...parsed, rows }, droppedKeys: [...badKeys], droppedRows: dropped };
}

// ---------------- 同步计划：新增 / 更新 / 不变 / 冲突 / 来源已删除 ----------------

interface TableShape { main: DatasetTable; key: string; child?: { table: DatasetTable; fk: string } }

export function tableShape(tableId: string): TableShape {
  if (tableId === 'orders') return { main: 'orders', key: 'id', child: { table: 'order_items', fk: 'order_id' } };
  if (tableId === 'purchase') return { main: 'purchase_orders', key: 'id', child: { table: 'purchase_items', fk: 'po_id' } };
  const main = mustTemplate(tableId).tables[0] as DatasetTable;
  return { main, key: main === 'opening_inventory' ? 'sku_id' : 'id' };
}

/** 一条业务数据 = 主表一行 + 子表若干行（订单+明细、采购单+明细） */
export interface Unit { main: Row; children: Row[] }

export function unitsFrom(tableId: string, data: Partial<Record<DatasetTable, Row[]>>): Map<string, Unit> {
  const s = tableShape(tableId);
  const out = new Map<string, Unit>();
  for (const r of data[s.main] || []) out.set(String(r[s.key]), { main: r, children: [] });
  if (s.child) for (const c of data[s.child.table] || []) out.get(String(c[s.child.fk]))?.children.push(c);
  return out;
}

export function unitsToPatch(tableId: string, units: Unit[]): Partial<Record<DatasetTable, Row[]>> {
  const s = tableShape(tableId);
  const patch: Partial<Record<DatasetTable, Row[]>> = { [s.main]: units.map((u) => u.main) };
  if (s.child) patch[s.child.table] = units.flatMap((u) => u.children);
  return patch;
}

/** 从数据集里删掉若干条业务数据（含子表），返回新数据集（不改入参） */
export function removeUnits(dataset: Dataset, tableId: string, keys: string[]): Dataset {
  const s = tableShape(tableId);
  const del = new Set(keys);
  const out: any = { ...dataset };
  out[s.main] = (dataset as any)[s.main].filter((r: Row) => !del.has(String(r[s.key])));
  if (s.child) out[s.child.table] = (dataset as any)[s.child.table].filter((r: Row) => !del.has(String(r[s.child!.fk])));
  return out as Dataset;
}

/** 工作台里每条数据的来源记录（谁写的、写进去时的内容指纹） */
export interface Provenance { dataSourceId: string | null; hash: string; deletedAtSource?: boolean }

export interface SyncPlan {
  accept: Unit[];
  created: string[];
  updated: string[];
  unchanged: string[];
  conflicts: { key: string; existing: Unit; incoming: Unit; existingOwner: string | null }[];
  /** 上次由本来源写入、这次平台上已经没有的数据 → 标记“来源已删除”，等财务确认 */
  missingAtSource: string[];
  /** 之前标记了“来源已删除”、这次平台上又出现的数据 → 取消标记 */
  reappeared: string[];
}

/**
 * 同步规则（Q17：同一张表允许多个来源）：
 *  - 工作台没有 → 新增；
 *  - 本来源写的、且之后没被别人改过 → 直接更新；
 *  - 内容完全相同 → 不变；
 *  - 其余（别的来源或文件导入写的，或写入后被别人改过）且内容不同 → 冲突，不覆盖，交给财务选。
 * `hash` 由调用方提供（需按数据库字段类型规范化后再算，避免格式差异被误判成冲突）。
 */
export function planSourceSync(input: {
  tableId: string;
  dataSourceId: string;
  incoming: Map<string, Unit>;
  existing: Map<string, Unit>;
  provenance: Map<string, Provenance>;
  /** 这次平台上存在、但因校验错误没写入的主键：不能算“来源已删除” */
  skippedKeys?: string[];
  hash: (u: Unit) => string;
}): SyncPlan {
  const plan: SyncPlan = { accept: [], created: [], updated: [], unchanged: [], conflicts: [], missingAtSource: [], reappeared: [] };
  for (const [key, inc] of input.incoming) {
    const ex = input.existing.get(key);
    const prov = input.provenance.get(key);
    if (prov?.deletedAtSource && prov.dataSourceId === input.dataSourceId) plan.reappeared.push(key);
    if (!ex) { plan.accept.push(inc); plan.created.push(key); continue; }
    const hEx = input.hash(ex);
    if (input.hash(inc) === hEx) { plan.unchanged.push(key); continue; }
    if (prov && prov.dataSourceId === input.dataSourceId && prov.hash === hEx) { plan.accept.push(inc); plan.updated.push(key); continue; }
    plan.conflicts.push({ key, existing: ex, incoming: inc, existingOwner: prov ? prov.dataSourceId : null });
  }
  const seen = new Set([...input.incoming.keys(), ...(input.skippedKeys || [])]);
  for (const [key, prov] of input.provenance) {
    if (prov.dataSourceId === input.dataSourceId && !prov.deletedAtSource && !seen.has(key) && input.existing.has(key)) plan.missingAtSource.push(key);
  }
  return plan;
}

/** 稳定 JSON（键排序），用于内容指纹 */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + stableStringify((v as any)[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

// ---------------- 知识库 ----------------

export const KNOWLEDGE_MODES = ['data', 'reference'] as const;
export type KnowledgeMode = (typeof KNOWLEDGE_MODES)[number];
export const KNOWLEDGE_MODE_LABELS: Record<KnowledgeMode, string> = { data: '数据型（全文检索，AI 可引用）', reference: '查询型（只同步目录，点开看原文）' };

/** 单篇正文上限（字符）。超出截断并标注，避免把超大文档整篇塞进数据库和模型 */
export const KNOWLEDGE_MAX_CHARS = 200_000;

/** 搜索结果摘要：取命中词附近的一段 */
export function snippetAround(text: string, q: string, width = 60): string {
  const s = String(text || '');
  const i = s.toLowerCase().indexOf(String(q).toLowerCase());
  if (i < 0) return s.slice(0, width * 2);
  const start = Math.max(0, i - width);
  return (start > 0 ? '…' : '') + s.slice(start, i + q.length + width) + (i + q.length + width < s.length ? '…' : '');
}
