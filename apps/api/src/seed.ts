/**
 * 本地/测试种子数据：虚构演示公司 + 3 个账号（老板/财务/只读）+ 一个空的第二租户（用于隔离测试）。
 * 密码从环境变量读取；未设置时只允许在非生产环境使用开发默认值。
 * 用法：npm run db:seed -w apps/api
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { buildDemoData, Dataset } from '@efa/domain';
import { TABLE_SPECS, toDbRow } from './dataset/table-specs';

export async function seed(prisma: PrismaClient, opts: { passwords?: Partial<Record<'owner' | 'finance' | 'viewer', string>>; reset?: boolean } = {}) {
  if (process.env.NODE_ENV === 'production' && !opts.passwords) throw new Error('生产环境禁止使用种子默认密码');
  const pw = {
    owner: opts.passwords?.owner ?? (process.env.SEED_OWNER_PASSWORD || 'owner-dev-123'),
    finance: opts.passwords?.finance ?? (process.env.SEED_FINANCE_PASSWORD || 'finance-dev-123'),
    viewer: opts.passwords?.viewer ?? (process.env.SEED_VIEWER_PASSWORD || 'viewer-dev-123')
  };
  const demo: Dataset = buildDemoData();
  if (opts.reset) {
    const tables = ['AuditEvent', 'SyncRun', 'SourceRow', 'SyncConflict', 'KnowledgeDoc', 'DataSource', 'NotificationDelivery', 'AiCall', 'BriefingVersion', 'Briefing', 'ImportBatch', 'ExternalIdentity', 'User',
      ...TABLE_SPECS.map((s) => s.delegate.charAt(0).toUpperCase() + s.delegate.slice(1)), 'Tenant'];
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  const tenants = [
    { slug: 'luye-demo', name: demo.meta.company_name, data: demo },
    { slug: 'other-demo', name: '另一家演示公司（虚构，用于隔离测试）', data: null }
  ];
  for (const t of tenants) {
    const existing = await prisma.tenant.findUnique({ where: { slug: t.slug } });
    if (existing) continue;
    const meta = t.data ? t.data.meta : { ...demo.meta, company_name: t.name, brand: '虚构', demo: true };
    const tenant = await prisma.tenant.create({ data: { slug: t.slug, name: t.name, meta: meta as Prisma.InputJsonValue, settings: demo.settings as Prisma.InputJsonValue } });
    const mk = async (username: string, displayName: string, role: 'OWNER' | 'FINANCE' | 'VIEWER', p: string) =>
      prisma.user.create({ data: { tenantId: tenant.id, username, displayName, role, passwordHash: await bcrypt.hash(p, 10) } });
    await mk('owner', t.slug === 'luye-demo' ? '老板（演示）' : '其他公司老板', 'OWNER', pw.owner);
    await mk('finance', '财务（演示）', 'FINANCE', pw.finance);
    await mk('viewer', '只读（演示）', 'VIEWER', pw.viewer);
    if (t.data) {
      for (const spec of TABLE_SPECS) {
        const rows = ((t.data as any)[spec.table] || []).map((r: any) => toDbRow(spec, tenant.id, r));
        for (let i = 0; i < rows.length; i += 5000) await (prisma as any)[spec.delegate].createMany({ data: rows.slice(i, i + 5000) });
      }
    } else {
      // 第二租户只放一个店铺和少量订单，数字与第一租户完全不同，便于发现串租户
      const small = { ...demo, stores: demo.stores.slice(0, 1), orders: demo.orders.filter((o) => o.store_id === demo.stores[0].id).slice(0, 20) } as Dataset;
      const oids = new Set(small.orders.map((o) => o.id));
      small.order_items = demo.order_items.filter((i) => oids.has(i.order_id));
      small.shipments = demo.shipments.filter((s) => oids.has(s.order_id));
      const keep = ['stores', 'suppliers', 'skus', 'opening_inventory', 'orders', 'order_items', 'shipments'];
      for (const spec of TABLE_SPECS.filter((s) => keep.includes(s.table))) {
        const rows = ((small as any)[spec.table] || []).map((r: any) => toDbRow(spec, tenant.id, r));
        if (rows.length) await (prisma as any)[spec.delegate].createMany({ data: rows });
      }
    }
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma, { reset: process.argv.includes('--reset') })
    .then(() => console.log('种子数据已写入：企业代码 luye-demo，账号 owner / finance / viewer（密码见 .env 或开发默认值）'))
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
