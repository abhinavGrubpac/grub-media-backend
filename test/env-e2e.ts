/**
 * Per-worker env for e2e tests. Runs (via jest-e2e setupFiles) before the app
 * is constructed, so ConfigModule validation sees valid values. Points at the
 * throwaway infra in docker-compose.test.yml.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT ?? '3001';
// SAFETY: force the throwaway test DB. Do NOT inherit process.env.DATABASE_URL
// — `@prisma/client` auto-loads `.env` (the real/dev DB) wherever it is
// imported, and the app under test must never point at that during e2e.
// TEST_DATABASE_URL is the explicit override for a custom throwaway DB.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://grub:grub@localhost:5433/grub_test?schema=public';
// SAFETY: force the throwaway test Redis, same reasoning as DATABASE_URL above.
// `globalSetup` imports `@prisma/client` in the main Jest process, which
// auto-loads `.env` (REDIS_PORT=6379 → the real Redis); workers inherit that
// polluted process.env, so `?? '6380'` would keep 6379 and the app under test
// would write login-lockouts / rate-limits into the real Redis. TEST_REDIS_*
// is the explicit override for a custom throwaway Redis.
process.env.REDIS_HOST = process.env.TEST_REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? '6380';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test_access_secret_at_least_32_chars_long_xx';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test_refresh_secret_at_least_32_chars_long_x';
process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';
process.env.JWT_REFRESH_TTL = process.env.JWT_REFRESH_TTL ?? '7d';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:3000';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.THROTTLE_LIMIT = process.env.THROTTLE_LIMIT ?? '1000';
process.env.THROTTLE_LOGIN_LOCK_MAX = process.env.THROTTLE_LOGIN_LOCK_MAX ?? '5';
