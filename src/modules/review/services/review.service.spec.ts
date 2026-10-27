import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma, ReviewStatus } from '@prisma/client';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { CreativeService } from './review.service';
import { ReviewController } from '../controllers/review.controller';
import { normalizeCreativeStatusFilter, CREATIVE_STATUS_FILTERS } from '../transitions';

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
    findUniqueOrThrow: jest.fn().mockResolvedValue({ ...versionRow, actions: [] }),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  };
  const reviewAction = {
    create: jest.fn().mockResolvedValue(undefined),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const brand = { findUnique: jest.fn().mockResolvedValue(null) };
  const agencyRef = {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const advert = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const user = { findMany: jest.fn().mockResolvedValue([]) };
  const activityLog = { create: jest.fn().mockResolvedValue({ id: 'log1' }) };
  const queryRaw = jest.fn().mockResolvedValue([]);
  const client = {
    creative,
    creativeVersion,
    reviewAction,
    brand,
    agencyRef,
    advert,
    user,
    activityLog,
    $queryRaw: queryRaw,
  };
  const prisma = {
    client,
    $transaction: jest.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  };
  const outbox = {
    emitInTx: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const adverts = {
    scheduleVersion: jest.fn().mockResolvedValue({ id: 'a1', status: 'SCHEDULED' }),
  };
  const storage = {
    buildKey: jest.fn().mockImplementation((prefix: string) => `${prefix}/1-a.png`),
    presignedUploadUrl: jest.fn().mockResolvedValue('https://mock-storage.local/uploads/x?mock=1'),
    assertFileUrlAllowed: jest.fn(),
    resolveCreativeFileUrl: jest.fn((s: string) => s),
    isConfigured: true,
    extractKeyFromUrl: jest.fn((s: string) => s.replace(/^https?:\/\/[^/]+\//, '')),
    getObjectSize: jest.fn().mockResolvedValue(1024),
  };
  const service = new CreativeService(
    prisma as never,
    outbox as never,
    new ActivityLogService(prisma as never),
    storage as never,
    adverts as never,
  );
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
    storage,
    adverts,
  };
}

describe('normalizeCreativeStatusFilter', () => {
  it('maps UI aliases to DB statuses and ALL to no filter', () => {
    expect(normalizeCreativeStatusFilter('PENDING')).toBe(ReviewStatus.PENDING);
    expect(normalizeCreativeStatusFilter('APPROVED')).toBe(ReviewStatus.APPROVED);
    expect(normalizeCreativeStatusFilter('AUTO_APPROVED')).toBe(ReviewStatus.APPROVED);
    expect(normalizeCreativeStatusFilter('NEED_CHANGES')).toBe(ReviewStatus.NEEDS_CHANGES);
    expect(normalizeCreativeStatusFilter('NEEDS_CHANGES')).toBe(ReviewStatus.NEEDS_CHANGES);
    expect(normalizeCreativeStatusFilter('REJECT')).toBe(ReviewStatus.REJECTED);
    expect(normalizeCreativeStatusFilter('REJECTED')).toBe(ReviewStatus.REJECTED);
    expect(normalizeCreativeStatusFilter('ON_HOLD')).toBe(ReviewStatus.ON_HOLD);
    expect(normalizeCreativeStatusFilter('WITHDRAWN')).toBe(ReviewStatus.WITHDRAWN);
    expect(normalizeCreativeStatusFilter('ALL')).toBeUndefined();
    expect(normalizeCreativeStatusFilter(undefined)).toBeUndefined();
    expect(CREATIVE_STATUS_FILTERS).toContain('ALL');
  });

  it('rejects unknown statuses', () => {
    expect(() => normalizeCreativeStatusFilter('BOGUS')).toThrow(BadRequestException);
  });
});

describe('CreativeService.findAll', () => {
  const pageQuery = { page: 1, limit: 20 } as { page: number; limit: number };

  it('filters by normalized status', async () => {
    const { service, creative } = makeDeps();
    creative.findMany.mockResolvedValue([]);
    await service.findAll({ ...pageQuery, status: 'REJECT' } as never);
    expect(creative.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          versions: { some: { status: 'REJECTED' } },
        }),
      }),
    );
  });

  it('omits the status clause for ALL', async () => {
    const { service, creative } = makeDeps();
    creative.findMany.mockResolvedValue([]);
    await service.findAll({ ...pageQuery, status: 'ALL' } as never);
    expect(creative.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('enriches list rows with brand logo and agency name/location', async () => {
    const { service, creative, agencyRef } = makeDeps();
    creative.findMany.mockResolvedValue([
      {
        ...creativeRow,
        brand: {
          ...brandRow,
          logoUrl: 'https://cdn.example.com/brand1.png',
          upstreamAgencyId: 'ag1',
        },
        createdAt: new Date('2026-01-01'),
        versions: [],
      },
    ]);
    agencyRef.findMany.mockResolvedValue([
      {
        upstreamAgencyId: 'ag1',
        agencyName: 'Test Agency',
        city: 'Bengaluru',
        address: '12 MG Road',
      },
    ]);
    const result = await service.findAll({ ...pageQuery } as never);
    expect(agencyRef.findMany).toHaveBeenCalledWith({
      where: { upstreamAgencyId: { in: ['ag1'] } },
    });
    expect(result.items[0].brand.logo_url).toBe('https://cdn.example.com/brand1.png');
    expect(result.items[0].agency).toMatchObject({
      upstream_agency_id: 'ag1',
      agency_name: 'Test Agency',
      city: 'Bengaluru',
      address: '12 MG Road',
    });
  });

  it('embeds approval threads with include=history in one batched query', async () => {
    const { service, creative, creativeVersion } = makeDeps();
    creative.findMany.mockResolvedValue([
      {
        ...creativeRow,
        brand: brandRow,
        versions: [{ ...versionRow, actions: [] }],
      },
    ]);
    creativeVersion.findMany.mockResolvedValue([{ ...versionRow, actions: [] }]);
    const result = await service.findAll({ ...pageQuery, include: 'history' } as never);
    expect(creativeVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creativeId: { in: ['c1'] } } }),
    );
    expect(result.items[0].versions).toHaveLength(1);
  });

  it('skips the thread query without include=history', async () => {
    const { service, creative, creativeVersion } = makeDeps();
    creative.findMany.mockResolvedValue([]);
    await service.findAll(pageQuery as never);
    expect(creativeVersion.findMany).not.toHaveBeenCalled();
    expect(creativeVersion.findFirst).not.toHaveBeenCalled();
  });

  it('filters by industry, upload window, actor, and ids', async () => {
    const { service, creative } = makeDeps();
    creative.findMany.mockResolvedValue([]);
    await service.findAll({
      ...pageQuery,
      industry: 'Beverages',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      actor_id: 'user9',
      ids: ['c1', 'c2'],
    } as never);
    const where = creative.findMany.mock.calls[0][0].where;
    expect(where.brand).toEqual({
      is: { industryCategory: { equals: 'Beverages', mode: 'insensitive' } },
    });
    expect(where.versions.some.createdAt.gte).toBeInstanceOf(Date);
    expect(where.versions.some.createdAt.lte).toBeInstanceOf(Date);
    expect(where.versions.some.actions).toEqual({ some: { actorId: 'user9' } });
    expect(where.id).toEqual({ in: ['c1', 'c2'] });
  });

  it('sorts by brand in the database and by upload recency in memory', async () => {
    const { service, creative } = makeDeps();
    creative.findMany.mockResolvedValue([]);
    await service.findAll({ ...pageQuery, sortBy: 'brand_name', sortOrder: 'asc' } as never);
    expect(creative.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { brand: { brandName: 'asc' } } }),
    );

    creative.findMany.mockResolvedValue([
      { ...creativeRow, brand: brandRow, createdAt: new Date('2026-01-01'), versions: [] },
      {
        ...creativeRow,
        id: 'c2',
        brand: brandRow,
        createdAt: new Date('2026-01-02'),
        versions: [{ ...versionRow, createdAt: new Date('2026-06-01'), actions: [] }],
      },
    ]);
    const result = await service.findAll({
      ...pageQuery,
      sortBy: 'uploaded_on',
      sortOrder: 'desc',
    } as never);
    expect(result.items.map((row) => row.id)).toEqual(['c2', 'c1']);
    expect(result.meta.totalItems).toBe(2);
  });
});

