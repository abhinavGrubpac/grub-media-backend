import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Runs once before the e2e suite: applies the checked-in SQL migrations to the
 * throwaway test database. Requires docker-compose.test.yml to be up
 * (postgres:5433, redis:6380).
 *
 * Why not `prisma migrate deploy`? Prisma 8 (RC) dropped the classic migrate
 * commands and now requires a `prisma.config.ts` with an `orm` adapter section.
 * The migrations on disk are still plain SQL, so we replay them directly through
 * the client — same statements, one less moving part.
 */
const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

/**
 * Split a migration file into individual statements. Tracks single-quoted
 * string literals and `--` line comments so a `;` inside either is not
 * mistaken for a terminator.
 */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!inString && ch === '-' && next === '-') {
      // Line comment — copy through to the end of the line, unaltered.
      const eol = sql.indexOf('\n', i);
      const end = eol === -1 ? sql.length : eol + 1;
      current += sql.slice(i, end);
      i = end - 1;
      continue;
    }

    if (ch === "'") {
      inString = !inString;
      current += ch;
      continue;
    }

    if (!inString && ch === ';') {
      if (current.trim().length > 0) {
        statements.push(current.trim());
      }
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements;
}

/** True when the statement is nothing but comments/whitespace. */
function isOnlyComments(statement: string): boolean {
  return statement.split('\n').every((line) => {
    const trimmed = line.trim();
    return trimmed === '' || trimmed.startsWith('--');
  });
}

export default async function globalSetup(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://grub:grub@localhost:5433/grub_test?schema=public';

  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [],
  });

  try {
    // Throwaway test database — start from a clean slate so replaying the SQL
    // migrations is deterministic regardless of what a previous run left behind.
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS public');

    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const dir of dirs) {
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
      for (const statement of splitSql(sql)) {
        if (isOnlyComments(statement)) {
          continue;
        }
        await prisma.$executeRawUnsafe(statement);
      }
      console.log(`applied migration ${dir}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
