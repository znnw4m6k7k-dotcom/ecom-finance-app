/**
 * 角色与权限矩阵（P0 假设，见 docs/待确认事项.md Q3）。
 * 前后端共用：后端用来做强制校验，前端只用来隐藏按钮。
 */
export const ROLES = ['OWNER', 'FINANCE', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { OWNER: '老板', FINANCE: '财务', VIEWER: '只读' };

export const PERMISSIONS = {
  'report:read': ['OWNER', 'FINANCE', 'VIEWER'],
  'data:import': ['OWNER', 'FINANCE'],
  'settings:write': ['OWNER', 'FINANCE'],
  'briefing:read': ['OWNER', 'FINANCE', 'VIEWER'],
  'briefing:generate': ['OWNER', 'FINANCE'],
  'briefing:edit': ['OWNER', 'FINANCE'],
  'briefing:submit': ['OWNER', 'FINANCE'],
  'briefing:approve': ['OWNER'],
  'audit:read': ['OWNER'],
  /** 连接平台智能表/知识库、确认字段对应、同步、处理冲突和来源删除（待确认事项 Q14–Q17） */
  'source:admin': ['OWNER', 'FINANCE'],
  /** 检索已同步的知识库（默认老板和财务，待确认 Q18） */
  'knowledge:search': ['OWNER', 'FINANCE'],
  'connector:admin': ['OWNER']
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[perm] as readonly string[]).includes(role);
}
