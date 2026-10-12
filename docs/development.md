# Development

## Local setup
See README "Getting started". TL;DR: `cp .env.example .env`, `npm ci`, `docker compose up -d postgres redis`, `npm run prisma:migrate`, `npm run prisma:seed`, `npm run start:dev`.

## Daily commands
```bash
npm run start:dev        # watch mode
npm run lint             # eslint (flat config)
npm run format           # prettier
npm test                 # unit
npm run test:e2e         # e2e (needs docker-compose.test.yml up)
npm run prisma:studio    # browse data
```

## Project layout rules
- Thin controllers: validate → call service → return. No business logic or DB calls in controllers.
- Business logic in services; data access via `PrismaService.client` (soft-delete aware).
- DTOs at the HTTP boundary; never return Prisma models. Response DTOs use `@Expose` allowlists.
- `@Global` infra modules (Prisma, Redis) are not re-imported in feature modules.
- No `any` without a documented reason; prefer explicit types and small, focused files.
- Don't create single-file folders without a reason; let them grow into folders.

## Testing approach
- Unit: services/guards/interceptors with Prisma/Redis mocked; deterministic. argon2 is mocked via `jest.mock('argon2')` (native exports aren't spy-able).
- E2E: Supertest against real throwaway Postgres+Redis (`docker-compose.test.yml`), covering auth flows, RBAC, validation, envelopes, reuse detection, soft delete.
- TDD: write the failing test, see it fail, implement, see it pass, commit.

## Git workflow
Branches: `main`, `develop`, `feature/*`, `fix/*`, `hotfix/*`, `refactor/*`, `chore/*`.
Conventional commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.
Example: `feat(users): add deactivation endpoint`.

## Adding a feature module
1. `src/modules/<feature>/` with `controllers/`, `services/`, `dto/`.
2. DTOs with `class-validator` + `@ApiProperty`.
3. Service uses `PrismaService.client`; map to a `*ResponseDto`.
4. RBAC via `@Roles` / `@RequirePermissions`; add new permissions to `ROLE_PERMISSIONS`.
5. Register the module in `AppModule`.
6. Unit tests for the service; e2e for the key flows.

## CI
GitHub Actions runs lint, build, unit tests, and e2e (with Postgres+Redis services). CI fails on tsc, lint, or test failure. See `.github/workflows/ci.yml`.

## Environment constraints seen during initial build
The foundation was built in an environment without a running Docker daemon/DB, so Docker image build and the e2e/boot paths were authored but executed by the developer afterward. All unit tests, type-check, and lint pass in-repo.
