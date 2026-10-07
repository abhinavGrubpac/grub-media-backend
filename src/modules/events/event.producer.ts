import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Message, Producer, logLevel } from 'kafkajs';

export interface TopicMessages {
  topic: string;
  messages: Message[];
}

/**
 * kafkajs producer wrapper (idempotent, acks=all). A broker that is down at
 * boot never crashes the API: the failure is logged and reconnect happens
 * lazily on the next publish attempt.
 */
@Injectable()
export class EventProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventProducer.name);
  private readonly producer: Producer;
  private connected = false;

  constructor(config: ConfigService) {
    const saslUsername = config.get<string | undefined>('kafka.saslUsername');
    const sasl = saslUsername
      ? {
          mechanism: 'scram-sha-256' as const,
          username: saslUsername,
          password: config.get<string>('kafka.saslPassword') ?? '',
        }
      : undefined;
    const kafka = new Kafka({
      brokers: config.get<string[]>('kafka.brokers') ?? ['localhost:9092'],
      clientId: config.get<string>('kafka.clientId') ?? 'grub-media-backend',
      logLevel: logLevel.ERROR,
      retry: { retries: 8, initialRetryTime: 300 },
      ssl: sasl ? true : undefined,
      sasl,
    });
    this.producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: true });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      this.logger.error(
        `Kafka producer could not connect at boot; will retry on publish: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async publishBatch(topicMessages: TopicMessages[]): Promise<void> {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }
    await this.producer.sendBatch({ acks: -1, topicMessages });
  }

  async publish(
    topic: string,
    key: string,
    value: string,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this.publishBatch([{ topic, messages: [{ key, value, headers }] }]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }
}
