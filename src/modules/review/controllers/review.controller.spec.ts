import { ReviewController } from './review.controller';

describe('ReviewController export', () => {
  it('passes active filters through and sets a readable download filename', async () => {
    const exportService = { exportCreatives: jest.fn().mockResolvedValue([]) };
    const controller = new ReviewController({} as never, exportService as never);
    const res = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await controller.export(res as never, { search: 'Festive' } as never);

    expect(exportService.exportCreatives).toHaveBeenCalledWith({ search: 'Festive' });
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': 'attachment; filename="creative_review_report.csv"',
      }),
    );
  });
});
