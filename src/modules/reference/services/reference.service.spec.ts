import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { parsePublishedOn, ReferenceService } from './reference.service';

const docRow = {
  id: 'doc1',
  title: 'CPC Guidelines',
  fileUrl: 'https://grubpac-media.s3.ap-south-1.amazonaws.com/references/1.pdf',
  fileSizeBytes: 1024,
  category: 'Regulatory',
  description: 'Central rates',
  publishedOn: new Date('2026-01-01T00:00:00Z'),
  isArchived: false,
  archivedOn: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

function makeDeps() {
  const referenceDoc = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const creativeVersion = { findUnique: jest.fn().mockResolvedValue(null) };
  const creativeReference = {
    create: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  };
  const client = { referenceDoc, creativeVersion, creativeReference };
  const prisma = {
    client,
    $transaction: jest.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  };
  const outbox = {
    emitInTx: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    buildKey: jest.fn().mockReturnValue('references/1-guidelines.pdf'),
    presignedUploadUrl: jest
      .fn()
      .mockResolvedValue('https://mock-storage.local/uploads/references/1-guidelines.pdf'),
    presignedDownloadUrl: jest.fn().mockResolvedValue('https://mock-storage.local/downloads/1.pdf'),
    publicUrlForKey: jest.fn((key: string) => `https://cdn.test/${key}`),
    resolveStoredFileUrl: jest.fn((input: string) => input),
    assertFileUrlAllowed: jest.fn(),
    assertFileSizeAllowed: jest.fn(),
    extractKeyFromUrl: jest.fn().mockReturnValue(null),
    getObjectSize: jest.fn().mockResolvedValue(null),
  };
  const service = new ReferenceService(prisma as never, outbox as never, storage as never);
  return { service, referenceDoc, creativeVersion, creativeReference, outbox, storage, client };
}

describe('parsePublishedOn', () => {
  it('passes undefined through to keep the field untouched', () => {
    expect(parsePublishedOn(undefined)).toBeUndefined();
  });

  it('maps null and empty strings to null', () => {
    expect(parsePublishedOn(null)).toBeNull();
    expect(parsePublishedOn('')).toBeNull();
  });

  it('parses valid dates and rejects garbage', () => {
    expect(parsePublishedOn('2026-01-15')).toEqual(new Date('2026-01-15'));
    expect(() => parsePublishedOn('not-a-date')).toThrow(BadRequestException);
  });
});

describe('ReferenceService.findAll', () => {
  it('applies the tri-state archive filter and category', async () => {
    const { service, referenceDoc } = makeDeps();
    await service.findAll({ archived: 'false' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: false } }),
    );

    await service.findAll({ archived: 'true', category: 'Regulatory' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { category: { equals: 'Regulatory', mode: 'insensitive' }, isArchived: true },
      }),
    );

    await service.findAll({});
    expect(referenceDoc.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: {}, orderBy: { updatedAt: 'desc' } }),
    );
  });

  it('searches by document name (case-insensitive)', async () => {
    const { service, referenceDoc } = makeDeps();
    await service.findAll({ search: 'CPC' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { title: { contains: 'CPC', mode: 'insensitive' } },
      }),
    );
  });

  it('maps UI sort keys to Prisma orderBy without passthrough', async () => {
    const { service, referenceDoc } = makeDeps();
    await service.findAll({ sortBy: 'name', sortOrder: 'asc' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { title: 'asc' } }),
    );

    await service.findAll({ sortBy: 'published', sortOrder: 'desc' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { publishedOn: 'desc' } }),
    );

    await service.findAll({ sortBy: 'archived', sortOrder: 'desc' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { archivedOn: 'desc' } }),
    );

    await service.findAll({ sortBy: 'uploaded', sortOrder: 'asc' });
    expect(referenceDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
    );
  });
});

