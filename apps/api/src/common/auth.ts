import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, Permission, Role } from '@efa/domain';
import { PrismaService } from '../prisma.service';

export interface AuthUser { id: string; tenantId: string; role: Role; username: string; displayName: string }

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PERMISSION = 'permission';
/** 声明接口需要的权限；未声明的非公开接口一律拒绝（默认拒绝） */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION, p);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/**
 * 全局守卫：校验 JWT → 从数据库重新加载用户（停用/改角色即时生效）→ 校验权限。
 * tenantId 只从服务端用户记录取得，绝不信任请求参数里的租户。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const handlers = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers)) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('请先登录');
    let payload: { sub: string; tid: string };
    try { payload = await this.jwt.verifyAsync(token); } catch { throw new UnauthorizedException('登录已过期，请重新登录'); }
    const user = await this.prisma.user.findFirst({ where: { id: payload.sub, tenantId: payload.tid, active: true } });
    if (!user) throw new UnauthorizedException('账号不存在或已停用');
    req.user = { id: user.id, tenantId: user.tenantId, role: user.role as Role, username: user.username, displayName: user.displayName } satisfies AuthUser;
    const perm = this.reflector.getAllAndOverride<Permission>(PERMISSION, handlers);
    if (!perm) throw new ForbiddenException('接口未声明权限');
    if (!can(user.role as Role, perm)) throw new ForbiddenException('没有权限执行此操作');
    return true;
  }
}
