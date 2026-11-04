import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeModel, Dataset, DatasetTable, FinanceModel, DATASET_TABLES } from '@efa/domain';
import { PrismaService } from '../prisma.service';
import { fromDbRow, SPEC_BY_TABLE, TABLE_SPECS, toDbRow } from './table-specs';

type Tx = Prisma.TransactionClient;
const BATCH = 5000;

/**
 * 租户数据集：从数据库按 tenantId 读出全部明细，交给核算引擎。
 * 进程内按租户缓存（导入、改设置后失效）。多实例部署时需改为共享缓存或按请求计算（见 docs/待确认事项.md）。
 */
@Injectable()
export class DatasetService {
  private cache = new Map<string, { dataset: Dataset; model: FinanceModel; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(tenantId: string) { this.cache.delete(tenantId); }

  async load(tenantId: string): Promise<Dataset> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    const ds: Record<string, any> = { meta: tenant.meta, settings: tenant.settings };
    await Promise.all(TABLE_SPECS.map(async (spec) => {
      const rows: any[] = await (this.prisma as any)[spec.delegate].findMany({
        where: { tenantId },
        orderBy: spec.key ? { [spec.key]: 'asc' } : { pk: 'asc' }
      });
      ds[spec.table] = rows.map((r) => fromDbRow(spec, r));
    }));
    return ds as Dataset;
  }

  async getModel(tenantId: string): Promise<{ dataset: Dataset; model: FinanceModel }> {
    const hit = this.cache.get(tenantId);
    if (hit) return hit;
    const dataset = await this.load(tenantId);
    const model = computeModel(dataset);
    const entry = { dataset, model, at: Date.now() };
    this.cache.set(tenantId, entry);
    return entry;
  }

  /** 整表重写（在事务内调用）：先删本租户该表全部行，再批量写入 */
  async replaceTable(tx: Tx, tenantId: string, table: DatasetTable, rows: Record<string, any>[]): Promise<number> {
    const spec = SPEC_BY_TABLE[table];
    const delegate = (tx as any)[spec.delegate];
    await delegate.deleteMany({ where: { tenantId } });
    const data = rows.map((r) => toDbRow(spec, tenantId, r));
    for (let i = 0; i < data.length; i += BATCH) await delegate.createMany({ data: data.slice(i, i + BATCH) });
    return data.length;
  }

  async replaceAll(tx: Tx, tenantId: string, ds: Dataset): Promise<void> {
    for (const t of DATASET_TABLES) await this.replaceTable(tx, tenantId, t, (ds as any)[t] || []);
  }
}
