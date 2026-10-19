import { ForbiddenException } from '@nestjs/common';
import { TestIntakeService } from './test-intake.service';

function makeDeps(nodeEnv = 'test') {
  const agencyRef = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'ag1',
      ...data,
    })),
  };
  const brand = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'brand1',
      ...data,
    })),
  };
  const prisma = { client: { agencyRef, brand } };
  const creativeVersion = {
    findUnique: jest.fn().mockResolvedValue(null),
  };
  (prisma.client as Record<string, unknown>).creativeVersion = creativeVersion;
  const creativeService = {
    upsertThread: jest.fn().mockResolvedValue({ creative: { id: 'c1' }, created: true }),
    uploadVersion: jest.fn().mockResolvedValue({ version: { id: 'v1' }, replayed: false }),
    takeAction: jest.fn().mockResolvedValue({ id: 'v1', status: 'APPROVED' }),
  };
  const advertService = {
    scheduleVersion: jest.fn().mockResolvedValue({ id: 'a1', status: 'SCHEDULED' }),
    upsertFromUpstream: jest.fn().mockResolvedValue({ advert: { id: 'a1' }, created: false }),
    syncDueSchedules: jest.fn().mockResolvedValue({ promoted: 1, expired: 0, at: new Date() }),
  };
  const config = { get: jest.fn().mockReturnValue(nodeEnv) };
  const service = new TestIntakeService(
    prisma as never,
    creativeService as never,
    advertService as never,
    config as never,
  );
  return { service, agencyRef, brand, creativeVersion, creativeService, advertService };
}

const agencyDto = { upstream_agency_id: 'ag-test', agency_name: 'Test Agency' };

describe('TestIntakeService production guard', () => {
  it('refuses every entry point in production', async () => {
    const { service } = makeDeps('production');

    await expect(service.registerAgency(agencyDto)).rejects.toThrow(ForbiddenException);
    await expect(service.createBrand({ brand_name: 'Acme' })).rejects.toThrow(ForbiddenException);
    await expect(service.goLiveSync('manager1')).rejects.toThrow(ForbiddenException);
  });
});

