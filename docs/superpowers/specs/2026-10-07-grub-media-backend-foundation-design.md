# grub-media-backend — Foundation Design Spec

- **Date:** 2026-10-07
- **Status:** Approved for planning
- **Scope:** Production-grade NestJS foundation — Auth, Users, Health. GrubPac domain modules are out of scope and will each get their own spec later, built on this foundation.

## 1. Intent & success criteria

Build a production-ready, scalable, modular-monolith NestJS backend that a medium/large team can extend safely for 3–5 years. Success means:

- A new developer can clone, `docker compose up`, migrate, seed, and hit a documented Swagger/Postman API within minutes.
- Adding a new feature module requires touching only that module plus route registration — no edits to unrelated modules.
- Auth, error handling, logging, response shape, and validation are consistent and enforced globally, not re-implemented per module.
- Secrets never appear in source or logs; the app refuses to boot on invalid config.

Non-goals: microservices, event sourcing, CQRS, DB-driven permission engine, GrubPac business domain, cookie-based browser auth (documented as future ADR).

## 2. Confirmed decisions

| Decision | Choice | Rationale |
|---|---|---|
| Delivered scope | Foundation only: Auth + Users + Health | Clean base; domain modules follow as separate specs |
| Refresh tokens | DB-persisted, argon2-hashed, rotated, reuse-detection | Real logout / revoke-all / theft detection |
| Redis | Included from day one | Shared throttler storage, failed-login lockout, future cache |
| Deploy target | Generic container | No cloud lock-in; runs on ECS/Fly/Render/k8s/bare Docker |
| Logger | nestjs-pino | Structured JSON, per-request correlation binding, built-in secret redaction |
| Password hashing | argon2 (argon2id) | Current best-practice KDF |
| Env validation | class-validator `validate` fn | Reuse existing dep; one validation library |
| Serialization | Explicit Response DTOs via `plainToInstance` | `ClassSerializerInterceptor` does not strip plain Prisma objects — explicit DTO is the allowlist |
| Token delivery | JSON body | API-first; cookie variant deferred to ADR |

## 3. Technology & versions

Pinned exactly at install; this is the target:

- NestJS 11, TypeScript 5.x, Node 22 LTS (production image), npm.
- Prisma 6 + PostgreSQL 16.
- `@nestjs/jwt`, `passport`, `passport-jwt`, `@nestjs/passport`.
- `argon2`.
- `@nestjs/throttler` + `@nest-lab/throttler-storage-redis`, `ioredis`.
- `nestjs-pino`, `pino-http`, `pino-pretty` (dev only).
- `@nestjs/terminus`.
- `@nestjs/swagger`.
- `helmet`, `class-validator`, `class-transformer`, `@nestjs/config`.
- Dev/quality: `jest`, `ts-jest`, `supertest`, `eslint`, `prettier`, `husky`, `lint-staged`.

Every dependency above has a single clear purpose; nothing speculative.

## 4. Folder structure

```
src/
├── common/
│   ├── decorators/      # @Public, @Roles, @RequirePermissions, @ResponseMessage, @CurrentUser
│   ├── dto/             # PaginationQueryDto, PaginatedMeta
│   ├── exceptions/      # domain exceptions (EmailAlreadyExists, etc.)
│   ├── filters/         # AllExceptionsFilter
│   ├── guards/          # RolesGuard (JwtAuthGuard lives in auth)
│   ├── interceptors/    # ResponseInterceptor
│   ├── middleware/       # RequestIdMiddleware
│   ├── pipes/           # (only if earned)
│   └── utils/           # pagination helpers, token utils
├── config/
│   ├── app.config.ts    # registerAs('app', ...)
│   ├── database.config.ts
│   ├── jwt.config.ts
│   ├── redis.config.ts
│   ├── throttle.config.ts
│   └── env.validation.ts
├── database/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── redis/
│   ├── redis.module.ts
│   └── redis.service.ts
├── modules/
│   ├── auth/
│   │   ├── controllers/  services/  dto/  guards/  strategies/  decorators/
│   │   └── auth.module.ts
│   ├── users/
│   │   ├── controllers/  services/  dto/
│   │   └── users.module.ts
│   └── health/
│       ├── health.controller.ts
│       └── health.module.ts
├── app.module.ts
└── main.ts

prisma/{schema.prisma, migrations/, seed.ts}
test/{e2e/, unit/, fixtures/}
docs/{architecture.md, authentication.md, api-guidelines.md, database.md, development.md, adr/}
postman/collection.json
```

