import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Merges a soft-delete guard (`deletedAt: null`) into a User `where` clause.
 * The caller's own `where` is spread last, so an explicit `deletedAt` filter
 * (e.g. to query deleted rows) overrides the default guard.
 */
export function applyNotDeleted(where: Prisma.UserWhereInput | undefined): Prisma.UserWhereInput {
  return { deletedAt: null, ...(where ?? {}) };
}

export function applyOrgNotDeleted(
  where: Prisma.OrganizationWhereInput | undefined,
): Prisma.OrganizationWhereInput {
  return { deletedAt: null, ...(where ?? {}) };
}

/**
 * PrismaService extends PrismaClient and exposes `client` — an extended client
 * that transparently filters out soft-deleted User rows for the default read
 * operations. ALWAYS use `prisma.client.*` (not `prisma.*`) for data access so
 * the soft-delete guard applies.
 *
 * Guarded (soft-delete filter applied): `findMany`, `findFirst`,
 * `findFirstOrThrow`, `count`.
 *
 * NOT guarded: `findUnique` and `findUniqueOrThrow` — their `where` accepts
 * only unique fields, so `deletedAt` cannot be injected. To read a user that
 * may be soft-deletable, use `findFirst`/`findFirstOrThrow` (never the
 * unique-by-id variants); those bypass the guard by design and will return
 * soft-deleted rows.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  readonly client = this.$extends({
    query: {
      user: {
        findMany({ args, query }) {
          args.where = applyNotDeleted(args.where);
          return query(args);
        },
        findFirst({ args, query }) {
          args.where = applyNotDeleted(args.where);
          return query(args);
        },
        findFirstOrThrow({ args, query }) {
          args.where = applyNotDeleted(args.where);
          return query(args);
        },
        count({ args, query }) {
          args.where = applyNotDeleted(args.where);
          return query(args);
        },
      },
      organization: {
        findMany({ args, query }) {
          args.where = applyOrgNotDeleted(args.where);
          return query(args);
        },
        findFirst({ args, query }) {
          args.where = applyOrgNotDeleted(args.where);
          return query(args);
        },
        findFirstOrThrow({ args, query }) {
          args.where = applyOrgNotDeleted(args.where);
          return query(args);
        },
        count({ args, query }) {
          args.where = applyOrgNotDeleted(args.where);
          return query(args);
        },
      },
    },
  });

  async onModuleInit(): Promise<void> {
    const connected = await this.connectWithRetry();
    this.logger.log(
      connected
        ? 'Prisma connected'
        : 'Prisma will connect lazily — database was unreachable at boot',
    );
  }

  /**
   * Eagerly connect, retrying through transient outages (a briefly unreachable
   * database server must not kill the boot — e.g. a cloud DB waking up or a
   * network blip). Bounded exponential backoff: 1s → 2s → 4s → 8s (5 attempts,
   * ~15s worst case). If it still fails, WARN and continue instead of
   * crashing: Prisma reconnects lazily on the next query anyway, and
   * GET /api/health reports 503 until the database is reachable again.
   *
   * @returns true when the eager $connect succeeded, false when we fell back
   * to lazy connection after exhausting the retries.
   */
  private async connectWithRetry(attempts = 5, baseDelayMs = 1000): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.$connect();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === attempts) {
          this.logger.warn(
            `Prisma $connect still failing after ${attempts} attempts (${message}). ` +
              'Continuing — the client will reconnect lazily on the next query.',
          );
          return false;
        }
        const delay = baseDelayMs * 2 ** (attempt - 1);
        this.logger.warn(
          `Prisma $connect failed (attempt ${attempt}/${attempts}): ${message} — retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
