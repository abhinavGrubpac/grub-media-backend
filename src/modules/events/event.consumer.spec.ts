import { BaseEventConsumer, MAX_MESSAGE_RETRIES } from './event.consumer';
import type { EventEnvelope } from './events.types';

const envelope: EventEnvelope = {
  eventId: 'e-1',
  eventType: 'review.approved',
  eventTime: '2026-10-07T00:00:00.000Z',
  entityType: 'CreativeVersion',
  entityId: 'v1',
  payload: {},
  schemaVersion: 1,
};

class TestConsumer extends BaseEventConsumer {
  protected readonly groupId = 'test-consumer';
  protected readonly topics = ['grubmedia.review.v1'];
  backoffBaseMs = 1;
  private failuresLeft: number;

  constructor(prisma: never, config: never, failures = 0) {
    super(prisma, config);
    this.failuresLeft = failures;
  }

  public handleCalls = 0;
  public poisoned: Array<{ envelope: EventEnvelope; error: unknown }> = [];

  protected async handle(): Promise<void> {
    this.handleCalls += 1;
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('handler exploded');
    }
  }

  protected async onPoisonMessage(envelope: EventEnvelope, error: unknown): Promise<void> {
    this.poisoned.push({ envelope, error });
  }
}

function makeDeps(failures = 0) {
  const findUnique = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockResolvedValue(undefined);
  const consumer = new TestConsumer(
    { client: { processedEvent: { findUnique, create } } } as never,
    { get: jest.fn() } as never,
    failures,
  );
  return { consumer, findUnique, create };
}

const message = (value: unknown) => ({
  topic: 'grubmedia.review.v1',
  message: { value: Buffer.from(JSON.stringify(value)) },
});

describe('BaseEventConsumer.processMessage', () => {
  it('handles a fresh event and records it as processed', async () => {
    const { consumer, create } = makeDeps();

    await consumer.processMessage(message(envelope));

    expect(consumer.handleCalls).toBe(1);
    expect(create).toHaveBeenCalledWith({
      data: { eventId: 'e-1', consumer: 'test-consumer', topic: 'grubmedia.review.v1' },
    });
    expect(consumer.poisoned).toHaveLength(0);
  });

  it('skips events already processed by this consumer (idempotency)', async () => {
    const { consumer, findUnique, create } = makeDeps();
    findUnique.mockResolvedValue({ eventId: 'e-1', consumer: 'test-consumer' });

    await consumer.processMessage(message(envelope));

    expect(consumer.handleCalls).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('skips malformed JSON without recording anything', async () => {
    const { consumer, create } = makeDeps();

    await consumer.processMessage({
      topic: 'grubmedia.review.v1',
      message: { value: Buffer.from('{nope') },
    });

    expect(consumer.handleCalls).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('skips empty messages', async () => {
    const { consumer, create } = makeDeps();

    await consumer.processMessage({ topic: 'grubmedia.review.v1', message: { value: null } });

    expect(consumer.handleCalls).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('retries up to the budget, then marks the DLQ and notifies the poison hook', async () => {
    const { consumer, create } = makeDeps(MAX_MESSAGE_RETRIES);

    await consumer.processMessage(message(envelope));

    expect(consumer.handleCalls).toBe(MAX_MESSAGE_RETRIES);
    expect(create).toHaveBeenCalledWith({
      data: { eventId: 'e-1', consumer: 'test-consumer', topic: 'grubmedia.review.v1->DLQ' },
    });
    expect(consumer.poisoned).toHaveLength(1);
    expect((consumer.poisoned[0].error as Error).message).toBe('handler exploded');
  });
});