describe('ReferenceService.generateUploadUrl', () => {
  it('records an upload-intent event and returns a presigned target', async () => {
    const { service, outbox, storage } = makeDeps();

    const result = await service.generateUploadUrl(
      { title: 'CPC Guidelines', category: 'Regulatory' },
      'user1',
    );

    expect(storage.assertFileSizeAllowed).toHaveBeenCalledWith(undefined);
    expect(result.file_key).toContain('references/');
    expect(result.file_url).toBe('https://cdn.test/references/1-guidelines.pdf');
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'reference.upload_intent',
        entityId: 'pending',
        key: 'user1',
        actorId: 'user1',
      }),
    );
  });

  it('validates the declared 99 MB limit', async () => {
    const { service, storage } = makeDeps();
    storage.assertFileSizeAllowed.mockImplementation(() => {
      throw new BadRequestException('file_size_bytes must be 99 MB or less');
    });
    await expect(
      service.generateUploadUrl(
        { title: 'Big', category: 'Regulatory', file_size_bytes: 200 * 1024 * 1024 },
        'user1',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ReferenceService.finalizeUpload', () => {
  it('guards the file URL and emits reference.uploaded', async () => {
    const { service, referenceDoc, storage, outbox } = makeDeps();
    referenceDoc.create.mockResolvedValue(docRow);

    const response = await service.finalizeUpload({
      title: '  CPC Guidelines  ',
      category: 'Regulatory',
      file_url: docRow.fileUrl,
    });

    expect(storage.assertFileUrlAllowed).toHaveBeenCalledWith(docRow.fileUrl);
    expect(referenceDoc.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'CPC Guidelines' }) }),
    );
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'reference.uploaded' }),
    );
    expect(response.file_size_bytes).toBe(docRow.fileSizeBytes);
  });

  it('persists declared file sizes', async () => {
    const { service, referenceDoc } = makeDeps();
    referenceDoc.create.mockResolvedValue(docRow);

    await service.finalizeUpload({
      title: 'CPC Guidelines',
      category: 'Regulatory',
      file_url: docRow.fileUrl,
      file_size_bytes: 1024,
    });

    expect(referenceDoc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileSizeBytes: 1024,
        }),
      }),
    );
  });

  it('rejects stored objects larger than 99 MB', async () => {
    const { service, referenceDoc, storage } = makeDeps();
    referenceDoc.create.mockResolvedValue(docRow);
    storage.extractKeyFromUrl.mockReturnValue('references/big.pdf');
    storage.getObjectSize.mockResolvedValue(100 * 1024 * 1024);

    await expect(
      service.finalizeUpload({ title: 'Big', category: 'Regulatory', file_url: docRow.fileUrl }),
    ).rejects.toThrow(/99 MB/);
  });

  it('rejects blank titles after trimming', async () => {
    const { service } = makeDeps();
    await expect(
      service.finalizeUpload({ title: '   ', category: 'Regulatory', file_url: 'https://x/y.pdf' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts file_key instead of file_url', async () => {
    const { service, referenceDoc, storage } = makeDeps();
    referenceDoc.create.mockResolvedValue(docRow);
    storage.resolveStoredFileUrl.mockReturnValue('https://cdn.test/references/1-guidelines.pdf');

    await service.finalizeUpload({
      title: 'CPC Guidelines',
      category: 'Regulatory',
      file_key: 'references/1-guidelines.pdf',
    });

    expect(storage.resolveStoredFileUrl).toHaveBeenCalledWith('references/1-guidelines.pdf');
    expect(referenceDoc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileUrl: 'https://cdn.test/references/1-guidelines.pdf' }),
      }),
    );
  });

  it('requires file_key or file_url', async () => {
    const { service } = makeDeps();
    await expect(
      service.finalizeUpload({ title: 'CPC Guidelines', category: 'Regulatory' }),
    ).rejects.toThrow(/file_key or file_url/);
  });
});

describe('ReferenceService.archive / restore', () => {
  it('archives softly with archived_on and emits reference.archived', async () => {
    const { service, referenceDoc, outbox } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue(docRow);
    referenceDoc.update.mockResolvedValue({ ...docRow, isArchived: true, archivedOn: new Date() });

    const response = await service.archive('doc1');

    expect(referenceDoc.update).toHaveBeenCalledWith({
      where: { id: 'doc1' },
      data: expect.objectContaining({ isArchived: true }),
    });
    expect(response.is_archived).toBe(true);
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'reference.archived' }),
    );
  });

  it('restore clears archived_on and emits reference.unarchived', async () => {
    const { service, referenceDoc, outbox } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue({
      ...docRow,
      isArchived: true,
      archivedOn: new Date(),
    });
    referenceDoc.update.mockResolvedValue(docRow);

    const response = await service.restore('doc1');

    expect(referenceDoc.update).toHaveBeenCalledWith({
      where: { id: 'doc1' },
      data: { isArchived: false, archivedOn: null },
    });
    expect(response.is_archived).toBe(false);
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'reference.unarchived' }),
    );
  });

  it('bulk-restore unarchives a selection at once', async () => {
    const { service, referenceDoc, outbox } = makeDeps();
    referenceDoc.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.bulkRestore(['a', 'b']);

    expect(referenceDoc.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['a', 'b'] }, isArchived: true } }),
    );
    expect(result).toEqual({ restored: 2 });
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'reference.bulk_restored' }),
    );
  });

  it('restore-all unarchives every archived document', async () => {
    const { service, referenceDoc } = makeDeps();
    referenceDoc.updateMany.mockResolvedValue({ count: 5 });

    const result = await service.restoreAll({});

    expect(referenceDoc.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isArchived: true }) }),
    );
    expect(result).toEqual({ restored: 5 });
  });

  it('rejects empty bulk-restore selections', async () => {
    const { service } = makeDeps();
    await expect(service.bulkRestore([])).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound for unknown documents', async () => {
    const { service, referenceDoc } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue(null);
    await expect(service.archive('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('ReferenceService.hardDelete', () => {
  it('permanently deletes unlinked documents', async () => {
    const { service, referenceDoc, creativeReference, outbox } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue(docRow);
    creativeReference.count.mockResolvedValue(0);

    await service.hardDelete('doc1');

    expect(referenceDoc.delete).toHaveBeenCalledWith({ where: { id: 'doc1' } });
    expect(outbox.emitInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'reference.deleted' }),
    );
  });

  it('blocks deletes that would orphan review justifications', async () => {
    const { service, referenceDoc, creativeReference } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue(docRow);
    creativeReference.count.mockResolvedValue(2);

    await expect(service.hardDelete('doc1')).rejects.toThrow(ConflictException);
  });
});

describe('ReferenceService.downloadUrl', () => {
  it('returns a presigned download target for the stored file', async () => {
    const { service, referenceDoc, storage } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue(docRow);
    storage.extractKeyFromUrl.mockReturnValue('references/1.pdf');

    const result = await service.downloadUrl('doc1');

    expect(storage.presignedDownloadUrl).toHaveBeenCalledWith(
      'references/1.pdf',
      expect.stringContaining('CPC'),
    );
    expect(result.file_url).toBe(docRow.fileUrl);
  });

  it('throws NotFound for unknown documents', async () => {
    const { service, referenceDoc } = makeDeps();
    referenceDoc.findUnique.mockResolvedValue(null);
    await expect(service.downloadUrl('missing')).rejects.toThrow(NotFoundException);
  });
});
