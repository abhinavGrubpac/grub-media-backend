# grub-media-backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade NestJS modular-monolith backend foundation — Auth, Users, Health — with all cross-cutting infrastructure (config, logging, errors, response shape, security, Docker).

**Architecture:** Feature-first modular monolith. Global cross-cutting concerns (JWT auth guard, response interceptor, exception filter, validation, request-id, pino logging) are registered once in `AppModule`/`main.ts`. Feature modules (`auth`, `users`, `health`) are self-contained. PrismaService is used directly by services; no repository abstraction. DB-persisted argon2-hashed rotated refresh tokens give real logout/revocation.

**Tech Stack:** NestJS 11, TypeScript 5, Node 22 LTS, Prisma 6 + PostgreSQL 16, Redis (ioredis), argon2, passport-jwt, nestjs-pino, @nestjs/throttler + redis storage, @nestjs/terminus, @nestjs/swagger, helmet, class-validator/transformer, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-10-07-grub-media-backend-foundation-design.md`

## Global Constraints

- NestJS 11, TypeScript 5.x, Prisma 6, Node 22 LTS runtime image, npm.
- No `process.env` in services — only namespaced `ConfigService.get('ns.key')`.
- App must throw on boot if env is invalid (class-validator `validate`).
- Prisma models never returned from controllers — map to Response DTO via `plainToInstance(..., { excludeExtraneousValues: true })`.
- Never log/return `passwordHash`, refresh/access tokens, `authorization`/`cookie` headers, or secrets.
- Migrations only (`migrate dev`/`migrate deploy`); never `db push` for prod.
- `try/catch` only to transform/enrich/recover/add-log-context; otherwise let errors bubble to the global filter.
- Routes under `/api/v1/...` (global prefix `api` + URI versioning). `@Public()` opts out of the global JWT guard.
- UserRole = `SUPER_ADMIN | ADMIN | EMPLOYEE`; UserStatus = `ACTIVE | INACTIVE | SUSPENDED`. No magic strings for these.
- Conventional commits. Commits use the repo's local git identity; do NOT add a `Co-Authored-By: Claude` trailer.
- No `any` without a documented reason; async/await; thin controllers.

## Review Focus

Inputs/failure modes the spec implies but that need explicit test pinning (each pinned in the owning task):

- **Refresh-token reuse after rotation** → presenting an already-rotated token must revoke the whole session family and 401, not silently issue new tokens. (Task 10)
- **passwordHash leakage** → `GET /users` and `/auth/me` responses must never contain `passwordHash`/`deletedAt`. (Tasks 12, 9)
- **Soft-deleted user still usable** → a user with `deletedAt` set must not appear in list/get and must not be able to authenticate. (Tasks 8, 12)
- **Malicious `X-Request-ID`** → an over-long or injection-y header value must be rejected and a fresh UUID generated instead. (Task 6)
- **Non-whitelisted / wrong-type body fields** → extra fields rejected (400 VALIDATION_ERROR envelope), query `limit` coerced and capped at 100. (Tasks 5, 7, 12)

---

## Task 1: Project scaffold, tooling, scripts

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `.dockerignore`, `.env.example`, `src/main.ts` (minimal), `src/app.module.ts` (minimal)
- Create: `.husky/pre-commit`, lint-staged config in `package.json`

**Interfaces:**
- Produces: a buildable Nest app with `npm run build`, `npm run start:dev`, `npm run lint`, `npm run test`, `npm run test:e2e`.

- [ ] **Step 1: Initialize package + install deps**

```bash
npm init -y
npm i @nestjs/common@^11 @nestjs/core@^11 @nestjs/platform-express@^11 @nestjs/config@^11 \
  @nestjs/jwt@^11 @nestjs/passport@^11 passport passport-jwt \
  @nestjs/swagger@^11 @nestjs/terminus@^11 @nestjs/throttler@^6 @nest-lab/throttler-storage-redis \
  @prisma/client@^6 ioredis argon2 nestjs-pino pino-http helmet \
  class-validator class-transformer reflect-metadata rxjs
npm i -D typescript@^5 @types/node@^22 @types/passport-jwt @types/supertest \
  @nestjs/cli@^11 @nestjs/testing@^11 @nestjs/schematics@^11 \
  prisma@^6 jest ts-jest @types/jest supertest ts-node source-map-support \
  eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  eslint-config-prettier eslint-plugin-prettier prettier pino-pretty husky lint-staged
```

- [ ] **Step 2: Add tsconfig** (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "moduleResolution": "node",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "noImplicitAny": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "paths": { "@/*": ["src/*"] }
  }
}
```

- [ ] **Step 3: nest-cli.json + build tsconfig**

`nest-cli.json`:
```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src", "compilerOptions": { "deleteOutDir": true } }
```
`tsconfig.build.json`:
```json
{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*spec.ts"] }
```

- [ ] **Step 4: Scripts + lint-staged** (merge into `package.json`)

```json
{
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"{src,test}/**/*.ts\"",
    "lint:fix": "eslint \"{src,test}/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "jest",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:seed": "ts-node prisma/seed.ts",
    "prisma:studio": "prisma studio",
    "prepare": "husky"
  },
  "lint-staged": { "*.ts": ["eslint --fix", "prettier --write"] },
  "prisma": { "seed": "ts-node prisma/seed.ts" }
}
```

- [ ] **Step 5: `.gitignore` / `.dockerignore` / eslint / prettier**

`.gitignore`: `node_modules`, `dist`, `.env`, `.env.*` (but keep `!.env.example`), `coverage`, `*.log`.
`.dockerignore`: `node_modules`, `dist`, `.git`, `coverage`, `.env`, `.env.*`, `test`, `docs`.
`.eslintrc.cjs`: `@typescript-eslint` parser + recommended + prettier; rule `@typescript-eslint/no-explicit-any: error`.
`.prettierrc`: `{ "singleQuote": true, "trailingComma": "all", "printWidth": 100 }`.

- [ ] **Step 6: Minimal bootstrap** (`src/app.module.ts`, `src/main.ts`)

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
@Module({})
export class AppModule {}
```
```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

- [ ] **Step 7: Jest config** (in `package.json`)

```json
{ "jest": { "moduleFileExtensions": ["js","json","ts"], "rootDir": "src", "testRegex": ".*\\.spec\\.ts$", "transform": { "^.+\\.(t|j)s$": "ts-jest" }, "collectCoverageFrom": ["**/*.(t|j)s"], "coverageDirectory": "../coverage", "testEnvironment": "node", "moduleNameMapper": { "^@/(.*)$": "<rootDir>/$1" } } }
```

- [ ] **Step 8: Init husky + verify build/lint**

Run: `npx husky init && echo "npx lint-staged" > .husky/pre-commit && npm run build && npm run lint`
Expected: build succeeds, lint passes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold NestJS project with tooling and scripts"
```

---

## Task 2: Environment config + validation

**Files:**
- Create: `src/config/env.validation.ts`, `src/config/app.config.ts`, `src/config/database.config.ts`, `src/config/jwt.config.ts`, `src/config/redis.config.ts`, `src/config/throttle.config.ts`, `src/config/index.ts`
- Test: `src/config/env.validation.spec.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `validate(config: Record<string, unknown>): EnvironmentVariables`; namespaced configs `app`, `database`, `jwt`, `redis`, `throttle` registered via `registerAs`.

- [ ] **Step 1: Write the failing test** (`src/config/env.validation.spec.ts`)

