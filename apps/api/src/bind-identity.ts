/**
 * 管理员在服务器上绑定员工的钉钉账号：node apps/api/dist/bind-identity.js <企业代码> <系统账号> <钉钉userid>
 * 只写入一条 userid 映射，不读取钉钉通讯录。
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const [tenantSlug, username, externalUserId, provider = 'dingtalk'] = process.argv.slice(2);
  if (!tenantSlug || !username || !externalUserId) throw new Error('用法：node apps/api/dist/bind-identity.js <企业代码> <系统账号> <钉钉userid>');
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new Error('企业不存在：' + tenantSlug);
    const user = await prisma.user.findFirst({ where: { tenantId: tenant.id, username } });
    if (!user) throw new Error('账号不存在：' + username);
    await prisma.externalIdentity.upsert({
      where: { tenantId_provider_externalUserId: { tenantId: tenant.id, provider, externalUserId } },
      update: { userId: user.id },
      create: { tenantId: tenant.id, userId: user.id, provider, externalUserId }
    });
    await prisma.auditEvent.create({ data: { tenantId: tenant.id, actorName: '服务器管理员', action: 'connector.identity_bound', targetType: 'user', targetId: user.id, detail: { provider, via: 'cli' } } });
    console.log(`已绑定：${tenantSlug}/${username} ↔ ${provider}:${externalUserId}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
