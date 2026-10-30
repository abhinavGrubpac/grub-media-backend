import { REFERENCE_MAX_FILE_BYTES, StorageService, stripUrlQuery } from './storage.service';

function makeService(configMap: Record<string, string | undefined>): StorageService {
  const config = { get: jest.fn((key: string) => configMap[key]) };
  return new StorageService(config as never);
}

describe('StorageService', () => {
  it('runs in mock mode when S3 is not configured', async () => {
    const storage = makeService({ 'app.nodeEnv': 'development' });
    expect(storage.isConfigured).toBe(false);
    await expect(storage.presignedUploadUrl('references/1-guidelines.pdf')).resolves.toContain(
      'mock-storage.local/uploads/references/1-guidelines.pdf',
    );
  });

  it('issues real presigned PUT URLs once S3 is configured', async () => {
    const storage = makeService({
      'app.nodeEnv': 'development',
      'storage.bucket': 'grub-media',
      'storage.region': 'ap-south-1',
      'storage.accessKeyId': 'key',
      'storage.secretAccessKey': 'secret',
    });
    expect(storage.isConfigured).toBe(true);
    const url = await storage.presignedUploadUrl('references/x.pdf');
    expect(url).toContain('grub-media.s3.ap-south-1.amazonaws.com/references/x.pdf');
    expect(url).toContain('X-Amz-Signature=');
  });

  it('builds sanitized, collision-safe bucket keys', () => {
    const storage = makeService({ 'app.nodeEnv': 'development' });
    const key = storage.buildKey('references', 'CPC Guidelines  (2026)/Chapter 1', 'pdf');
    expect(key).toMatch(/^references\/\d+-CPC-Guidelines-2026-Chapter-1\.pdf$/);
  });

  it('normalizes finalize keys to full bucket URLs in production', () => {
    const storage = makeService({
      'app.nodeEnv': 'development',
      'storage.bucket': 'grub-media',
      'storage.region': 'ap-south-1',
      'storage.accessKeyId': 'key',
      'storage.secretAccessKey': 'secret',
    });
    expect(storage.resolveCreativeFileUrl('agency/x.png')).toBe(
      'https://grub-media.s3.ap-south-1.amazonaws.com/agency/x.png',
    );
    expect(
      storage.resolveCreativeFileUrl('https://grub-media.s3.ap-south-1.amazonaws.com/agency/x.png'),
    ).toBe('https://grub-media.s3.ap-south-1.amazonaws.com/agency/x.png');
    expect(() => storage.resolveCreativeFileUrl('')).toThrow(/s3_key is required/);
    expect(() => storage.resolveCreativeFileUrl('https://evil.example.com/x.png')).toThrow(
      /configured media bucket/,
    );
    expect(() => storage.resolveCreativeFileUrl('../escape.png')).toThrow(/relative bucket key/);
  });

  it('accepts any file URL outside production', () => {
    const storage = makeService({ 'app.nodeEnv': 'development' });
    expect(() =>
      storage.assertFileUrlAllowed('https://evil.example.com/payload.pdf'),
    ).not.toThrow();
  });

  it('enforces the approved media bucket in production', () => {
    const storage = makeService({
      'app.nodeEnv': 'production',
      'storage.bucket': 'grubpac-media',
      'storage.region': 'ap-south-1',
    });
    expect(() =>
      storage.assertFileUrlAllowed(
        'https://grubpac-media.s3.ap-south-1.amazonaws.com/references/x.pdf',
      ),
    ).not.toThrow();
    expect(() => storage.assertFileUrlAllowed('https://evil.example.com/payload.pdf')).toThrow(
      /approved media bucket/,
    );
    expect(() => storage.assertFileUrlAllowed('not a url')).toThrow(/valid URL/);
  });

  it('enforces the 99 MB upload limit', () => {
    const storage = makeService({ 'app.nodeEnv': 'development' });
    expect(() => storage.assertFileSizeAllowed(undefined)).not.toThrow();
    expect(() => storage.assertFileSizeAllowed(1024)).not.toThrow();
    expect(() => storage.assertFileSizeAllowed(REFERENCE_MAX_FILE_BYTES)).not.toThrow();
    expect(() => storage.assertFileSizeAllowed(REFERENCE_MAX_FILE_BYTES + 1)).toThrow(/99 MB/);
    expect(() => storage.assertFileSizeAllowed(0)).toThrow(/positive integer/);
  });

  it('extracts bucket keys from stored file URLs', () => {
    const storage = makeService({ 'app.nodeEnv': 'development' });
    expect(
      storage.extractKeyFromUrl(
        'https://grub-media.s3.ap-south-1.amazonaws.com/references/1-guidelines.pdf',
      ),
    ).toBe('references/1-guidelines.pdf');
    expect(storage.extractKeyFromUrl('not a url')).toBeNull();
  });

  it('returns mock download URLs without S3 credentials', async () => {
    const storage = makeService({ 'app.nodeEnv': 'development' });
    await expect(storage.presignedDownloadUrl('references/1.pdf', 'CPC.pdf')).resolves.toContain(
      'mock-storage.local/downloads/references/1.pdf',
    );
    await expect(storage.getObjectSize('references/1.pdf')).resolves.toBeNull();
  });

  it('builds ready-to-store public URLs from keys', () => {
    const storage = makeService({
      'app.nodeEnv': 'development',
      'storage.bucket': 'grub-media',
      'storage.region': 'ap-south-1',
      'storage.accessKeyId': 'key',
      'storage.secretAccessKey': 'secret',
    });
    expect(storage.publicUrlForKey('references/1.pdf')).toBe(
      'https://grub-media.s3.ap-south-1.amazonaws.com/references/1.pdf',
    );
  });

  it('resolves finalize file_key input to canonical URLs', () => {
    const storage = makeService({
      'app.nodeEnv': 'development',
      'storage.bucket': 'grub-media',
      'storage.region': 'ap-south-1',
      'storage.accessKeyId': 'key',
      'storage.secretAccessKey': 'secret',
    });
    expect(storage.resolveStoredFileUrl('references/1.pdf')).toBe(
      'https://grub-media.s3.ap-south-1.amazonaws.com/references/1.pdf',
    );
    // A pasted presigned upload_url still resolves to the permanent object URL.
    expect(
      storage.resolveStoredFileUrl(
        'https://grub-media.s3.ap-south-1.amazonaws.com/references/1.pdf?X-Amz-Signature=abc',
      ),
    ).toBe('https://grub-media.s3.ap-south-1.amazonaws.com/references/1.pdf');
    expect(() => storage.resolveStoredFileUrl('   ')).toThrow(/must not be empty/);
  });

  it('strips query strings and fragments from URLs', () => {
    expect(stripUrlQuery('https://cdn.test/a.pdf?x=1#frag')).toBe('https://cdn.test/a.pdf');
    expect(stripUrlQuery('https://cdn.test/a.pdf')).toBe('https://cdn.test/a.pdf');
    expect(stripUrlQuery('not a url')).toBe('not a url');
  });
});