```ts
import { validate } from './env.validation';

const base = {
  NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32), JWT_REFRESH_SECRET: 'y'.repeat(32),
  JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '7d',
  REDIS_HOST: 'localhost', REDIS_PORT: '6379', CORS_ORIGINS: 'http://localhost:3000',
};

describe('validate', () => {
  it('passes with valid env', () => {
    expect(() => validate(base)).not.toThrow();
  });
  it('throws when JWT_ACCESS_SECRET too short', () => {
    expect(() => validate({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow();
  });
  it('throws when DATABASE_URL missing', () => {
    const { DATABASE_URL, ...rest } = base;
    expect(() => validate(rest)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npm test -- env.validation`
Expected: FAIL — `validate` not defined.

- [ ] **Step 3: Implement** (`src/config/env.validation.ts`)

```ts
import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsString, MinLength, validateSync, IsOptional } from 'class-validator';

export enum NodeEnv { Development = 'development', Production = 'production', Test = 'test' }

export class EnvironmentVariables {
  @IsEnum(NodeEnv) NODE_ENV!: NodeEnv;
  @IsInt() PORT!: number;
  @IsString() DATABASE_URL!: string;
  @IsString() @MinLength(32) JWT_ACCESS_SECRET!: string;
  @IsString() @MinLength(32) JWT_REFRESH_SECRET!: string;
  @IsString() JWT_ACCESS_TTL!: string;
  @IsString() JWT_REFRESH_TTL!: string;
  @IsString() REDIS_HOST!: string;
  @IsInt() REDIS_PORT!: number;
  @IsOptional() @IsString() REDIS_PASSWORD?: string;
  @IsString() CORS_ORIGINS!: string;
  @IsOptional() @IsString() LOG_LEVEL?: string;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }
  return validated;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- env.validation`
Expected: PASS (3 tests).

- [ ] **Step 5: Namespaced configs** (`src/config/*.config.ts`)

```ts
// src/config/jwt.config.ts
import { registerAs } from '@nestjs/config';
export default registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET as string,
  refreshSecret: process.env.JWT_REFRESH_SECRET as string,
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
}));
```
Create `app.config.ts` (`app`: port, nodeEnv, corsOrigins split by `,`), `database.config.ts` (`database`: url), `redis.config.ts` (`redis`: host, port, password), `throttle.config.ts` (`throttle`: ttl, limit, login limit). `index.ts` re-exports all as an array for `ConfigModule.forRoot({ load: [...] })`.

- [ ] **Step 6: Fill `.env.example`** with every key + safe placeholders (32+ char dummy secrets).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(config): add validated namespaced environment configuration"
```

---

## Task 3: PrismaModule + PrismaService + schema + soft-delete extension

**Files:**
- Create: `prisma/schema.prisma`, `src/database/prisma.service.ts`, `src/database/prisma.module.ts`
- Test: `src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces: `PrismaService` (extends `PrismaClient`, `OnModuleInit`/`OnModuleDestroy`) exported by global `PrismaModule`. Soft-delete: default `findMany/findFirst/findUnique` on `User` exclude `deletedAt != null`.

- [ ] **Step 1: Define schema** (`prisma/schema.prisma`)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum UserRole { SUPER_ADMIN ADMIN EMPLOYEE }
enum UserStatus { ACTIVE INACTIVE SUSPENDED }

model User {
  id           String     @id @default(cuid())
  email        String     @unique
  passwordHash String
  firstName    String
  lastName     String
  role         UserRole   @default(EMPLOYEE)
  status       UserStatus @default(ACTIVE)
  createdBy    String?
  updatedBy    String?
  deletedAt    DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  sessions     Session[]
  @@index([deletedAt])
}

model Session {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  hashedToken  String
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?
  createdAt    DateTime  @default(now())
  @@index([userId])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  action     String
  resource   String
  resourceId String?
  requestId  String?
  ip         String?
  metadata   Json?
  createdAt  DateTime @default(now())
  @@index([resource, resourceId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Write failing test** (`src/database/prisma.service.spec.ts`)

```ts
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('exposes a client extended with soft-delete filtering', () => {
    const service = new PrismaService();
    expect(service.client).toBeDefined();
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `npm test -- prisma.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement PrismaService** (`src/database/prisma.service.ts`)

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly client = this.$extends({
    query: {
      user: {
        async findMany({ args, query }) { args.where = { deletedAt: null, ...args.where }; return query(args); },
        async findFirst({ args, query }) { args.where = { deletedAt: null, ...args.where }; return query(args); },
        async findUnique({ args, query }) {
          return (this as PrismaClient).user.findFirst({ where: { ...args.where, deletedAt: null } });
        },
      },
    },
  });

  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```
> Note: use `service.client` for all reads/writes so the soft-delete extension applies. Document in `docs/database.md`.

- [ ] **Step 5: PrismaModule (global)** (`src/database/prisma.module.ts`)

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- [ ] **Step 6: Generate client + create migration + run test**

Run:
```bash
npx prisma generate
npx prisma migrate dev --name init --create-only   # review SQL
npm test -- prisma.service
```
Expected: client generated, migration file created, test PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(database): add Prisma schema, service, soft-delete extension, init migration"
```

---

## Task 4: RedisModule + RedisService

**Files:**
- Create: `src/redis/redis.service.ts`, `src/redis/redis.module.ts`
- Test: `src/redis/redis.service.spec.ts`

**Interfaces:**
- Produces: `RedisService` with `getClient(): Redis`, `increment(key, ttlSeconds): Promise<number>`, `get(key)`, `set(key, val, ttlSeconds?)`, `del(key)`, `ping()`. Global `RedisModule`.

- [ ] **Step 1: Write failing test** (`src/redis/redis.service.spec.ts`)

```ts
import { RedisService } from './redis.service';

describe('RedisService.increment', () => {
  it('increments and sets TTL on first hit', async () => {
    const fake: any = {
      multi: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
    };
    const service = new RedisService(fake);
    const count = await service.increment('login:a@b.c', 900);
    expect(count).toBe(1);
    expect(fake.incr).toHaveBeenCalledWith('login:a@b.c');
    expect(fake.expire).toHaveBeenCalledWith('login:a@b.c', 900);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npm test -- redis.service`
Expected: FAIL — not defined.

- [ ] **Step 3: Implement** (`src/redis/redis.service.ts`)

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
  getClient(): Redis { return this.redis; }
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const res = await this.redis.multi().incr(key).expire(key, ttlSeconds).exec();
    return (res?.[0]?.[1] as number) ?? 0;
  }
  async get(key: string): Promise<string | null> { return this.redis.get(key); }
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) { await this.redis.set(key, value, 'EX', ttlSeconds); } else { await this.redis.set(key, value); }
  }
  async del(key: string): Promise<void> { await this.redis.del(key); }
  async ping(): Promise<string> { return this.redis.ping(); }
}
```

- [ ] **Step 4: RedisModule (global)** (`src/redis/redis.module.ts`) — provides `REDIS_CLIENT` via factory using `ConfigService.get('redis.*')`, exports `RedisService`.

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, RedisService } from './redis.service';
@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [ConfigService], useFactory: (c: ConfigService) =>
      new Redis({ host: c.get('redis.host'), port: c.get('redis.port'), password: c.get('redis.password'), maxRetriesPerRequest: null }) },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 5: Run test, verify pass**

Run: `npm test -- redis.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(redis): add Redis module and service"
```

---

## Task 5: Global exception filter + response interceptor + domain exceptions

**Files:**
- Create: `src/common/filters/all-exceptions.filter.ts`, `src/common/interceptors/response.interceptor.ts`, `src/common/decorators/response-message.decorator.ts`, `src/common/exceptions/domain.exceptions.ts`, `src/common/constants/error-codes.ts`
- Test: `src/common/filters/all-exceptions.filter.spec.ts`, `src/common/interceptors/response.interceptor.spec.ts`

**Interfaces:**
- Produces: `AllExceptionsFilter` (emits `{success:false, statusCode, message, errorCode, timestamp, path, requestId}`), `ResponseInterceptor` (wraps `{success:true, message, data, meta?}`), `@ResponseMessage(msg)`, domain exceptions (`EmailAlreadyExistsException`, `InvalidCredentialsException`, `UserNotFoundException`).

- [ ] **Step 1: Write failing tests**

`response.interceptor.spec.ts`:
```ts
import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function ctx(message?: string) {
  return {
    switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }),
    getHandler: () => ({}), getClass: () => ({}),
  } as any;
}

