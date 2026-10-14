import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type ActivityWriter = Pick<Prisma.TransactionClient, 'activityLog'>;

export interface ActivityRecord {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
  upstreamEventId?: string | null;
  upstreamPortal?: string | null;
}

/**
 * Government audit trail (WORKFLOWS.md §1.3). Complements the outbox:
 * outbox events drive projectors, ActivityLog rows answer "who did what to
 * which entity" for the audit surface. Writes are best-effort outside
 * transactions so auditing never breaks the operation it records.
 */
@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async recordInTx(tx: ActivityWriter, input: ActivityRecord): Promise<void> {
    await tx.activityLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        requestId: input.requestId ?? null,
        ip: input.ip ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        upstreamEventId: input.upstreamEventId ?? null,
        upstreamPortal: input.upstreamPortal ?? null,
      },
    });
  }

  async record(input: ActivityRecord): Promise<void> {
    try {
      await this.recordInTx(this.prisma, input);
    } catch {
      // Auditing must never break the operation it records.
    }
  }
}
