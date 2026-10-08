# Database

## Stack
PostgreSQL 16 + Prisma 6 (classic, URL-in-schema). ADR 003 explains the choice of Prisma 6 over 7.

## Models
- **User** — id (cuid), email (unique), passwordHash, firstName, lastName, role (`UserRole`), status (`UserStatus`), tokenVersion, createdBy?, updatedBy?, deletedAt? (soft delete), timestamps, sessions[].
- **Session** — id, userId (fk cascade, indexed), hashedToken (argon2 of the refresh secret), userAgent?, ip?, expiresAt, revokedAt?, replacedById? (reserved for future rotation-chain tracing; not currently populated — reuse detection is userId-scoped), createdAt.
- **AuditLog** — actorId?, action, resource, resourceId?, requestId?, ip?, metadata (Json, no secrets), createdAt. Indexed on `(resource, resourceId)` and `createdAt`. (Table provided; write-path wiring is a future module.)

Enums: `UserRole = SUPER_ADMIN|ADMIN|EMPLOYEE`, `UserStatus = ACTIVE|INACTIVE|SUSPENDED`.

## Indexes (intentional)
`User.email` unique · `User.deletedAt` · `Session.userId` · `AuditLog(resource,resourceId)` · `AuditLog.createdAt`. Nothing speculative.

## Soft delete
Only `User` has `deletedAt`. A Prisma client **extension** injects `deletedAt: null` into `findMany`/`findFirst`/`findFirstOrThrow`/`count` on `User`. **Always read via `prisma.client.*`** so the guard applies. `findUnique`/`findUniqueOrThrow` are NOT guarded (their `where` only accepts unique fields) — use `findFirst` for soft-deletable reads. An explicit `deletedAt` filter overrides the default (to query deleted rows).

## Migrations
Migrations only — never `db push` in prod.
- `npm run prisma:migrate` → `migrate dev` (local; authors migrations)
- `npm run prisma:deploy` → `migrate deploy` (release)
The initial migration was authored via `prisma migrate diff` and lives in `prisma/migrations/`.

## Transactions
Used only where atomicity is required (e.g. `revokeAllForUser` bumps tokenVersion + revokes sessions in one `$transaction`; refresh rotation uses a conditional `updateMany` for single-use semantics). No transactions around simple reads.

## Graceful shutdown
`PrismaService` disconnects on `OnModuleDestroy`; `enableShutdownHooks()` ties it to SIGTERM/SIGINT.

## Ops notes
- The generated init migration includes `CREATE SCHEMA IF NOT EXISTS "public"`. On managed Postgres that restricts `CREATE` on `public` (e.g. some Supabase setups), ensure the deploy role has the right or pre-create the schema.
- Refresh-token lookup is O(1) by `sessionId`; at very high session volume, monitor `Session` table growth and add a periodic purge of expired/revoked rows.
