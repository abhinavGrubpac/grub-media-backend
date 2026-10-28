import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { AdvertService } from './advert.service';

const brandRow = {
  id: 'brand1',
  brandName: 'Acme',
  industryCategory: 'Food',
  contactEmail: null,
  isActive: true,
  autoApprove: false,
  isFlagged: false,
  upstreamBrandId: 'ub1',
  upstreamAgencyId: 'ag1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const creativeRow = {
  id: 'c1',
  brandId: 'brand1',
  creativeName: 'Festive Ad',
  externalRefId: null,
  currentVersionId: null,
  upstreamCreativeId: 'uc1',
  upstreamAgencyId: 'ag1',
  campaignRef: null,
  createdAt: new Date(),
};

const approvedVersion = {
  id: 'v1',
  creativeId: 'c1',
  versionNumber: 1,
  mediaUrl: 's3://bucket/a.png',
  mediaType: 'Image',
  status: 'APPROVED',
  createdBy: 'user1',
  upstreamVersionId: 'uv1',
  submittedAt: null,
  createdAt: new Date(),
  creative: { ...creativeRow, brand: brandRow },
};

const advertRow = {
  id: 'a1',
  versionId: 'v1',
  addressText: 'MG Road',
  status: 'SCHEDULED',
  startDate: new Date(),
  endDate: new Date(),
  cityName: 'Bengaluru',
  zoneName: null,
  imageHash: null,
  upstreamAdvertId: 'ua1',
  createdAt: new Date(),
};

function makeDeps() {
  const advert = {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const creativeVersion = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const executeRaw = jest.fn().mockResolvedValue(1);
  const queryRaw = jest.fn().mockResolvedValue([]);
  const advertSearchHistory = {
    create: jest.fn().mockResolvedValue({ id: 's1' }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const activityLog = { create: jest.fn().mockResolvedValue({ id: 'log1' }) };
  const client = {
    advert,
    creativeVersion,
    advertSearchHistory,
    activityLog,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  };
  const prisma = {
    client,
    $transaction: jest.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
    $executeRaw: executeRaw,
  };
  const outbox = {
    emitInTx: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdvertService(
    prisma as never,
    outbox as never,
    new ActivityLogService(prisma as never),
  );
  return {
    service,
    client,
    advert,
    creativeVersion,
    executeRaw,
    queryRaw,
    advertSearchHistory,
    outbox,
  };
}

describe('AdvertService.scheduleVersion', () => {
  const dto = {
    version_id: 'v1',
    lat: 12.9716,
    lng: 77.5946,
    address_text: 'MG Road, Bengaluru',
    start_date: new Date('2026-10-08T00:00:00Z'),
    end_date: new Date('2026-10-20T00:00:00Z'),
  };

  it('books a PENDING version (pre-approval schedules are normal)', async () => {
    const { service, creativeVersion, advert, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      ...approvedVersion,
      status: 'PENDING',
      creative: { ...creativeRow, brand: brandRow },
    });
    advert.findUnique.mockResolvedValue({ ...advertRow, status: 'SCHEDULED' });

    const response = await service.scheduleVersion({ ...dto, radius: 2.5 }, 'manager1');

    expect(response.status).toBe('SCHEDULED');
    expect(outbox.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'advert.deploy_blocked' }),
    );
  });

  it('blocks dead-end versions and emits advert.deploy_blocked', async () => {
    const { service, creativeVersion, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      ...approvedVersion,
      status: 'REJECTED',
      creative: creativeRow,
    });

    await expect(service.scheduleVersion(dto, 'manager1')).rejects.toThrow(BadRequestException);
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'advert.deploy_blocked',
        payload: expect.objectContaining({ reason: 'version_not_schedulable' }),
      }),
    );
  });

  it('blocks deployment when the brand kill-switch is active', async () => {
    const { service, creativeVersion, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      ...approvedVersion,
      creative: { ...creativeRow, brand: { ...brandRow, isActive: false } },
    });

    await expect(service.scheduleVersion(dto, 'manager1')).rejects.toThrow(BadRequestException);
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'advert.deploy_blocked',
        payload: expect.objectContaining({ reason: 'brand_inactive' }),
      }),
    );
  });

  it('inserts via raw SQL, emits advert.scheduled and re-reads the row', async () => {
    const { service, creativeVersion, executeRaw, advert, outbox } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      ...approvedVersion,
      creative: { ...creativeRow, brand: brandRow },
    });
    advert.findUnique.mockResolvedValue(advertRow);

    const response = await service.scheduleVersion(dto, 'manager1');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(advert.updateMany).not.toHaveBeenCalled();
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'advert.scheduled',
        key: expect.any(String),
        payload: expect.objectContaining({ lat: 12.9716, brand_id: 'brand1' }),
      }),
    );
    expect(response.status).toBe('SCHEDULED');
  });

  it('rejects an unknown version', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(null);

    await expect(service.scheduleVersion(dto, 'manager1')).rejects.toThrow(NotFoundException);
  });
});

