import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AgencyRef, Prisma, ReviewStatus } from '@prisma/client';
import { StandardMeta, standardMeta, toSkipTake } from '../../../common/utils/paginate';
import { PrismaService } from '../../../database/prisma.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { isS3NotFound, StorageService } from '../../../common/storage/storage.service';
import { assertBrandActive } from '../../../common/utils/brand';
import { AdvertService } from '../../advert/services/advert.service';
import { EventOutboxService } from '../../events/event.outbox';
import { EventTypes } from '../../events/events.constants';
import { CreativeQueryDto } from '../dto/creative-query.dto';
import {
  CreativeResponseDto,
  CreativeScheduleSummaryDto,
  CreativeVersionResponseDto,
  ReviewActionResponseDto,
} from '../dto/creative-response.dto';
import { CreateCreativeDto } from '../dto/create-creative.dto';
import { UploadVersionDto } from '../dto/upload-version.dto';
import {
  actionTypeFor,
  assertActionableStatus,
  assertValidMediaType,
  assertValidTakeAction,
  assertValidTransition,
  assertWithdrawable,
  isVersionDerivedSort,
  normalizeCreativeStatusFilter,
  statusForAction,
} from '../transitions';

export interface TakeActionInput {
  action: string;
  comments?: string;
  reason?: string;
  expectedVersion?: number;
}

export interface CreativeListFilters {
  status?: string;
  brand_id?: string;
  search?: string;
  industry?: string;
  startDate?: string;
  endDate?: string;
  actor_id?: string;
  ids?: string[];
}

function dayStart(value: string): Date {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dayEnd(value: string): Date {
  const d = new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Shared list/export predicate. All version-level conditions (upload window,
 * actor) merge into a single `versions.some` so one version must satisfy them
 * together. Status is special: a creative belongs to exactly one status
 * section, so callers resolve the ids of creatives whose *current* (latest)
 * version has that status and pass them as `currentVersionIds`. This keeps
 * pagination totals at one row per creative instead of counting every
 * historical version that ever carried the status.
 */
export function buildCreativeWhere(
  filters: CreativeListFilters,
  options: { currentVersionIds?: string[] } = {},
): Prisma.CreativeWhereInput {
  const status = normalizeCreativeStatusFilter(filters.status);

  let createdAt: { gte?: Date; lte?: Date } | undefined;
  if (filters.startDate || filters.endDate) {
    const gte = filters.startDate ? dayStart(filters.startDate) : undefined;
    const lte = filters.endDate ? dayEnd(filters.endDate) : undefined;
    if ((gte && Number.isNaN(gte.getTime())) || (lte && Number.isNaN(lte.getTime()))) {
      throw new BadRequestException('Invalid startDate or endDate');
    }
    createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  }

  const versionMatch: Record<string, unknown> = {
    ...(createdAt ? { createdAt } : {}),
    ...(filters.actor_id ? { actions: { some: { actorId: filters.actor_id } } } : {}),
  };

  const andClauses: Prisma.CreativeWhereInput[] = [];
  if (filters.ids?.length) andClauses.push({ id: { in: filters.ids } });
  if (status) {
    andClauses.push(
      options.currentVersionIds !== undefined
        ? { currentVersionId: { in: options.currentVersionIds } }
        : // Backwards-compatible fallback for direct callers that have not
          // resolved current-version ids yet.
          { versions: { some: { status } } },
    );
  }

  return {
    ...(andClauses.length === 1 ? andClauses[0] : andClauses.length ? { AND: andClauses } : {}),
    ...(filters.brand_id ? { brandId: filters.brand_id } : {}),
    ...(filters.search ? { creativeName: { contains: filters.search, mode: 'insensitive' } } : {}),
    ...(filters.industry
      ? { brand: { is: { industryCategory: { equals: filters.industry, mode: 'insensitive' } } } }
      : {}),
    ...(Object.keys(versionMatch).length ? { versions: { some: versionMatch } } : {}),
  } as Prisma.CreativeWhereInput;
}

/**
 * Version ids of creatives whose current version carries `status`.
 *
 * `Creative.currentVersionId` is advanced on every upload, so joining through
 * it yields exactly one row per creative. Raw SQL is used because Prisma
 * cannot compare a relation back to a scalar column in a single `where`.
 */
export async function currentVersionIdsForStatus(
  prisma: PrismaService,
  status: ReviewStatus,
): Promise<string[]> {
  const rows = await prisma.client.$queryRaw<Array<{ id: string | null }>>(
    Prisma.sql`
      SELECT c."current_version_id" AS "id"
      FROM "Creative" c
      INNER JOIN "CreativeVersion" v ON v."id" = c."current_version_id"
      WHERE v."status" = ${status}::"ReviewStatus"
    `,
  );
  return rows.map((row) => row.id).filter((id): id is string => Boolean(id));
}

type ListedCreative = CreativeResponseDto & { versions?: CreativeVersionResponseDto[] };

function sortListed(
  items: ListedCreative[],
  sortBy: string,
  order: 'asc' | 'desc',
): ListedCreative[] {
  const dir = order === 'asc' ? 1 : -1;
  const valueOf = (row: ListedCreative): string | number => {
    if (sortBy === 'brand_name') return row.brand?.brand_name ?? '';
    const raw =
      sortBy === 'uploaded_on'
        ? row.latest_version?.created_at
        : sortBy === 'last_action_at'
          ? row.last_action_at
          : row.created_at;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  return [...items].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb)) * dir;
    }
    return (va - vb) * dir;
  });
}

export interface CreativeUpstreamInput {
  upstream_creative_id: string;
  upstream_agency_id: string;
  upstream_brand_id: string;
  creative_name: string;
  campaign_ref?: string | null;
  upstream_portal?: string;
}

export interface WithdrawVersionInput {
  upstream_version_id?: string;
  version_id?: string;
  reason?: string;
  upstream_event_id?: string;
  upstream_portal?: string;
}

const REVIEW_EVENT_BY_ACTION = {
  APPROVE: EventTypes.reviewApproved,
  REJECT: EventTypes.reviewRejected,
  HOLD: EventTypes.reviewOnHold,
  REQUEST_CHANGES: EventTypes.reviewNeedsChanges,
  RESUME: EventTypes.reviewResumed,
} as const;