describe('CreativeService.createCreative', () => {
  it('rejects unknown brands', async () => {
    const { service, brand } = makeDeps();
    brand.findUnique.mockResolvedValue(null);
    await expect(
      service.createCreative({ brand_id: 'missing', creative_name: 'X' }, 'u1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('creates the thread alone without initial_version', async () => {
    const { service, brand, creative, creativeVersion } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);
    creative.create.mockResolvedValue({ ...creativeRow });
    const result = await service.createCreative(
      { brand_id: 'brand1', creative_name: 'Festive Ad' },
      'u1',
    );
    expect(creativeVersion.create).not.toHaveBeenCalled();
    expect(result.latest_version).toBeNull();
  });

  it('creates thread + v1 atomically with initial_version', async () => {
    const { service, brand, creative, creativeVersion } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);
    creative.create.mockResolvedValue({ ...creativeRow });
    creativeVersion.create.mockResolvedValue({ ...versionRow, versionNumber: 1 });
    creative.update.mockResolvedValue(creativeRow);
    const result = await service.createCreative(
      {
        brand_id: 'brand1',
        creative_name: 'Festive Ad',
        initial_version: { media_url: 's3://b/a.png', media_type: 'Image' },
      },
      'u1',
    );
    expect(creativeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNumber: 1, status: 'PENDING', createdBy: 'u1' }),
      }),
    );
    expect(result.latest_version?.version_number).toBe(1);
  });

  it('books the schedule in the same call when provided', async () => {
    const { service, brand, creative, creativeVersion, adverts } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);
    creative.create.mockResolvedValue({ ...creativeRow });
    creativeVersion.create.mockResolvedValue({ ...versionRow, versionNumber: 1 });
    creative.update.mockResolvedValue(creativeRow);
    adverts.scheduleVersion.mockResolvedValue({
      id: 'a1',
      status: 'SCHEDULED',
      start_date: new Date('2026-11-01T00:00:00Z'),
      end_date: new Date('2026-11-30T00:00:00Z'),
      address_text: 'MG Road',
      city_name: null,
      zone_name: null,
      radius_km: 2.5,
      location: null,
    });

    const result = await service.createCreative(
      {
        brand_id: 'brand1',
        creative_name: 'Festive Ad',
        initial_version: { media_url: 's3://b/a.png', media_type: 'Image' },
        schedule: {
          lat: 12.9716,
          lng: 77.5946,
          start_date: new Date('2026-11-01T00:00:00Z'),
          end_date: new Date('2026-11-30T00:00:00Z'),
          radius: 2.5,
        },
      },
      'u1',
    );

    expect(adverts.scheduleVersion).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 12.9716, radius: 2.5 }),
      'u1',
    );
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules?.[0]).toMatchObject({ advert_id: 'a1', radius_km: 2.5 });
  });

  it('rejects a schedule without initial_version', async () => {
    const { service, brand, adverts } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);

    await expect(
      service.createCreative(
        {
          brand_id: 'brand1',
          creative_name: 'X',
          schedule: {
            lat: 12.9716,
            lng: 77.5946,
            start_date: new Date('2026-11-01T00:00:00Z'),
            end_date: new Date('2026-11-30T00:00:00Z'),
          },
        },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(adverts.scheduleVersion).not.toHaveBeenCalled();
  });

  it('blocks creation for a deactivated brand (kill-switch preventative)', async () => {
    const { service, brand, creative } = makeDeps();
    brand.findUnique.mockResolvedValue({ ...brandRow, isActive: false });

    await expect(
      service.createCreative({ brand_id: 'brand1', creative_name: 'X' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
    expect(creative.create).not.toHaveBeenCalled();
  });

  it('translates a brand FK race into 404 instead of 500', async () => {
    const { service, brand, creative } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);
    creative.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', {
        code: 'P2003',
        clientVersion: '6.19.3',
      }),
    );

    await expect(
      service.createCreative({ brand_id: 'brand1', creative_name: 'X' }, 'u1'),
    ).rejects.toThrow(NotFoundException);
  });
});

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

  it('blocks uploads for a deactivated brand (kill-switch preventative)', async () => {
    const { service, creative, creativeVersion } = makeDeps();
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      brand: { ...brandRow, isActive: false },
    });

    await expect(service.uploadVersion('c1', dto, 'user1')).rejects.toThrow(BadRequestException);
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

  it('rejects REJECT without a reason', async () => {
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

    await service.takeAction(
      'v1',
      { action: 'REJECT', comments: 'Misleading claim', reason: 'NON_COMPLIANT' },
      'reviewer1',
    );

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

  it('includes the recorded action in the response trail', async () => {
    const { service, creativeVersion, user } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);
    creativeVersion.findUniqueOrThrow.mockResolvedValue({
      ...versionRow,
      status: 'APPROVED',
      actions: [
        {
          id: 'ra1',
          versionId: 'v1',
          actorId: 'reviewer1',
          action: 'APPROVE',
          comments: 'Compliant',
          createdAt: new Date('2026-10-19T06:00:00Z'),
        },
      ],
    });
    user.findMany.mockResolvedValue([
      {
        id: 'reviewer1',
        firstName: 'Rita',
        lastName: 'Reviewer',
        avatarUrl: 'https://cdn.example.com/rita.png',
      },
      {
        id: 'user1',
        firstName: 'Uma',
        lastName: 'Uploader',
        avatarUrl: 'https://cdn.example.com/uma.png',
      },
    ]);

    const result = await service.takeAction(
      'v1',
      { action: 'APPROVE', comments: 'Compliant' },
      'reviewer1',
    );

    expect(creativeVersion.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'v1' },
      include: { actions: { orderBy: { createdAt: 'asc' } } },
    });
    expect(result.latest_action).toMatchObject({
      action: 'APPROVE',
      actor_name: 'Rita Reviewer',
      logo: 'https://cdn.example.com/rita.png',
    });
    expect(result.created_by_name).toBe('Uma Uploader');
    expect(result.created_by_logo).toBe('https://cdn.example.com/uma.png');
    expect(result.actions).toHaveLength(1);
    expect(result.actions?.[0]).toMatchObject({
      action: 'APPROVE',
      comments: 'Compliant',
      logo: 'https://cdn.example.com/rita.png',
    });
  });

  it('writes the audit-trail row for every decision', async () => {
    const { service, creativeVersion, client } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'APPROVED' });

    await service.takeAction('v1', { action: 'APPROVE' }, 'reviewer1');

    expect(client.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'reviewer1',
          action: 'review.approve',
          entityType: 'CreativeVersion',
          entityId: 'v1',
        }),
      }),
    );
  });

  it('conflicts when the version is already decided (one-way gate)', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({ ...versionRow, status: 'APPROVED' });

    await expect(
      service.takeAction(
        'v1',
        { action: 'REJECT', comments: 'late', reason: 'NON_COMPLIANT' },
        'reviewer1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects direct decisions on ON_HOLD versions (resume first)', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({ ...versionRow, status: 'ON_HOLD' });

    await expect(service.takeAction('v1', { action: 'APPROVE' }, 'reviewer1')).rejects.toThrow(
      ConflictException,
    );
    expect(creativeVersion.update).not.toHaveBeenCalled();
  });

  it('resumes ON_HOLD back to PENDING via RESUME', async () => {
    const { service, creativeVersion, reviewAction, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({ ...versionRow, status: 'ON_HOLD' });
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'PENDING' });

    await service.takeAction('v1', { action: 'RESUME' }, 'reviewer1');

    expect(creativeVersion.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { status: 'PENDING' },
    });
    expect(reviewAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'reviewer1', action: 'RESUME' }),
      }),
    );
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'review.resumed',
        payload: expect.objectContaining({ from_status: 'ON_HOLD', new_status: 'PENDING' }),
      }),
    );
  });

  it('rejects RESUME on non-ON_HOLD versions', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(versionRow);

    await expect(service.takeAction('v1', { action: 'RESUME' }, 'reviewer1')).rejects.toThrow(
      ConflictException,
    );
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

  it('blocks threads for a deactivated brand (kill-switch preventative)', async () => {
    const { service, agencyRef, brand } = makeDeps();
    agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
    brand.findUnique.mockResolvedValue({ ...brandRow, isActive: false });

    await expect(service.upsertThread(input)).rejects.toThrow(BadRequestException);
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

describe('CreativeService.getCreative', () => {
  it('returns the full detail view and records the view', async () => {
    const { service, creative, agencyRef, user } = makeDeps();
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      brand: { ...brandRow, flaggedBy: 'manager1', flaggedOn: new Date('2026-10-10T00:00:00Z') },
      upstreamAgencyId: 'ag1',
      versions: [
        {
          ...versionRow,
          actions: [],
          adverts: [
            {
              id: 'a1',
              versionId: 'v1',
              addressText: 'MG Road',
              status: 'SCHEDULED',
              startDate: new Date('2026-11-01T00:00:00Z'),
              endDate: new Date('2026-11-30T00:00:00Z'),
              cityName: 'Bengaluru',
              zoneName: 'Central',
              radiusKm: 2.5,
            },
          ],
        },
      ],
    });
    agencyRef.findUnique.mockResolvedValue({
      upstreamAgencyId: 'ag1',
      agencyName: 'Test Agency',
      city: 'Bengaluru',
      address: 'MG Road',
    });
    user.findMany.mockResolvedValue([
      { id: 'manager1', firstName: 'Riya', lastName: 'Sharma' },
      { id: 'viewer1', firstName: 'Aarav', lastName: 'Mehta' },
    ]);

    const result = await service.getCreative('c1', 'viewer1');

    expect(creative.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
    expect(result.id).toBe('c1');
    expect(result.latest_version?.id).toBe('v1');
    expect(result.versions).toHaveLength(1);
    expect(result.agency).toMatchObject({ agency_name: 'Test Agency', city: 'Bengaluru' });
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules?.[0]).toMatchObject({ advert_id: 'a1', radius_km: 2.5 });
    expect(result.brand.flagged_by).toBe('Riya Sharma');
    expect(result.last_viewed_by).toBe('Aarav Mehta');
    expect(result.viewed_minutes_ago).toBe(0);
    expect(creative.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ lastViewedBy: 'viewer1' }),
      }),
    );
  });

  it('summarizes targeted regions across all versions, deduped and sorted', async () => {
    const { service, creative, user } = makeDeps();
    const advert = (id: string, city: string | null) => ({
      id,
      versionId: 'v1',
      addressText: `${city ?? 'Unknown'} site`,
      status: 'SCHEDULED',
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-11-30T00:00:00Z'),
      cityName: city,
      zoneName: null,
      radiusKm: null,
    });
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      brand: brandRow,
      upstreamAgencyId: null,
      versions: [
        {
          ...versionRow,
          id: 'v1',
          actions: [],
          adverts: [advert('a1', 'Mumbai'), advert('a2', 'Bengaluru'), advert('a3', 'Mumbai')],
        },
        {
          ...versionRow,
          id: 'v2',
          actions: [],
          adverts: [advert('a4', null), advert('a5', 'Delhi')],
        },
      ],
    });
    user.findMany.mockResolvedValue([]);

    const result = await service.getCreative('c1', 'viewer1');

    expect(result.targeted_regions).toEqual(['Bengaluru', 'Delhi', 'Mumbai']);
  });

  it('reports no targeted regions before any deployment', async () => {
    const { service, creative, user } = makeDeps();
    creative.findUnique.mockResolvedValue({
      ...creativeRow,
      brand: brandRow,
      upstreamAgencyId: null,
      versions: [{ ...versionRow, actions: [], adverts: [] }],
    });
    user.findMany.mockResolvedValue([]);

    const result = await service.getCreative('c1', 'viewer1');

    expect(result.targeted_regions).toEqual([]);
    expect(result.schedules).toEqual([]);
  });

  it('throws NotFound for an unknown creative', async () => {
    const { service, creative } = makeDeps();
    creative.findUnique.mockResolvedValue(null);

    await expect(service.getCreative('missing', 'viewer1')).rejects.toThrow(NotFoundException);
  });
});