Rule: no folder is created to hold a single file. `constants`/`interfaces`/`enums` start as one file beside their consumer and graduate to a folder only when they grow.

## 5. Configuration & env validation

- Namespaced `registerAs` configs; access via typed `ConfigService.get('jwt.accessSecret')` / `ConfigType`. Never `process.env` in services.
- `env.validation.ts` exports a `validate(config)` using class-validator against an `EnvironmentVariables` class. App throws on boot if invalid.
- Env groups: `APP_*`, `DATABASE_*`, `JWT_*`, `REDIS_*`, `CORS_*`, `RATE_LIMIT_*`, `LOG_*`.
- `.env.example` committed with every key documented and safe placeholders. Real `.env*` gitignored.

## 6. Error handling

- `AllExceptionsFilter` (global) emits:
  ```json
  { "success": false, "statusCode": 400, "message": "...", "errorCode": "VALIDATION_ERROR",
    "timestamp": "ISO", "path": "/api/v1/users", "requestId": "..." }
  ```
- Mapping:
  - `HttpException` → its status + mapped `errorCode`.
  - Custom domain exceptions (e.g. `EmailAlreadyExistsException`) → semantic status + stable `errorCode`.
  - `PrismaClientKnownRequestError`: `P2002`→409 `CONFLICT`, `P2025`→404 `NOT_FOUND`; others→500.
  - Unknown → 500 `INTERNAL_ERROR`, generic message in prod; full stack logged internally with `requestId`.
- Validation errors flattened to a readable `message` + `errorCode: VALIDATION_ERROR`.
- **Try/catch only** to transform, enrich, recover, or add log context. No blanket wrapping; unexpected errors bubble to the filter.

## 7. Logging (nestjs-pino)

