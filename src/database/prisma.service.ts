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

/**
 * PrismaService extends PrismaClient and exposes `client` — an extended client
 * that transparently filters out soft-deleted User rows for the default read
 * operations. ALWAYS use `prisma.client.*` (not `prisma.*`) for data access so
 * the soft-delete guard applies.
 *
 * Note: `findUnique` is intentionally NOT guarded (its `where` only accepts
 * unique fields). Application code reads soft-deletable users via `findFirst`.
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
        count({ args, query }) {
          args.where = applyNotDeleted(args.where);
          return query(args);
        },
      },
    },
  });

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