describe('ResponseInterceptor', () => {
  it('wraps plain data', async () => {
    const reflector: any = { getAllAndOverride: () => 'OK msg' };
    const interceptor = new ResponseInterceptor(reflector);
    const next = { handle: () => of({ id: '1' }) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as any));
    expect(result).toEqual({ success: true, message: 'OK msg', data: { id: '1' } });
  });
  it('lifts meta out of paginated shape', async () => {
    const reflector: any = { getAllAndOverride: () => undefined };
    const interceptor = new ResponseInterceptor(reflector);
    const next = { handle: () => of({ data: [1], meta: { page: 1 } }) };
    const result = await lastValueFrom(interceptor.intercept(ctx(), next as any));
    expect(result).toEqual({ success: true, message: 'Success', data: [1], meta: { page: 1 } });
  });
});
```

`all-exceptions.filter.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function host(statusHolder: { code?: number; body?: unknown }) {
  const res = { status: (c: number) => { statusHolder.code = c; return res; }, json: (b: unknown) => { statusHolder.body = b; } };
  const req = { url: '/api/v1/users', id: 'req-123' };
  return { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as any;
}

describe('AllExceptionsFilter', () => {
  it('formats HttpException into the standard envelope', () => {
    const holder: any = {};
    new AllExceptionsFilter().catch(new BadRequestException('bad'), host(holder));
    expect(holder.code).toBe(400);
    expect(holder.body).toMatchObject({ success: false, statusCode: 400, errorCode: 'BAD_REQUEST', path: '/api/v1/users', requestId: 'req-123' });
    expect(holder.body.message).toBe('bad');
    expect(holder.body.timestamp).toBeDefined();
  });
  it('maps Prisma P2002 to 409 CONFLICT', () => {
    const holder: any = {};
    const err: any = Object.assign(new Error('unique'), { code: 'P2002', clientVersion: '6', name: 'PrismaClientKnownRequestError' });
    new AllExceptionsFilter().catch(err, host(holder));
    expect(holder.code).toBe(409);
    expect(holder.body.errorCode).toBe('CONFLICT');
  });
  it('hides internal errors as generic 500', () => {
    const holder: any = {};
    new AllExceptionsFilter().catch(new Error('db exploded'), host(holder));
    expect(holder.code).toBe(500);
    expect(holder.body.message).toBe('Internal server error');
    expect(holder.body.errorCode).toBe('INTERNAL_ERROR');
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test -- common/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement error codes + domain exceptions**

`src/common/constants/error-codes.ts`:
```ts
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR', UNAUTHORIZED: 'UNAUTHORIZED', FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT', BAD_REQUEST: 'BAD_REQUEST', INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
```
`src/common/exceptions/domain.exceptions.ts`:
```ts
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
export class EmailAlreadyExistsException extends ConflictException {
  constructor() { super({ message: 'Email already in use', errorCode: 'CONFLICT' }); }
}
export class UserNotFoundException extends NotFoundException {
  constructor() { super({ message: 'User not found', errorCode: 'NOT_FOUND' }); }
}
export class InvalidCredentialsException extends UnauthorizedException {
  constructor() { super({ message: 'Invalid credentials', errorCode: 'UNAUTHORIZED' }); }
}
```

- [ ] **Step 4: Implement ResponseInterceptor + decorator**

`src/common/decorators/response-message.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
export const RESPONSE_MESSAGE = 'response_message';
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE, message);
```
`src/common/interceptors/response.interceptor.ts`:
```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RESPONSE_MESSAGE } from '../decorators/response-message.decorator';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    const message = this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE, [context.getHandler(), context.getClass()]) ?? 'Success';
    return next.handle().pipe(map((payload) => {
      if (payload && typeof payload === 'object' && 'data' in payload && 'meta' in payload) {
        const p = payload as { data: unknown; meta: unknown };
        return { success: true, message, data: p.data, meta: p.meta };
      }
      return { success: true, message, data: payload };
    }));
  }
}
```

- [ ] **Step 5: Implement AllExceptionsFilter**

`src/common/filters/all-exceptions.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ERROR_CODES } from '../constants/error-codes';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();
    const { status, message, errorCode } = this.resolve(exception);
    if (status >= 500) { this.logger.error({ err: exception, requestId: req.id }, 'Unhandled exception'); }
    res.status(status).json({
      success: false, statusCode: status, message, errorCode,
      timestamp: new Date().toISOString(), path: req.url, requestId: req.id,
    });
  }
  private resolve(exception: unknown): { status: number; message: string; errorCode: string } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();
      const body = typeof response === 'object' ? (response as Record<string, unknown>) : { message: response };
      const rawMessage = body.message ?? exception.message;
      return {
        status,
        message: Array.isArray(rawMessage) ? (rawMessage as string[]).join(', ') : String(rawMessage),
        errorCode: (body.errorCode as string) ?? this.statusToCode(status),
      };
    }
    if (this.isPrismaKnownError(exception)) {
      const code = (exception as { code: string }).code;
      if (code === 'P2002') return { status: 409, message: 'Resource already exists', errorCode: ERROR_CODES.CONFLICT };
      if (code === 'P2025') return { status: 404, message: 'Resource not found', errorCode: ERROR_CODES.NOT_FOUND };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error', errorCode: ERROR_CODES.INTERNAL_ERROR };
  }
  private isPrismaKnownError(e: unknown): boolean {
    return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PrismaClientKnownRequestError';
  }
  private statusToCode(status: number): string {
    const map: Record<number, string> = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
    return map[status] ?? ERROR_CODES.INTERNAL_ERROR;
  }
}
```

- [ ] **Step 6: Run tests, verify pass**

Run: `npm test -- common/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(common): global exception filter, response interceptor, domain exceptions"
```

---

## Task 6: Request-ID middleware

**Files:**
- Create: `src/common/middleware/request-id.middleware.ts`, `src/common/constants/request.constants.ts`
- Test: `src/common/middleware/request-id.middleware.spec.ts`

**Interfaces:**
- Produces: `RequestIdMiddleware` setting `req.id` and `X-Request-ID` response header. Exports `REQUEST_ID_HEADER = 'x-request-id'` and `isValidRequestId(value): boolean` (UUID or `^[A-Za-z0-9_-]{8,64}$`).

- [ ] **Step 1: Write failing test**

```ts
import { RequestIdMiddleware, isValidRequestId } from './request-id.middleware';

describe('isValidRequestId', () => {
  it('accepts safe ids', () => { expect(isValidRequestId('abc_123-XY')).toBe(true); });
  it('rejects too-long / injection values', () => {
    expect(isValidRequestId('x'.repeat(200))).toBe(false);
    expect(isValidRequestId('bad\ninjection')).toBe(false);
  });
});

describe('RequestIdMiddleware', () => {
  it('reuses a valid client id', () => {
    const req: any = { headers: { 'x-request-id': 'client_1234' } };
    const res: any = { setHeader: jest.fn() };
    new RequestIdMiddleware().use(req, res, () => {});
    expect(req.id).toBe('client_1234');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'client_1234');
  });
  it('generates a uuid when client id is invalid', () => {
    const req: any = { headers: { 'x-request-id': 'bad\nvalue' } };
    const res: any = { setHeader: jest.fn() };
    new RequestIdMiddleware().use(req, res, () => {});
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Run test, verify fail** — `npm test -- request-id` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && (SAFE_ID.test(value) || UUID.test(value));
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    req.id = isValidRequestId(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
  }
}
```

- [ ] **Step 4: Run test, verify pass** — `npm test -- request-id` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(common): validated request-id middleware"`

---

## Task 7: Pagination DTO + helper

**Files:**
- Create: `src/common/dto/pagination-query.dto.ts`, `src/common/dto/paginated.ts`, `src/common/utils/paginate.ts`
- Test: `src/common/utils/paginate.spec.ts`

**Interfaces:**
- Produces: `PaginationQueryDto { page=1, limit=20 (max 100), sortBy?, sortOrder='desc' }`; `buildMeta(total, page, limit): PaginatedMeta`; `toSkipTake(dto): { skip, take }`; type `Paginated<T> = { data: T[]; meta: PaginatedMeta }`.

- [ ] **Step 1: Write failing test** (`paginate.spec.ts`)

```ts
import { buildMeta, toSkipTake } from './paginate';

describe('pagination', () => {
  it('computes skip/take', () => { expect(toSkipTake({ page: 3, limit: 20 } as any)).toEqual({ skip: 40, take: 20 }); });
  it('builds meta with totalPages', () => {
    expect(buildMeta(100, 1, 20)).toEqual({ page: 1, limit: 20, total: 100, totalPages: 5 });
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement DTO + helper**

```ts
// src/common/dto/pagination-query.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
export class PaginationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc';
}
```
```ts
// src/common/dto/paginated.ts
export interface PaginatedMeta { page: number; limit: number; total: number; totalPages: number; }
export interface Paginated<T> { data: T[]; meta: PaginatedMeta; }
```
```ts
// src/common/utils/paginate.ts
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { PaginatedMeta } from '../dto/paginated';
export function toSkipTake(dto: PaginationQueryDto): { skip: number; take: number } {
  return { skip: (dto.page - 1) * dto.limit, take: dto.limit };
}
export function buildMeta(total: number, page: number, limit: number): PaginatedMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}
```

- [ ] **Step 4: Run, verify pass** — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(common): reusable pagination dto and helpers"`

---

## Task 8: Users module — service, DTOs, soft-delete, response mapping

**Files:**
- Create: `src/modules/users/users.module.ts`, `src/modules/users/services/users.service.ts`, `src/modules/users/dto/create-user.dto.ts`, `update-user.dto.ts`, `user-query.dto.ts`, `user-response.dto.ts`
- Test: `src/modules/users/services/users.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService.client`, argon2.
- Produces: `UsersService` with `create(dto, actorId?): Promise<UserResponseDto>`, `findById(id): Promise<UserResponseDto>`, `findByEmailWithHash(email): Promise<User | null>` (internal, includes hash — used by auth only), `list(query): Promise<Paginated<UserResponseDto>>`, `update(id, dto, actorId): Promise<UserResponseDto>`, `softDelete(id): Promise<void>`, `setStatus(id, status)`. `UserResponseDto` with `@Expose()` on id, email, firstName, lastName, role, status, createdAt, updatedAt (NO passwordHash/deletedAt).

- [ ] **Step 1: Write failing test** (`users.service.spec.ts`)

```ts
import { UsersService } from './users.service';
import { EmailAlreadyExistsException } from '../../../common/exceptions/domain.exceptions';

const userRow = {
  id: 'u1', email: 'a@b.c', passwordHash: 'HASH', firstName: 'A', lastName: 'B',
  role: 'EMPLOYEE', status: 'ACTIVE', deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
};

function prismaMock(overrides: any = {}) {
  return { client: { user: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(userRow),
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([userRow]),
    update: jest.fn().mockResolvedValue({ ...userRow, deletedAt: new Date() }),
    ...overrides,
  } } } as any;
}

describe('UsersService', () => {
  it('creates a user and never returns passwordHash', async () => {
    const svc = new UsersService(prismaMock());
    const result = await svc.create({ email: 'a@b.c', password: 'Str0ng!pass', firstName: 'A', lastName: 'B' } as any);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.email).toBe('a@b.c');
  });
  it('rejects duplicate email', async () => {
    const svc = new UsersService(prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow) }));
    await expect(svc.create({ email: 'a@b.c', password: 'Str0ng!pass', firstName: 'A', lastName: 'B' } as any))
      .rejects.toBeInstanceOf(EmailAlreadyExistsException);
  });
  it('list returns paginated DTOs without hash', async () => {
    const svc = new UsersService(prismaMock());
    const page = await svc.list({ page: 1, limit: 20, sortOrder: 'desc' } as any);
    expect(page.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(page.data[0]).not.toHaveProperty('passwordHash');
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement DTOs**

```ts
// create-user.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
export class CreateUserDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, { message: 'password must include upper, lower and a number' })
  password!: string;
  @ApiProperty() @IsString() @MinLength(1) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) lastName!: string;
  @ApiProperty({ enum: UserRole, required: false }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
}
```
```ts
// update-user.dto.ts
import { PartialType, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { UserStatus } from '@prisma/client';
import { CreateUserDto } from './create-user.dto';
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
```
```ts
// user-query.dto.ts
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
export class UserQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
```
```ts
// user-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { UserRole, UserStatus } from '@prisma/client';
export class UserResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() email!: string;
  @ApiProperty() @Expose() firstName!: string;
  @ApiProperty() @Expose() lastName!: string;
  @ApiProperty({ enum: UserRole }) @Expose() role!: UserRole;
  @ApiProperty({ enum: UserStatus }) @Expose() status!: UserStatus;
  @ApiProperty() @Expose() createdAt!: Date;
  @ApiProperty() @Expose() updatedAt!: Date;
}
```

- [ ] **Step 4: Implement UsersService**

```ts
import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import type { User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { EmailAlreadyExistsException, UserNotFoundException } from '../../../common/exceptions/domain.exceptions';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(user: User): UserResponseDto {
    return plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true });
  }

  async create(dto: CreateUserDto, actorId?: string): Promise<UserResponseDto> {
    const existing = await this.prisma.client.user.findFirst({ where: { email: dto.email } });
    if (existing) throw new EmailAlreadyExistsException();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.client.user.create({
      data: { email: dto.email, passwordHash, firstName: dto.firstName, lastName: dto.lastName, role: dto.role, createdBy: actorId },
    });
    return this.toDto(user);
  }

  async findById(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.client.user.findFirst({ where: { id } });
    if (!user) throw new UserNotFoundException();
    return this.toDto(user);
  }

  async findByEmailWithHash(email: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({ where: { email } });
  }

  async list(query: UserQueryDto): Promise<Paginated<UserResponseDto>> {
    const where = { role: query.role, status: query.status };
    const { skip, take } = toSkipTake(query);
    const orderBy = { [query.sortBy ?? 'createdAt']: query.sortOrder };
    const [rows, total] = await Promise.all([
      this.prisma.client.user.findMany({ where, skip, take, orderBy }),
      this.prisma.client.user.count({ where }),
    ]);
    return { data: rows.map((r) => this.toDto(r)), meta: buildMeta(total, query.page, query.limit) };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserResponseDto> {
    await this.findById(id);
    const user = await this.prisma.client.user.update({ where: { id }, data: { ...dto, updatedBy: actorId } });
    return this.toDto(user);
  }

  async softDelete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.client.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async setStatus(id: string, status: UserStatus): Promise<UserResponseDto> {
    await this.findById(id);
    const user = await this.prisma.client.user.update({ where: { id }, data: { status } });
    return this.toDto(user);
  }
}
```

- [ ] **Step 5: UsersModule**

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

- [ ] **Step 6: Run, verify pass** — `npm test -- users.service` → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(users): users service, DTOs, soft delete, safe response mapping"`