describe('AdvertService.updateStatus (govt origin)', () => {
  it('rejects illegal government transitions', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue(advertRow);

    await expect(service.updateStatus('a1', 'LIVE', 'manager1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('conflicts (409) on terminal-state moves', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue({ ...advertRow, status: 'REVOKED' });

    await expect(service.updateStatus('a1', 'LIVE', 'manager1')).rejects.toThrow(ConflictException);
  });

  it('conflicts (409) on a stale expected_status', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue({ ...advertRow, status: 'LIVE' });

    await expect(service.updateStatus('a1', 'PAUSED', 'manager1', 'SCHEDULED')).rejects.toThrow(
      ConflictException,
    );
    expect(advert.updateMany).not.toHaveBeenCalled();
  });

  it('conflicts (409) when the row vanishes between read and write', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue({ ...advertRow, status: 'LIVE' });
    advert.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateStatus('a1', 'PAUSED', 'manager1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('records a legal revoke with the event and re-reads the row', async () => {
    const { service, advert, outbox } = makeDeps();
    advert.findUnique
      .mockResolvedValueOnce({ ...advertRow, status: 'LIVE' })
      .mockResolvedValueOnce({ ...advertRow, status: 'REVOKED' })
      .mockResolvedValueOnce({
        ...advertRow,
        status: 'REVOKED',
        version: { creative: { brand: {} } },
      });

    const response = await service.updateStatus('a1', 'REVOKED', 'manager1');

    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'REVOKED' },
    });
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'advert.revoked',
        payload: expect.objectContaining({ from_status: 'LIVE', status: 'REVOKED' }),
      }),
    );
    expect(response.status).toBe('REVOKED');
  });

  it('rejects unknown adverts', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue(null);

    await expect(service.updateStatus('missing', 'REVOKED', 'manager1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('writes the audit-trail row for every status change', async () => {
    const { service, advert, client } = makeDeps();
    advert.findUnique
      .mockResolvedValueOnce({ ...advertRow, status: 'LIVE' })
      .mockResolvedValueOnce({ ...advertRow, status: 'PAUSED' })
      .mockResolvedValueOnce({ ...advertRow, status: 'PAUSED' });

    await service.updateStatus('a1', 'PAUSED', 'manager1');

    expect(client.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'manager1',
          action: 'advert.paused',
          entityType: 'Advert',
          entityId: 'a1',
        }),
      }),
    );
  });

  it('resumes PAUSED to SCHEDULED before the start date', async () => {
    const { service, advert } = makeDeps();
    const now = Date.now();
    const paused = {
      ...advertRow,
      status: 'PAUSED',
      startDate: new Date(now + 7 * 86400000),
      endDate: new Date(now + 14 * 86400000),
    };
    advert.findUnique
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce({ ...paused, status: 'SCHEDULED' })
      .mockResolvedValueOnce({
        ...paused,
        status: 'SCHEDULED',
        version: { creative: { brand: {} } },
      });

    const response = await service.updateStatus('a1', 'SCHEDULED', 'manager1');

    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'SCHEDULED' },
    });
    expect(response.status).toBe('SCHEDULED');
  });

  it('resumes PAUSED to LIVE inside the flight window', async () => {
    const { service, advert } = makeDeps();
    const now = Date.now();
    const paused = {
      ...advertRow,
      status: 'PAUSED',
      startDate: new Date(now - 86400000),
      endDate: new Date(now + 7 * 86400000),
    };
    advert.findUnique
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce({ ...paused, status: 'LIVE' })
      .mockResolvedValueOnce({
        ...paused,
        status: 'LIVE',
        version: { creative: { brand: {} } },
      });

    const response = await service.updateStatus('a1', 'LIVE', 'manager1');

    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'LIVE' },
    });
    expect(response.status).toBe('LIVE');
  });

  it('blocks PAUSED going LIVE before its start date (resume to SCHEDULED)', async () => {
    const { service, advert } = makeDeps();
    const now = Date.now();
    advert.findUnique.mockResolvedValue({
      ...advertRow,
      status: 'PAUSED',
      startDate: new Date(now + 7 * 86400000),
      endDate: new Date(now + 14 * 86400000),
    });

    await expect(service.updateStatus('a1', 'LIVE', 'manager1')).rejects.toThrow(
      /resume to SCHEDULED/,
    );
    expect(advert.updateMany).not.toHaveBeenCalled();
  });

  it('blocks PAUSED going SCHEDULED after the start date (resume to LIVE)', async () => {
    const { service, advert } = makeDeps();
    const now = Date.now();
    advert.findUnique.mockResolvedValue({
      ...advertRow,
      status: 'PAUSED',
      startDate: new Date(now - 86400000),
      endDate: new Date(now + 7 * 86400000),
    });

    await expect(service.updateStatus('a1', 'SCHEDULED', 'manager1')).rejects.toThrow(
      /resume to LIVE/,
    );
    expect(advert.updateMany).not.toHaveBeenCalled();
  });
});

