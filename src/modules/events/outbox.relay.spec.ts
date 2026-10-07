import { OutboxRelayService } from './outbox.relay';
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

function makeDeps() {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const publishBatch = jest.fn().mockResolvedValue(undefined);
  const relay = new OutboxRelayService(
    { client: { $queryRaw: queryRaw, outboxEvent: { updateMany } } } as never,
    { publishBatch } as never,
  );
  return { relay, queryRaw, updateMany, publishBatch };
}

describe('OutboxRelayService', () => {
  it('publishes claimed rows grouped by topic and marks them sent', async () => {
    const { relay, queryRaw, updateMany, publishBatch } = makeDeps();
    queryRaw.mockResolvedValue([
      { id: 'o1', topic: 'grubmedia.review.v1', key: 'c1', payload: envelope },
      { id: 'o2', topic: 'grubmedia.advert.v1', key: 'a1', payload: envelope },
      { id: 'o3', topic: 'grubmedia.review.v1', key: 'c2', payload: envelope },
    ]);

    await relay.drain();

    expect(publishBatch).toHaveBeenCalledTimes(1);
    const batches = publishBatch.mock.calls[0][0];
    expect(batches).toHaveLength(2);
    const reviewBatch = batches.find((b: { topic: string }) => b.topic === 'grubmedia.review.v1');
    expect(reviewBatch.messages).toHaveLength(2);
    expect(JSON.parse(reviewBatch.messages[0].value)).toMatchObject({ eventId: 'e-1' });
    expect(reviewBatch.messages[0].headers).toEqual({
      'x-event-id': 'e-1',
      'x-event-type': 'review.approved',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o1', 'o2', 'o3'] } },
      data: expect.objectContaining({ lastError: null, failedAt: null }),
    });
  });

  it('records the failure and keeps rows unsent when publishing fails', async () => {
    const { relay, queryRaw, updateMany, publishBatch } = makeDeps();
    queryRaw.mockResolvedValue([
      { id: 'o1', topic: 'grubmedia.review.v1', key: 'c1', payload: envelope },
    ]);
    publishBatch.mockRejectedValue(new Error('broker down'));

    await relay.drain();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o1'] } },
      data: expect.objectContaining({ lastError: 'broker down', failedAt: expect.any(Date) }),
    });
  });

  it('does nothing when no rows are pending', async () => {
    const { relay, publishBatch } = makeDeps();
    await relay.drain();
    expect(publishBatch).not.toHaveBeenCalled();
  });

  it('claims with FOR UPDATE SKIP LOCKED and a bounded attempt window', async () => {
    const { relay, queryRaw } = makeDeps();
    await relay.drain();

    const sql = queryRaw.mock.calls[0][0] as { text: string };
    expect(sql.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql.text).toContain('"sentAt" IS NULL');
    expect(sql.text).toContain('"attempts" < ');
  });

  it('never throws even when claiming fails', async () => {
    const { relay, queryRaw } = makeDeps();
    queryRaw.mockRejectedValue(new Error('db exploded'));
    await expect(relay.drain()).resolves.toBeUndefined();
  });
});