describe('CreativeService.requestUploadUrl', () => {
  it('issues a bucket key + upload URL for a live brand', async () => {
    const { service, brand } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);

    const result = await service.requestUploadUrl(
      { brand_id: 'brand1', name: 'Diwali Film', media_type: 'Image' },
      'u1',
    );

    expect(result.s3_key).toContain('creatives/');
    expect(result.upload_url).toContain('mock-storage.local');
    expect(result.file_url).toBe(result.s3_key);
  });

  it('rejects unknown brands and killed brands', async () => {
    const { service, brand } = makeDeps();
    brand.findUnique.mockResolvedValue(null);
    await expect(
      service.requestUploadUrl({ brand_id: 'missing', name: 'X', media_type: 'Image' }, 'u1'),
    ).rejects.toThrow(NotFoundException);

    brand.findUnique.mockResolvedValue({ ...brandRow, isActive: false });
    await expect(
      service.requestUploadUrl({ brand_id: 'brand1', name: 'X', media_type: 'Image' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-image media everywhere (media is always an image)', async () => {
    const { service, brand, creative } = makeDeps();
    brand.findUnique.mockResolvedValue(brandRow);
    creative.findUnique.mockResolvedValue({ ...creativeRow, brand: brandRow });

    await expect(
      service.requestUploadUrl({ brand_id: 'brand1', name: 'X', media_type: 'Video' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createCreative(
        {
          brand_id: 'brand1',
          creative_name: 'X',
          initial_version: { media_url: 's3://b/a.mp4', media_type: 'Video' },
        },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.uploadVersion('c1', { media_url: 's3://b/a.mp4', media_type: 'Video' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CreativeService.finalizeUpload', () => {
  it('requires creative_id or brand_id + name', async () => {
    const { service } = makeDeps();

    await expect(
      service.finalizeUpload({ s3_key: 'creatives/1-a.png', media_type: 'Image' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('attaches a version to an existing creative', async () => {
    const { service, creative, creativeVersion } = makeDeps();
    creative.findUnique.mockResolvedValue({ ...creativeRow, brand: brandRow });
    creativeVersion.findFirst.mockResolvedValue(null);
    creativeVersion.create.mockResolvedValue({ ...versionRow, id: 'v2', versionNumber: 2 });
    creative.update.mockResolvedValue(creativeRow);

    const result = await service.finalizeUpload(
      { creative_id: 'c1', s3_key: 'creatives/2-b.png', media_type: 'Image' },
      'u1',
    );

    expect(creativeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaUrl: 'creatives/2-b.png' }),
      }),
    );
    expect(result.id).toBe('v2');
  });

  it('stores the normalized bucket URL returned by the storage layer', async () => {
    const { service, creative, creativeVersion, storage } = makeDeps();
    (storage.resolveCreativeFileUrl as jest.Mock).mockReturnValue(
      'https://grub-media.s3.ap-south-1.amazonaws.com/creatives/2-b.png',
    );
    creative.findUnique.mockResolvedValue({ ...creativeRow, brand: brandRow });
    creativeVersion.findFirst.mockResolvedValue(null);
    creativeVersion.create.mockResolvedValue({ ...versionRow, id: 'v2', versionNumber: 2 });
    creative.update.mockResolvedValue(creativeRow);

    await service.finalizeUpload(
      { creative_id: 'c1', s3_key: 'creatives/2-b.png', media_type: 'Image' },
      'u1',
    );

    expect(creativeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaUrl: 'https://grub-media.s3.ap-south-1.amazonaws.com/creatives/2-b.png',
        }),
      }),
    );
  });

  it('derives media_name from the s3_key file name', async () => {
    const { service, creative, creativeVersion } = makeDeps();
    creative.findUnique.mockResolvedValue({ ...creativeRow, brand: brandRow });
    creativeVersion.findFirst.mockResolvedValue(null);
    creativeVersion.create.mockResolvedValue({ ...versionRow, id: 'v3', versionNumber: 3 });
    creative.update.mockResolvedValue(creativeRow);

    await service.finalizeUpload(
      { creative_id: 'c1', s3_key: 'creatives/diwali%20film%2015s.png', media_type: 'Image' },
      'u1',
    );

    expect(creativeVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaName: 'diwali film 15s.png' }),
      }),
    );
  });

  it('rejects finalize when the object was never uploaded', async () => {
    const { service, storage } = makeDeps();
    storage.getObjectSize.mockRejectedValue({
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

    await expect(
      service.finalizeUpload(
        { creative_id: 'c1', s3_key: 'creatives/ghost.png', media_type: 'Image' },
        'u1',
      ),
    ).rejects.toThrow(/No file uploaded yet/);
  });

  it('rejects finalize when the uploaded object is empty', async () => {
    const { service, storage } = makeDeps();
    storage.getObjectSize.mockResolvedValue(0);

    await expect(
      service.finalizeUpload(
        { creative_id: 'c1', s3_key: 'creatives/empty.png', media_type: 'Image' },
        'u1',
      ),
    ).rejects.toThrow(/empty/);
  });
});

describe('filterOptions', () => {
  it('returns distinct locations, actioner names, and per-creative geo', async () => {
    const { service, client } = makeDeps();
    client.advert.findMany.mockResolvedValue([
      { addressText: ' MG Road ', version: { creativeId: 'c1' } },
      { addressText: 'MG Road', version: { creativeId: 'c1' } },
      { addressText: 'Brigade Road', version: { creativeId: 'c2' } },
      { addressText: null, version: { creativeId: 'c2' } },
      { addressText: 'No Creative', version: null },
    ]);
    client.reviewAction.findMany.mockResolvedValue([
      { actorId: 'u1' },
      { actorId: '  ' },
      { actorId: 'agency-operator' },
    ]);
    client.user.findMany.mockResolvedValue([{ id: 'u1', firstName: 'Ishani', lastName: 'Reddy' }]);

    const result = await service.filterOptions();

    expect(result.locations).toEqual(['Brigade Road', 'MG Road']);
    expect(result.actioners).toEqual(['agency-operator', 'Ishani Reddy']);
    expect(result.geo).toEqual({ c1: ['MG Road'], c2: ['Brigade Road'] });
    expect(client.advert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ addressText: true }) }),
    );
  });

  it('returns empty collections when there is no data', async () => {
    const { service } = makeDeps();
    const result = await service.filterOptions();
    expect(result).toEqual({ locations: [], actioners: [], geo: {} });
  });
});

describe('CreativeService.bulkAction (multi-select bulk review)', () => {
  const approvedRow = { ...versionRow, id: 'v2', status: 'APPROVED' };

  it('validates the shared action once before writing anything', async () => {
    const { service, creativeVersion } = makeDeps();

    await expect(
      service.bulkAction({ action: 'REJECT', version_ids: ['v1', 'v2'] }, 'reviewer1'),
    ).rejects.toThrow(BadRequestException);

    // No version was even probed: the batch fails fast with zero reads/writes.
    expect(creativeVersion.findUnique).not.toHaveBeenCalled();
  });

  it('applies the decision per version through the standard single path', async () => {
    const { service, creativeVersion, reviewAction, outbox, client } = makeDeps();
    // Both versions are applicable: fresh, PENDING rows.
    creativeVersion.findUnique.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({ ...versionRow, id: args.where.id }),
    );
    creativeVersion.update
      .mockResolvedValueOnce({ ...versionRow, status: 'APPROVED' })
      .mockResolvedValueOnce({ ...versionRow, id: 'v2', status: 'APPROVED' });
    client.creativeVersion.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({ ...versionRow, id: args.where.id, status: 'APPROVED', actions: [] }),
    );

    const result = await service.bulkAction(
      {
        action: 'APPROVE',
        comments: 'Bulk approved',
        version_ids: ['v1', 'v2'],
      },
      'reviewer1',
    );

    expect(result.applied).toEqual([
      { version_id: 'v1', new_status: 'APPROVED' },
      { version_id: 'v2', new_status: 'APPROVED' },
    ]);
    expect(result.skipped).toEqual([]);
    expect(reviewAction.create).toHaveBeenCalledTimes(2);
    const events = outbox.emitInTx.mock.calls.map(
      (call) => (call[1] as { eventType: string }).eventType,
    );
    // One review.approved event per applied version — same trail as singles.
    expect(events.filter((event) => event === 'review.approved')).toHaveLength(2);
  });

  it('skips decided and missing versions with per-id reasons instead of failing', async () => {
    const { service, creativeVersion, client } = makeDeps();
    creativeVersion.findUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'v1') return Promise.resolve(versionRow);
      if (args.where.id === 'v2') return Promise.resolve(approvedRow);
      return Promise.resolve(null);
    });
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'APPROVED' });
    client.creativeVersion.findUniqueOrThrow.mockResolvedValue({
      ...versionRow,
      status: 'APPROVED',
      actions: [],
    });

    const result = await service.bulkAction(
      { action: 'APPROVE', version_ids: ['v1', 'v2', 'v3'] },
      'reviewer1',
    );

    expect(result.applied).toEqual([{ version_id: 'v1', new_status: 'APPROVED' }]);
    expect(result.skipped).toEqual(
      ['v2', 'v3'].map((version_id) => ({ version_id, reason: expect.any(String) })),
    );
    expect(result.skipped.find((row) => row.version_id === 'v2')?.reason).toMatch(
      /already APPROVED/,
    );
    expect(result.skipped.find((row) => row.version_id === 'v3')?.reason).toMatch(/not found/);
  });

  it('does not cascade advert revocations for skipped versions', async () => {
    const { service, creativeVersion, client, advert } = makeDeps();
    // Only v1 is applicable; v2 is already decided.
    creativeVersion.findUnique.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve(args.where.id === 'v1' ? versionRow : approvedRow),
    );
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'APPROVED' });
    client.creativeVersion.findUniqueOrThrow.mockResolvedValue({
      ...versionRow,
      status: 'APPROVED',
      actions: [],
    });

    await service.bulkAction({ action: 'APPROVE', version_ids: ['v1', 'v2'] }, 'reviewer1');

    expect(advert.updateMany).not.toHaveBeenCalled();
  });

  it('cascades advert revocations once per applied REJECT', async () => {
    const { service, creativeVersion, client, advert, outbox } = makeDeps();
    creativeVersion.findUnique.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({ ...versionRow, id: args.where.id }),
    );
    creativeVersion.update.mockResolvedValue({ ...versionRow, status: 'REJECTED' });
    advert.findMany.mockResolvedValue([{ id: 'a1' }]);
    client.creativeVersion.findUniqueOrThrow.mockResolvedValue({
      ...versionRow,
      status: 'REJECTED',
      actions: [],
    });

    const result = await service.bulkAction(
      {
        action: 'REJECT',
        reason: 'NON_COMPLIANT',
        version_ids: ['v1', 'v2'],
      },
      'reviewer1',
    );

    expect(result.applied).toHaveLength(2);
    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1'] } },
      data: { status: 'REVOKED' },
    });
    expect(advert.updateMany).toHaveBeenCalledTimes(2);
    const events = outbox.emitInTx.mock.calls.map(
      (call) => (call[1] as { eventType: string }).eventType,
    );
    expect(events.filter((event) => event === 'review.rejected')).toHaveLength(2);
  });
});

describe('ReviewController route order', () => {
  it('declares static GET routes before parameterized GET routes', () => {
    const getMetadata = (
      Reflect as unknown as {
        getMetadata: (key: string, target: object) => unknown;
      }
    ).getMetadata;
    const proto = ReviewController.prototype;
    const getRoutes = Object.getOwnPropertyNames(proto)
      .filter((name) => {
        const fn = (proto as unknown as Record<string, unknown>)[name];
        if (typeof fn !== 'function') return false;
        return getMetadata(METHOD_METADATA, fn) === RequestMethod.GET;
      })
      .map((name) => {
        const fn = (proto as unknown as Record<string, unknown>)[name] as object;
        const path = getMetadata(PATH_METADATA, fn);
        return Array.isArray(path) ? path.join(',') : String(path);
      });

    expect(getRoutes).toContain('filter-options');
    expect(getRoutes).toContain('export');
    const staticIdx = Math.max(getRoutes.indexOf('filter-options'), getRoutes.indexOf('export'));
    const paramIdx = getRoutes.findIndex((p) => p.includes(':'));
    expect(paramIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeLessThan(paramIdx);
  });
});
