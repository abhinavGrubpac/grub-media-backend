import { CreativePdfService } from './creative-pdf.service';
import type { CreativeExportRow } from './export.service';

const baseVersion = {
  id: 'v1',
  version_number: 2,
  media_url: 'https://example.invalid/media.png',
  media_type: 'Image',
  media_name: 'festive-banner.png',
  file_size_bytes: 2048,
  status: 'REJECTED',
  uploaded_on: new Date('2026-10-20T10:00:00Z'),
  uploaded_by: 'Asha Rao',
  last_action: 'REJECT',
  last_action_by: 'Prema Sharma',
  last_action_at: new Date('2026-10-21T09:30:00Z'),
  comments: 'Text overlaps the logo on small screens.',
  reason: 'Brand logo obscured',
};

const row: CreativeExportRow = {
  id: 'cmcreative0001',
  creative_name: 'Diwali Festive Banner',
  industry: 'Food & Beverage',
  brand_name: 'Chole Bhature Co.',
  media_name: 'festive-banner.png',
  agency_name: 'Bright Ideas Agency',
  location: 'Central Pune; Koregaon Park',
  uploaded_on: new Date('2026-10-20T10:00:00Z'),
  last_action_by: 'Prema Sharma',
  last_action_at: new Date('2026-10-21T09:30:00Z'),
  approval_status: 'REJECTED',
  thumbnail_url: null,
  versions: [
    baseVersion,
    {
      ...baseVersion,
      id: 'v0',
      version_number: 1,
      status: 'APPROVED',
      last_action: 'APPROVE',
      comments: null,
      reason: null,
    },
  ],
};

describe('CreativePdfService', () => {
  const storage = {
    extractKeyFromUrl: jest.fn().mockReturnValue(null),
    presignedDownloadUrl: jest.fn(),
  };

  const pageCount = (buffer: Buffer): number =>
    (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;

  it('renders a PDF containing every requested field and the version history', async () => {
    const service = new CreativePdfService(storage as never);
    const buffer = await service.render([row], {
      generatedAt: new Date('2026-10-27T10:00:00Z'),
    });

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
    const text = buffer.toString('latin1');
    expect(text).toContain('Creative Review Report');
    // Regression: footers drawn in the bottom margin must not append pages.
    expect(pageCount(buffer)).toBe(1);
  });

  it('renders an empty report without throwing', async () => {
    const service = new CreativePdfService(storage as never);
    const buffer = await service.render([]);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(buffer)).toBe(1);
  });
});
