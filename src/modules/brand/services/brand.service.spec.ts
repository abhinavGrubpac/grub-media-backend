import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BrandService, brandOrderBy, buildBrandWhere } from './brand.service';

const fullBrand = {
  id: 'b1',
  brandName: 'Acme',
  industryCategory: 'Food',
  contactEmail: 'acme@example.com',
  logoUrl: 'https://cdn.example.com/acme.png',
  address: 'MG Road, Bengaluru',
  isActive: true,
  autoApprove: false,
  isFlagged: false,
  flaggedBy: null,
  flaggedOn: null,
  upstreamBrandId: null,
  upstreamAgencyId: 'ag1',
  createdAt: new Date('2026-10-07T00:00:00Z'),
  updatedAt: new Date('2026-10-07T00:00:00Z'),
};

function makeDeps() {
  const brand = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  };
  const agencyRef = {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const advert = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const client = { brand, agencyRef, advert };
  const prisma = {
    client,
    $transaction: jest.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  };
  const outbox = {
    emitInTx: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BrandService(prisma as never, outbox as never);
  return { service, brand, agencyRef, advert, outbox };
}

describe('buildBrandWhere', () => {
  it('builds search + flag + auto-approve + activity + industry predicates', () => {
    expect(buildBrandWhere({ search: 'Acme' })).toEqual({
      brandName: { contains: 'Acme', mode: 'insensitive' },
    });
    expect(buildBrandWhere({ flag_status: 'flagged' })).toEqual({ isFlagged: true });
    expect(buildBrandWhere({ flag_status: 'unflagged' })).toEqual({ isFlagged: false });
    expect(buildBrandWhere({ auto_approval: 'on' })).toEqual({ autoApprove: true });
    expect(buildBrandWhere({ auto_approval: 'off' })).toEqual({ autoApprove: false });
    expect(buildBrandWhere({ activity: 'stopped' })).toEqual({ isActive: false });
    expect(buildBrandWhere({ industry: 'Food' })).toEqual({
      industryCategory: { equals: 'Food', mode: 'insensitive' },
    });
    expect(buildBrandWhere({})).toEqual({});
  });
});

describe('brandOrderBy', () => {
  it('maps UI sort keys without passthrough', () => {
    expect(brandOrderBy('name', 'asc')).toEqual({ brandName: 'asc' });
    expect(brandOrderBy('name', 'desc')).toEqual({ brandName: 'desc' });
    expect(brandOrderBy('updated', 'desc')).toEqual({ updatedAt: 'desc' });
    expect(brandOrderBy(undefined, 'desc')).toEqual({ brandName: 'asc' });
    expect(() => brandOrderBy('bogus', 'asc')).toThrow(BadRequestException);
  });
});

describe('BrandService', () => {
  it('findAll paginates and maps rows to the snake_case response shape', async () => {
    const { service, brand } = makeDeps();
    brand.findMany.mockResolvedValue([fullBrand]);
    brand.count.mockResolvedValue(1);

    const result = await service.findAll({ page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ brand_name: 'Acme', is_active: true });
    expect(result.data[0]).not.toHaveProperty('brandName');
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('findAll applies filters, name/updated sorting, and agency enrichment', async () => {
    const { service, brand, agencyRef } = makeDeps();
    brand.findMany.mockResolvedValue([fullBrand]);
    brand.count.mockResolvedValue(1);
    agencyRef.findMany.mockResolvedValue([
      { upstreamAgencyId: 'ag1', agencyName: 'Dentsu', city: 'Mumbai', address: 'BKC' },
    ]);

    const result = await service.findAll({
      page: 1,
      limit: 20,
      search: 'Acme',
      flag_status: 'unflagged',
      auto_approval: 'off',
      activity: 'active',
      industry: 'Food',
      sortBy: 'updated',
      sortOrder: 'desc',
    });

    expect(brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isFlagged: false, isActive: true, autoApprove: false }),
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(result.data[0]).toMatchObject({
      agency: { agency_name: 'Dentsu', city: 'Mumbai' },
      logo_url: 'https://cdn.example.com/acme.png',
      address: 'MG Road, Bengaluru',
    });
  });

  it('industries returns distinct categories for the dropdown', async () => {
    const { service, brand } = makeDeps();
    brand.findMany.mockResolvedValue([
      { industryCategory: 'Food' },
      { industryCategory: 'Beverages' },
    ]);

    await expect(service.industries()).resolves.toEqual(['Food', 'Beverages']);
    expect(brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['industryCategory'] }),
    );
  });

  it('exportBrands reuses list filters and enriches agency names', async () => {
    const { service, brand, agencyRef } = makeDeps();
    brand.findMany.mockResolvedValue([fullBrand]);
    agencyRef.findMany.mockResolvedValue([
      { upstreamAgencyId: 'ag1', agencyName: 'Dentsu', city: 'Mumbai', address: 'BKC' },
    ]);

    const rows = await service.exportBrands({ flag_status: 'unflagged' });

    expect(brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isFlagged: false }) }),
    );
    expect(rows).toEqual([expect.objectContaining({ brand_name: 'Acme', agency_name: 'Dentsu' })]);
  });

  it('findOne throws NotFound for an unknown id', async () => {
    const { service, brand } = makeDeps();
    brand.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('create writes logo/address and emits brand.created in the same transaction', async () => {
    const { service, brand, outbox } = makeDeps();
    brand.create.mockResolvedValue({ ...fullBrand, brandName: 'Newco' });

    const response = await service.create({
      brand_name: 'Newco',
      auto_approve: true,
      logo_url: 'https://cdn.example.com/newco.png',
      address: 'Park Street',
    });

    expect(response.brand_name).toBe('Newco');
    expect(brand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brandName: 'Newco',
          autoApprove: true,
          logoUrl: 'https://cdn.example.com/newco.png',
          address: 'Park Street',
        }),
      }),
    );
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'brand.created',
        payload: expect.objectContaining({ brand_name: 'Newco' }),
      }),
    );
  });

  it('setFlag emits non_compliant_flagged when raising the flag', async () => {
    const { service, brand, outbox } = makeDeps();
    brand.findUnique.mockResolvedValue(fullBrand);
    brand.update.mockResolvedValue({ ...fullBrand, isFlagged: true });

    await service.setFlag('b1', true);

    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'brand.non_compliant_flagged' }),
    );
  });

  it('setFlag records who flagged and when, and clears both on unflag', async () => {
    const { service, brand } = makeDeps();
    brand.findUnique.mockResolvedValue(fullBrand);
    brand.update.mockResolvedValue({
      ...fullBrand,
      isFlagged: true,
      flaggedBy: 'manager1',
      flaggedOn: new Date('2026-10-14T00:00:00Z'),
    });

    const flagged = await service.setFlag('b1', true, 'manager1');

    expect(brand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isFlagged: true, flaggedBy: 'manager1' }),
      }),
    );
    expect(flagged).toMatchObject({ flagged_by: 'manager1' });

    brand.update.mockResolvedValue({ ...fullBrand, isFlagged: false, flaggedBy: null });
    await service.setFlag('b1', false, 'manager1');
    expect(brand.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isFlagged: false, flaggedBy: null, flaggedOn: null }),
      }),
    );
  });

  it('killSwitch deactivation revokes non-revoked adverts and emits both events', async () => {
    const { service, brand, advert, outbox } = makeDeps();
    brand.findUnique.mockResolvedValue(fullBrand);
    brand.update.mockResolvedValue({ ...fullBrand, isActive: false });
    advert.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    const result = await service.killSwitch('b1', false);

    expect(advert.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] } },
      data: { status: 'REVOKED' },
    });
    expect(result.revoked_adverts_count).toBe(2);
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'brand.deactivated',
        payload: expect.objectContaining({ is_active: false, revoked_adverts_count: 2 }),
      }),
    );
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'advert.auto_revoked',
        payload: expect.objectContaining({ advert_id: 'a1', reason: 'brand_kill_switch' }),
      }),
    );
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'advert.auto_revoked',
        payload: expect.objectContaining({ advert_id: 'a2', reason: 'brand_kill_switch' }),
      }),
    );
  });

  it('killSwitch reactivation does not cascade adverts', async () => {
    const { service, brand, advert, outbox } = makeDeps();
    brand.findUnique.mockResolvedValue({ ...fullBrand, isActive: false });
    brand.update.mockResolvedValue(fullBrand);

    const result = await service.killSwitch('b1', true);

    expect(advert.findMany).not.toHaveBeenCalled();
    expect(advert.updateMany).not.toHaveBeenCalled();
    expect(result.revoked_adverts_count).toBe(0);
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'brand.reactivated' }),
    );
  });

  describe('upsertFromUpstream', () => {
    const input = {
      upstream_brand_id: 'ub1',
      upstream_agency_id: 'ag1',
      brand_name: 'Upstream Brand',
      industry_category: 'Beverages',
      contact_email: null,
    };

    it('rejects when the upstream agency is unknown', async () => {
      const { service, agencyRef } = makeDeps();
      agencyRef.findUnique.mockResolvedValue(null);

      await expect(service.upsertFromUpstream(input)).rejects.toThrow(NotFoundException);
    });

    it('creates with upstream attribution when the name is free', async () => {
      const { service, brand, agencyRef, outbox } = makeDeps();
      agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
      brand.create.mockResolvedValue({
        ...fullBrand,
        brandName: 'Upstream Brand',
        upstreamBrandId: 'ub1',
      });

      const result = await service.upsertFromUpstream(input);

      expect(result.created).toBe(true);
      expect(outbox.emitInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'brand.created',
          actorId: undefined,
          payload: expect.objectContaining({ origin: 'upstream' }),
        }),
      );
    });

    it('conflicts when the upstream name collides with a local brand', async () => {
      const { service, brand, agencyRef } = makeDeps();
      agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
      brand.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(fullBrand);

      await expect(service.upsertFromUpstream(input)).rejects.toThrow(ConflictException);
    });

    it('returns the existing row untouched when nothing changed (idempotent replay)', async () => {
      const { service, brand, agencyRef, outbox } = makeDeps();
      agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
      brand.findUnique.mockResolvedValueOnce({
        ...fullBrand,
        brandName: input.brand_name,
        industryCategory: input.industry_category ?? null,
        contactEmail: input.contact_email ?? null,
        upstreamAgencyId: 'ag1',
        upstreamBrandId: 'ub1',
      });

      const result = await service.upsertFromUpstream(input);

      expect(result.created).toBe(false);
      expect(brand.update).not.toHaveBeenCalled();
      expect(outbox.emitInTx).not.toHaveBeenCalled();
    });

    it('updates with change detection and oldValue/newValue on rename', async () => {
      const { service, brand, agencyRef, outbox } = makeDeps();
      agencyRef.findUnique.mockResolvedValue({ upstreamAgencyId: 'ag1' });
      brand.findUnique
        .mockResolvedValueOnce({ ...fullBrand, upstreamBrandId: 'ub1', upstreamAgencyId: 'ag1' })
        .mockResolvedValueOnce(null);
      brand.update.mockResolvedValue({
        ...fullBrand,
        brandName: 'Upstream Brand',
        upstreamBrandId: 'ub1',
      });

      const result = await service.upsertFromUpstream(input);

      expect(result.created).toBe(false);
      const event = outbox.emitInTx.mock.calls[0][1] as {
        eventType: string;
        payload: Record<string, unknown>;
      };
      expect(event.eventType).toBe('brand.updated');
      expect(event.payload.oldValue).toMatchObject({ brand_name: 'Acme' });
      expect(event.payload.newValue).toMatchObject({ brand_name: 'Upstream Brand' });
    });
  });
});
