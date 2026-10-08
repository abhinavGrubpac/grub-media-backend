# grub-media-backend

Production-grade NestJS backend foundation for GrubPac — authentication, user management, and health, built as a modular monolith with clear boundaries so features can be added safely by a team over years.

## Overview

- **Modular monolith** — feature modules (`auth`, `users`, `health`) are self-contained; cross-cutting concerns (auth guard, response envelope, error filter, request-id, logging) are wired once globally.
- **Secure by default** — every route requires a valid JWT unless marked `@Public()`; RBAC via decorators; DB-persisted rotating refresh tokens with reuse detection; argon2id password hashing; Helmet, CORS allowlist, rate limiting, brute-force lockout.
- **Typed & validated** — strict TypeScript, `class-validator` DTOs, env validated on boot.

## Tech stack

NestJS 11 · TypeScript 5.9 · PostgreSQL 16 + Prisma 6 · Redis (ioredis, optional) · argon2 · passport-jwt · nestjs-pino · @nestjs/throttler · @nestjs/terminus · @nestjs/swagger · Jest 30 + Supertest · ESLint 10 (flat) + Prettier · Docker.

> See `docs/adr/` for why these versions/approaches were chosen (notably NestJS 11 + Prisma 6 over the ESM-only / driver-adapter latest majors).

## Architecture

```
src/
├── common/        # filters, interceptors, guards, decorators, middleware, dto, utils, constants
├── config/        # namespaced registerAs config + env validation
├── database/      # PrismaModule + PrismaService (soft-delete extension)
├── redis/         # RedisModule + RedisService (optional, graceful)
├── modules/
│   ├── auth/      # controllers, services (auth + token), dto, guards, strategies, decorators, constants
│   ├── users/     # controllers, services, dto
│   └── health/    # terminus health (db + redis)
├── app.module.ts
└── main.ts
```

See `docs/architecture.md` for the full picture.

## Getting started

### Prerequisites
Node 22+, npm, Docker (for Postgres/Redis locally).

### Setup
```bash
cp .env.example .env            # fill in secrets (JWT_* must be >= 32 chars)
npm ci
docker compose up -d postgres redis
npx prisma migrate deploy       # or: npm run prisma:migrate (dev)
SEED_SUPER_ADMIN_EMAIL=admin@grubpac.com SEED_SUPER_ADMIN_PASSWORD='Str0ngPass1' npm run prisma:seed
npm run start:dev
```
API: `http://localhost:3000/api/v1` · Swagger: `http://localhost:3000/api/docs` · Health: `http://localhost:3000/api/health`

### Environment variables
Validated on boot (`src/config/env.validation.ts`); the app refuses to start if invalid.

| Var | Notes |
|---|---|
| `NODE_ENV` | development \| production \| test |
| `PORT` | default 3000 |
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ≥32 chars |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | e.g. `15m` / `7d` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | optional — app runs degraded without Redis (no shared throttle/lockout) |
| `CORS_ORIGINS` | comma-separated allowlist |
| `LOG_LEVEL` | pino level |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` / `THROTTLE_LOGIN_LOCK_MAX` | rate-limit window (ms) / limit / failed-login lockout |
| `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` | seed only |

## Database & migrations
Prisma with PostgreSQL. Migrations only — never `db push` in prod.
```bash
npm run prisma:migrate   # migrate dev (local, creates migrations)
npm run prisma:deploy    # migrate deploy (release)
npm run prisma:studio
```
Soft delete is on `User` only (`deletedAt`), enforced by a Prisma client extension — always read via `prisma.client.*`. See `docs/database.md`.

## Testing
```bash
npm test                 # unit tests
npm run test:cov
docker compose -f docker-compose.test.yml up -d
npm run test:e2e         # e2e against throwaway postgres:5433 + redis:6380
docker compose -f docker-compose.test.yml down
```

## Authentication & RBAC
JWT access token (short-lived) + DB-persisted, argon2-hashed, rotating refresh token with reuse detection. Roles: `SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`. Authorization via `@Roles(...)` and `@RequirePermissions('users.read')` + `RolesGuard`. See `docs/authentication.md`.

## Logging
nestjs-pino — structured JSON (pretty in dev), per-request correlation id (`X-Request-ID`), secret redaction (authorization/cookie/password/tokens). Never logs credentials.

## API conventions
REST, plural nouns, verbs via HTTP method, under `/api/v1`. Standard envelopes:
```jsonc
// success
{ "success": true, "message": "...", "data": {}, "meta": { "page":1,"limit":20,"total":100,"totalPages":5 } }
// error
{ "success": false, "statusCode": 400, "message": "...", "errorCode": "VALIDATION_ERROR", "timestamp": "...", "path": "...", "requestId": "..." }
```
See `docs/api-guidelines.md`.

## Docker
```bash
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run prisma:seed
```
Multi-stage build, runs as non-root, `HEALTHCHECK` on `/api/health`.

## Postman
Import `postman/collection.json` + `postman/environment.json`. Login auto-captures `{{accessToken}}`/`{{refreshToken}}`; the collection sends the bearer token automatically.

## Git conventions
Branches: `main`, `develop`, `feature/*`, `fix/*`, `hotfix/*`, `refactor/*`, `chore/*`.
Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`.

## Coding standards
Thin controllers; business logic in services; DTOs at boundaries (never return Prisma models); no `any` without reason; async/await; small focused units; `@Global` infra (Prisma/Redis) not re-imported per feature module. See `docs/development.md`.

## Project scripts
`start:dev` `build` `start:prod` `lint` `lint:fix` `format` `format:check` `test` `test:cov` `test:e2e` `prisma:migrate` `prisma:deploy` `prisma:seed` `prisma:studio`.
