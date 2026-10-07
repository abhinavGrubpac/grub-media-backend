import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CreativeService } from './review.service';

const brandRow = {
  id: 'brand1',
  brandName: 'Acme',
  industryCategory: null,
  contactEmail: null,
  isActive: true,
  autoApprove: false,
  isFlagged: false,
  upstreamBrandId: null,
  upstreamAgencyId: null,
  createdAt: new Date('2026-10-07T00:00:00Z'),
  updatedAt: new Date('2026-10-07T00:00:00Z'),
};

const creativeRow = {
  id: 'c1',
  brandId: 'brand1',
  creativeName: 'Festive Ad',
  externalRefId: null,
  currentVersionId: null,
  upstreamCreativeId: null,
  upstreamAgencyId: null,
  campaignRef: null,
  createdAt: new Date('2026-10-07T00:00:00Z'),
};

const versionRow = {
  id: 'v1',
  creativeId: 'c1',
  versionNumber: 1,
  mediaUrl: 's3://bucket/agency/ag1/a.png',
  mediaType: 'Image',
  status: 'PENDING',
  createdBy: 'user1',
  upstreamVersionId: null,
  submittedAt: null,
  createdAt: new Date('2026-10-07T00:00:00Z'),
};

function makeDeps() {
  const creative = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  };
  const creativeVersion = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  };
  const reviewAction = { create: jest.fn().mockResolvedValue(undefined) };
  const brand = { findUnique: jest.fn().mockResolvedValue(null) };
  const agencyRef = { findUnique: jest.fn().mockResolvedValue(null) };
  const advert = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const user = { findMany: jest.fn().mockResolvedValue([]) };
  const client = { creative, creativeVersion, reviewAction, brand, agencyRef, advert, user };
  const prisma = {
    client,
    $transaction: jest.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  };
  const outbox = {
    emitInTx: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CreativeService(prisma as never, outbox as never);
  return {
    service,
    client,
    creative,
    creativeVersion,
    reviewAction,
    brand,
    agencyRef,
    advert,
    user,
    outbox,
  };
}

describe('CreativeService.uploadVersion', () => {
  const dto = { media_url: 's3://bucket/agency/ag1/b.png', media_type: 'Image' };

  it('increments the version number and emits version.uploaded keyed by the creative', async () => {
    const { service, creative, brand, creativeVersion, outbox } = makeDeps();
    creative.findUnique.mockResolvedValue({ ...creativeRow, brand: brandRow });
    brand.findUnique.mockResolvedValue(brandRow);
    creativeVersion.findFirst.mockResolvedValue(versionRow);
    creativeVersion.create.mockResolvedValue({ ...versionRow, id: 'v2', versionNumber: 2 });
    creative.update.mockResolvedValue({ ...creativeRow, currentVersionId: 'v2' });

    const result = await service.uploadVersion('c1', dto, 'user1');

    expect(result.replayed).toBe(false);
    expect(creativeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNumber: 2, status: 'PENDING' }),
      }),
    );
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'version.uploaded',
        key: 'c1',
        payload: expect.objectContaining({ version_number: 2, auto_approved: false }),
      }),
    );
  });

  it('conflicts when the latest version is already APPROVED', async () => {
    const { service, creative, creativeVersion } = makeDeps();
    creative.findUnique.mockResolvedValue({ ...creativeRow, brand: brandRow });
    creativeVersion.findFirst.mockResolvedValue({ ...versionRow, status: 'APPROVED' });

    await expect(service.uploadVersion('c1', dto, 'user1')).rejects.toThrow(ConflictException);
  });

  it('auto-approves instantly when brand.auto_approve is set', async () => {
    const { service, creative, creativeVersion, outbox } = makeDeps();
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      brand: { ...brandRow, autoApprove: true },
    });
    creativeVersion.findFirst.mockResolvedValue(null);
    creativeVersion.create.mockResolvedValue({ ...versionRow, status: 'APPROVED' });
    creative.update.mockResolvedValue(creativeRow);

    await service.uploadVersion('c1', dto, 'user1');

    expect(creativeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', versionNumber: 1 }),
      }),
    );
    const events = outbox.emitInTx.mock.calls.map(
      (call) => (call[1] as { eventType: string }).eventType,
    );
    expect(events).toEqual(['version.uploaded', 'review.auto_approved']);
  });

  it('returns the existing version untouched on an upstream replay', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({ ...versionRow, upstreamVersionId: 'uv1' });

    const result = await service.uploadVersion(
      'c1',
      { ...dto, upstream_version_id: 'uv1' },
      'svc:agency-portal',
    );

    expect(result.replayed).toBe(true);
    expect(creativeVersion.create).not.toHaveBeenCalled();
  });
});