type CreativeWithBrandAndVersions = Prisma.CreativeGetPayload<{
  include: { brand: true; versions: { include: { actions: true } } };
}>;

/**
 * Creative review lifecycle (REQUIREMENTS.md §3.1, WORKFLOWS.md §1).
 *
 * Operator actions derive the actor from the JWT (never from the request
 * body) so the ReviewAction trail cannot be spoofed. Upstream-facing methods
 * (upsertThread / uploadVersion / withdrawVersion) are idempotent on
 * upstream_*_id and are the service contract for the future intake module.
 */
@Injectable()
export class CreativeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EventOutboxService,
    private readonly activity: ActivityLogService,
    private readonly storage: StorageService,
    private readonly adverts: AdvertService,
  ) {}

  async findAll(query: CreativeQueryDto): Promise<{
    items: (CreativeResponseDto & { versions?: CreativeVersionResponseDto[] })[];
    meta: StandardMeta;
  }> {
    const { skip, take } = toSkipTake(query);
    const sortBy = query.sort_by ?? query.sortBy;
    const order = query.sort_order ?? query.sortOrder ?? 'desc';
    const status = normalizeCreativeStatusFilter(query.status);
    const currentVersionIds = status
      ? await currentVersionIdsForStatus(this.prisma, status)
      : undefined;
    const where = buildCreativeWhere(
      {
        status: query.status,
        brand_id: query.brand_id,
        search: query.search,
        industry: query.industry,
        startDate: query.startDate,
        endDate: query.endDate,
        actor_id: query.actor_id,
        ids: query.ids,
      },
      status ? { currentVersionIds } : {},
    );
    // Version-derived sorts (uploaded_on/last_action_at) cannot be pushed to
    // Prisma (to-many ordering), so filter in the DB, enrich, then sort and
    // slice in memory. created_at/brand_name sort in the database.
    const versionSort = !!sortBy && isVersionDerivedSort(sortBy);
    const orderBy = versionSort
      ? { createdAt: 'desc' as const }
      : sortBy === 'brand_name'
        ? { brand: { brandName: order } }
        : { createdAt: order };
    const versionsInclude = {
      orderBy: { versionNumber: 'desc' as const },
      take: 1,
      include: { actions: { orderBy: { createdAt: 'desc' as const }, take: 1 } },
    };
    let creatives: Prisma.CreativeGetPayload<{
      include: { brand: true; versions: { include: { actions: true } } };
    }>[];
    let total: number;
    if (versionSort) {
      creatives = await this.prisma.client.creative.findMany({
        where,
        orderBy,
        include: { brand: true, versions: versionsInclude },
      });
      total = creatives.length;
    } else {
      [creatives, total] = await Promise.all([
        this.prisma.client.creative.findMany({
          where,
          orderBy,
          skip,
          take,
          include: { brand: true, versions: versionsInclude },
        }),
        this.prisma.client.creative.count({ where }),
      ]);
    }

    // ?include=history merges list + per-row history calls into one request:
    // one batched versions query instead of N round-trips from the UI.
    const threadVersions =
      query.include === 'history' && creatives.length > 0
        ? await this.prisma.client.creativeVersion.findMany({
            where: { creativeId: { in: creatives.map((creative) => creative.id) } },
            orderBy: [{ creativeId: 'asc' }, { versionNumber: 'desc' }],
            include: { actions: { orderBy: { createdAt: 'asc' } } },
          })
        : [];
    const threadsByCreative = new Map<string, typeof threadVersions>();
    for (const version of threadVersions) {
      const list = threadsByCreative.get(version.creativeId) ?? [];
      list.push(version);
      threadsByCreative.set(version.creativeId, list);
    }

    const creativeIds = creatives.map((creative) => creative.id);
    const [agencies, latestActions, creativeGeo, sizeTotals] = await Promise.all([
      this.fetchAgencies(
        creatives.map((creative) => creative.upstreamAgencyId ?? creative.brand.upstreamAgencyId),
      ),
      this.fetchLatestActions(creativeIds),
      this.fetchCreativeGeo(creativeIds),
      this.fetchCreativeSizeTotals(creativeIds),
    ]);
    const actorNames = await this.resolveActorNames([
      ...this.collectActorIds([
        ...creatives.flatMap((creative) => creative.versions),
        ...threadVersions,
      ]),
      ...this.collectRowIds(creatives),
      ...Array.from(latestActions.values()).map((action) => action.actorId),
    ]);
    const data = creatives.map((creative) => {
      // The root "last action" reflects the newest review across the whole
      // thread. A newly uploaded (usually PENDING) version can have no action
      // while the previous version still carries the latest review.
      const latestAction =
        latestActions.get(creative.id) ?? creative.versions[0]?.actions[0] ?? null;
      const response = this.toCreativeResponse(
        creative,
        actorNames,
        agencies,
        latestAction,
        sizeTotals.get(creative.id) ?? null,
      );
      const geo = creativeGeo.get(creative.id);
      return {
        ...response,
        location: geo?.location ?? response.location ?? null,
        targeted_regions: geo?.regions ?? [],
        ...(query.include === 'history'
          ? {
              versions: (threadsByCreative.get(creative.id) ?? []).map((version) =>
                this.toVersionResponse(version, actorNames),
              ),
            }
          : {}),
      };
    });
    if (versionSort && sortBy) {
      const sorted = sortListed(data, sortBy, order);
      const page = sorted.slice(skip, skip + take);
      return { items: page, meta: standardMeta(total, query.page, query.limit, page.length) };
    }
    return { items: data, meta: standardMeta(total, query.page, query.limit, data.length) };
  }

  async createCreative(dto: CreateCreativeDto, actorId: string): Promise<CreativeResponseDto> {
    const brand = await this.prisma.client.brand.findUnique({ where: { id: dto.brand_id } });
    if (!brand) throw new NotFoundException(`Brand with ID ${dto.brand_id} not found`);
    // WORKFLOWS.md §2.3 preventative: killed brands accept no new creatives.
    assertBrandActive(brand.isActive, brand.id);
    if (dto.initial_version) assertValidMediaType(dto.initial_version.media_type);

    // Optional initial_version merges create + upload-version into one atomic
    // call (same auto-approve + idempotency rules as uploadVersion).
    const autoApprove = brand.autoApprove === true;
    const initialStatus = autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING;
    const initialImageHash =
      autoApprove && dto.initial_version
        ? await this.adverts.resolveImageHash(dto.initial_version.media_url)
        : null;
    const initialFileSize = dto.initial_version
      ? (dto.initial_version.file_size_bytes ??
        (await this.resolveFileSize(dto.initial_version.media_url)))
      : null;

    if (dto.schedule && !dto.initial_version) {
      throw new BadRequestException('schedule needs initial_version: nothing to book yet');
    }
    const { creative, version } = await this.prisma.$transaction(async (tx) => {
      let created;
      try {
        created = await tx.creative.create({
          data: {
            brandId: dto.brand_id,
            creativeName: dto.creative_name,
            externalRefId: dto.external_ref_id ?? null,
          },
        });
      } catch (err) {
        // Brand deleted between the existence check and the write (or a
        // caller-supplied id that resolved differently) surfaces as P2003 —
        // translate it to 404 instead of leaking a 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          throw new NotFoundException(`Brand with ID ${dto.brand_id} not found`);
        }
        throw err;
      }
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.creativeCreated,
        entityType: 'Creative',
        entityId: created.id,
        actorId,
        key: created.id,
        payload: {
          creative_id: created.id,
          brand_id: created.brandId,
          creative_name: created.creativeName,
        },
      });

      if (!dto.initial_version) return { creative: created, version: null };

      const createdVersion = await tx.creativeVersion.create({
        data: {
          creativeId: created.id,
          versionNumber: 1,
          mediaUrl: dto.initial_version.media_url,
          mediaType: dto.initial_version.media_type,
          mediaName: dto.initial_version.media_name ?? null,
          fileSizeBytes: initialFileSize,
          imageHash: initialImageHash,
          status: initialStatus,
          createdBy: actorId,
        },
      });
      await tx.creative.update({
        where: { id: created.id },
        data: { currentVersionId: createdVersion.id },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.versionUploaded,
        entityType: 'CreativeVersion',
        entityId: createdVersion.id,
        actorId,
        key: created.id,
        payload: {
          creative_id: created.id,
          version_id: createdVersion.id,
          version_number: 1,
          media_url: createdVersion.mediaUrl,
          media_type: createdVersion.mediaType,
          media_name: createdVersion.mediaName ?? null,
          auto_approved: autoApprove,
          notes: dto.initial_version.notes ?? null,
        },
      });
      if (autoApprove) {
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.reviewAutoApproved,
          entityType: 'CreativeVersion',
          entityId: createdVersion.id,
          actorId,
          key: created.id,
          payload: {
            version_id: createdVersion.id,
            creative_id: created.id,
            reason: 'brand.auto_approve',
          },
        });
      }
      return { creative: created, version: createdVersion };
    });
    const agency = brand.upstreamAgencyId
      ? await this.prisma.client.agencyRef.findUnique({
          where: { upstreamAgencyId: brand.upstreamAgencyId },
        })
      : null;
    // Optional schedule books the advert in the same call (pre-approval
    // booking is normal; go-live waits for APPROVE).
    let schedules: CreativeScheduleSummaryDto[] = [];
    if (dto.schedule && version) {
      const booked = await this.adverts.scheduleVersion(
        {
          version_id: version.id,
          lat: dto.schedule.lat,
          lng: dto.schedule.lng,
          address_text: dto.schedule.address_text ?? '',
          start_date: dto.schedule.start_date,
          end_date: dto.schedule.end_date,
          city_name: dto.schedule.city_name ?? null,
          zone_name: dto.schedule.zone_name ?? null,
          radius: dto.schedule.radius ?? null,
        },
        actorId,
      );
      schedules = [
        {
          advert_id: booked.id,
          version_id: version.id,
          status: booked.status,
          start_date: booked.start_date as Date,
          end_date: booked.end_date as Date,
          address_text: booked.address_text,
          city_name: booked.city_name,
          zone_name: booked.zone_name,
          radius_km: booked.radius_km ?? null,
          location: booked.location ?? null,
        },
      ];
    }
    const base = this.toCreativeResponse(
      { ...creative, brand, versions: version ? [{ ...version, actions: [] }] : [] },
      new Map(),
    );
    return plainToInstance(
      CreativeResponseDto,
      {
        ...base,
        agency: agency
          ? {
              upstream_agency_id: agency.upstreamAgencyId,
              agency_name: agency.agencyName,
              city: agency.city ?? null,
              address: agency.address ?? null,
            }
          : null,
        versions: version ? [this.toVersionResponse({ ...version, actions: [] }, new Map())] : [],
        schedules,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Adds a version to the approval thread. Versions auto-increment inside the
   * same thread; uploading over an APPROVED latest version conflicts (409) and
   * brand.auto_approve bypasses the review queue instantly.
   */
  async uploadVersion(
    creativeId: string,
    dto: UploadVersionDto & {
      upstream_version_id?: string;
      submitted_at?: Date | null;
      admin_approved_by?: string | null;
      admin_approved_at?: Date | null;
      admin_comments?: string | null;
      file_size_bytes?: number;
    },
    actorId: string,
  ): Promise<{ version: CreativeVersionResponseDto; replayed: boolean }> {
    if (dto.upstream_version_id) {
      const replay = await this.prisma.client.creativeVersion.findUnique({
        where: { upstreamVersionId: dto.upstream_version_id },
      });
      if (replay) return { version: this.toVersionResponse(replay, new Map()), replayed: true };
    }
    assertValidMediaType(dto.media_type);

    const creative = await this.prisma.client.creative.findUnique({
      where: { id: creativeId },
      include: { brand: true },
    });
    if (!creative) throw new NotFoundException(`Creative with ID ${creativeId} not found`);
    assertBrandActive(creative.brand?.isActive ?? true, creative.brandId);

    const latest = await this.prisma.client.creativeVersion.findFirst({
      where: { creativeId },
      orderBy: { versionNumber: 'desc' },
    });
    if (latest?.status === ReviewStatus.APPROVED) {
      throw new ConflictException(
        'Current version is APPROVED; a new version cannot be uploaded until the decision is reset',
      );
    }
    const nextVersionNumber = latest ? latest.versionNumber + 1 : 1;
    const autoApprove = creative.brand?.autoApprove === true;
    const status = autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING;
    const imageHash = autoApprove ? await this.adverts.resolveImageHash(dto.media_url) : null;
    const fileSizeBytes = dto.file_size_bytes ?? (await this.resolveFileSize(dto.media_url));

    const version = await this.prisma.$transaction(async (tx) => {
      const created = await tx.creativeVersion.create({
        data: {
          creativeId,
          versionNumber: nextVersionNumber,
          mediaUrl: dto.media_url,
          mediaType: dto.media_type,
          mediaName: dto.media_name ?? null,
          fileSizeBytes,
          imageHash,
          status,
          createdBy: actorId,
          upstreamVersionId: dto.upstream_version_id ?? null,
          submittedAt: dto.submitted_at ?? null,
          adminApprovedBy: dto.admin_approved_by ?? null,
          adminApprovedAt: dto.admin_approved_at ?? null,
          adminComments: dto.admin_comments ?? null,
        },
      });
      await tx.creative.update({
        where: { id: creativeId },
        data: { currentVersionId: created.id },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.versionUploaded,
        entityType: 'CreativeVersion',
        entityId: created.id,
        actorId,
        key: creativeId,
        payload: {
          creative_id: creativeId,
          version_id: created.id,
          version_number: created.versionNumber,
          media_url: created.mediaUrl,
          media_type: created.mediaType,
          media_name: created.mediaName ?? null,
          auto_approved: autoApprove,
          notes: dto.notes ?? null,
          upstream_version_id: dto.upstream_version_id ?? null,
          submitted_at: dto.submitted_at ? dto.submitted_at.toISOString() : null,
        },
      });
      if (autoApprove) {
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.reviewAutoApproved,
          entityType: 'CreativeVersion',
          entityId: created.id,
          actorId,
          key: creativeId,
          payload: {
            version_id: created.id,
            creative_id: creativeId,
            reason: 'brand.auto_approve',
          },
        });
      }
      return created;
    });
    return { version: this.toVersionResponse(version, new Map()), replayed: false };
  }

  /**
   * Full creative detail (API_SPECIFICATION.md §4 + operator detail view):
   * brand + agency + full version history + advert schedules with WKT
   * locations. Records this view for last-viewed tracking (best-effort).
   */
  async getCreative(id: string, actorId: string): Promise<CreativeResponseDto> {
    const creative = await this.prisma.client.creative.findUnique({
      where: { id },
      include: {
        brand: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            actions: { orderBy: { createdAt: 'asc' } },
            adverts: true,
          },
        },
      },
    });
    if (!creative) throw new NotFoundException(`Creative with ID ${id} not found`);

    const viewedAt = new Date();
    try {
      await this.prisma.client.creative.update({
        where: { id },
        data: { lastViewedBy: actorId, lastViewedAt: viewedAt },
      });
      creative.lastViewedBy = actorId;
      creative.lastViewedAt = viewedAt;
    } catch {
      // View tracking must never break the read.
    }

    const actorNames = await this.resolveActorNames([
      ...this.collectActorIds(creative.versions),
      ...this.collectRowIds([creative]),
      actorId,
    ]);
    const agency = creative.upstreamAgencyId
      ? await this.prisma.client.agencyRef.findUnique({
          where: { upstreamAgencyId: creative.upstreamAgencyId },
        })
      : null;
    const advertIds = creative.versions.flatMap((version) =>
      (version.adverts ?? []).map((advert) => advert.id),
    );
    const locations = await this.fetchAdvertLocations(advertIds);
    // Creative-level region summary: distinct advert cities across all
    // versions. Computed from the already-loaded adverts (no extra query),
    // so creatives with no deployments report an empty list.
    const targetedRegions = Array.from(
      new Set(
        creative.versions.flatMap((version) =>
          (version.adverts ?? [])
            .map((advert) => advert.cityName?.trim())
            .filter((city): city is string => Boolean(city)),
        ),
      ),
    ).sort((a, b) => a.localeCompare(b));
    const primaryLocation =
      creative.versions
        .flatMap((version) => version.adverts ?? [])
        .map((advert) => advert.addressText?.trim())
        .find((address): address is string => Boolean(address)) ??
      creative.brand.address ??
      null;
    const base = this.toCreativeResponse(
      creative,
      actorNames,
      new Map(),
      undefined,
      creative.versions.length > 0
        ? creative.versions.reduce((sum, version) => sum + (version.fileSizeBytes ?? 0), 0)
        : null,
    );
    return plainToInstance(
      CreativeResponseDto,
      {
        ...base,
        agency: agency
          ? {
              upstream_agency_id: agency.upstreamAgencyId,
              agency_name: agency.agencyName,
              city: agency.city ?? null,
              address: agency.address ?? null,
            }
          : null,
        versions: creative.versions.map((version) => this.toVersionResponse(version, actorNames)),
        location: primaryLocation,
        targeted_regions: targetedRegions,
        schedules: creative.versions.flatMap((version) =>
          (version.adverts ?? []).map((advert) => ({
            advert_id: advert.id,
            version_id: version.id,
            status: advert.status,
            start_date: advert.startDate,
            end_date: advert.endDate,
            address_text: advert.addressText,
            city_name: advert.cityName,
            zone_name: advert.zoneName,
            radius_km: advert.radiusKm ?? null,
            location: locations.get(advert.id) ?? null,
          })),
        ),
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * S3 presigned upload handshake (API_SPECIFICATION.md §4). Returns a
   * bucket key + upload URL; the client PUTs bytes there, then calls
   * finalizeUpload. Mock-storage URLs in development (see StorageService).
   */
  async requestUploadUrl(
    dto: { brand_id: string; name: string; media_type: string },
    actorId: string,
  ): Promise<{ upload_url: string; s3_key: string; file_url: string }> {
    const brand = await this.prisma.client.brand.findUnique({ where: { id: dto.brand_id } });
    if (!brand) throw new NotFoundException(`Brand with ID ${dto.brand_id} not found`);
    assertBrandActive(brand.isActive, brand.id);
    assertValidMediaType(dto.media_type);
    await this.outbox.emit({
      eventType: 'creative.upload_intent',
      entityType: 'Creative',
      entityId: 'pending',
      actorId,
      key: actorId,
      payload: { brand_id: dto.brand_id, name: dto.name, media_type: dto.media_type },
    });
    const s3Key = this.storage.buildKey('creatives', dto.name, 'png');
    const uploadUrl = await this.storage.presignedUploadUrl(s3Key);
    return { upload_url: uploadUrl, s3_key: s3Key, file_url: s3Key };
  }

  /**
   * Confirms a client upload: creates the creative (or attaches a version
   * to creative_id) with v1/PENDING semantics via the standard paths.
   */
  async finalizeUpload(
    dto: {
      creative_id?: string;
      brand_id?: string;
      name?: string;
      s3_key: string;
      media_type: string;
      file_size_bytes?: number;
    },
    actorId: string,
  ): Promise<CreativeResponseDto | CreativeVersionResponseDto> {
    // Normalize once: bare keys become full bucket URLs (directly renderable),
    // foreign hosts and malformed keys fail here instead of downstream.
    const fileUrl = this.storage.resolveCreativeFileUrl(dto.s3_key);
    this.storage.assertFileUrlAllowed(fileUrl);
    const uploadedSize = await this.assertUploadCompleted(fileUrl);
    const fileSizeBytes = dto.file_size_bytes ?? uploadedSize ?? undefined;
    const mediaName = this.deriveMediaName(dto.s3_key);
    if (dto.creative_id) {
      const { version } = await this.uploadVersion(
        dto.creative_id,
        {
          media_url: fileUrl,
          media_name: mediaName ?? undefined,
          media_type: dto.media_type,
          file_size_bytes: fileSizeBytes,
        },
        actorId,
      );
      return version;
    }
    if (!dto.brand_id || !dto.name) {
      throw new BadRequestException('Provide creative_id or brand_id + name');
    }
    return this.createCreative(
      {
        brand_id: dto.brand_id,
        creative_name: dto.name,
        initial_version: {
          media_url: fileUrl,
          media_name: mediaName ?? undefined,
          media_type: dto.media_type,
          file_size_bytes: fileSizeBytes,
        },
      },
      actorId,
    );
  }

  /**
   * Confirms bytes actually landed in the bucket before a version is created:
   * a key that was never uploaded (definitive S3 404) or an empty-bodied PUT
   * (zero-byte object) must not become a version whose media 404s. Mock
   * storage and unreachable S3 stay fail-open, matching the reference flow.
   *
   * Returns the authoritative object size (null when it cannot be read) so the
   * same HEAD powers the stored file-size total.
   */
  private async assertUploadCompleted(fileUrl: string): Promise<number | null> {
    if (!this.storage.isConfigured) return null;
    const key = this.storage.extractKeyFromUrl(fileUrl);
    if (!key) return null;
    let size: number | null;
    try {
      size = await this.storage.getObjectSize(key);
    } catch (err) {
      if (isS3NotFound(err)) {
        throw new BadRequestException(
          `No file uploaded yet for "${key}" — PUT the file bytes to upload_url first, then finalize`,
        );
      }
      return null; // storage unreachable: fail-open
    }
    if (size === 0) {
      throw new BadRequestException(
        `The uploaded file "${key}" is empty — PUT the file bytes to upload_url first, then finalize`,
      );
    }
    return size;
  }

  /**
   * Best-effort authoritative size for a media URL. Used on direct
   * upload/create calls (which may not run the finalize HEAD); mock storage or
   * an unreachable object leaves the size unknown instead of blocking intake.
   */
  private async resolveFileSize(mediaUrl: string): Promise<number | null> {
    if (!this.storage.isConfigured) return null;
    const key = this.storage.extractKeyFromUrl(mediaUrl);
    if (!key) return null;
    try {
      return await this.storage.getObjectSize(key);
    } catch {
      return null;
    }
  }

  /**
   * Display name for finalize flows: the file name (last path segment of the
   * s3 key), percent-decoded and length-capped — null when the key carries no
   * usable name.
   */
  private deriveMediaName(s3Key: string): string | null {
    const raw = s3Key.split('#')[0].split('?')[0];
    const base = raw.split('/').pop()?.trim() ?? '';
    if (!base) return null;
    let name = base;
    try {
      name = decodeURIComponent(base);
    } catch {
      // keep the raw segment when the key isn't valid percent-encoding
    }
    return name.slice(0, 200) || null;
  }

  /**
   * Records a review decision. Optimistic locking via expectedVersion: the
   * first write wins, the loser gets 409. REJECT/NEEDS_CHANGES cascade
   * advert.auto_revoked to every non-revoked advert of the version.
   */
  async takeAction(
    versionId: string,
    input: TakeActionInput,
    actorId: string,
  ): Promise<CreativeVersionResponseDto> {
    const version = await this.prisma.client.creativeVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException(`Creative version ${versionId} not found`);

    if (input.expectedVersion !== undefined) {
      // expectedVersion is the version number the caller saw. Compare it with
      // the newest version in the thread, not merely the target row: a newly
      // uploaded version must invalidate a stale review screen.
      const latest = await this.prisma.client.creativeVersion.findFirst({
        where: { creativeId: version.creativeId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const latestVersionNumber = latest?.versionNumber ?? version.versionNumber;
      if (input.expectedVersion !== latestVersionNumber) {
        throw new ConflictException(
          `Version conflict: creative is now on version ${latestVersionNumber}`,
        );
      }
    }
    // WORKFLOWS.md §1.3 one-way gate: only PENDING accepts a decision.
    // ON_HOLD parks the version — RESUME returns it to PENDING first.
    // Decided statuses are terminal; further review needs a new version.
    assertValidTakeAction(input);
    const action = input.action as keyof typeof REVIEW_EVENT_BY_ACTION;
    if (action === 'RESUME' && version.status !== ReviewStatus.ON_HOLD) {
      throw new ConflictException('Only ON_HOLD versions can be resumed');
    }
    if (action !== 'RESUME') assertActionableStatus(version.status);
    const newStatus = statusForAction(action);
    assertValidTransition(version.status, newStatus);
    const imageHash =
      newStatus === ReviewStatus.APPROVED && !version.imageHash
        ? await this.adverts.resolveImageHash(version.mediaUrl)
        : null;
    const reason = input.reason?.trim() || null;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.creativeVersion.update({
        where: { id: versionId },
        data: { status: newStatus, ...(imageHash ? { imageHash } : {}) },
      });
      await tx.reviewAction.create({
        data: {
          versionId,
          actorId,
          action: actionTypeFor(action),
          comments: input.comments ?? null,
          reason,
        },
      });
      await this.activity.recordInTx(tx, {
        actorId,
        action: `review.${action.toLowerCase()}`,
        entityType: 'CreativeVersion',
        entityId: versionId,
        metadata: {
          from_status: version.status,
          new_status: newStatus,
          comments: input.comments ?? null,
          reason,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: REVIEW_EVENT_BY_ACTION[action],
        entityType: 'CreativeVersion',
        entityId: versionId,
        actorId,
        key: version.creativeId,
        payload: {
          version_id: versionId,
          creative_id: version.creativeId,
          action,
          new_status: newStatus,
          from_status: version.status,
          comments: input.comments ?? null,
          reason,
        },
      });
      if (newStatus === ReviewStatus.REJECTED || newStatus === ReviewStatus.NEEDS_CHANGES) {
        const adverts = await tx.advert.findMany({
          where: { versionId, status: { not: 'REVOKED' } },
          select: { id: true },
        });
        if (adverts.length > 0) {
          await tx.advert.updateMany({
            where: { id: { in: adverts.map((advert) => advert.id) } },
            data: { status: 'REVOKED' },
          });
          for (const advert of adverts) {
            await this.outbox.emitInTx(tx, {
              eventType: EventTypes.advertAutoRevoked,
              entityType: 'Advert',
              entityId: advert.id,
              key: advert.id,
              actorId,
              payload: {
                advert_id: advert.id,
                version_id: versionId,
                creative_id: version.creativeId,
                reason: `Creative version ${action}`,
              },
            });
          }
        }
      }
      return tx.creativeVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { actions: { orderBy: { createdAt: 'asc' } } },
      });
    });
    const actorNames = await this.resolveActorNames(this.collectActorIds([updated]));
    return this.toVersionResponse(updated, actorNames);
  }

  /**
   * Filter-modal support data (single call, view roles only so every
   * reviewer role can use it without extra permissions):
   * - `locations`: distinct hoarding addresses across all adverts.
   * - `actioners`: distinct reviewer display names from review history.
   * - `geo`: creativeId -> addresses, so the UI can match rows to a region.
   */
  async filterOptions(): Promise<{
    locations: string[];
    actioners: string[];
    geo: Record<string, string[]>;
  }> {
    const [adverts, actorRows, users] = await Promise.all([
      this.prisma.client.advert.findMany({
        select: { addressText: true, version: { select: { creativeId: true } } },
      }),
      this.prisma.client.reviewAction.findMany({
        select: { actorId: true },
        distinct: ['actorId'],
      }),
      this.prisma.client.user.findMany({
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    const geo: Record<string, string[]> = {};
    const locationSet = new Set<string>();
    for (const ad of adverts) {
      const addr = ad.addressText?.trim();
      const creativeId = ad.version?.creativeId;
      if (!addr || !creativeId) continue;
      locationSet.add(addr);
      if (!geo[creativeId]) geo[creativeId] = [];
      if (!geo[creativeId].includes(addr)) geo[creativeId].push(addr);
    }

    const namesById = new Map(
      users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()]),
    );
    const actionerSet = new Set<string>();
    for (const row of actorRows) {
      const raw = row.actorId?.trim();
      if (!raw) continue;
      const named = namesById.get(raw);
      if (named) {
        actionerSet.add(named);
      } else if (!/^[0-9a-f-]{36}$/i.test(raw)) {
        // Human-readable non-UUID actor tags pass through.
        actionerSet.add(raw);
      }
    }

    return {
      locations: Array.from(locationSet).sort((a, b) => a.localeCompare(b)),
      actioners: Array.from(actionerSet).sort((a, b) => a.localeCompare(b)),
      geo,
    };
  }

  /** Withdraws an undecided version (MULTI_PORTAL_ARCHITECTURE.md §8.4). */
  async withdrawVersion(
    creativeId: string,
    input: WithdrawVersionInput,
  ): Promise<{ version: CreativeVersionResponseDto }> {
    let version: Prisma.CreativeVersionGetPayload<object> | null = null;
    if (input.upstream_version_id) {
      version = await this.prisma.client.creativeVersion.findUnique({
        where: { upstreamVersionId: input.upstream_version_id },
      });
    } else if (input.version_id) {
      version = await this.prisma.client.creativeVersion.findUnique({
        where: { id: input.version_id },
      });
    } else {
      version = await this.prisma.client.creativeVersion.findFirst({
        where: { creativeId },
        orderBy: { versionNumber: 'desc' },
      });
    }
    if (!version) throw new NotFoundException('No matching creative version to withdraw');
    if (version.creativeId !== creativeId) {
      throw new BadRequestException('Version does not belong to this creative');
    }
    assertWithdrawable(version.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.creativeVersion.update({
        where: { id: version.id },
        data: { status: ReviewStatus.WITHDRAWN },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.creativeWithdrawn,
        entityType: 'CreativeVersion',
        entityId: version.id,
        actorId: input.upstream_portal,
        key: creativeId,
        payload: {
          version_id: version.id,
          creative_id: creativeId,
          from_status: version.status,
          reason: input.reason ?? null,
          upstream_event_id: input.upstream_event_id ?? null,
        },
      });
      return saved;
    });
    return { version: this.toVersionResponse(updated, new Map()) };
  }

  /**
   * Upstream intake write for the approval thread (UPSTREAM_INTEGRATION_API.md
   * §4.3). Idempotent on upstream_creative_id; brand resolved by
   * upstream_brand_id with a raw-id fallback.
   */
  async upsertThread(
    input: CreativeUpstreamInput,
  ): Promise<{ creative: CreativeResponseDto; created: boolean }> {
    const agency = await this.prisma.client.agencyRef.findUnique({
      where: { upstreamAgencyId: input.upstream_agency_id },
    });
    if (!agency) {
      throw new NotFoundException(
        `Unknown upstream agency ${input.upstream_agency_id}; push it via PUT /intake/agencies first`,
      );
    }

    const brand =
      (await this.prisma.client.brand.findUnique({
        where: { upstreamBrandId: input.upstream_brand_id },
      })) ??
      (await this.prisma.client.brand.findUnique({ where: { id: input.upstream_brand_id } }));
    if (!brand)
      throw new NotFoundException(`Brand with upstream ID ${input.upstream_brand_id} not found`);
    assertBrandActive(brand.isActive, brand.id);

    const existing = await this.prisma.client.creative.findUnique({
      where: { upstreamCreativeId: input.upstream_creative_id },
    });
    if (!existing) {
      const creative = await this.prisma.$transaction(async (tx) => {
        const created = await tx.creative.create({
          data: {
            brandId: brand.id,
            creativeName: input.creative_name,
            campaignRef: input.campaign_ref ?? null,
            upstreamCreativeId: input.upstream_creative_id,
            upstreamAgencyId: input.upstream_agency_id,
          },
        });
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.creativeCreated,
          entityType: 'Creative',
          entityId: created.id,
          actorId: input.upstream_portal,
          key: created.id,
          payload: {
            creative_id: created.id,
            brand_id: created.brandId,
            creative_name: created.creativeName,
            origin: 'upstream',
          },
        });
        return created;
      });
      return {
        creative: this.toCreativeResponse({ ...creative, brand, versions: [] }, new Map()),
        created: true,
      };
    }

    const changed =
      existing.brandId !== brand.id ||
      existing.creativeName !== input.creative_name ||
      existing.campaignRef !== (input.campaign_ref ?? null) ||
      existing.upstreamAgencyId !== input.upstream_agency_id;
    if (!changed) {
      return {
        creative: this.toCreativeResponse({ ...existing, brand, versions: [] }, new Map()),
        created: false,
      };
    }

    const creative = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.creative.update({
        where: { id: existing.id },
        data: {
          brandId: brand.id,
          creativeName: input.creative_name,
          campaignRef: input.campaign_ref ?? null,
          upstreamAgencyId: input.upstream_agency_id,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.creativeUpdated,
        entityType: 'Creative',
        entityId: updated.id,
        actorId: input.upstream_portal,
        key: updated.id,
        payload: {
          oldValue: {
            brand_id: existing.brandId,
            creative_name: existing.creativeName,
            campaign_ref: existing.campaignRef,
          },
          newValue: {
            brand_id: updated.brandId,
            creative_name: updated.creativeName,
            campaign_ref: updated.campaignRef,
          },
          origin: 'upstream',
        },
      });
      return updated;
    });
    return {
      creative: this.toCreativeResponse({ ...creative, brand, versions: [] }, new Map()),
      created: false,
    };
  }

  private collectActorIds(
    versions: Array<{ createdBy: string; actions: Array<{ actorId: string }> }>,
  ): string[] {
    const ids = new Set<string>();
    for (const version of versions) {
      ids.add(version.createdBy);
      for (const action of version.actions) ids.add(action.actorId);
    }
    return [...ids];
  }

  /** Brand flag authors + creative viewers referenced outside version threads. */
  private collectRowIds(
    creatives: Array<{
      brand: { flaggedBy: string | null };
      lastViewedBy: string | null;
    }>,
  ): string[] {
    const ids: string[] = [];
    for (const creative of creatives) {
      if (creative.brand.flaggedBy) ids.push(creative.brand.flaggedBy);
      if (creative.lastViewedBy) ids.push(creative.lastViewedBy);
    }
    return ids;
  }

  private async resolveActorNames(actorIds: string[]): Promise<Map<string, string>> {
    if (actorIds.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((user) => {
        const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        return [user.id, name || 'Unknown user'];
      }),
    );
  }

  /** Newest review action per creative across every version in the thread. */
  private async fetchLatestActions(
    creativeIds: string[],
  ): Promise<Map<string, { actorId: string; createdAt: Date }>> {
    if (creativeIds.length === 0) return new Map();
    const rows = await this.prisma.client.reviewAction.findMany({
      where: { version: { is: { creativeId: { in: creativeIds } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        actorId: true,
        createdAt: true,
        version: { select: { creativeId: true } },
      },
    });
    const latest = new Map<string, { actorId: string; createdAt: Date }>();
    for (const row of rows) {
      const creativeId = row.version.creativeId;
      if (!latest.has(creativeId)) {
        latest.set(creativeId, { actorId: row.actorId, createdAt: row.createdAt });
      }
    }
    return latest;
  }

  /**
   * Primary hoarding address + distinct advert cities per creative for the
   * list's Location column and Region/Location filter. Mirrors the detail
   * view's targeted_regions and gives the UI a row-level `location` even when
   * the filter-options lookup is unavailable.
   */
  private async fetchCreativeGeo(
    creativeIds: string[],
  ): Promise<Map<string, { location: string | null; regions: string[] }>> {
    if (creativeIds.length === 0) return new Map();
    const rows = await this.prisma.client.advert.findMany({
      where: { version: { is: { creativeId: { in: creativeIds } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        addressText: true,
        cityName: true,
        version: { select: { creativeId: true } },
      },
    });
    const geo = new Map<string, { location: string | null; cities: Set<string> }>();
    for (const row of rows) {
      const creativeId = row.version.creativeId;
      const entry = geo.get(creativeId) ?? { location: null, cities: new Set<string>() };
      const address = row.addressText?.trim();
      if (!entry.location && address) entry.location = address;
      const city = row.cityName?.trim();
      if (city) entry.cities.add(city);
      geo.set(creativeId, entry);
    }
    return new Map(
      [...geo].map(([creativeId, entry]) => [
        creativeId,
        {
          location: entry.location,
          regions: [...entry.cities].sort((a, b) => a.localeCompare(b)),
        },
      ]),
    );
  }

  /** Total bytes across every version of each listed creative. */
  private async fetchCreativeSizeTotals(creativeIds: string[]): Promise<Map<string, number>> {
    if (creativeIds.length === 0) return new Map();
    const rows = await this.prisma.client.creativeVersion.groupBy({
      by: ['creativeId'],
      where: { creativeId: { in: creativeIds } },
      _sum: { fileSizeBytes: true },
    });
    return new Map(
      rows
        .filter((row) => row._sum.fileSizeBytes !== null)
        .map((row) => [row.creativeId, row._sum.fileSizeBytes as number]),
    );
  }

  /** WKT site locations for adverts (Prisma cannot project the PostGIS column). */
  private async fetchAdvertLocations(ids: string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string; wkt: string | null }>>(
      Prisma.sql`SELECT "id", ST_AsText("location") AS "wkt" FROM "Advert" WHERE "id" IN (${Prisma.join(ids)})`,
    );
    return new Map(rows.map((row) => [row.id, row.wkt]));
  }

  /** Batched agency lookup for list rows, keyed by upstream agency id. */
  private async fetchAgencies(upstreamIds: Array<string | null>): Promise<Map<string, AgencyRef>> {
    const ids = [...new Set(upstreamIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.agencyRef.findMany({
      where: { upstreamAgencyId: { in: ids } },
    });
    return new Map(rows.map((row) => [row.upstreamAgencyId, row]));
  }

  /**
   * Newest action across every version. The list passes an explicit batched
   * lookup because it only loads the latest version; detail/other callers can
   * rely on the versions they already hold.
   */
  private latestActionFromVersions(
    versions: Array<{ actions?: Array<{ actorId: string; createdAt: Date }> }>,
  ): { actorId: string; createdAt: Date } | null {
    let latest: { actorId: string; createdAt: Date } | null = null;
    for (const version of versions) {
      for (const action of version.actions ?? []) {
        if (!latest || action.createdAt.getTime() > latest.createdAt.getTime()) {
          latest = { actorId: action.actorId, createdAt: action.createdAt };
        }
      }
    }
    return latest;
  }

  private toCreativeResponse(
    creative: CreativeWithBrandAndVersions,
    actorNames: Map<string, string>,
    agencies: Map<string, AgencyRef> = new Map(),
    latestActionOverride?: { actorId: string; createdAt: Date } | null,
    totalSizeOverride?: number | null,
  ): CreativeResponseDto {
    const latestVersion = creative.versions[0];
    const latestAction =
      latestActionOverride !== undefined
        ? latestActionOverride
        : this.latestActionFromVersions(creative.versions);
    const totalSizeBytes =
      totalSizeOverride !== undefined
        ? totalSizeOverride
        : creative.versions.length > 0
          ? creative.versions.reduce((sum, version) => sum + (version.fileSizeBytes ?? 0), 0)
          : null;
    const agencyId = creative.upstreamAgencyId ?? creative.brand.upstreamAgencyId;
    const agency = agencyId ? (agencies.get(agencyId) ?? null) : null;
    return plainToInstance(
      CreativeResponseDto,
      {
        id: creative.id,
        brand_id: creative.brandId,
        brand: {
          id: creative.brand.id,
          brand_name: creative.brand.brandName,
          logo_url: creative.brand.logoUrl ?? null,
          address: creative.brand.address ?? null,
          is_flagged: creative.brand.isFlagged,
          industry_category: creative.brand.industryCategory ?? null,
          flagged_by:
            (creative.brand.flaggedBy && actorNames.get(creative.brand.flaggedBy)) || null,
          flagged_on: creative.brand.flaggedOn ?? null,
        },
        creative_name: creative.creativeName,
        external_ref_id: creative.externalRefId,
        upstream_creative_id: creative.upstreamCreativeId,
        campaign_ref: creative.campaignRef,
        current_version_id: creative.currentVersionId,
        created_at: creative.createdAt,
        latest_version: latestVersion ? this.toVersionResponse(latestVersion, actorNames) : null,
        last_action_by: latestAction ? (actorNames.get(latestAction.actorId) ?? null) : null,
        last_action_at: latestAction ? latestAction.createdAt : null,
        location: creative.brand.address ?? null,
        targeted_regions: [],
        total_size_bytes: totalSizeBytes,
        last_viewed_by: (creative.lastViewedBy && actorNames.get(creative.lastViewedBy)) || null,
        last_viewed_at: creative.lastViewedAt ?? null,
        viewed_minutes_ago: creative.lastViewedAt
          ? Math.max(0, Math.round((Date.now() - creative.lastViewedAt.getTime()) / 60000))
          : null,
        ...(agency
          ? {
              agency: {
                upstream_agency_id: agency.upstreamAgencyId,
                agency_name: agency.agencyName,
                city: agency.city ?? null,
                address: agency.address ?? null,
              },
            }
          : {}),
      },
      { excludeExtraneousValues: true },
    );
  }

  private toVersionResponse(
    version:
      | Prisma.CreativeVersionGetPayload<{ include: { actions: true } }>
      | Prisma.CreativeVersionGetPayload<object>,
    actorNames: Map<string, string>,
  ): CreativeVersionResponseDto {
    const withActions = version as Prisma.CreativeVersionGetPayload<{ include: { actions: true } }>;
    const actions = withActions.actions ?? [];
    const latestAction = [...actions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    return plainToInstance(
      CreativeVersionResponseDto,
      {
        id: version.id,
        version_number: version.versionNumber,
        media_url: version.mediaUrl,
        media_type: version.mediaType,
        media_name: version.mediaName ?? null,
        file_size_bytes: version.fileSizeBytes ?? null,
        status: version.status,
        created_by: version.createdBy,
        created_by_name: actorNames.get(version.createdBy) ?? null,
        created_at: version.createdAt,
        admin_approved_by: version.adminApprovedBy ?? null,
        admin_approved_at: version.adminApprovedAt ?? null,
        admin_comments: version.adminComments ?? null,
        latest_action: latestAction
          ? plainToInstance(
              ReviewActionResponseDto,
              {
                id: latestAction.id,
                action: latestAction.action,
                comments: latestAction.comments,
                reason: latestAction.reason ?? null,
                actor_id: latestAction.actorId,
                actor_name: actorNames.get(latestAction.actorId) ?? null,
                created_at: latestAction.createdAt,
              },
              { excludeExtraneousValues: true },
            )
          : null,
        actions: actions
          ? actions.map((action) =>
              plainToInstance(
                ReviewActionResponseDto,
                {
                  id: action.id,
                  action: action.action,
                  comments: action.comments,
                  reason: action.reason ?? null,
                  actor_id: action.actorId,
                  actor_name: actorNames.get(action.actorId) ?? null,
                  created_at: action.createdAt,
                },
                { excludeExtraneousValues: true },
              ),
            )
          : undefined,
      },
      { excludeExtraneousValues: true },
    );
  }
}
