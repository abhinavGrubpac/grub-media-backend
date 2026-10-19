import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { BaseEventConsumer } from '../event.consumer';
import { EventTopics, EventTypes } from '../events.constants';
import { EventEnvelope } from '../events.types';

/**
 * Turns review/advert/brand events into in-app Notification rows.
 *
 * Targeting: this portal's RBAC is a role map (no Permission tables), so the
 * reference implementation's "users holding creative:approve" resolves to the
 * manager profile (ADMIN + SUPER_ADMIN). Brand liaisons are external agency
 * users and do not exist here, so review decisions notify managers.
 */
@Injectable()
export class NotificationProjectorConsumer extends BaseEventConsumer {
  protected readonly groupId = 'notification-projector';
  protected readonly topics = [EventTopics.REVIEW, EventTopics.ADVERT, EventTopics.BRAND];

  constructor(prisma: PrismaService, config: ConfigService) {
    super(prisma, config);
  }

  protected async handle(envelope: EventEnvelope): Promise<void> {
    const payload = envelope.payload as Record<string, unknown>;
    switch (envelope.eventType) {
      case EventTypes.reviewOnHold:
      case EventTypes.reviewRejected:
      case EventTypes.reviewNeedsChanges: {
        const title =
          envelope.eventType === EventTypes.reviewOnHold
            ? 'Creative put on hold'
            : envelope.eventType === EventTypes.reviewRejected
              ? 'Creative rejected'
              : 'Changes requested';
        const message =
          typeof payload.comments === 'string' && payload.comments.length > 0
            ? payload.comments
            : title;
        await this.notifyUsers(await this.managerIds(), title, message, envelope.eventType);
        return;
      }
      case EventTypes.advertRevoked:
      case EventTypes.advertAutoRevoked: {
        const message = typeof payload.reason === 'string' ? payload.reason : 'Compliance action';
        await this.notifyUsers(
          await this.managerIds(),
          'Advert revoked',
          message,
          envelope.eventType,
        );
        return;
      }
      case EventTypes.brandDeactivated: {
        const count =
          typeof payload.revoked_adverts_count === 'number' ? payload.revoked_adverts_count : 0;
        await this.notifyUsers(
          await this.managerIds(),
          'Brand kill-switch executed',
          `All advertising for this brand has been stopped (${count} advert(s) revoked).`,
          envelope.eventType,
        );
        return;
      }
      default:
        return;
    }
  }

  private async notifyUsers(
    userIds: string[],
    title: string,
    message: string,
    type: string,
  ): Promise<void> {
    await Promise.all(
      userIds.map((userId) =>
        this.prisma.client.notification.create({ data: { userId, title, message, type } }),
      ),
    );
  }

  /** Users whose role grants the manager profile (creative:approve holders). */
  private async managerIds(): Promise<string[]> {
    const users = await this.prisma.client.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    return [...new Set(users.map((user) => user.id))];
  }
}