describe('AdvertService.upsertFromUpstream', () => {
  const input = {
    upstream_advert_id: 'ua1',
    upstream_creative_id: 'uc1',
    upstream_version_id: 'uv1',
    lat: 12.9716,
    lng: 77.5946,
    address_text: 'MG Road',
    start_date: new Date('2026-10-08T00:00:00Z'),
    end_date: new Date('2026-10-20T00:00:00Z'),
  };

  it('conflicts when mutating a non-SCHEDULED advert', async () => {
    const { service, creativeVersion, advert } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue(approvedVersion);
    advert.findUnique.mockResolvedValue({ ...advertRow, status: 'LIVE' });

    await expect(service.upsertFromUpstream(input)).rejects.toThrow(ConflictException);
  });

  it('rejects versions belonging to another upstream creative', async () => {
    const { service, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      ...approvedVersion,
      creative: { ...creativeRow, upstreamCreativeId: 'uc-other' },
    });

    await expect(service.upsertFromUpstream(input)).rejects.toThrow(BadRequestException);
  });
});

describe('AdvertService.findAll', () => {
  it('paginates and accepts both brandId spellings', async () => {
    const { service, advert } = makeDeps();
    advert.findMany.mockResolvedValue([advertRow]);
    advert.count.mockResolvedValue(1);

    const result = await service.findAll({
      page: 2,
      limit: 10,
      brandId: 'brand1',
      sortOrder: 'desc',
    });

    expect(advert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { version: { creative: { brandId: 'brand1' } } },
        skip: 10,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({
      totalItems: 1,
      itemCount: 1,
      itemsPerPage: 10,
      totalPages: 1,
      currentPage: 2,
    });
  });

  it('combines industry, schedule window, ids and DB sorting in one predicate', async () => {
    const { service, advert } = makeDeps();
    advert.findMany.mockResolvedValue([]);
    advert.count.mockResolvedValue(0);

    await service.findAll({
      page: 1,
      limit: 20,
      industry: 'Food',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
      ids: ['a1', 'a2'],
      sortBy: 'start_date',
      sortOrder: 'asc',
    });

    const where = advert.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ['a1', 'a2'] });
    expect(where.version.creative.brand).toEqual({
      is: { industryCategory: { equals: 'Food', mode: 'insensitive' } },
    });
    expect(where.AND).toEqual([
      { endDate: { gte: new Date('2026-10-01T00:00:00.000Z') } },
      { startDate: { lte: new Date('2026-10-31T23:59:59.999Z') } },
    ]);
    expect(advert.findMany.mock.calls[0][0].orderBy).toEqual({ startDate: 'asc' });
  });

  it('rejects unknown sort keys', async () => {
    const { service } = makeDeps();

    await expect(
      service.findAll({ page: 1, limit: 20, sortOrder: 'desc', sortBy: 'bogus' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('records first-page text searches so they appear in recent searches', async () => {
    const { service, advert, advertSearchHistory } = makeDeps();
    advert.findMany.mockResolvedValue([advertRow]);
    advert.count.mockResolvedValue(1);

    await service.findAll(
      { page: 1, limit: 20, sortOrder: 'desc', search: ' Mumbai ' },
      'manager1',
    );

    expect(advertSearchHistory.create).toHaveBeenCalledTimes(1);
    expect(advertSearchHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'manager1',
        resultCount: 1,
        params: expect.objectContaining({ search: 'Mumbai' }),
      }),
    });
  });

  it('does not record text searches while paging', async () => {
    const { service, advert, advertSearchHistory } = makeDeps();
    advert.findMany.mockResolvedValue([]);
    advert.count.mockResolvedValue(0);

    await service.findAll({ page: 2, limit: 20, sortOrder: 'desc', search: 'Mumbai' }, 'manager1');

    expect(advertSearchHistory.create).not.toHaveBeenCalled();
  });

  it('matches text searches against city and zone columns', async () => {
    const { service, advert } = makeDeps();
    advert.findMany.mockResolvedValue([]);
    advert.count.mockResolvedValue(0);

    await service.findAll({ page: 1, limit: 20, sortOrder: 'desc', search: 'Nashik' });

    const where = advert.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { cityName: { contains: 'Nashik', mode: 'insensitive' } },
        { zoneName: { contains: 'Nashik', mode: 'insensitive' } },
      ]),
    );
  });
});

