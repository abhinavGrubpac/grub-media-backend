import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Message } from 'kafkajs';
import { PrismaService } from '../../database/prisma.service';
import { EventProducer } from './event.producer';
import { EVENT_HEADERS, EventEnvelope } from './events.types';

interface ClaimedRow {
  id: string;
  topic: string;
  key: string;
  payload: unknown;
}

/**
 * Relays committed outbox rows to Kafka (at-least-once). Polls on a fixed
 * interval, claims a batch with FOR UPDATE SKIP LOCKED so multiple instances
 * never double-claim, and parks rows after MAX_ATTEMPTS so poison cannot
 * block the queue. Never throws — all failures are logged.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly BATCH_SIZE = 100;
  private static readonly MAX_ATTEMPTS = 10;

  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: EventProducer,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), OutboxRelayService.POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const claimed = await this.prisma.client.$queryRaw<ClaimedRow[]>(Prisma.sql`
        UPDATE "OutboxEvent" SET "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "OutboxEvent"
          WHERE "sentAt" IS NULL AND "attempts" < ${OutboxRelayService.MAX_ATTEMPTS}
          ORDER BY "createdAt" ASC
          LIMIT ${OutboxRelayService.BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "topic", "key", "payload"
      `);
      if (claimed.length === 0) return;

      const ids = claimed.map((row) => row.id);
      const byTopic = new Map<string, Message[]>();
      for (const row of claimed) {
        const envelope = row.payload as unknown as EventEnvelope;
        const messages = byTopic.get(row.topic) ?? [];
        messages.push({
          key: row.key,
          value: JSON.stringify(envelope),
          headers: {
            [EVENT_HEADERS.eventId]: envelope.eventId,
            [EVENT_HEADERS.eventType]: envelope.eventType,
          },
        });
        byTopic.set(row.topic, messages);
      }

      try {
        await this.producer.publishBatch(
          [...byTopic].map(([topic, messages]) => ({ topic, messages })),
        );
        await this.prisma.client.outboxEvent.updateMany({
          where: { id: { in: ids } },
          data: { sentAt: new Date(), lastError: null, failedAt: null },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.client.outboxEvent.updateMany({
          where: { id: { in: ids } },
          data: { lastError: message, failedAt: new Date() },
        });
      }
    } catch (error) {
      this.logger.error(
        `Outbox drain failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
