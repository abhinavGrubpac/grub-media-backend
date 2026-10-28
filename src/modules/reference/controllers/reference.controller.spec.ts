import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from '../services/reference.service';

/**
 * Regression guard for the bulk-route shadowing bug: `DELETE /:id` is a
 * single-segment dynamic route, so any static DELETE path declared after it
 * would be treated as a document id. These tests pin the routing contract for
 * both the canonical POST bulk routes and their DELETE aliases.
 */
describe('ReferenceController bulk routes', () => {
  let app: INestApplication;
  const service = {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    downloadUrl: jest.fn().mockResolvedValue({ download_url: 'u', file_url: 'f' }),
    generateUploadUrl: jest.fn().mockResolvedValue({}),
    finalizeUpload: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    archive: jest.fn().mockResolvedValue({ id: 'doc-1', is_archived: true }),
    restore: jest.fn().mockResolvedValue({ id: 'doc-1', is_archived: false }),
    hardDelete: jest.fn().mockResolvedValue(undefined),
    bulkArchive: jest.fn().mockResolvedValue({ archived: 1 }),
    bulkRestore: jest.fn().mockResolvedValue({ restored: 1 }),
    restoreAll: jest.fn().mockResolvedValue({ restored: 1 }),
    bulkHardDelete: jest.fn().mockResolvedValue({ deleted: 1, skipped: [] }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReferenceController],
      providers: [{ provide: ReferenceService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('DELETE /references/bulk-hard-delete reaches the bulk handler, not archive(:id)', async () => {
    await request(app.getHttpServer())
      .delete('/references/bulk-hard-delete')
      .send({ ids: ['doc-1'] })
      .expect(200);

    expect(service.bulkHardDelete).toHaveBeenCalledWith(['doc-1']);
    expect(service.archive).not.toHaveBeenCalled();
  });

  it('POST /references/bulk-hard-delete keeps working', async () => {
    await request(app.getHttpServer())
      .post('/references/bulk-hard-delete')
      .send({ ids: ['doc-1'] })
      .expect(200);

    expect(service.bulkHardDelete).toHaveBeenCalledWith(['doc-1']);
  });

  it('DELETE /references/bulk-archive reaches the bulk handler, not archive(:id)', async () => {
    await request(app.getHttpServer())
      .delete('/references/bulk-archive')
      .send({ ids: ['doc-1'] })
      .expect(200);

    expect(service.bulkArchive).toHaveBeenCalledWith(['doc-1']);
    expect(service.archive).not.toHaveBeenCalled();
  });

  it('POST /references/bulk-archive keeps working', async () => {
    await request(app.getHttpServer())
      .post('/references/bulk-archive')
      .send({ ids: ['doc-1'] })
      .expect(200);

    expect(service.bulkArchive).toHaveBeenCalledWith(['doc-1']);
  });

  it('DELETE /references/:id still archives a single document', async () => {
    await request(app.getHttpServer()).delete('/references/doc-1').expect(200);

    expect(service.archive).toHaveBeenCalledWith('doc-1');
    expect(service.bulkHardDelete).not.toHaveBeenCalled();
  });

  it('DELETE /references/:id/permanent still hard-deletes a single document', async () => {
    await request(app.getHttpServer()).delete('/references/doc-1/permanent').expect(200);

    expect(service.hardDelete).toHaveBeenCalledWith('doc-1');
  });

  it('rejects a bulk selection without ids', async () => {
    await request(app.getHttpServer())
      .delete('/references/bulk-hard-delete')
      .send({ ids: [] })
      .expect(400);

    expect(service.bulkHardDelete).not.toHaveBeenCalled();
  });
});
