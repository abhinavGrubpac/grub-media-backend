import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Prisma, ReferenceDoc } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { EventOutboxService } from '../../events/event.outbox';
import { EventTypes } from '../../events/events.constants';
import { ReferenceDocResponseDto } from '../dto/reference-response.dto';
import { ReferenceFinalizeDto } from '../dto/reference-finalize.dto';
import {
  REFERENCE_SORT_KEYS,
  ReferenceListQueryDto,
  ReferenceSortKey,
} from '../dto/reference-list-query.dto';
import { ReferenceUpdateDto } from '../dto/reference-update.dto';
import { ReferenceUploadUrlDto } from '../dto/reference-upload-url.dto';
import { REFERENCE_MAX_FILE_BYTES, StorageService, isS3NotFound } from './storage.service';

export interface ReferenceCreateInput {
  title: string;
  category: string;
  file_url: string;
  file_size_bytes?: number | null;
  description?: string | null;
  published_on?: string | null;
}

export interface ReferenceUpdateInput {
  title?: string;
  category?: string;
  file_url?: string;
  description?: string | null;
  published_on?: string | null;
}

/**
 * Normalises published_on: undefined keeps the field untouched, null/'' clears
 * it, anything else must parse as a date.
 */
export function parsePublishedOn(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('published_on must be a valid date');
  }
  return date;
}

/** UI sort key -> Prisma orderBy. Allowlisted so arbitrary input never reaches Prisma. */
const REFERENCE_ORDER_BY: Record<ReferenceSortKey, Prisma.ReferenceDocOrderByWithRelationInput> = {
  name: { title: 'asc' },
  published: { publishedOn: 'asc' },
  archived: { archivedOn: 'asc' },
  uploaded: { createdAt: 'asc' },
};

function resolveOrderBy(
  sortBy: ReferenceSortKey | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
): Prisma.ReferenceDocOrderByWithRelationInput {
  const order = sortOrder ?? 'desc';
  if (!sortBy || !REFERENCE_SORT_KEYS.includes(sortBy)) return { updatedAt: 'desc' };
  const base = REFERENCE_ORDER_BY[sortBy];
  const field = Object.keys(base)[0] as keyof Prisma.ReferenceDocOrderByWithRelationInput;
  return { [field]: order } as Prisma.ReferenceDocOrderByWithRelationInput;
}

/**
 * Regulatory document library (REQUIREMENTS.md §3.3). Documents can be archived
 * (soft delete) for a reversible hidden state, or permanently deleted when the
 * user explicitly chooses Delete. Permanent deletion stays blocked while a doc
 * justifies a review decision so audit history is kept.
 * Reviewers link documents to creative versions to justify rejections.
 */