describe('AdvertService.exportAdverts', () => {
  it('projects the same filter set to flat rows', async () => {
    const { service, advert } = makeDeps();
    advert.findMany.mockResolvedValue([
      {
        ...advertRow,
        radiusKm: 2.5,
        version: {
          creative: { creativeName: 'Festive Ad', brand: { brandName: 'Acme' } },
        },
      },
    ]);

    const rows = await service.exportAdverts({ status: 'SCHEDULED', ids: ['a1'] });

    expect(advert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['a1'] } }) }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'a1',
        creative: 'Festive Ad',
        brand: 'Acme',
        status: 'SCHEDULED',
        radius_km: 2.5,
      }),
    ]);
  });
});

describe('AdvertService.syncDueSchedules', () => {
  it('promotes due rows to LIVE and retires overdue rows to EXPIRED', async () => {
    const { service, advert, outbox } = makeDeps();
    const now = new Date('2026-10-15T00:00:00Z');
    advert.findMany
      .mockResolvedValueOnce([{ id: 'due1', status: 'SCHEDULED' }])
      .mockResolvedValueOnce([{ id: 'old1', status: 'SCHEDULED' }]);
    advert.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.syncDueSchedules(now, 'system');

    expect(result).toEqual({ promoted: 1, expired: 1, at: now });
    const events = outbox.emitInTx.mock.calls.map(
      (call) => (call[1] as { eventType: string }).eventType,
    );
    expect(events).toEqual(['advert.live', 'advert.expired']);
  });

  it('promotes due rows only for APPROVED versions (pre-approval bookings wait)', async () => {
    const { service, advert } = makeDeps();
    const now = new Date('2026-10-15T00:00:00Z');
    advert.findMany.mockResolvedValue([]);
    advert.updateMany.mockResolvedValue({ count: 1 });

    await service.syncDueSchedules(now, 'system');

    expect(advert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SCHEDULED',
          version: { status: 'APPROVED' },
        }),
      }),
    );
  });
});

