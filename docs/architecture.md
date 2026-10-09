# Architecture

## Style: modular monolith
A single deployable with strict internal module boundaries. Feature modules own their controllers/services/DTOs; shared infrastructure lives in `common/`, `config/`, `database/`, `redis/`. This keeps the system simple to run and reason about now, while leaving clean seams to extract a service later if a module's scaling or ownership diverges.

## Request lifecycle
1. **RequestIdMiddleware** assigns/propagates a correlation id (`req.id`, `X-Request-ID`).
2. **Global guards** (in order): `ThrottlerGuard` → `JwtAuthGuard` (skipped for `@Public`) → `RolesGuard`.
3. **ValidationPipe** (whitelist + forbidNonWhitelisted + transform) validates/coerces DTOs.
4. Controller → service → PrismaService/RedisService.
5. **ResponseInterceptor** wraps the result in the success envelope (unless `@SkipResponseWrap`).
6. **AllExceptionsFilter** converts any thrown error into the standard error envelope.

## Global providers (AppModule)
- `APP_GUARD` ×3 (throttle, authenticate, authorize)
- `APP_INTERCEPTOR` ResponseInterceptor
- `APP_FILTER` AllExceptionsFilter
- `ConfigModule` (global, validated), `LoggerModule` (pino), `ThrottlerModule` (Redis storage or in-memory fallback)
- `@Global` `PrismaModule` and `RedisModule` — injected anywhere without re-import.

## Logging & correlation
pino via nestjs-pino. Each request carries a correlation id bound to every log line and returned as `X-Request-ID`. Secrets are redacted. `pino-http` runs before Nest middleware, so both `genReqId` and `RequestIdMiddleware` validate a client id and agree on a single value.

## Health
Terminus checks Postgres + Redis at `/api/health` (LB probe) and `/api/v1/health`. The route uses `@SkipResponseWrap` so monitoring tools receive native Terminus JSON on 200; on failure the status is 503 and detail is logged internally. Redis being optional, its indicator reports `up` with a note when Redis is not configured.

## Observability extension points
JSON logs are Loki/ELK-ready; the correlation id is the trace seam. OpenTelemetry/Prometheus can be added later without touching feature code (wrap bootstrap + add an interceptor/exporter). Nothing is installed prematurely.

## Error handling strategy
One global filter, one envelope. HttpExceptions carry a stable `errorCode`; Prisma known errors are mapped (`P2002`→409, `P2025`→404); everything else is a generic 500 with the detail logged, never leaked. `try/catch` is used only to transform/enrich/recover — not as boilerplate.

## Performance notes
`Promise.all` for independent reads; pagination everywhere lists can grow; intentional indexes only; refresh-token lookup is O(1) by session id. Background jobs/queues can be introduced later for expensive work.
