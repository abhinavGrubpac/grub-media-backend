import { ReviewController } from './review.controller';

describe('ReviewController export', () => {
  const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    send: jest.fn(),
  });

  it('renders a PDF by default and keeps the filters active', async () => {
    const exportService = { exportCreatives: jest.fn().mockResolvedValue([]) };
    const pdfService = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')) };
    const controller = new ReviewController(
      {} as never,
      exportService as never,
      pdfService as never,
    );
    const res = makeRes();

    await controller.export(res as never, { search: 'Festive' } as never);

    expect(exportService.exportCreatives).toHaveBeenCalledWith({ search: 'Festive' });
    expect(pdfService.render).toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': expect.stringMatching(
          /^attachment; filename="creative_review_report_\d{4}-\d{2}-\d{2}\.pdf"$/,
        ),
      }),
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('streams CSV when format=csv is requested', async () => {
    const exportService = { exportCreatives: jest.fn().mockResolvedValue([]) };
    const pdfService = { render: jest.fn() };
    const controller = new ReviewController(
      {} as never,
      exportService as never,
      pdfService as never,
    );
    const res = makeRes();

    await controller.export(res as never, { format: 'csv' } as never);

    expect(pdfService.render).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': expect.stringMatching(
          /creative_review_report_\d{4}-\d{2}-\d{2}\.csv"$/,
        ),
      }),
    );
  });
});