describe('TestIntakeService staging flow', () => {
  it('registers agencies idempotently on upstream_agency_id', async () => {
    const { service, agencyRef } = makeDeps();
    agencyRef.findUnique.mockResolvedValue({ id: 'ag1' });

    const result = await service.registerAgency(agencyDto);

    expect(result).toEqual({ agency: { id: 'ag1' }, created: false });
    expect(agencyRef.create).not.toHaveBeenCalled();
  });

  it('creates a creative with bundled schedule + admin decision in one call', async () => {
    const { service, creativeService, advertService, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      id: 'v1',
      upstreamVersionId: 'uv1',
      creative: { id: 'c1', upstreamCreativeId: 'uc1' },
    });

    const result = await service.createCreative(
      {
        brand_id: 'brand1',
        creative_name: 'Festive Ad',
        media_url: 's3://b/a.png',
        media_type: 'Image',
        admin_approval: {
          by: 'admin-reviewer',
          at: new Date('2026-10-01T00:00:00Z'),
          comments: 'Admin approved',
        },
        schedule: {
          lat: 12.9716,
          lng: 77.5946,
          address_text: 'MG Road',
          start_date: new Date('2026-11-01T00:00:00Z'),
          end_date: new Date('2026-11-30T00:00:00Z'),
        },
      },
      'manager1',
    );

    expect(creativeService.uploadVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        admin_approved_by: 'admin-reviewer',
        admin_comments: 'Admin approved',
      }),
      'manager1',
    );
    expect(advertService.upsertFromUpstream).toHaveBeenCalled();
    expect(result.advert).toEqual({ id: 'a1' });
  });

  it('bootstraps agency → brand → creative → approval → schedule in order', async () => {
    const { service, creativeService, advertService, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      id: 'v1',
      upstreamVersionId: 'uv1',
      creative: { id: 'c1', upstreamCreativeId: 'uc1' },
    });

    const result = await service.bootstrap(
      {
        agency: agencyDto,
        brand: { brand_name: 'Acme' },
        creative: { creative_name: 'Festive Ad', media_url: 's3://b/a.png', media_type: 'Image' },
        approve_immediately: true,
        schedule: {
          lat: 12.9716,
          lng: 77.5946,
          address_text: 'MG Road',
          start_date: new Date('2026-11-01T00:00:00Z'),
          end_date: new Date('2026-11-30T00:00:00Z'),
        },
      },
      'manager1',
    );

    expect(creativeService.upsertThread).toHaveBeenCalledWith(
      expect.objectContaining({ upstream_portal: 'test-intake' }),
    );
    expect(creativeService.uploadVersion).toHaveBeenCalled();
    expect(creativeService.takeAction).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ action: 'APPROVE' }),
      'manager1',
    );
    expect(advertService.upsertFromUpstream).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 12.9716 }),
    );
    expect(result.advert).toEqual({ id: 'a1' });
  });

  it('schedules before approval (agency books first, go-live waits for APPROVE)', async () => {
    const { service, creativeService, advertService, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      id: 'v1',
      upstreamVersionId: 'uv1',
      creative: { id: 'c1', upstreamCreativeId: 'uc1' },
    });

    const result = await service.bootstrap(
      {
        agency: agencyDto,
        brand: { brand_name: 'Acme', upstream_brand_id: 'ub1' },
        creative: {
          creative_name: 'Festive Ad',
          media_url: 's3://b/a.png',
          media_type: 'Image',
          upstream_creative_id: 'uc1',
          upstream_version_id: 'uv1',
        },
        schedule: {
          lat: 12.9716,
          lng: 77.5946,
          address_text: 'MG Road',
          start_date: new Date('2026-11-01T00:00:00Z'),
          end_date: new Date('2026-11-30T00:00:00Z'),
        },
      },
      'manager1',
    );

    expect(creativeService.takeAction).not.toHaveBeenCalled();
    expect(advertService.upsertFromUpstream).toHaveBeenCalled();
    expect(result.advert).toEqual({ id: 'a1' });
    expect(result.version).toEqual({ id: 'v1' });
  });

  it('leaves the version PENDING without approve_immediately or schedule', async () => {
    const { service, creativeService, advertService } = makeDeps();

    const result = await service.bootstrap(
      {
        agency: agencyDto,
        brand: { brand_name: 'Acme' },
        creative: { creative_name: 'Festive Ad', media_url: 's3://b/a.png', media_type: 'Image' },
      },
      'manager1',
    );

    expect(creativeService.takeAction).not.toHaveBeenCalled();
    expect(advertService.scheduleVersion).not.toHaveBeenCalled();
    expect(result.advert).toBeNull();
    expect(result.version).toEqual({ id: 'v1' });
  });

  it('replays idempotently on fixed inputs (no duplicate rows)', async () => {
    const { service, creativeService, advertService, creativeVersion } = makeDeps();
    creativeVersion.findUnique.mockResolvedValue({
      id: 'v1',
      upstreamVersionId: 'uv1',
      creative: { id: 'c1', upstreamCreativeId: 'uc1' },
    });

    const first = await service.bootstrap(
      {
        agency: agencyDto,
        brand: { brand_name: 'Acme', upstream_brand_id: 'ub1' },
        creative: {
          creative_name: 'Festive Ad',
          media_url: 's3://b/a.png',
          media_type: 'Image',
          upstream_creative_id: 'uc1',
          upstream_version_id: 'uv1',
        },
        approve_immediately: true,
        schedule: {
          lat: 12.9716,
          lng: 77.5946,
          address_text: 'MG Road',
          start_date: new Date('2026-11-01T00:00:00Z'),
          end_date: new Date('2026-11-30T00:00:00Z'),
        },
      },
      'manager1',
    );

    expect(creativeService.uploadVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ upstream_version_id: 'uv1' }),
      'manager1',
    );
    expect(advertService.upsertFromUpstream).toHaveBeenCalledWith(
      expect.objectContaining({ upstream_advert_id: expect.any(String) }),
    );
    expect(first.advert).toEqual({ id: 'a1' });
  });
});