describe('AdvertService.searchByRadius', () => {
  it('rejects radius without location and partial coordinates', async () => {
    const { service } = makeDeps();

    await expect(service.searchByRadius({ radius: 5 })).rejects.toThrow(BadRequestException);
    await expect(service.searchByRadius({ lat: 12.9 })).rejects.toThrow(BadRequestException);
    await expect(service.searchByRadius({ lng: 77.5 })).rejects.toThrow(BadRequestException);
  });

  it('returns distance-sorted geo rows with echo, count and history record', async () => {
    const { service, queryRaw, advertSearchHistory } = makeDeps();
    queryRaw.mockResolvedValue([
      {
        ...advertRow,
        versionId2: 'v1',
        versionNumber: 1,
        versionStatus: 'APPROVED',
        creativeId: 'c1',
        creativeName: 'Festive Ad',
        brandId: 'brand1',
        brandName: 'Acme',
        isFlagged: false,
        industryCategory: 'Food',
        mediaUrl: 's3://bucket/a.png',
        mediaType: 'Image',
        location: 'POINT(77.5946 12.9716)',
        distanceKm: 1.23456,
        total: 2,
      },
    ]);

    const result = await service.searchByRadius({
      lat: 12.9716,
      lng: 77.5946,
      radius: 5,
      page: 1,
      limit: 50,
      actor_id: 'manager1',
    });

    expect(result.meta).toEqual({
      totalItems: 2,
      itemCount: 1,
      itemsPerPage: 50,
      totalPages: 1,
      currentPage: 1,
    });
    expect(result.search).toEqual(
      expect.objectContaining({ lat: 12.9716, lng: 77.5946, radius_km: 5, sort: 'distance_asc' }),
    );
    const row = result.items[0] as { distance_km: number; location: string; industry: string };
    expect(row.distance_km).toBe(1.235);
    expect(row.location).toBe('POINT(77.5946 12.9716)');
    expect(row.industry).toBe('Food');
    expect(advertSearchHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'manager1', resultCount: 2 }),
      }),
    );
  });

  it('falls back to a paginated filtered list without coordinates', async () => {
    const { service, advert, advertSearchHistory } = makeDeps();
    advert.findMany.mockResolvedValue([advertRow]);
    advert.count.mockResolvedValue(1);

    const result = await service.searchByRadius({ brand_id: 'brand1', actor_id: 'manager1' });

    expect(result.meta.totalItems).toBe(1);
    expect(result.search).toEqual(
      expect.objectContaining({ lat: null, lng: null, radius_km: null }),
    );
    expect(advertSearchHistory.create).toHaveBeenCalled();
  });

  it('accepts text search on the plain-search fallback', async () => {
    const { service, advert, advertSearchHistory } = makeDeps();
    advert.findMany.mockResolvedValue([advertRow]);
    advert.count.mockResolvedValue(1);

    const result = await service.searchByRadius({ search: ' Nashik ', actor_id: 'manager1' });

    const where = advert.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { cityName: { contains: 'Nashik', mode: 'insensitive' } },
        { addressText: { contains: 'Nashik', mode: 'insensitive' } },
      ]),
    );
    expect(result.search.search).toBe('Nashik');
    expect(advertSearchHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'manager1',
          params: expect.objectContaining({ search: 'Nashik' }),
        }),
      }),
    );
  });

  it('skips history for anonymous callers', async () => {
    const { service, advert, advertSearchHistory } = makeDeps();
    advert.findMany.mockResolvedValue([]);
    advert.count.mockResolvedValue(0);

    await service.searchByRadius({});

    expect(advertSearchHistory.create).not.toHaveBeenCalled();
  });
});

