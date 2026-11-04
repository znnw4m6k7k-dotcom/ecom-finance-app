import { Body, Controller, Get, HttpCode, Inject, Post, Req, UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { can, PERMISSIONS, Permission, Role, ROLE_LABELS } from '@efa/domain';
import type { WorkspaceConnector } from '@efa/workspace-connectors';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../common/auth';
import { parseBody } from '../common/zod';
import { APP_CONFIG, AppConfig, WORKSPACE_CONNECTOR } from '../config';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';

const LoginBody = z.object({ tenant: z.string().min(1).max(64), username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).strict();
const DingLoginBody = z.object({ tenant: z.string().min(1).max(64), authCode: z.string().min(1).max(200) }).strict();

/** 简单的登录失败限流（进程内）：同一 租户+账号 5 次失败锁 5 分钟。多实例部署需换成共享存储 */
const failures = new Map<string, { count: number; until: number }>();
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(WORKSPACE_CONNECTOR) private readonly connector: WorkspaceConnector,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig
  ) {}

  private async issue(user: { id: string; tenantId: string; role: string; username: string; displayName: string }) {
    const token = await this.jwt.signAsync({ sub: user.id, tid: user.tenantId });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    return { token, user: this.profile(user as AuthUser, tenant) };
  }

  private profile(user: AuthUser, tenant: { slug: string; name: string }) {
    const perms = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.role as Role, p));
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, roleLabel: ROLE_LABELS[user.role as Role], tenant: { slug: tenant.slug, name: tenant.name }, permissions: perms };
  }

  @Public() @Post('login') @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: any) {
    const b = parseBody(LoginBody, body);
    const key = `${b.tenant}/${b.username}`;
    const f = failures.get(key);
    if (f && f.until > Date.now()) throw new HttpException('登录失败次数过多，请 5 分钟后再试', 429);
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: b.tenant } });
    const user = tenant ? await this.prisma.user.findFirst({ where: { tenantId: tenant.id, username: b.username, active: true } }) : null;
    const ok = user ? await bcrypt.compare(b.password, user.passwordHash) : false;
    if (!user || !ok) {
      const n = (f && f.until <= Date.now() && f.count >= LOCK_AFTER ? 0 : f?.count ?? 0) + 1;
      failures.set(key, { count: n, until: n >= LOCK_AFTER ? Date.now() + LOCK_MS : 0 });
      if (tenant) await this.audit.record({ tenantId: tenant.id, id: null, displayName: b.username }, 'auth.login_failed', { type: 'user', id: user?.id }, { username: b.username }, undefined, req.ip);
      throw new UnauthorizedException('企业代码、账号或密码错误');
    }
    failures.delete(key);
    await this.audit.record(user, 'auth.login', { type: 'user', id: user.id }, { method: 'password' }, undefined, req.ip);
    return this.issue(user);
  }

  /** 钉钉 H5 微应用免登：authCode → 钉钉 userid → 管理员已绑定的内部账号。未绑定的账号不会自动创建 */
  @Public() @Post('dingtalk') @HttpCode(200)
  async dingtalk(@Body() body: unknown, @Req() req: any) {
    const b = parseBody(DingLoginBody, body);
    if (this.connector.provider !== 'dingtalk' || !this.connector.capabilities().login) throw new BadRequestException('当前未启用钉钉登录');
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: b.tenant } });
    if (!tenant) throw new UnauthorizedException('企业不存在');
    const ident = await this.connector.resolveIdentity({ provider: 'dingtalk', authCode: b.authCode }, { tenantId: tenant.id });
    const link = await this.prisma.externalIdentity.findUnique({
      where: { tenantId_provider_externalUserId: { tenantId: tenant.id, provider: 'dingtalk', externalUserId: ident.externalUserId } },
      include: { user: true }
    });
    if (!link || !link.user.active) throw new UnauthorizedException(`该钉钉账号（userid：${ident.externalUserId}）尚未绑定系统账号，请把这个 userid 发给管理员绑定`);
    await this.audit.record(link.user, 'auth.login', { type: 'user', id: link.user.id }, { method: 'dingtalk' }, undefined, req.ip);
    return this.issue(link.user);
  }

  /** 前端判断是否走钉钉免登：只返回非密钥信息 */
  @Public() @Get('dingtalk/config')
  dingtalkConfig() {
    const enabled = this.connector.provider === 'dingtalk' && this.connector.capabilities().login && !!this.cfg.DINGTALK_CORP_ID;
    return enabled ? { enabled, corpId: this.cfg.DINGTALK_CORP_ID, clientId: this.cfg.DINGTALK_APP_KEY, jsapiUrl: this.cfg.DINGTALK_JSAPI_URL } : { enabled: false };
  }

  @Get('me') @RequirePermission('report:read')
  async me(@CurrentUser() user: AuthUser) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    return this.profile(user, tenant);
  }
}
