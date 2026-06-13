import type { AppJwtPayload, AppRole, Permission } from './types.js';
import { ROLE_HIERARCHY, ROLE_PERMISSIONS } from './types.js';

export function resolvePermissions(role: AppRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** You may grant any role at or below your own level (admins can grant admin). */
export function canAssignRole(assignerRole: AppRole, targetRole: AppRole): boolean {
  return ROLE_HIERARCHY[assignerRole] >= ROLE_HIERARCHY[targetRole];
}

export function hasPermission(user: AppJwtPayload, permission: Permission): boolean {
  return user.permissions.includes(permission);
}
