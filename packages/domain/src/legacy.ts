/**
 * 复用 Demo 已通过验收的核算引擎 / 导入器（legacy/src，原样保留，不改口径）。
 * 这里只加类型外壳，前后端共用同一份核算代码，避免两套口径。
 */
import * as path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const legacyDir = path.join(__dirname, '..', 'legacy', 'src');
/* eslint-disable @typescript-eslint/no-require-imports */
const engine = require(path.join(legacyDir, 'engine.js'));
const demo = require(path.join(legacyDir, 'data.js'));
const importer = require(path.join(legacyDir, 'importer.js'));
const templates = require(path.join(legacyDir, 'templates.js'));
const xlsx = require(path.join(legacyDir, 'xlsx.js'));
/* eslint-enable @typescript-eslint/no-require-imports */

export type Row = Record<string, any>;

export interface Dataset {
  meta: Row;
  settings: Row;
  stores: Row[];
  suppliers: Row[];
  skus: Row[];
  employees: Row[];
  opening_inventory: Row[];
  orders: Row[];
  order_items: Row[];
  shipments: Row[];
  purchase_orders: Row[];
  purchase_items: Row[];
  platform_bills: Row[];
  payouts: Row[];
  expenses: Row[];
  invoices: Row[];
}

export const DATASET_TABLES = [
  'stores', 'suppliers', 'skus', 'employees', 'opening_inventory',
  'orders', 'order_items', 'shipments', 'purchase_orders', 'purchase_items',
  'platform_bills', 'payouts', 'expenses', 'invoices'
] as const;
export type DatasetTable = (typeof DATASET_TABLES)[number];

export interface Check { id: string; label: string; ok: boolean; expected?: number; actual?: number; diff?: number; detail?: string }

/** computeModel 的输出结构见 legacy 文档 docs/data-schema.md §4；这里只声明简报用到的字段 */
export interface FinanceModel {
  months: string[];
  stores: Row[];
  storeMonth: Record<string, Record<string, Row>>;
  companyMonth: Record<string, Row>;
  total: Row;
  inventory: { bySku: Row[]; total: Row };
  reconciliation: { bills: Row[]; payoutDiffs: Row[]; summary: Row };
  cash: { byStore: Record<string, Row>; total: Row };
  invoices: { input: Row; output: Row; issues: Row[] };
  checks: Check[];
  alerts: Row[];
  kpis: Record<string, Row>;
  [k: string]: any;
}

export function computeModel(data: Dataset): FinanceModel {
  return engine.computeModel(data);
}

export function buildDemoData(): Dataset {
  return demo.buildDemoData();
}

export const SETTINGS_DEFAULTS: Row = engine.SETTINGS_DEFAULTS;

export interface ParsedTable { headers: string[]; rows: any[][]; truncated?: boolean; source?: string }

export interface ImportPreparation {
  ok: boolean;
  tableId: string;
  label?: string;
  headers: string[];
  mapping: Record<string, string>;
  unmatched?: string[];
  missing?: string[];
  errors: { row: number; field: string; value: any; message: string }[];
  errorCount?: number;
  warnings: string[];
  warningCount?: number;
  preview: Row[];
  patch: Partial<Record<DatasetTable, Row[]>>;
  stats: { rows: number; valid: number; outputRows?: number };
}

export const IMPORT_TABLE_IDS: string[] = templates.TABLES
  ? templates.TABLES.map((t: Row) => t.id)
  : ['orders', 'shipments', 'platform_bills', 'payouts', 'purchase', 'employees', 'expenses', 'invoices', 'skus', 'stores', 'opening_inventory'];

export function parseCsv(text: string): ParsedTable {
  const p = importer.parseCsv(text);
  return { headers: p.headers, rows: p.rows, source: 'csv' };
}

export async function parseXlsx(buf: ArrayBuffer | Uint8Array, maxRows = 20000): Promise<ParsedTable> {
  const res = await xlsx.parseXlsx(buf, { maxRows });
  const rows: any[][] = res.rows || [];
  if (!rows.length) return { headers: [], rows: [], source: 'xlsx' };
  return { headers: rows[0].map((h: any) => String(h).trim()), rows: rows.slice(1), truncated: res.truncated, source: 'xlsx' };
}

export function prepareImport(tableId: string, parsed: ParsedTable, dataset: Dataset): ImportPreparation {
  return importer.prepare(tableId, parsed, dataset, 'append');
}

export function applyImport(dataset: Dataset, patch: ImportPreparation['patch'], mode: 'append' | 'replace'): Dataset {
  return importer.apply(dataset, patch, mode);
}

/** patch 中出现的表 + 它们的子表：持久化时需要整表重写 */
export function tablesTouchedBy(patch: ImportPreparation['patch']): DatasetTable[] {
  const set = new Set<DatasetTable>();
  for (const k of Object.keys(patch) as DatasetTable[]) {
    set.add(k);
    if (k === 'orders') set.add('order_items');
    if (k === 'purchase_orders') set.add('purchase_items');
  }
  return [...set];
}
