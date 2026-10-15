import { ActivityLogService } from './activity-log.service';

function makeService() {
  const activityLog = { create: jest.fn().mockResolvedValue({ id: 'log1' }) };
  const prisma = { client: { activityLog } };
  return { service: new ActivityLogService(prisma as never), activityLog };
}

describe('ActivityLogService', () => {
  it('writes the audit row inside transactions', async () => {
    const { service, activityLog } = makeService();
    const tx = { activityLog };

    await service.recordInTx(tx as never, {
      actorId: 'manager1',
      action: 'review.approve',
      entityType: 'CreativeVersion',
      entityId: 'v1',
      metadata: { new_status: 'APPROVED' },
    });

    expect(activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'manager1',
          action: 'review.approve',
          entityType: 'CreativeVersion',
          entityId: 'v1',
        }),
      }),
    );
  });

  it('never breaks the caller when the write fails', async () => {
    const { service, activityLog } = makeService();
    activityLog.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.record({ action: 'advert.pause', entityType: 'Advert', entityId: 'a1' }),
    ).resolves.toBeUndefined();
  });
});
