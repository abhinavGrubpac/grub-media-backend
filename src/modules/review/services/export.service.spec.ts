import { ExportService } from './export.service';

describe('ExportService', () => {
  it('applies search together with the other active list filters', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const service = new ExportService({
      client: { creative: { findMany }, $queryRaw: queryRaw },
    } as never);

    await service.exportCreatives({
      status: 'REJECT',
      brand_id: 'brand1',
      industry: 'Food',
      search: 'Festive',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          currentVersionId: { in: ['c1'] },
          brandId: 'brand1',
          creativeName: { contains: 'Festive', mode: 'insensitive' },
          brand: { is: { industryCategory: { equals: 'Food', mode: 'insensitive' } } },
        }),
      }),
    );
  });
});
