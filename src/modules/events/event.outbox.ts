import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EmitInput, EventEnvelope, topicForEvent } from './events.types';

/** Anything that can write outbox rows: a transaction client or the service itself. */
type OutboxWriter = Pick<Prisma.TransactionClient, 'outboxEvent'>;

@Injectable()
export class EventOutboxService {
  private readonly logger = new Logger(EventOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  buildEnvelope(input: EmitInput, eventId: string): EventEnvelope {
    return {
      eventId,
      eventType: input.eventType,
      eventTime: new Date().toISOString(),
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload ?? {},
      schemaVersion: 1,
    };
  }

  /**
   * Records the event inside the caller's transaction — the outbox row commits
   * atomically with the business write (transactional outbox pattern).
   */
  async emitInTx(tx: OutboxWriter, input: EmitInput): Promise<void> {
    const eventId = randomUUID();
    const envelope = this.buildEnvelope(input, eventId);
    await tx.outboxEvent.create({
      data: {
        id: eventId,
        topic: topicForEvent(input.eventType),
        key: input.key ?? input.entityId,
        payload: envelope as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Records an event outside any transaction (fire-and-forget paths such as
   * deploy-blocked reasons or upload intents). Never breaks the request path.
   */
  async emit(input: EmitInput): Promise<void> {
    try {
      await this.emitInTx(this.prisma, input);
    } catch (error) {
      this.logger.error(
        `Failed to record outbox event ${input.eventType} for ${input.entityType}/${input.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
