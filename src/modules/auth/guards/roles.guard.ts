import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Permission, ROLE_PERMISSIONS } from '../constants/permissions';

/**
 * Enforces @Roles and/or @RequirePermissions metadata. Runs after JwtAuthGuard,
 * so `request.user` is populated. A route with neither decorator is allowed
 * (authentication alone suffices).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permissions = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!roles?.length && !permissions?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: { role: UserRole } }>().user;
    if (!user) {
      return false;
    }

    if (roles?.length && !roles.includes(user.role)) {
      return false;
    }

    if (permissions?.length) {
      const granted = ROLE_PERMISSIONS[user.role] ?? [];
      if (!permissions.every((permission) => granted.includes(permission))) {
        return false;
      }
    }

    return true;
  }
}