---

## Task 9: Auth decorators, strategy, guards (RBAC + permission seam)

**Files:**
- Create: `src/modules/auth/decorators/public.decorator.ts`, `roles.decorator.ts`, `require-permissions.decorator.ts`, `current-user.decorator.ts`
- Create: `src/modules/auth/strategies/jwt.strategy.ts`, `src/modules/auth/guards/jwt-auth.guard.ts`, `src/modules/auth/guards/roles.guard.ts`
- Create: `src/modules/auth/constants/permissions.ts`
- Test: `src/modules/auth/guards/roles.guard.spec.ts`

**Interfaces:**
- Consumes: `UserRole` from `@prisma/client`, `ConfigService.get('jwt.accessSecret')`.
- Produces: `@Public()`, `@Roles(...roles)`, `@RequirePermissions(...perms)`, `@CurrentUser()`; `JwtStrategy` producing `AuthUser { id, role, tokenVersion }`; `JwtAuthGuard` (honors `@Public`); `RolesGuard` (checks roles AND mapped permissions); `ROLE_PERMISSIONS: Record<UserRole, Permission[]>`.

- [ ] **Step 1: Permissions map + decorators**

```ts
// constants/permissions.ts
import { UserRole } from '@prisma/client';
export type Permission =
  | 'users.read' | 'users.create' | 'users.update' | 'users.delete';
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: ['users.read', 'users.create', 'users.update', 'users.delete'],
  ADMIN: ['users.read', 'users.create', 'users.update', 'users.delete'],
  EMPLOYEE: ['users.read'],
};
```
```ts
// decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```
```ts
// decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```
```ts
// decorators/require-permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions';
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);
```
```ts
// decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export interface AuthUser { id: string; role: import('@prisma/client').UserRole; tokenVersion: number; }
export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);
```