@Injectable()
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EventOutboxService,
    private readonly storage: StorageService,
  ) {}

  /** Tri-state archive filter + name search + allowlisted sort for the UI tabs. */
  async findAll(query: ReferenceListQueryDto): Promise<ReferenceDocResponseDto[]> {
    const archived = query.archived === undefined ? undefined : query.archived === 'true';
    const search = query.search?.trim();
    const docs = await this.prisma.client.referenceDoc.findMany({
      where: {
        ...(query.category ? { category: { equals: query.category, mode: 'insensitive' } } : {}),
        ...(archived === undefined ? {} : { isArchived: archived }),
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: resolveOrderBy(query.sortBy, query.sortOrder),
    });
    return docs.map((doc) => this.toResponse(doc));
  }

  async findOne(id: string): Promise<ReferenceDocResponseDto> {
    const doc = await this.prisma.client.referenceDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Reference document ${id} not found`);
    return this.toResponse(doc);
  }

  /** View helper: returns the doc plus its renderable file URL. */
  async view(id: string): Promise<ReferenceDocResponseDto> {
    return this.findOne(id);
  }

  /** Download helper: presigned GET (attachment) with the stored URL as fallback. */
  async downloadUrl(id: string): Promise<{ download_url: string; file_url: string }> {
    const doc = await this.prisma.client.referenceDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Reference document ${id} not found`);
    const key = this.storage.extractKeyFromUrl(doc.fileUrl);
    const downloadUrl = key
      ? await this.storage.presignedDownloadUrl(key, `${doc.title}.pdf`)
      : doc.fileUrl;
    return { download_url: downloadUrl, file_url: doc.fileUrl };
  }

  /**
   * Issues a presigned upload target and records a reference.upload_intent
   * ("ghost upload") so uncompleted uploads remain auditable.
   */
  async generateUploadUrl(
    dto: ReferenceUploadUrlDto,
    actorId: string,
  ): Promise<{ upload_url: string; file_key: string; file_url: string }> {
    this.storage.assertFileSizeAllowed(dto.file_size_bytes);
    await this.outbox.emit({
      eventType: 'reference.upload_intent',
      entityType: 'ReferenceDoc',
      entityId: 'pending',
      key: actorId,
      actorId,
      payload: {
        title: dto.title,
        category: dto.category,
        file_size_bytes: dto.file_size_bytes ?? null,
      },
    });
    const fileKey = this.storage.buildKey('references', dto.title, 'pdf');
    const uploadUrl = await this.storage.presignedUploadUrl(fileKey);
    // file_url is the permanent object URL — paste it straight into finalize.
    // upload_url is single-use SigV4 (expires in 15 min) for the PUT only.
    return {
      upload_url: uploadUrl,
      file_key: fileKey,
      file_url: this.storage.publicUrlForKey(fileKey),
    };
  }

  async finalizeUpload(dto: ReferenceFinalizeDto): Promise<ReferenceDocResponseDto> {
    const title = this.requireTrimmed(dto.title, 'title');
    const category = this.requireTrimmed(dto.category, 'category');
    // Easiest path: paste file_key from upload-url and the server builds the
    // URL. file_url also accepted (presigned query strings are stripped).
    const keyInput = dto.file_key?.trim() ? dto.file_key.trim() : null;
    const urlInput = dto.file_url?.trim() ? dto.file_url.trim() : null;
    if (!keyInput && !urlInput) {
      throw new BadRequestException('Provide file_key or file_url');
    }
    const fileUrl = this.storage.resolveStoredFileUrl((keyInput ?? urlInput) as string);
    this.storage.assertFileUrlAllowed(fileUrl);
    this.storage.assertFileSizeAllowed(dto.file_size_bytes);

    // Authoritative check against the stored object: declared size is
    // validated above, and the object MUST exist — finalizing a key that was
    // never uploaded used to create ghost rows whose download 404s (NoSuchKey).
    // Unreachable S3 stays fail-open (existing behavior); only a definitive
    // 404 is rejected.
    const key = this.storage.extractKeyFromUrl(fileUrl);
    if (key && this.storage.isConfigured) {
      let actual: number | null;
      try {
        actual = await this.storage.getObjectSize(key);
      } catch (err) {
        if (isS3NotFound(err)) {
          throw new BadRequestException(
            `No file uploaded yet for "${key}" — PUT the PDF to upload_url first, then finalize`,
          );
        }
        actual = null;
      }
      if (actual !== null && actual > REFERENCE_MAX_FILE_BYTES) {
        throw new BadRequestException(
          `file must be 99 MB or less (stored object is ${actual} bytes)`,
        );
      }
    }

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.referenceDoc.create({
        data: {
          title,
          category,
          fileUrl,
          fileSizeBytes: dto.file_size_bytes ?? null,
          description: dto.description?.trim() ? dto.description.trim() : null,
          publishedOn: (parsePublishedOn(dto.published_on ?? null) as Date | null) ?? null,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceUploaded,
        entityType: 'ReferenceDoc',
        entityId: created.id,
        key: created.id,
        payload: {
          doc_id: created.id,
          title: created.title,
          category: created.category,
          file_url: created.fileUrl,
          file_size_bytes: created.fileSizeBytes,
          description: created.description,
          published_on: created.publishedOn ? created.publishedOn.toISOString() : null,
        },
      });
      return created;
    });
    return this.toResponse(doc);
  }

  async update(id: string, dto: ReferenceUpdateDto): Promise<ReferenceDocResponseDto> {
    const existing = await this.prisma.client.referenceDoc.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Reference document ${id} not found`);
    // Archived docs are read-only history for past review decisions — restore
    // first so edits cannot rewrite the justification record in place.
    if (existing.isArchived) {
      throw new ConflictException(`Reference document ${id} is archived; restore before editing`);
    }

    if (dto.title !== undefined) this.requireTrimmed(dto.title, 'title');
    if (dto.category !== undefined) this.requireTrimmed(dto.category, 'category');
    if (dto.file_url !== undefined) this.storage.assertFileUrlAllowed(dto.file_url);

    const data: Prisma.ReferenceDocUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
      ...(dto.file_url !== undefined ? { fileUrl: dto.file_url } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() ? dto.description.trim() : null }
        : {}),
      ...(dto.published_on !== undefined
        ? { publishedOn: parsePublishedOn(dto.published_on) ?? null }
        : {}),
    };

    const doc = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.referenceDoc.update({ where: { id }, data });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceUpdated,
        entityType: 'ReferenceDoc',
        entityId: updated.id,
        key: updated.id,
        payload: {
          doc_id: updated.id,
          oldValue: {
            title: existing.title,
            category: existing.category,
            file_url: existing.fileUrl,
            description: existing.description,
          },
          newValue: {
            title: updated.title,
            category: updated.category,
            file_url: updated.fileUrl,
            description: updated.description,
          },
        },
      });
      return updated;
    });
    return this.toResponse(doc);
  }

  /** Soft delete: archived documents stay queryable for past reviews. */
  async archive(id: string): Promise<ReferenceDocResponseDto> {
    const doc = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.referenceDoc.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Reference document ${id} not found`);
      if (existing.isArchived) {
        throw new ConflictException(`Reference document ${id} is already archived`);
      }
      const archived = await tx.referenceDoc.update({
        where: { id },
        data: { isArchived: true, archivedOn: new Date() },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceArchived,
        entityType: 'ReferenceDoc',
        entityId: archived.id,
        key: archived.id,
        payload: {
          doc_id: archived.id,
          title: archived.title,
          archived_on: archived.archivedOn?.toISOString() ?? null,
        },
      });
      return archived;
    });
    return this.toResponse(doc);
  }

  async restore(id: string): Promise<ReferenceDocResponseDto> {
    const doc = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.referenceDoc.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Reference document ${id} not found`);
      if (!existing.isArchived) {
        throw new ConflictException(`Reference document ${id} is not archived`);
      }
      const restored = await tx.referenceDoc.update({
        where: { id },
        data: { isArchived: false, archivedOn: null },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceUnarchived,
        entityType: 'ReferenceDoc',
        entityId: restored.id,
        key: restored.id,
        payload: { doc_id: restored.id, title: restored.title },
      });
      return restored;
    });
    return this.toResponse(doc);
  }

  /**
   * Archives an explicit selection at once (documents tab multi-select):
   * the counterpart of bulk-restore, replacing N × DELETE /:id with one call.
   * Already-archived and missing ids are simply excluded from the write and
   * reflected in the returned counts (no batch failure), and the whole
   * selection commits in ONE transaction with a single bulk event.
   */
  async bulkArchive(ids: string[]): Promise<{ archived: number }> {
    if (!ids.length) throw new BadRequestException('ids must not be empty');
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.referenceDoc.updateMany({
        where: { id: { in: ids }, isArchived: false },
        data: { isArchived: true, archivedOn: new Date() },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceBulkArchived,
        entityType: 'ReferenceDoc',
        entityId: 'bulk',
        key: 'bulk',
        payload: { doc_ids: ids, archived: updated.count },
      });
      return updated;
    });
    return { archived: result.count };
  }

  /** Unarchives an explicit selection at once (archived tab multi-select). */
  async bulkRestore(ids: string[]): Promise<{ restored: number }> {
    if (!ids.length) throw new BadRequestException('ids must not be empty');
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.referenceDoc.updateMany({
        where: { id: { in: ids }, isArchived: true },
        data: { isArchived: false, archivedOn: null },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceBulkRestored,
        entityType: 'ReferenceDoc',
        entityId: 'bulk',
        key: 'bulk',
        payload: { doc_ids: ids, restored: updated.count },
      });
      return updated;
    });
    return { restored: result.count };
  }

  /** Unarchives every archived document at once (optionally filtered). */
  async restoreAll(filter?: { category?: string; search?: string }): Promise<{ restored: number }> {
    const search = filter?.search?.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.referenceDoc.updateMany({
        where: {
          isArchived: true,
          ...(filter?.category
            ? { category: { equals: filter.category, mode: 'insensitive' } }
            : {}),
          ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
        },
        data: { isArchived: false, archivedOn: null },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceBulkRestored,
        entityType: 'ReferenceDoc',
        entityId: 'all',
        key: 'all',
        payload: { restored: updated.count, filter: filter ?? {} },
      });
      return updated;
    });
    return { restored: result.count };
  }

  /**
   * Permanently deletes a document whether it is active or archived. Blocked
   * while the doc justifies a review decision (CreativeReference exists) so
   * audit history is kept.
   */
  async hardDelete(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.referenceDoc.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Reference document ${id} not found`);
      const links = await tx.creativeReference.count({ where: { docId: id } });
      if (links > 0) {
        throw new ConflictException(
          `Reference document ${id} justifies ${links} review decision(s) and cannot be permanently deleted`,
        );
      }
      await tx.referenceDoc.delete({ where: { id } });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.referenceDeleted,
        entityType: 'ReferenceDoc',
        entityId: id,
        key: id,
        payload: { doc_id: id, title: existing.title },
      });
    });
  }

  /**
   * Multi-select permanent delete from either tab: replaces N ×
   * DELETE /:id/permanent with one request. Every id is applied through the
   * standard single-doc path — identical guard (refusal while the doc justifies
   * review decisions) — and rows that fail are skipped with a per-id reason
   * instead of failing the batch.
   */
  async bulkHardDelete(
    ids: string[],
  ): Promise<{ deleted: number; skipped: { id: string; reason: string }[] }> {
    if (!ids.length) throw new BadRequestException('ids must not be empty');
    const skipped: { id: string; reason: string }[] = [];
    let deleted = 0;
    for (const id of [...new Set(ids)]) {
      try {
        await this.hardDelete(id);
        deleted += 1;
      } catch (error) {
        skipped.push({
          id,
          reason:
            error instanceof HttpException ? error.message : 'unexpected error deleting the doc',
        });
      }
    }
    return { deleted, skipped };
  }

  private requireTrimmed(value: string, field: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new BadRequestException(`${field} must not be empty`);
    return trimmed;
  }

  private toResponse(doc: ReferenceDoc): ReferenceDocResponseDto {
    return plainToInstance(
      ReferenceDocResponseDto,
      {
        id: doc.id,
        title: doc.title,
        file_url: doc.fileUrl,
        file_size_bytes: (doc as { fileSizeBytes?: number | null }).fileSizeBytes ?? null,
        category: doc.category,
        description: doc.description,
        published_on: doc.publishedOn,
        is_archived: doc.isArchived,
        archived_on: doc.archivedOn,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
      },
      { excludeExtraneousValues: true },
    );
  }
}
