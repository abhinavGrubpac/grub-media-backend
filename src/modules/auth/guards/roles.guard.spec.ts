import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

function reflectorFor(meta: Record<string, unknown>) {
  return {
    getAllAndOverride: (key: string) => meta[key],
  } as never;
}

describe('RolesGuard', () => {
  it('allows when neither roles nor permissions are required', () => {
    const guard = new RolesGuard(reflectorFor({}));
    expect(guard.canActivate(ctx({ role: UserRole.EMPLOYEE }))).toBe(true);
  });

  it('denies when there is no authenticated user but a role is required', () => {
    const guard = new RolesGuard(reflectorFor({ [ROLES_KEY]: [UserRole.ADMIN] }));
    expect(guard.canActivate(ctx(undefined))).toBe(false);
  });

  it('denies EMPLOYEE when ADMIN role is required', () => {
    const guard = new RolesGuard(reflectorFor({ [ROLES_KEY]: [UserRole.ADMIN] }));
    expect(guard.canActivate(ctx({ role: UserRole.EMPLOYEE }))).toBe(false);
  });

  it('allows ADMIN when ADMIN role is required', () => {
    const guard = new RolesGuard(reflectorFor({ [ROLES_KEY]: [UserRole.ADMIN] }));
    expect(guard.canActivate(ctx({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('allows EMPLOYEE for a users.read permission', () => {
    const guard = new RolesGuard(reflectorFor({ [PERMISSIONS_KEY]: ['users.read'] }));
    expect(guard.canActivate(ctx({ role: UserRole.EMPLOYEE }))).toBe(true);
  });

  it('denies EMPLOYEE for a users.delete permission', () => {
    const guard = new RolesGuard(reflectorFor({ [PERMISSIONS_KEY]: ['users.delete'] }));
    expect(guard.canActivate(ctx({ role: UserRole.EMPLOYEE }))).toBe(false);
  });

  it('allows ADMIN for users.delete permission', () => {
    const guard = new RolesGuard(reflectorFor({ [PERMISSIONS_KEY]: ['users.delete'] }));
    expect(guard.canActivate(ctx({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('with BOTH role and permission required, denies when the role passes but permission is missing', () => {
    // EMPLOYEE satisfies no role list here; use a role match but missing permission:
    const guard = new RolesGuard(
      reflectorFor({ [ROLES_KEY]: [UserRole.EMPLOYEE], [PERMISSIONS_KEY]: ['users.delete'] }),
    );
    expect(guard.canActivate(ctx({ role: UserRole.EMPLOYEE }))).toBe(false);
  });

  it('with BOTH role and permission required, allows only when both pass', () => {
    const guard = new RolesGuard(
      reflectorFor({ [ROLES_KEY]: [UserRole.ADMIN], [PERMISSIONS_KEY]: ['users.delete'] }),
    );
    expect(guard.canActivate(ctx({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('denies a role not present in the ROLE_PERMISSIONS map (unknown role → empty grants)', () => {
    const guard = new RolesGuard(reflectorFor({ [PERMISSIONS_KEY]: ['users.read'] }));
    expect(guard.canActivate(ctx({ role: 'GUEST' as UserRole }))).toBe(false);
  });
});