- [ ] **Step 2: Write failing test** (`roles.guard.spec.ts`)

```ts
import { RolesGuard } from './roles.guard';
import { UserRole } from '@prisma/client';

function ctx(user: any) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
}

describe('RolesGuard', () => {
  it('allows when no roles/permissions required', () => {
    const reflector: any = { getAllAndOverride: () => undefined };
    expect(new RolesGuard(reflector).canActivate(ctx({ role: 'EMPLOYEE' }))).toBe(true);
  });
  it('denies EMPLOYEE when ADMIN role required', () => {
    const reflector: any = { getAllAndOverride: (key: string) => (key === 'roles' ? [UserRole.ADMIN] : undefined) };
    expect(new RolesGuard(reflector).canActivate(ctx({ role: 'EMPLOYEE' }))).toBe(false);
  });
  it('allows EMPLOYEE for users.read permission', () => {
    const reflector: any = { getAllAndOverride: (key: string) => (key === 'permissions' ? ['users.read'] : undefined) };
    expect(new RolesGuard(reflector).canActivate(ctx({ role: 'EMPLOYEE' }))).toBe(true);
  });
  it('denies EMPLOYEE for users.delete permission', () => {
    const reflector: any = { getAllAndOverride: (key: string) => (key === 'permissions' ? ['users.delete'] : undefined) };
    expect(new RolesGuard(reflector).canActivate(ctx({ role: 'EMPLOYEE' }))).toBe(false);
  });
});
```

- [ ] **Step 3: Run, verify fail** — FAIL.

- [ ] **Step 4: Implement guards + strategy**

```ts
// guards/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Permission, ROLE_PERMISSIONS } from '../constants/permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    const perms = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length && !perms?.length) return true;
    const user = context.switchToHttp().getRequest().user as { role: UserRole } | undefined;
    if (!user) return false;
    if (roles?.length && !roles.includes(user.role)) return false;
    if (perms?.length) {
      const granted = ROLE_PERMISSIONS[user.role] ?? [];
      if (!perms.every((p) => granted.includes(p))) return false;
    }
    return true;
  }
}
```
```ts
// guards/jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```
```ts
// strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';
import { UserStatus } from '@prisma/client';
import type { AuthUser } from '../decorators/current-user.decorator';

interface JwtPayload { sub: string; role: string; tokenVersion: number; }

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: config.get<string>('jwt.accessSecret') });
  }
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.client.user.findFirst({ where: { id: payload.sub } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException();
    return { id: user.id, role: user.role, tokenVersion: payload.tokenVersion };
  }
}
```
> `tokenVersion`: add a `tokenVersion Int @default(0)` column to `User` in a follow-up migration here — used by logout-all. Update schema + `npx prisma migrate dev --name add_token_version` before running tests. Adjust JwtStrategy to compare `payload.tokenVersion === user.tokenVersion` and reject mismatch.

- [ ] **Step 5: Run, verify pass** — `npm test -- roles.guard` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(auth): JWT strategy, auth/roles guards, RBAC permission seam"`

---

## Task 10: Token service — issue, hash, rotate, reuse-detection

**Files:**
- Create: `src/modules/auth/services/token.service.ts`
- Test: `src/modules/auth/services/token.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService.client` (`session`), `JwtService`, `ConfigService('jwt.*')`, argon2.
- Produces: `TokenService` with `issuePair(user, ctx): Promise<{ accessToken, refreshToken }>` (creates Session with hashed refresh token), `rotate(presentedToken, ctx): Promise<{ accessToken, refreshToken, userId }>` (verifies, detects reuse → revoke family + throw, else rotate), `revokeSession(sessionId)`, `revokeAllForUser(userId)`.

- [ ] **Step 1: Write failing test** (`token.service.spec.ts`) — covers reuse-detection (Review Focus)

