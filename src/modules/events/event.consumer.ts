import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, Message } from 'kafkajs';
import { PrismaService } from '../../database/prisma.service';
import { EventEnvelope } from './events.types';

/** Retry budget before a message is treated as poison. */
export const MAX_MESSAGE_RETRIES = 5;

export interface IncomingMessage {
  topic: string;
  message: Pick<Message, 'value'>;
}

/**
 * Base class for Kafka consumers: at-least-once delivery with idempotency via
 * the ProcessedEvent table ((event_id, consumer) pair), a bounded retry loop
 * with linear backoff, and a DLQ marker after the budget is exhausted so the
 * partition never blocks. Broker unavailability at boot is logged, not fatal.
 */
@Injectable()
export abstract class BaseEventConsumer implements OnModuleInit, OnModuleDestroy {
  protected readonly logger = new Logger(BaseEventConsumer.name);
  private consumer?: Consumer;

  protected abstract readonly groupId: string;
  protected abstract readonly topics: readonly string[];

  /** Linear backoff base; overridden in tests to keep suites fast. */
  protected backoffBaseMs = 200;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const kafka = new Kafka({
        brokers: this.config.get<string[]>('kafka.brokers') ?? ['localhost:9092'],
        clientId: this.config.get<string>('kafka.clientId') ?? 'grub-media-backend',
        retry: { retries: 8, initialRetryTime: 300 },
      });
      this.consumer = kafka.consumer({
        groupId: this.groupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
      });
      await this.consumer.connect();
      await this.consumer.subscribe({ topics: [...this.topics], fromBeginning: false });
      await this.consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            await this.processMessage({ topic, message });
          } catch (error) {
            this.logger.error(
              `Consumer ${this.groupId} failed processing ${topic}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
      });
    } catch (error) {
      this.logger.error(
        `Consumer ${this.groupId} could not start (broker unavailable?): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }

  async processMessage(incoming: IncomingMessage): Promise<void> {
    const raw = incoming.message.value?.toString();
    if (!raw) {
      this.logger.warn(
        `Consumer ${this.groupId} received an empty message on ${incoming.topic}; skipping`,
      );
      return;
    }
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(raw) as EventEnvelope;
    } catch {
      this.logger.warn(
        `Consumer ${this.groupId} received malformed JSON on ${incoming.topic}; skipping`,
      );
      return;
    }

    const seen = await this.prisma.client.processedEvent.findUnique({
      where: { eventId_consumer: { eventId: envelope.eventId, consumer: this.groupId } },
    });
    if (seen) return;

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_MESSAGE_RETRIES; attempt++) {
      try {
        await this.handle(envelope);
        await this.prisma.client.processedEvent.create({
          data: { eventId: envelope.eventId, consumer: this.groupId, topic: incoming.topic },
        });
        return;
      } catch (error) {
        lastError = error;
        await this.sleep(this.backoffBaseMs * attempt);
      }
    }

    this.logger.error(
      `Consumer ${this.groupId} exhausted ${MAX_MESSAGE_RETRIES} retries for event ${envelope.eventId} (${envelope.eventType})`,
    );
    await this.prisma.client.processedEvent
      .create({
        data: {
          eventId: envelope.eventId,
          consumer: this.groupId,
          topic: `${incoming.topic}->DLQ`,
        },
      })
      .catch(() => undefined);
    await this.onPoisonMessage(envelope, lastError);
  }

  protected abstract handle(envelope: EventEnvelope): Promise<void>;

  protected async onPoisonMessage(envelope: EventEnvelope, error: unknown): Promise<void> {
    this.logger.error(
      `Consumer ${this.groupId} poisoned event ${envelope.eventId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
