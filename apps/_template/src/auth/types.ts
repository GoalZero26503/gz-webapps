export const APP_ROLES = ['user', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const PERMISSIONS = {
  'users:read': 'View app users',
  'users:write': 'Modify app user roles',
  'users:invite': 'Invite new app users',
  'users:delete': 'Delete app users',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  user: [],
  admin: ['users:read', 'users:write', 'users:invite', 'users:delete'],
};

export const ROLE_HIERARCHY: Record<AppRole, number> = {
  user: 0,
  admin: 1,
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
