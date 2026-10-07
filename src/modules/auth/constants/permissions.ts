import { UserRole } from '@prisma/client';

/**
 * Permission seam: RBAC today, permission-based authorization later. Guards can
 * require either a role (@Roles) or a fine-grained permission (@RequirePermissions).
 * The role→permission mapping lives in code now; migrating it to the database is
 * additive and does not change the guard/decorator API.
 */
export type Permission = 'users.read' | 'users.create' | 'users.update' | 'users.delete';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: ['users.read', 'users.create', 'users.update', 'users.delete'],
  ADMIN: ['users.read', 'users.create', 'users.update', 'users.delete'],
  EMPLOYEE: ['users.read'],
};
