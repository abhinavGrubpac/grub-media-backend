import { execFileSync } from 'child_process';

/**
 * Runs once before the e2e suite: applies migrations to the throwaway test
 * database. Requires docker-compose.test.yml to be up (postgres:5433, redis:6380).
 */
export default function globalSetup(): void {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://grub:grub@localhost:5433/grub_test?schema=public';
  // Static args, no shell — no injection surface.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
