# Server 401 & Schema Drift Troubleshooting

## Issue Summary

The server returned **401 Unauthorized** on protected routes due to JWT token validation failure, combined with **Prisma P2022 schema drift errors** indicating the database schema didn't match the Prisma model definition.

### Root Causes

1. **Token Version Mismatch**: User's `tokenVersion` in DB (54) didn't match the token payload (53)
   - Cause: Password reset, logout-everywhere, or other token invalidation bumped the version
   - Fix: User must log in again to get a fresh token with current version

2. **Missing `role` Column**: Prisma model expects `User.role` enum, but DB was missing it
   - Cause: Old migrations not properly applied
   - Fix: Migration `20261027000100_backfill_user_role_column` adds it

3. **Schema Drift (roleId FK)**: Production DB had a `roleId` foreign key instead of `role` enum
   - Cause: Someone ran `prisma migrate dev` directly on production and didn't commit migrations
   - Fix: Migration `20261027000200_fix_role_schema_drift` migrates `roleId`→`role` and cleans up

4. **Missing Migrations**: 5 migrations were created on production but never committed to git
   - Files: `20261026000000_*`, `20261027000000_*`, `20261027120000_*`, `20261027130000_*`
   - Fix: Stub migration files created to mark them as applied in migration history

## Resolution Steps

### For Local Development

```bash
# 1. Apply all migrations to sync your DB with the schema
npm run prisma:deploy

# 2. If migrations fail, resolve them manually:
npm run prisma:migrate -- resolve <migration-name>

# 3. Seed the database with test users
SEED_SUPER_ADMIN_EMAIL='admin@grubpac.com' \
SEED_SUPER_ADMIN_PASSWORD='Admin@123456' \
npm run prisma:seed

# 4. Restart the server
npm run start:dev

# 5. Log in with seeded credentials to get a fresh token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@grubpac.com","password":"Admin@123456"}'
```

### For Production

```bash
# 1. Apply pending migrations
npm run prisma:deploy

# 2. If drift is detected, Prisma will guide you to fix it
# 3. The migrations will:
#    - Add missing `role` enum column
#    - Migrate data from `roleId` FK to `role` enum
#    - Drop legacy `roleId` FK and `Role` table

# 4. Restart the app
# 5. Users will need to re-authenticate (existing tokens are invalidated due to version bump)
```

## JWT Token Validation

The `JwtStrategy` (in `src/modules/auth/strategies/jwt.strategy.ts`) re-validates on every request:

```typescript
async validate(payload: JwtPayload): Promise<AuthUser> {
  const user = await this.prisma.client.user.findFirst({ 
    where: { id: payload.sub } 
  });
  
  // Fails if:
  // 1. User not found (user deleted or doesn't exist)
  // 2. user.status !== ACTIVE (suspended/inactive)
  // 3. user.tokenVersion !== payload.tokenVersion (token invalidated)
  
  if (!user || user.status !== UserStatus.ACTIVE || 
      user.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedException();
  }
  return { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
}
```

**Common 401 causes:**
- **Token expired**: Check `exp` claim in JWT (use `jwt.io` to decode)
- **Token invalidated**: User's `tokenVersion` changed (password reset, logout-everywhere)
- **User not found**: User was deleted (soft or hard)
- **User inactive**: User was suspended

**Debug tip**: Check server logs for `JwtStrategy` debug logs showing which validation failed.

## Logging

Enhanced logging was added to help diagnose auth issues:

- `JwtStrategy.validate()` logs: user found/not found, status, tokenVersion mismatch
- `AuthService.login()` logs: user found, password valid, any errors

Enable debug logs:
```bash
LOG_LEVEL=debug npm run start:dev
```

## Prevention

1. **Never run `prisma migrate dev` on production** — use `prisma migrate deploy` only
2. **Always commit migrations** after running locally before deploying
3. **Use explicit role enum** — no more `roleId` FKs (breaking change if needed)
4. **Document schema changes** in ADRs and migration comments
5. **Test auth flows** in CI/CD before merging (login, refresh, profile endpoints)
