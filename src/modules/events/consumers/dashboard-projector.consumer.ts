import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { BaseEventConsumer } from '../event.consumer';
import { EventTopics, EventTypes } from '../events.constants';
import { EventEnvelope } from '../events.types';

/**
 * Maintains DashboardSnapshot counters from the event stream. Lifecycle events
 * carry from_status so the previous bucket can be decremented; historical
 * fallbacks keep pre-lifecycle events consistent (a version starts PENDING,
 * an advert starts SCHEDULED and goes through LIVE).
 */
@Injectable()
export class DashboardProjectorConsumer extends BaseEventConsumer {
  protected readonly groupId = 'dashboard-projector';
  protected readonly topics = [
    EventTopics.REVIEW,
    EventTopics.ADVERT,
    EventTopics.BRAND,
    EventTopics.AUTH,
    EventTopics.AGENCY,
  ];

  constructor(prisma: PrismaService, config: ConfigService) {
    super(prisma, config);
  }

  protected async handle(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as Record<string, unknown>;
    const fromStatus = typeof payload.from_status === 'string' ? payload.from_status : undefined;

    switch (envelope.eventType) {
      case EventTypes.creativeCreated:
        await this.bump('creatives_total', 1);
        await this.bump('status_PENDING', 1);
        return;
      case EventTypes.versionUploaded:
        // A new version re-enters the queue as PENDING.
        await this.bump('status_PENDING', 1);
        return;
      case EventTypes.reviewApproved:
      case EventTypes.reviewAutoApproved:
        await this.moveStatus(fromStatus ?? 'PENDING', 'APPROVED');
        await this.bump('actioned_total', 1);
        return;
      case EventTypes.reviewRejected:
        await this.moveStatus(fromStatus ?? 'PENDING', 'REJECTED');
        await this.bump('actioned_total', 1);
        return;
      case EventTypes.reviewOnHold:
        await this.moveStatus(fromStatus ?? 'PENDING', 'ON_HOLD');
        return;
      case EventTypes.reviewNeedsChanges:
        await this.moveStatus(fromStatus ?? 'PENDING', 'NEEDS_CHANGES');
        await this.bump('actioned_total', 1);
        return;
      case EventTypes.creativeWithdrawn:
        await this.moveStatus(fromStatus ?? 'PENDING', 'WITHDRAWN');
        return;
      case EventTypes.advertScheduled:
        if (payload.updated === true) return; // schedule mutation, no status change
        await this.bump('adverts_total', 1);
        await this.bump('status_SCHEDULED', 1);
        return;
      case EventTypes.advertLive:
        await this.moveAdvertStatus(fromStatus ?? 'SCHEDULED', 'LIVE');
        return;
      case EventTypes.advertPaused:
        await this.moveAdvertStatus(fromStatus ?? 'LIVE', 'PAUSED');
        return;
      case EventTypes.advertExpired:
        await this.moveAdvertStatus(fromStatus ?? 'LIVE', 'EXPIRED');
        return;
      case EventTypes.advertRevoked:
      case EventTypes.advertAutoRevoked:
        await this.moveAdvertStatus(fromStatus ?? 'LIVE', 'REVOKED');
        return;
      case EventTypes.brandCreated:
        await this.bump('brands_total', 1);
        return;
      case EventTypes.userCreated:
        await this.bump('users_total', 1);
        return;
      case EventTypes.agencyCreated:
        await this.bump('agencies_total', 1);
        return;
      case EventTypes.notificationCreated:
        await this.bump('notifications_total', 1);
        return;
      default:
        return;
    }
  }

  private async moveStatus(from: string, to: string): Promise<void> {
    await this.bump(`status_${from}`, -1);
    await this.bump(`status_${to}`, 1);
  }

  private async moveAdvertStatus(from: string, to: string): Promise<void> {
    await this.moveStatus(from, to);
  }

  private async bump(key: string, delta: number): Promise<void> {
    const current = await this.prisma.client.dashboardSnapshot.findUnique({ where: { key } });
    const count = this.readCount(current?.value) + delta;
    await this.prisma.client.dashboardSnapshot.upsert({
      where: { key },
      create: { key, value: { count } },
      update: { value: { count } },
    });
  }

  private readCount(value: Prisma.JsonValue | null | undefined): number {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as { count?: unknown }).count === 'number'
    ) {
      return (value as { count: number }).count;
    }
    return 0;
  }
}