```ts
import { TokenService } from './token.service';
import { UnauthorizedException } from '@nestjs/common';

const now = new Date(Date.now() + 86400000);

function deps(sessionRow: any) {
  const prisma = { client: { session: {
    create: jest.fn().mockResolvedValue({ id: 's1' }),
    findMany: jest.fn().mockResolvedValue(sessionRow ? [sessionRow] : []),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  } } } as any;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') } as any;
  const config = { get: jest.fn((k: string) => (k === 'jwt.refreshTtl' ? '7d' : k === 'jwt.accessTtl' ? '15m' : 'secret')) } as any;
  return { prisma, jwt, config };
}

describe('TokenService.rotate', () => {
  it('revokes the whole family and throws when a revoked token is reused', async () => {
    const argon2 = require('argon2');
    const hashed = await argon2.hash('leaked-token');
    const { prisma, jwt, config } = deps({ id: 's1', userId: 'u1', hashedToken: hashed, revokedAt: new Date(), expiresAt: now });
    const svc = new TokenService(prisma, jwt, config);
    await expect(svc.rotate('leaked-token', { ip: '1.1.1.1' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.client.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement TokenService**

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import type { User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

interface SessionCtx { ip?: string; userAgent?: string; }
interface TokenPair { accessToken: string; refreshToken: string; }

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async signAccess(user: Pick<User, 'id' | 'role'> & { tokenVersion: number }): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, role: user.role, tokenVersion: user.tokenVersion },
      { secret: this.config.get('jwt.accessSecret'), expiresIn: this.config.get('jwt.accessTtl') },
    );
  }

  private expiryFromNow(): Date { return new Date(Date.now() + 7 * 24 * 3600 * 1000); }

  async issuePair(user: User & { tokenVersion: number }, ctx: SessionCtx): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    const hashedToken = await argon2.hash(refreshToken, { type: argon2.argon2id });
    await this.prisma.client.session.create({
      data: { userId: user.id, hashedToken, ip: ctx.ip, userAgent: ctx.userAgent, expiresAt: this.expiryFromNow() },
    });
    const accessToken = await this.signAccess(user);
    return { accessToken, refreshToken };
  }

  async rotate(presentedToken: string, ctx: SessionCtx): Promise<TokenPair & { userId: string }> {
    const candidates = await this.prisma.client.session.findMany({ where: { expiresAt: { gt: new Date() } }, include: { user: true } });
    let match: (typeof candidates)[number] | undefined;
    for (const s of candidates) { if (await argon2.verify(s.hashedToken, presentedToken)) { match = s; break; } }
    if (!match) throw new UnauthorizedException('Invalid refresh token');
    if (match.revokedAt) {
      await this.prisma.client.session.updateMany({ where: { userId: match.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const user = (match as unknown as { user: User & { tokenVersion: number } }).user;
    const pair = await this.issuePair(user, ctx);
    await this.prisma.client.session.update({ where: { id: match.id }, data: { revokedAt: new Date() } });
    return { ...pair, userId: match.userId };
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.client.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
```
> `rotate` scanning all sessions is acceptable at foundation scale; `docs/database.md` notes the future optimization (store a lookup selector/prefix) when session volume grows.

- [ ] **Step 4: Run, verify pass** — `npm test -- token.service` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(auth): token service with rotation and reuse detection"`

---

## Task 11: AuthService + brute-force lockout

**Files:**
- Create: `src/modules/auth/services/auth.service.ts`, `src/modules/auth/dto/login.dto.ts`, `refresh.dto.ts`, `auth-response.dto.ts`
- Test: `src/modules/auth/services/auth.service.spec.ts`

**Interfaces:**
- Consumes: `UsersService.findByEmailWithHash`, `TokenService`, `RedisService.increment`, argon2.
- Produces: `AuthService.login(dto, ctx): Promise<AuthResponseDto>`, `refresh(token, ctx)`, `logout(userId)`, `me(userId): Promise<UserResponseDto>`. Locks after N failed attempts (`throttle.loginLockMax`) for a TTL window.

- [ ] **Step 1: Write failing test**

```ts
import { AuthService } from './auth.service';
import { InvalidCredentialsException } from '../../../common/exceptions/domain.exceptions';

const user = { id: 'u1', email: 'a@b.c', passwordHash: 'HASH', role: 'EMPLOYEE', status: 'ACTIVE', tokenVersion: 0 };

function deps(verifyResult: boolean, attempts = 1) {
  const users = { findByEmailWithHash: jest.fn().mockResolvedValue(user), findById: jest.fn() } as any;
  const tokens = { issuePair: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) } as any;
  const redis = { increment: jest.fn().mockResolvedValue(attempts), del: jest.fn() } as any;
  const config = { get: jest.fn(() => 5) } as any;
  jest.spyOn(require('argon2'), 'verify').mockResolvedValue(verifyResult);
  return { users, tokens, redis, config };
}

describe('AuthService.login', () => {
  it('returns tokens on valid credentials and clears attempt counter', async () => {
    const { users, tokens, redis, config } = deps(true);
    const svc = new AuthService(users, tokens, redis, config);
    const res = await svc.login({ email: 'a@b.c', password: 'x' }, {});
    expect(res.accessToken).toBe('a');
    expect(redis.del).toHaveBeenCalled();
  });
  it('throws InvalidCredentials on wrong password', async () => {
    const { users, tokens, redis, config } = deps(false);
    const svc = new AuthService(users, tokens, redis, config);
    await expect(svc.login({ email: 'a@b.c', password: 'x' }, {})).rejects.toBeInstanceOf(InvalidCredentialsException);
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement DTOs + AuthService**

```ts
// dto/login.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
export class LoginDto { @ApiProperty() @IsEmail() email!: string; @ApiProperty() @IsString() @MinLength(1) password!: string; }
// dto/refresh.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
export class RefreshDto { @ApiProperty() @IsString() refreshToken!: string; }
// dto/auth-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ type: UserResponseDto }) user!: UserResponseDto;
}
```
```ts
// services/auth.service.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { UsersService } from '../../users/services/users.service';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { TokenService } from './token.service';
import { RedisService } from '../../../redis/redis.service';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { InvalidCredentialsException } from '../../../common/exceptions/domain.exceptions';
import { UserStatus } from '@prisma/client';

interface Ctx { ip?: string; userAgent?: string; }
const LOCK_TTL = 900;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, ctx: Ctx): Promise<AuthResponseDto> {
    const key = `login:${dto.email}:${ctx.ip ?? 'unknown'}`;
    const attempts = await this.redis.increment(key, LOCK_TTL);
    if (attempts > this.config.get<number>('throttle.loginLockMax', 5)) {
      throw new ForbiddenException({ message: 'Too many failed attempts. Try again later.', errorCode: 'FORBIDDEN' });
    }
    const user = await this.users.findByEmailWithHash(dto.email);
    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) throw new InvalidCredentialsException();
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new InvalidCredentialsException();
    await this.redis.del(key);
    const pair = await this.tokens.issuePair(user as never, ctx);
    return { ...pair, user: plainToInstance(UserResponseDto, user, { excludeExtraneousValues: true }) };
  }

  async refresh(refreshToken: string, ctx: Ctx): Promise<Pick<AuthResponseDto, 'accessToken' | 'refreshToken'>> {
    const { accessToken, refreshToken: next } = await this.tokens.rotate(refreshToken, ctx);
    return { accessToken, refreshToken: next };
  }

  async logout(userId: string): Promise<void> { await this.tokens.revokeAllForUser(userId); }
  async me(userId: string): Promise<UserResponseDto> { return this.users.findById(userId); }
}
```
> Soft-deleted users: `login` rejects on `user.deletedAt` (Review Focus — soft-deleted user cannot authenticate).

- [ ] **Step 4: Run, verify pass** — `npm test -- auth.service` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(auth): auth service with brute-force lockout"`

---

## Task 12: Controllers — auth + users, wired with guards/Swagger

**Files:**
- Create: `src/modules/auth/controllers/auth.controller.ts`, `src/modules/auth/auth.module.ts`
- Create: `src/modules/users/controllers/users.controller.ts`; Modify `users.module.ts` to register controller
- Test: covered by E2E (Task 15); add controller unit test `src/modules/users/controllers/users.controller.spec.ts`

**Interfaces:**
- Consumes: `AuthService`, `UsersService`, guards/decorators from Task 9.
- Produces: REST endpoints under `/api/v1/auth/*` and `/api/v1/users/*`.

- [ ] **Step 1: Auth controller**