- `LoggerModule.forRoot` with: `pino-pretty` in dev, JSON in prod; log level from `LOG_LEVEL`.
- `genReqId` reuses validated `X-Request-ID` (see §8) so every log line in a request carries `reqId`.
- Redaction paths: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.passwordHash`, `*.refreshToken`, `*.accessToken`, `*.token`.
- HTTP auto-logging: method, url, status, responseTime, reqId.
- Services use `new Logger(Context)` / injected `PinoLogger` — context name = class.
- Never log credentials, tokens, auth headers, or PII payloads.

## 8. Request correlation ID

- `RequestIdMiddleware` (or pino `genReqId`): read `X-Request-ID`; **reuse only if it matches UUID or `^[A-Za-z0-9_-]{8,64}$`**, else generate UUIDv4. Prevents log injection / unbounded input.
- Set on response header `X-Request-ID`; bound into logger context.

## 9. API versioning & response shape

- `main.ts`: global prefix `api`, URI versioning → routes under `/api/v1/...`.
- `ResponseInterceptor` (global) wraps success:
  ```json
  { "success": true, "message": "Users fetched successfully", "data": [],
    "meta": { "page":1,"limit":20,"total":100,"totalPages":5 } }
  ```
- `message` supplied by `@ResponseMessage('...')` metadata, defaulting to a generic success string. `meta` present only for paginated results.
- Standardization applies at the HTTP boundary only; internal service methods return plain typed values/DTOs.

## 10. DTO & serialization standards

- Per resource: `CreateXDto`, `UpdateXDto` (PartialType), `XQueryDto` (extends `PaginationQueryDto`), `XResponseDto`.
- Global `ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true, transformOptions:{enableImplicitConversion:true} })`.
- **Services map Prisma models → Response DTO via `plainToInstance(XResponseDto, model, { excludeExtraneousValues:true })`.** `@Expose()` allowlists fields. `passwordHash`, `deletedAt`, session secrets are never exposed. Prisma models never returned directly from controllers.

## 11. Enums & constants

- Domain enums live with their module (`UserRole`, `UserStatus` in users; token/auth enums in auth). No global grab-bag enum file.
- `UserRole = SUPER_ADMIN | ADMIN | EMPLOYEE`. No magic strings for domain values; trivial literals left inline per pragmatism (rule #30).

## 12. Authentication

**Access token:** JWT, ~15m TTL, payload `{ sub, role, tokenVersion }`, signed with `JWT_ACCESS_SECRET`.

**Refresh token:** opaque 256-bit random (base64url). Only its argon2 hash stored in `Session`. ~7d TTL.

- `POST /api/v1/auth/login` — validate credentials (argon2.verify), issue access+refresh, create `Session`, return tokens + user DTO. Stricter per-route throttle + Redis failed-login lockout.
- `POST /api/v1/auth/refresh` — look up session by presented refresh token, verify hash, check not expired/revoked. **Rotate**: revoke old, issue new pair. **Reuse detection**: if a revoked/rotated token is presented, revoke the entire session family for that user and 401.
- `POST /api/v1/auth/logout` — revoke current session (`revokedAt`).
- `POST /api/v1/auth/logout-all` — revoke all sessions for the user (bump `tokenVersion` to invalidate outstanding access tokens).
- `GET /api/v1/auth/me` — current user from access token.

**Strategies/guards:**
- `JwtStrategy` (passport-jwt) validates signature + `tokenVersion` match.
- `JwtAuthGuard` registered **globally** via `APP_GUARD`; `@Public()` opts routes out (login, refresh, health, docs).
- Password hashing argon2id; passwords validated by DTO (min length, complexity policy configurable).

## 13. Authorization (RBAC, permission-ready)

- `@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)` + `RolesGuard` via `Reflector`. No inline role checks in controller bodies.
- Permission seam now: `@RequirePermissions('users.read')` backed by an in-code `ROLE_PERMISSIONS` map (role → permission set). Guard checks the mapped set. Migrating to DB-driven permissions later is additive.
- Role hierarchy (`SUPER_ADMIN > ADMIN > EMPLOYEE`) expressed in the permission map, not auto-assumed per check.

## 14. Users module

- `POST /api/v1/users` (ADMIN+) — create user, hash password, set `createdBy`.
- `GET /api/v1/users` (ADMIN+) — paginated/sorted list.
- `GET /api/v1/users/:id` — self or ADMIN+.
- `PATCH /api/v1/users/:id` — self (limited fields) or ADMIN+ (role/status).
- `DELETE /api/v1/users/:id` (ADMIN+) — soft delete (`deletedAt`).
- Activation/deactivation via `status` (`ACTIVE|INACTIVE|SUSPENDED`).
- Thin controllers: validate → call service → return DTO. Business rules in `UsersService`. PrismaService used directly (no repository abstraction until it earns its place — rule #32).

## 15. Database (Prisma + Postgres)

Models:
- **User**: id (cuid), email (unique), passwordHash, firstName, lastName, role (`UserRole`), status (`UserStatus`), createdAt, updatedAt, createdBy?, updatedBy?, deletedAt? (soft delete).
- **Session**: id, userId (fk, indexed), hashedToken, userAgent?, ip?, expiresAt, revokedAt?, replacedById? (rotation chain), createdAt.
- **AuditLog**: id, actorId?, action, resource, resourceId?, requestId?, ip?, metadata (Json, no secrets), createdAt. Indexed on `(resource, resourceId)` and `createdAt`.

Rules:
- Migrations only: `migrate dev` locally, `migrate deploy` on release. Never `db push` in prod.
- Soft delete **only on User**, enforced by a Prisma client extension applying `deletedAt: null` to default finds so deleted rows never leak.
- Indexes intentional: `User.email` unique, `Session.userId`, audit indexes above. Nothing speculative.
- Transactions (`$transaction`) only where atomicity is required (e.g. refresh rotation: revoke old + create new). No transactions around simple reads.
- Graceful shutdown: `app.enableShutdownHooks()` + `PrismaService implements OnModuleDestroy` → `$disconnect()`. Redis + HTTP closed on SIGTERM (Prisma 6 has no `beforeExit` hook).

Seed: `prisma/seed.ts` creates a `SUPER_ADMIN` from env-provided credentials (idempotent upsert); fails loudly if seed env missing in non-dev.

## 16. Pagination

- Shared `PaginationQueryDto`: `page` (default 1), `limit` (default 20, max 100), `sortBy`, `sortOrder` (`asc|desc`).
- Helper computes `skip/take` and builds `meta`. Cursor pagination documented as a future option for high-volume resources; not implemented now.

## 17. Security baseline

- Helmet; CORS allowlist from `CORS_ORIGINS`.
- Global throttler (Redis storage) + stricter `/auth/login` limit + Redis failed-login lockout (counter keyed by email+ip, TTL).
- Global ValidationPipe (whitelist/forbid/transform).
- argon2id passwords; no plaintext ever.
- No secrets in source; env validated on boot.
- Prod errors generic; stack never returned.
- Correct HTTP status codes throughout.

## 18. Health

- `@nestjs/terminus` at `/api/v1/health` (documented) + unversioned `/health` for LB probes.
- Indicators: Prisma connectivity ping, Redis ping. Extension points left for external APIs/S3/etc. — not wired unless critical.

## 19. Observability extension points

- pino JSON logs are Loki/ELK-ready. `reqId` is the trace seam.
- Clean place to add OpenTelemetry + Prometheus later (noted in `docs/architecture.md`); nothing installed now.

## 20. Testing

- **Unit** (Jest): services with PrismaService + Redis mocked. Deterministic.
- **E2E** (Supertest) against real throwaway Postgres + Redis via `docker-compose.test.yml` (Prisma behavior must be real, not faked). Flows: login; refresh rotation + reuse-detection; `@Public`/guard enforcement; RBAC 403; validation 400 envelope; 404/409 envelopes; `/me`.
- Testcontainers noted as future upgrade.
- CI fails on tsc error, lint error, or test failure.

## 21. Docker & DX

- Multi-stage `Dockerfile` (deps → build → runtime on Node 22 LTS slim), runs as non-root, `HEALTHCHECK` hitting `/health`.
- `docker-compose.yml` (app + postgres + redis) for local; `docker-compose.test.yml` for E2E.
- `.dockerignore`. Graceful shutdown wired.
- npm scripts: `start:dev`, `build`, `start:prod`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:e2e`, `test:cov`, `prisma:migrate`, `prisma:deploy`, `prisma:seed`, `prisma:studio`.
- Husky pre-commit → lint-staged (eslint+prettier on staged files).

