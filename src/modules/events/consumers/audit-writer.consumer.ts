import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { BaseEventConsumer } from '../event.consumer';
import { EventProducer } from '../event.producer';
import { EventTopics, EventTypes } from '../events.constants';
import { EventEnvelope } from '../events.types';

/**
 * Persists every event on the bus into the audit trail: activity events go to
 * the existing AuditLog table (this foundation's audit model), system errors
 * to SystemLog. Poison messages are additionally published to the DLQ topic.
 */
@Injectable()
export class AuditWriterConsumer extends BaseEventConsumer {
  protected readonly groupId = 'audit-writer';
  protected readonly topics = [
    EventTopics.REVIEW,
    EventTopics.ADVERT,
    EventTopics.BRAND,
    EventTopics.AUTH,
    EventTopics.REFERENCE,
    EventTopics.AGENCY,
    EventTopics.NOTIFICATION,
    EventTopics.AUDIT,
  ];

  constructor(
    prisma: PrismaService,
    config: ConfigService,
    private readonly producer: EventProducer,
  ) {
    super(prisma, config);
  }

  protected async handle(envelope: EventEnvelope): Promise<void> {
    if (envelope.eventType === EventTypes.systemError) {
      await this.prisma.client.systemLog.create({
        data: {
          level: typeof envelope.payload.level === 'string' ? envelope.payload.level : 'ERROR',
          module: envelope.entityType,
          message:
            typeof envelope.payload.message === 'string'
              ? envelope.payload.message
              : JSON.stringify(envelope.payload),
          stackTrace:
            typeof envelope.payload.stackTrace === 'string' ? envelope.payload.stackTrace : null,
        },
      });
      return;
    }

    const payload = envelope.payload as { oldValue?: unknown; newValue?: unknown };
    const metadata = (
      payload.oldValue !== undefined
        ? { oldValue: payload.oldValue, newValue: payload.newValue }
        : envelope.payload
    ) as Prisma.InputJsonValue;
    await this.prisma.client.auditLog.create({
      data: {
        actorId: envelope.actorId ?? null,
        action: envelope.eventType,
        resource: envelope.entityType,
        resourceId: envelope.entityId,
        metadata,
      },
    });
  }

  protected async onPoisonMessage(envelope: EventEnvelope, error: unknown): Promise<void> {
    await super.onPoisonMessage(envelope, error);
    try {
      await this.producer.publish(
        EventTopics.DLQ,
        envelope.entityId,
        JSON.stringify({
          source: envelope,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } catch (publishError) {
      this.logger.error(
        `Failed to publish event ${envelope.eventId} to the DLQ: ${
          publishError instanceof Error ? publishError.message : String(publishError)
        }`,
      );
    }
  }
}
