/**
 * Per-worker env for e2e tests. Runs (via jest-e2e setupFiles) before the app
 * is constructed, so ConfigModule validation sees valid values. Points at the
 * throwaway infra in docker-compose.test.yml.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT ?? '3001';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://grub:grub@localhost:5433/grub_test?schema=public';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6380';
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