describe('AdvertService.transitionFromUpstream', () => {
  it('conflicts (409) on upstream REVOKED attempts (government-only)', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue({ ...advertRow, status: 'LIVE' });

    await expect(service.transitionFromUpstream('a1', { status: 'REVOKED' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('maps upstream COMPLETED/CANCELLED aliases to EXPIRED', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique
      .mockResolvedValueOnce({ ...advertRow, status: 'LIVE' })
      .mockResolvedValueOnce({ ...advertRow, status: 'EXPIRED' })
      .mockResolvedValueOnce({ ...advertRow, status: 'LIVE' })
      .mockResolvedValueOnce({ ...advertRow, status: 'EXPIRED' });

    await service.transitionFromUpstream('a1', { status: 'COMPLETED' });
    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'EXPIRED' },
    });
    await service.transitionFromUpstream('a1', { status: 'CANCELLED' });
    expect(advert.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'a1' },
      data: { status: 'EXPIRED' },
    });
  });

  it('blocks SCHEDULED going LIVE before its start date', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue({
      ...advertRow,
      status: 'SCHEDULED',
      startDate: new Date('2026-12-01T00:00:00Z'),
    });

    await expect(
      service.transitionFromUpstream('a1', {
        status: 'LIVE',
        occurred_at: '2026-10-01T00:00:00Z',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('applies legal upstream transitions with the event', async () => {
    const { service, advert, outbox } = makeDeps();
    advert.findUnique
      .mockResolvedValueOnce({ ...advertRow, status: 'SCHEDULED' })
      .mockResolvedValueOnce({ ...advertRow, status: 'LIVE' });

    const response = await service.transitionFromUpstream('a1', { status: 'LIVE' });

    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'LIVE' },
    });
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'advert.live' }),
    );
    expect(response.status).toBe('LIVE');
  });
});