```ts
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser, AuthUser } from '../decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';

function ctxOf(req: Request) { return { ip: req.ip, userAgent: req.headers['user-agent'] }; }

@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('login') @HttpCode(200) @ResponseMessage('Logged in successfully')
  login(@Body() dto: LoginDto, @Req() req: Request) { return this.auth.login(dto, ctxOf(req)); }

  @Public() @Post('refresh') @HttpCode(200) @ResponseMessage('Token refreshed')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) { return this.auth.refresh(dto.refreshToken, ctxOf(req)); }

  @ApiBearerAuth() @Post('logout') @HttpCode(200) @ResponseMessage('Logged out')
  async logout(@CurrentUser() user: AuthUser) { await this.auth.logout(user.id); return null; }

  @ApiBearerAuth() @Get('me') @ResponseMessage('Current user')
  me(@CurrentUser() user: AuthUser) { return this.auth.me(user.id); }
}
```

- [ ] **Step 2: AuthModule**

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 3: Users controller** (thin; RBAC via decorators)

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN) @RequirePermissions('users.create')
  @Post() @ResponseMessage('User created')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser) { return this.users.create(dto, actor.id); }

  @RequirePermissions('users.read') @Get() @ResponseMessage('Users fetched successfully')
  list(@Query() query: UserQueryDto) { return this.users.list(query); }

  @RequirePermissions('users.read') @Get(':id') @ResponseMessage('User fetched successfully')
  findOne(@Param('id') id: string) { return this.users.findById(id); }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN) @RequirePermissions('users.update')
  @Patch(':id') @ResponseMessage('User updated')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) { return this.users.update(id, dto, actor.id); }

  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN) @RequirePermissions('users.delete')
  @Delete(':id') @HttpCode(200) @ResponseMessage('User deleted')
  async remove(@Param('id') id: string) { await this.users.softDelete(id); return null; }
}
```

- [ ] **Step 4: Register controller** in `users.module.ts` (`controllers: [UsersController]`).

- [ ] **Step 5: Controller unit test** (`users.controller.spec.ts`) — verify delegation:

```ts
import { UsersController } from './users.controller';
describe('UsersController', () => {
  it('delegates create to service with actor id', async () => {
    const svc: any = { create: jest.fn().mockResolvedValue({ id: 'u1' }) };
    const ctrl = new UsersController(svc);
    await ctrl.create({ email: 'a@b.c' } as any, { id: 'admin' } as any);
    expect(svc.create).toHaveBeenCalledWith({ email: 'a@b.c' }, 'admin');
  });
});
```

- [ ] **Step 6: Run, verify pass** — `npm test -- users.controller` → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(auth,users): REST controllers with RBAC and Swagger decorators"`

---

## Task 13: Health module

**Files:**
- Create: `src/modules/health/health.controller.ts`, `src/modules/health/redis.health.ts`, `src/modules/health/health.module.ts`
- Test: `src/modules/health/redis.health.spec.ts`

**Interfaces:**
- Consumes: `@nestjs/terminus`, `PrismaService`, `RedisService`.
- Produces: `GET /api/v1/health` and `GET /health` (both public) checking DB + Redis; `RedisHealthIndicator.isHealthy(key)`.

- [ ] **Step 1: Write failing test** (`redis.health.spec.ts`)

```ts
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  it('reports up when ping returns PONG', async () => {
    const redis: any = { ping: jest.fn().mockResolvedValue('PONG') };
    const indicator = new RedisHealthIndicator(redis);
    await expect(indicator.isHealthy('redis')).resolves.toEqual({ redis: { status: 'up' } });
  });
  it('throws when ping fails', async () => {
    const redis: any = { ping: jest.fn().mockRejectedValue(new Error('down')) };
    const indicator = new RedisHealthIndicator(redis);
    await expect(indicator.isHealthy('redis')).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify fail** — FAIL.

- [ ] **Step 3: Implement indicator + controller + module**

```ts
// redis.health.ts
import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service';
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) { super(); }
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try { const res = await this.redis.ping(); if (res !== 'PONG') throw new Error('bad ping'); return this.getStatus(key, true); }
    catch (e) { throw new HealthCheckError('Redis down', this.getStatus(key, false)); }
  }
}
```
```ts
// health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';
import { RedisHealthIndicator } from './redis.health';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthIndicator,
  ) {}
  @Public() @Get(['health', 'v1/health']) @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
```
> Note: `/health` is unversioned (LB probe) and `/v1/health` is the documented versioned path; both handled by the same controller. Health responses bypass the `ResponseInterceptor` by returning Terminus' native shape — acceptable; document in `docs/architecture.md`.

- [ ] **Step 4: HealthModule** — imports `TerminusModule`, declares `HealthController`, provides `RedisHealthIndicator`.

- [ ] **Step 5: Run, verify pass** — `npm test -- redis.health` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(health): terminus health check for db and redis"`

---

## Task 14: App wiring — bootstrap, global providers, Swagger, security, shutdown

**Files:**
- Modify: `src/app.module.ts`, `src/main.ts`
- Test: smoke covered in E2E (Task 15)

**Interfaces:**
- Consumes: everything above.
- Produces: fully wired app — global `ValidationPipe`, `APP_GUARD` (JwtAuthGuard + RolesGuard), `APP_INTERCEPTOR` (ResponseInterceptor), `APP_FILTER` (AllExceptionsFilter), throttler with Redis storage, helmet, CORS, versioning, Swagger at `/api/docs`, pino logger, graceful shutdown.

- [ ] **Step 1: AppModule**

```ts
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';
import { configLoaders } from './config';
import { validate } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: configLoaders, validate, envFilePath: ['.env.local', '.env'] }),
    LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: (c: ConfigService) => ({
      pinoHttp: {
        level: c.get('LOG_LEVEL') ?? 'info',
        genReqId: (req) => (req as { id?: string }).id,
        redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.refreshToken', '*.accessToken', '*.token'],
        transport: c.get('app.nodeEnv') === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }) }),
    ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory: (c: ConfigService) => ({
      throttlers: [{ ttl: c.get('throttle.ttl', 60000), limit: c.get('throttle.limit', 100) }],
      storage: new ThrottlerStorageRedisService(new Redis({ host: c.get('redis.host'), port: c.get('redis.port'), password: c.get('redis.password'), maxRetriesPerRequest: null })),
    }) }),
    PrismaModule, RedisModule, AuthModule, UsersModule, HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void { consumer.apply(RequestIdMiddleware).forRoutes('*'); }
}
```
> Guard order matters: Throttler → JwtAuth → Roles. `APP_GUARD` providers execute in registration order.

- [ ] **Step 2: main.ts**

```ts
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  app.use(helmet());
  app.enableCors({ origin: config.get<string[]>('app.corsOrigins'), credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder().setTitle('grub-media-backend API').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(config.get<number>('app.port') ?? 3000);
}
void bootstrap();
```
> `/health` unversioned: since `defaultVersion` is set, register the unversioned route via `VERSION_NEUTRAL` on the HealthController (`@Controller({ version: VERSION_NEUTRAL })`) — adjust Task 13 controller accordingly so `/api/health` and `/api/v1/health` both resolve.

- [ ] **Step 3: Build + boot smoke**

Run: `npm run build` then (with Postgres+Redis up via compose from Task 16) `npm run start:dev` and `curl localhost:3000/api/health`.
Expected: build clean; health returns `{ status: 'ok', ... }`.

- [ ] **Step 4: Commit** — `git commit -m "feat(app): wire global guards, interceptor, filter, swagger, security, shutdown"`

---

## Task 15: E2E tests (real Postgres + Redis)

**Files:**
- Create: `test/jest-e2e.json`, `test/setup-e2e.ts`, `test/auth.e2e-spec.ts`, `test/users.e2e-spec.ts`, `test/helpers.ts`, `docker-compose.test.yml`

**Interfaces:**
- Consumes: full app via `AppModule`.
- Produces: green E2E suite covering the Review Focus items end to end.

