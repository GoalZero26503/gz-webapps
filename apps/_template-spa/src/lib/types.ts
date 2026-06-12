export type AppRole = 'user' | 'admin';

export type Permission =
  | 'portal:user:read'
  | 'portal:user:write'
  | 'portal:user:invite'
  | 'portal:user:delete';

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  role: AppRole;
  permissions: Permission[];
}

export interface StoredAuth {
  token: string;
  refreshToken: string | null;
  user: AuthUser;
}