describe('AdvertService.searchByImage (single endpoint)', () => {
  async function blackPng(): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp({
      create: { width: 9, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
  }

  it('requires either a file or image_hash/advert_id', async () => {
    const { service } = makeDeps();
    await expect(service.searchByImage(undefined, {})).rejects.toThrow(BadRequestException);
  });

  it('rejects oversized and non-image uploads', async () => {
    const { service } = makeDeps();
    await expect(service.searchByImage(Buffer.alloc(6 * 1024 * 1024), {})).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.searchByImage(Buffer.from('not-an-image'), {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('ranks candidates by Hamming distance and records the search', async () => {
    const { service, advert, advertSearchHistory } = makeDeps();
    advert.findMany.mockResolvedValue([
      { ...advertRow, id: 'far', imageHash: 'ffffffffffffffff' },
      { ...advertRow, id: 'near', imageHash: '0000000000000001' },
      { ...advertRow, id: 'exact', imageHash: '0000000000000000' },
      { ...advertRow, id: 'unhashed', imageHash: null },
    ]);

    const result = await service.searchByImage(await blackPng(), {
      max_distance: 10,
      actor_id: 'manager1',
    });

    // Solid black hashes to 0x0; unhashed rows never participate.
    expect(result.meta.totalItems).toBe(2);
    expect(result.items.map((row) => (row as { id: string }).id)).toEqual(['exact', 'near']);
    expect((result.items[0] as { hash_distance: number }).hash_distance).toBe(0);
    expect((result.items[1] as { hash_distance: number }).hash_distance).toBe(1);
    expect(result.search).toEqual(
      expect.objectContaining({ query_hash: '0000000000000000', max_distance: 10 }),
    );
    expect(advertSearchHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'manager1', resultCount: 2 }),
      }),
    );
  });

  it('resolves advert_id to its stored hash and ranks nearest-first', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue({ ...advertRow, id: 'ref', imageHash: '0000000000000000' });
    advert.findMany.mockResolvedValue([
      { ...advertRow, id: 'near', imageHash: '0000000000000001' },
      { ...advertRow, id: 'exact', imageHash: '0000000000000000' },
      { ...advertRow, id: 'unhashed', imageHash: null },
    ]);

    const result = await service.searchByImage(undefined, { advert_id: 'ref', max_distance: 10 });

    expect(result.items.map((row) => (row as { id: string }).id)).toEqual(['exact', 'near']);
    expect(result.search.query_hash).toBe('0000000000000000');
  });

  it('rejects unknown reference adverts and hash-less rows', async () => {
    const { service, advert } = makeDeps();
    advert.findUnique.mockResolvedValue(null);
    await expect(service.searchByImage(undefined, { advert_id: 'missing' })).rejects.toThrow(
      NotFoundException,
    );

    advert.findUnique.mockResolvedValue({ ...advertRow, imageHash: null });
    await expect(service.searchByImage(undefined, { advert_id: 'ref' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('prefers an uploaded file over hash params', async () => {
    const { service, advert } = makeDeps();
    advert.findMany.mockResolvedValue([
      { ...advertRow, id: 'exact', imageHash: '0000000000000000' },
    ]);

    const result = await service.searchByImage(await blackPng(), {
      image_hash: 'ffffffffffffffff',
      max_distance: 10,
    });

    // File (black = 0x0) wins, so the unrelated explicit hash is ignored.
    expect(result.items.map((row) => (row as { id: string }).id)).toEqual(['exact']);
  });
});

describe('AdvertService.listRecentSearches', () => {
  it('maps rows to the revisit shape with hours_ago', async () => {
    const { service, advertSearchHistory } = makeDeps();
    const searchedAt = new Date(Date.now() - 5 * 3600000);
    advertSearchHistory.findMany.mockResolvedValue([
      { id: 's1', params: { radius_km: 5 }, resultCount: 3, preview: null, createdAt: searchedAt },
    ]);

    const rows = await service.listRecentSearches('manager1');

    expect(advertSearchHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'manager1' }),
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(advertSearchHistory.findMany.mock.calls[0][0].take).toBeUndefined();
    expect(rows).toEqual([
      {
        id: 's1',
        params: { radius_km: 5 },
        adverts_matched: 3,
        preview: [],
        searched_at: searchedAt,
        hours_ago: 5,
      },
    ]);
  });

  it('returns team-wide history for admins and own history for employees', async () => {
    const { service, advertSearchHistory } = makeDeps();
    advertSearchHistory.findMany.mockResolvedValue([]);

    await service.listRecentSearches('admin1', UserRole.ADMIN);
    expect(advertSearchHistory.findMany.mock.calls[0][0].where.userId).toBeUndefined();

    await service.listRecentSearches('super1', UserRole.SUPER_ADMIN);
    expect(advertSearchHistory.findMany.mock.calls[1][0].where.userId).toBeUndefined();

    await service.listRecentSearches('employee1', UserRole.EMPLOYEE);
    expect(advertSearchHistory.findMany.mock.calls[2][0].where.userId).toBe('employee1');
  });

  it('returns the stored media preview for newer rows', async () => {
    const { service, advertSearchHistory } = makeDeps();
    const preview = [
      {
        advert_id: 'a1',
        media_url: 'agency/test-agency/v1.png',
        creative_name: 'Diwali Film',
        brand_name: 'Amul',
        address_text: 'MG Road, Bengaluru',
        city_name: 'Bengaluru',
        status: 'LIVE',
        distance_km: 2.09,
      },
    ];
    advertSearchHistory.findMany.mockResolvedValue([
      { id: 's2', params: { radius_km: 5 }, resultCount: 1, preview, createdAt: new Date() },
    ]);

    const rows = await service.listRecentSearches('manager1');

    expect(rows[0].preview).toEqual(preview);
  });

  it('stores a top-4 media snapshot when recording a search', async () => {
    const { service, queryRaw, advertSearchHistory } = makeDeps();
    const row = (id: string) => ({
      ...advertRow,
      id,
      versionId2: 'v1',
      versionNumber: 1,
      versionStatus: 'APPROVED',
      creativeId: 'c1',
      creativeName: 'Festive Ad',
      brandId: 'brand1',
      brandName: 'Acme',
      isFlagged: false,
      industryCategory: 'Food',
      mediaUrl: `s3://bucket/${id}.png`,
      mediaType: 'Image',
      location: 'POINT(77.5946 12.9716)',
      distanceKm: 1.2,
      total: 5,
    });
    queryRaw.mockResolvedValue([row('a1'), row('a2'), row('a3'), row('a4'), row('a5')]);

    await service.searchByRadius({
      lat: 12.9716,
      lng: 77.5946,
      radius: 5,
      page: 1,
      limit: 50,
      actor_id: 'manager1',
    });

    expect(advertSearchHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'manager1',
          resultCount: 5,
          preview: expect.arrayContaining([
            expect.objectContaining({ advert_id: 'a1', media_url: 's3://bucket/a1.png' }),
          ]),
        }),
      }),
    );
    const saved = (advertSearchHistory.create as jest.Mock).mock.calls[0][0].data.preview;
    expect(saved).toHaveLength(4);
    expect(saved[0]).toMatchObject({ brand_name: 'Acme', city_name: expect.anything() });
  });
});
