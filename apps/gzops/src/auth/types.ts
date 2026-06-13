export const APP_ROLES = ['viewer', 'editor', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const PERMISSIONS = {
  'deploys:create': 'Trigger deployments',
  'programs:write': 'Create, edit, and publish programs',
  'users:read': 'View users and access requests',
  'users:write': 'Approve/deny requests, change roles, remove users',
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * viewer  — read-only; action affordances are not rendered at all.
 * editor  — viewer + deploy artifacts + create/edit programs.
 * admin   — editor + user & access management.
 */
export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  viewer: [],
  editor: ['deploys:create', 'programs:write'],
  admin: ['deploys:create', 'programs:write', 'users:read', 'users:write'],
};

export const ROLE_HIERARCHY: Record<AppRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

export interface AppJwtPayload {
  sub: string;
  email: string;
  name: string;
  role: AppRole;
  permissions: Permission[];
  iat: number;
  exp: number;
}