- [ ] **Step 1: Compose test infra + jest-e2e config**

`docker-compose.test.yml`: postgres:16 (port 5433, db `grub_test`) + redis:7 (port 6380).
`test/jest-e2e.json`:
```json
{ "moduleFileExtensions": ["js","json","ts"], "rootDir": ".", "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$", "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^@/(.*)$": "<rootDir>/../src/$1" }, "globalSetup": "<rootDir>/setup-e2e.ts" }
```
`test/setup-e2e.ts`: set `DATABASE_URL`/`REDIS_*` to test infra, run `prisma migrate deploy`.

- [ ] **Step 2: Helpers** (`test/helpers.ts`) — `createTestApp()` (builds Nest app with same global config as main.ts), `seedUser(role)`, `login(app, email, pw)` returning tokens.

- [ ] **Step 3: Auth E2E** (`test/auth.e2e-spec.ts`) — write these cases:

```ts
// pseudo-structure; each is a real it() using supertest(app.getHttpServer())
it('POST /api/v1/auth/login returns standardized success envelope with tokens');
it('rejects wrong password with 401 and error envelope (errorCode UNAUTHORIZED)');
it('GET /api/v1/auth/me without token returns 401 envelope');
it('GET /api/v1/auth/me with access token returns current user WITHOUT passwordHash');   // Review Focus
it('refresh rotates tokens; old refresh token then fails with 401 (reuse detection)');   // Review Focus
it('soft-deleted user cannot log in (401)');                                             // Review Focus
```
Each asserts body shape `{ success, message, data }` / `{ success:false, statusCode, errorCode, requestId }` and `expect(res.headers['x-request-id']).toBeDefined()`.

- [ ] **Step 4: Users E2E** (`test/users.e2e-spec.ts`):

```ts
it('EMPLOYEE cannot POST /api/v1/users (403 FORBIDDEN)');          // RBAC
it('ADMIN can create a user; response has no passwordHash');       // Review Focus
it('rejects unknown body field with 400 VALIDATION_ERROR');        // Review Focus
it('GET /api/v1/users?limit=999 caps/【rejects】 to validation (400 or capped)'); // Review Focus
it('GET /api/v1/users returns paginated envelope with meta.totalPages');
it('malicious X-Request-ID header is replaced by a generated uuid'); // Review Focus
```

- [ ] **Step 5: Run E2E**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
npm run test:e2e
docker compose -f docker-compose.test.yml down
```
Expected: all E2E pass.

- [ ] **Step 6: Commit** — `git commit -m "test(e2e): auth and users end-to-end with real postgres and redis"`

---

## Task 16: Docker (dev + prod) + seed

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `prisma/seed.ts`
- Modify: `.env.example` (add `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`)

**Interfaces:**
- Produces: multi-stage prod image (non-root), local `docker compose up` (app+postgres+redis), idempotent super-admin seed.

- [ ] **Step 1: Seed** (`prisma/seed.ts`)

```ts
import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
const prisma = new PrismaClient();
async function main(): Promise<void> {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD are required');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email }, update: {},
    create: { email, passwordHash, firstName: 'Super', lastName: 'Admin', role: UserRole.SUPER_ADMIN },
  });
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
```

- [ ] **Step 2: Dockerfile (multi-stage, non-root)**

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1001 appuser
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
```

- [ ] **Step 3: docker-compose.yml** — services: `app` (build ., env_file .env, depends_on postgres+redis healthy), `postgres:16` (volume, healthcheck `pg_isready`), `redis:7` (healthcheck `redis-cli ping`).

- [ ] **Step 4: Verify image builds + app boots + migrate + seed**

Run:
```bash
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run prisma:seed
curl localhost:3000/api/health
```
Expected: health ok, seed creates super-admin.

- [ ] **Step 5: Commit** — `git commit -m "feat(docker): multi-stage image, compose stack, super-admin seed"`

---

## Task 17: Documentation + ADRs + Postman

**Files:**
- Create: `README.md`, `docs/architecture.md`, `docs/authentication.md`, `docs/api-guidelines.md`, `docs/database.md`, `docs/development.md`, `docs/adr/001..006*.md`, `postman/collection.json`, `postman/environment.json`

**Interfaces:**
- Produces: complete onboarding + API contract docs.

- [ ] **Step 1: README** covering every topic from spec §22 (overview, architecture, folder structure, setup, env, DB/migrations, run, test, Swagger, Postman, auth, RBAC, logging, Docker, deploy, git conventions, coding standards). Include the quick-start command sequence.

- [ ] **Step 2: docs/** — architecture.md (module map, global providers, observability extension points, health interceptor-bypass note), authentication.md (token lifecycle, rotation, reuse-detection diagram, lockout), api-guidelines.md (REST naming, response/error envelopes, pagination, versioning), database.md (schema, soft-delete `client` usage rule, migrations, rotate-scan future optimization), development.md (local setup, branch strategy, conventional commits).

- [ ] **Step 3: ADRs** — 001-modular-monolith, 002-jwt-plus-db-refresh-rotation, 003-postgresql-prisma, 004-pino-logging, 005-rbac-permission-seam, 006-token-delivery-body-vs-cookie. Each: Context / Decision / Alternatives / Consequences.

- [ ] **Step 4: Postman** — `collection.json` with folders Authentication / Users / Health, `{{baseUrl}}` variables, and a login test script saving `{{accessToken}}`/`{{refreshToken}}`; collection-level Bearer auth using `{{accessToken}}`. `environment.json` with `baseUrl=http://localhost:3000/api/v1`, empty token vars.

- [ ] **Step 5: Commit** — `git commit -m "docs: README, architecture/auth/api/db docs, ADRs, Postman collection"`

---

## Task 18: CI + final verification

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI failing on tsc/lint/test; whole-suite green locally.

- [ ] **Step 1: CI workflow** — Node 22; services postgres:16 + redis:7; steps: `npm ci`, `npx prisma generate`, `npm run lint`, `npm run build`, `npm test`, `prisma migrate deploy` + `npm run test:e2e`.

- [ ] **Step 2: Full local verification**

Run:
```bash
npm run lint && npm run build && npm test
docker compose -f docker-compose.test.yml up -d && npm run test:e2e && docker compose -f docker-compose.test.yml down
```
Expected: lint clean, build clean, all unit + E2E green.

- [ ] **Step 3: Commit** — `git commit -m "ci: add github actions pipeline (lint, build, unit, e2e)"`

---

## Self-Review Notes

- **Spec coverage:** config(T2), logging/pino(T14), errors(T5), request-id(T6), versioning/response(T7,T14), security/throttle/lockout(T11,T14), swagger(T14), health(T13), prisma/schema/migrations/soft-delete(T3), transactions(rotate T10), auth all endpoints(T10–12), RBAC+permission seam(T9), users CRUD(T8,T12), pagination(T7), testing(T15), graceful shutdown(T14), docker(T16), docs/ADR/postman(T17), CI/git conventions(T18, Global Constraints). Audit log model created (T3); wiring audit writes is a follow-up (noted — not in foundation endpoints beyond the table).
- **Review Focus coverage:** reuse-detection (T10 unit + T15 e2e), passwordHash leak (T8 unit + T15 e2e), soft-deleted auth (T11 unit + T15 e2e), malicious request-id (T6 unit + T15 e2e), non-whitelist/limit cap (T15 e2e; ValidationPipe T14).
- **Known deferrals (documented, not gaps):** audit-write interceptor, cursor pagination, OpenTelemetry, cookie-based auth — all have extension points/ADRs.