## 22. Documentation & ADRs

- `README.md`: overview, architecture, folder structure, setup, env, DB/migrations, run, test, Swagger, Postman, auth, RBAC, logging, Docker, deploy, git conventions, coding standards.
- `docs/`: architecture.md, authentication.md, api-guidelines.md, database.md, development.md.
- ADRs: `001-modular-monolith`, `002-jwt-plus-db-refresh-rotation`, `003-postgresql-prisma`, `004-pino-logging`, `005-rbac-permission-seam`, `006-token-delivery-body-vs-cookie`.

## 23. Git & API conventions

- Branches: `main`, `develop`, `feature/*`, `fix/*`, `hotfix/*`, `refactor/*`, `chore/*`.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`).
- REST: plural nouns, HTTP verbs carry the action (`POST /users`, `DELETE /users/:id`); no verb-in-path.

## 24. Deviations from original brief (approved)

1. Winston → **nestjs-pino** (structured + auto request-correlation + redaction).
2. Explicit Response DTOs instead of trusting `ClassSerializerInterceptor` over Prisma models.
3. Validate/limit client-supplied `X-Request-ID`.
4. Permission seam now, DB permission tables later.
5. Tokens in body + cookie ADR, not cookies now.
6. Env validation via class-validator (no Joi).
```
