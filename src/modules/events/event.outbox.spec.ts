import { EventOutboxService } from './event.outbox';
import { EventTypes } from './events.constants';

describe('EventOutboxService', () => {
  const service = new EventOutboxService({} as never);

  it('emitInTx writes an outbox row keyed by the aggregate entity', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { outboxEvent: { create } } as never;

    await service.emitInTx(tx, {
      eventType: EventTypes.versionUploaded,
      entityType: 'CreativeVersion',
      entityId: 'v1',
      payload: { version_number: 2 },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.topic).toBe('grubmedia.review.v1');
    expect(data.key).toBe('v1');
    expect(data.payload.eventType).toBe(EventTypes.versionUploaded);
    expect(data.payload.entityId).toBe('v1');
    expect(data.payload.schemaVersion).toBe(1);
    expect(data.payload.eventId).toEqual(expect.any(String));
    expect(data.payload.eventTime).toEqual(expect.any(String));
  });

  it('emitInTx honours an explicit partition key override', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { outboxEvent: { create } } as never;

    await service.emitInTx(tx, {
      eventType: EventTypes.advertAutoRevoked,
      entityType: 'Advert',
      entityId: 'a1',
      key: 'creative-1',
    });

    expect(create.mock.calls[0][0].data.key).toBe('creative-1');
    expect(create.mock.calls[0][0].data.topic).toBe('grubmedia.advert.v1');
  });

  it('emit never breaks the caller when the write fails', async () => {
    const failing = {
      client: {
        outboxEvent: {
          create: jest.fn().mockRejectedValue(new Error('db down')),
        },
      },
    };
    const tolerant = new EventOutboxService(failing as never);

    await expect(
      tolerant.emit({
        eventType: EventTypes.advertDeployBlocked,
        entityType: 'CreativeVersion',
        entityId: 'v1',
      }),
    ).resolves.toBeUndefined();
  });
});
