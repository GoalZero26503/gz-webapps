import { getUser } from './auth';
import type { Permission } from './types';

export function hasPermission(permission: Permission): boolean {
  const user = getUser();
  if (!user) return false;
  return user.permissions.includes(permission);
}