describe('CreativeService.takeAction', () => {
  it('conflicts when expectedVersion does not match (optimistic locking)', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);

    await expect(
      service.takeAction('v1', { action: 'APPROVE', expectedVersion: 3 }, 'reviewer1'),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects REJECT without comments', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);

    await expect(service.takeAction('v1', { action: 'REJECT' }, 'reviewer1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an unknown version', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(null);

    await expect(service.takeAction('missing', { action: 'APPROVE' }, 'reviewer1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('records the decision, emits the review event and cascades advert revocations on REJECT', async () => {
    const { service, creativeVersion, reviewAction, advert, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'REJECTED' });
    advert.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    await service.takeAction('v1', { action: 'REJECT', comments: 'Misleading claim' }, 'reviewer1');

    expect(reviewAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'reviewer1', action: 'REJECT' }),
      }),
    );
    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] } },
      data: { status: 'REVOKED' },
    });
    const events = outbox.emitInTx.mock.calls.map(
      (call) => (call[1] as { eventType: string; payload?: Record<string, unknown> }).eventType,
    );
    expect(events).toEqual(['review.rejected', 'advert.auto_revoked', 'advert.auto_revoked']);
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'review.rejected',
        payload: expect.objectContaining({ from_status: 'PENDING', new_status: 'REJECTED' }),
      }),
    );
  });

  it('does not cascade adverts on APPROVE', async () => {
    const { service, creativeVersion, advert } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'APPROVED' });

    await service.takeAction('v1', { action: 'APPROVE' }, 'reviewer1');

    expect(advert.findMany).not.toHaveBeenCalled();
    expect(advert.updateMany).not.toHaveBeenCalled();
  });
});

describe('CreativeService.withdrawVersion', () => {
  it('conflicts when the version was already decided', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({ ...versionRow, status: 'APPROVED' });

    await expect(service.withdrawVersion('c1', { version_id: 'v1' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('withdraws an undecided version and emits creative.withdrawn with from_status', async () => {
    const { service, creativeVersion, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'WITHDRAWN' });

    const result = await service.withdrawVersion('c1', {
      version_id: 'v1',
      reason: 'Agency mistake',
    });

    expect(creativeVersion.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { status: 'WITHDRAWN' },
    });
    expect(result.version.status).toBe('WITHDRAWN');
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'creative.withdrawn',
        payload: expect.objectContaining({ from_status: 'PENDING', reason: 'Agency mistake' }),
      }),
    );
  });
});

describe('CreativeService.upsertThread', () => {
  const input = {
    upstream_creative_id: 'uc1',
    upstream_agency_id: 'ag1',
    upstream_brand_id: 'ub1',
    creative_name: 'Festive Ad',
  };

  it('rejects unknown upstream agencies', async () => {
    const { service, agencyRef } = makeDeps();
    agencyRef.findUnique.mockResolvedValue(null);

    await expect(service.upsertThread(input)).rejects.toThrow(NotFoundException);
  });

  it('creates the thread with upstream attribution', async () => {
    const { service, agencyRef, brand, creative, outbox } = makeDeps();
    agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
    brand.findUnique.mockResolvedValue(brandRow);
    creative.findUnique.mockResolvedValue(null);
    creative.create.mockResolvedValue({ ...creativeRow, upstreamCreativeId: 'uc1' });

    const result = await service.upsertThread(input);

    expect(result.created).toBe(true);
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'creative.created',
        payload: expect.objectContaining({ origin: 'upstream' }),
      }),
    );
  });

  it('returns the thread untouched on an idempotent replay', async () => {
    const { service, agencyRef, brand, creative, outbox } = makeDeps();
    agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
    brand.findUnique.mockResolvedValue({ ...brandRow, upstreamBrandId: 'ub1' });
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      upstreamCreativeId: 'uc1',
      upstreamAgencyId: 'ag1',
      campaignRef: null,
    });

    const result = await service.upsertThread(input);

    expect(result.created).toBe(false);
    expect(creative.update).not.toHaveBeenCalled();
    expect(outbox.emitInTx).not.toHaveBeenCalled();
  });
});

describe('CreativeService.getHistory', () => {
  it('resolves actor display names in a single batch', async () => {
    const { service, creative, user } = makeDeps();
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      brand: brandRow,
      versions: [
        {
          ...versionRow,
          actions: [
            {
              id: 'ra1',
              versionId: 'v1',
              actorId: 'user1',
              action: 'REJECT',
              comments: 'x',
              createdAt: new Date('2026-10-07T01:00:00Z'),
            },
          ],
        },
      ],
    });
    user.findMany.mockResolvedValue([{ id: 'user1', firstName: 'Riya', lastName: 'Sharma' }]);

    const history = await service.getHistory('c1');

    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['user1'] } } }),
    );
    expect(history.versions[0].actions?.[0]).toMatchObject({ actor_name: 'Riya Sharma' });
  });

  it('throws NotFound for an unknown creative', async () => {
    const { service, creative } = makeDeps();
    creative.findUnique.mockResolvedValue(null);

    await expect(service.getHistory('missing')).rejects.toThrow(NotFoundException);
  });
});
