/**
 * 数据集表 ↔ Prisma 模型的映射。字段名与 Demo 数据契约一致；
 * 这里只负责类型转换：Decimal ↔ number，@db.Date ↔ 'YYYY-MM-DD'（空日期 ↔ ''）。
 */
import type { DatasetTable } from '@efa/domain';

export type FieldType = 'str' | 'str?' | 'num' | 'num?' | 'int' | 'bool' | 'date' | 'date?' | 'strarr' | 'bool?';

export interface TableSpec {
  table: DatasetTable;
  delegate: string; // prisma client 属性名
  /** 有业务主键的表（用于唯一性），无主键（明细行）为 null */
  key: 'id' | 'sku_id' | null;
  fields: Record<string, FieldType>;
}

const money = 'num' as const;

export const TABLE_SPECS: TableSpec[] = [
  { table: 'stores', delegate: 'store', key: 'id', fields: { id: 'str', platform: 'str', name: 'str', commission_rate: money, tech_fee_rate: money, payment_fee_rate: money, insurance_rate: money, settlement_days: 'int' } },
  { table: 'suppliers', delegate: 'supplier', key: 'id', fields: { id: 'str', name: 'str', tax_rate: 'num?', terms: 'str?' } },
  { table: 'skus', delegate: 'sku', key: 'id', fields: { id: 'str', name: 'str', category: 'str?', spec: 'str?', list_price: 'num?', supplier_id: 'str?', launch_month: 'str?', status: 'str?' } },
  { table: 'employees', delegate: 'employee', key: 'id', fields: { id: 'str', name: 'str', role: 'str', base_salary: money, allowance: money, deduction: money, basis: 'str?', store_ids: 'strarr', commission_share: 'num?', joined_at: 'date?', active: 'bool?' } },
  { table: 'opening_inventory', delegate: 'openingInventory', key: 'sku_id', fields: { sku_id: 'str', qty: 'int', unit_cost: money } },
  { table: 'orders', delegate: 'order', key: 'id', fields: { id: 'str', store_id: 'str', order_date: 'date', status: 'str?', paid_amount: money, refund_amount: money, refund_date: 'date?', ship_date: 'date?', carrier: 'str?', province: 'str?', returned: 'bool' } },
  { table: 'order_items', delegate: 'orderItem', key: null, fields: { order_id: 'str', sku_id: 'str', qty: 'int', amount: money, refund_amount: money, refund_qty: 'int' } },
  { table: 'shipments', delegate: 'shipment', key: 'id', fields: { id: 'str', order_id: 'str', carrier: 'str?', province: 'str?', weight_kg: 'num?', base_fee: money, overweight_fee: money, surcharge: money, return_fee: money, shipped_at: 'date?', returned: 'bool' } },
  { table: 'purchase_orders', delegate: 'purchaseOrder', key: 'id', fields: { id: 'str', supplier_id: 'str', date: 'date', status: 'str?', invoice_no: 'str?' } },
  { table: 'purchase_items', delegate: 'purchaseItem', key: null, fields: { po_id: 'str', sku_id: 'str', qty: 'int', unit_price: money, amount: money } },
  { table: 'platform_bills', delegate: 'platformBill', key: 'id', fields: { id: 'str', store_id: 'str', period: 'str', gmv: money, refund_amount: money, commission: money, tech_service_fee: money, payment_fee: money, promotion_fee: money, freight_insurance: money, subsidy: money, other_deduction: money, settled_amount: money, status: 'str?', payout_date: 'date?', note: 'str?' } },
  { table: 'payouts', delegate: 'payout', key: 'id', fields: { id: 'str', store_id: 'str', bill_id: 'str?', date: 'date', amount: money, bank_ref: 'str?' } },
  { table: 'expenses', delegate: 'expense', key: 'id', fields: { id: 'str', date: 'date', category: 'str', store_id: 'str?', vendor: 'str?', amount: money, invoice_no: 'str?' } },
  { table: 'invoices', delegate: 'invoice', key: 'id', fields: { id: 'str', direction: 'str', number: 'str?', date: 'date', seller: 'str?', buyer: 'str?', amount: money, tax_amount: money, related_type: 'str?', related_id: 'str?', note: 'str?' } }
];

export const SPEC_BY_TABLE = Object.fromEntries(TABLE_SPECS.map((s) => [s.table, s])) as Record<DatasetTable, TableSpec>;

function toDate(v: unknown, optional: boolean): Date | null {
  const s = v == null ? '' : String(v).trim();
  if (!s) {
    if (optional) return null;
    throw new Error('必填日期为空');
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`日期格式错误：${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** 数据集行 → 数据库行 */
export function toDbRow(spec: TableSpec, tenantId: string, row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { tenantId };
  for (const [f, t] of Object.entries(spec.fields)) {
    const v = row[f];
    switch (t) {
      case 'str': out[f] = String(v ?? ''); break;
      case 'str?': out[f] = v == null || v === '' ? null : String(v); break;
      case 'num': out[f] = Number(v || 0); break;
      case 'num?': out[f] = v == null || v === '' ? null : Number(v); break;
      case 'int': out[f] = Math.round(Number(v || 0)); break;
      case 'bool': out[f] = v === true || v === 'true' || v === 1 || v === '1'; break;
      case 'bool?': out[f] = v == null || v === '' ? null : v === true || v === 'true' || v === 1 || v === '1'; break;
      case 'date': out[f] = toDate(v, false); break;
      case 'date?': out[f] = toDate(v, true); break;
      case 'strarr': out[f] = Array.isArray(v) ? v.map(String) : v ? String(v).split(/[,，;；|]/).map((x) => x.trim()).filter(Boolean) : []; break;
    }
  }
  return out;
}

/** 数据库行 → 数据集行（与 Demo 引擎期望的结构一致） */
export function fromDbRow(spec: TableSpec, row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [f, t] of Object.entries(spec.fields)) {
    const v = row[f];
    switch (t) {
      case 'num': out[f] = Number(v); break;
      case 'num?': if (v != null) out[f] = Number(v); break;
      case 'date': out[f] = (v as Date).toISOString().slice(0, 10); break;
      case 'date?': out[f] = v ? (v as Date).toISOString().slice(0, 10) : ''; break;
      case 'str?': if (v != null) out[f] = v; else if (f === 'note' || f === 'invoice_no') out[f] = ''; break;
      case 'bool?': if (v != null) out[f] = v; break;
      default: out[f] = v;
    }
  }
  return out;
}
