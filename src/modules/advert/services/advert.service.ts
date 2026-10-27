import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Prisma, AdvertStatus, ReviewStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StandardMeta, standardMeta, toSkipTake } from '../../../common/utils/paginate';
import { PrismaService } from '../../../database/prisma.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { EventOutboxService } from '../../events/event.outbox';
import { EventTypes } from '../../events/events.constants';
import type { EventType } from '../../events/events.constants';
import { AdvertListQueryDto } from '../dto/advert-list-query.dto';
import { AdvertBrandGroupDto, AdvertResponseDto } from '../dto/advert-response.dto';
import {
  ADVERT_SORT_KEYS,
  assertAdvertTransition,
  assertCoordinates,
  assertDateRange,
  assertSchedulableVersionStatus,
  availableGovtActions,
  isAdvertStatus,
  isSchedulableVersionStatus,
  normalizeUpstreamAdvertStatus,
} from '../validators';
import {
  IMAGE_SEARCH_CANDIDATE_LIMIT,
  IMAGE_SEARCH_DEFAULT_MAX_DISTANCE,
  IMAGE_SEARCH_MAX_DISTANCE,
  IMAGE_UPLOAD_MAX_BYTES,
  assertImageHash,
  dHashFromGrayscale,
  hammingDistanceHex,
} from '../image-hash';
import type { AdvertSearchSort, AdvertSortKey } from '../validators';

export interface AdvertUpstreamInput {
  upstream_advert_id: string;
  upstream_creative_id: string;
  upstream_version_id: string;
  lat: number;
  lng: number;
  address_text: string;
  start_date: Date;
  end_date: Date;
  city_name?: string | null;
  zone_name?: string | null;
  radius_km?: number | null;
  image_hash?: string | null;
  upstream_portal?: string;
}

export interface AdvertUpstreamTransitionInput {
  status: string;
  occurred_at?: string | null;
  reason?: string | null;
  upstream_portal?: string;
}

export interface AdvertListFilters {
  status?: string;
  brand_id?: string;
  brandId?: string;
  search?: string;
  industry?: string;
  brand_status?: 'flagged' | 'notflagged';
  city?: string;
  zone?: string;
  start_date?: string;
  end_date?: string;
  ids?: string[];
}

/** First-page media snapshot for the revisit list. Brand-grouped pages are
 * flattened back to rows so the preview is always a flat advert list. */
export function buildSearchPreview(
  items: AdvertResponseDto[] | AdvertBrandGroupDto[],
  limit = RECENT_SEARCH_PREVIEW_LIMIT,
): AdvertSearchPreview[] {
  const flat: AdvertResponseDto[] = [];
  for (const item of items) {
    const nested = (item as Partial<AdvertBrandGroupDto>).adverts;
    if (Array.isArray(nested)) flat.push(...nested);
    else flat.push(item as AdvertResponseDto);
    if (flat.length >= limit) break;
  }
  return flat.slice(0, limit).map((row) => ({
    advert_id: row.id,
    media_url: row.media_url ?? null,
    creative_name: row.creative_name ?? row.version?.creative_name ?? null,
    brand_name: row.version?.brand?.brand_name ?? null,
    address_text: row.address_text ?? null,
    city_name: row.city_name ?? null,
    status: row.status,
    distance_km: row.distance_km ?? null,
  }));
}
/** Group page rows under their brand headers (brand order = first appearance). */
export function groupAdvertsByBrand(rows: AdvertResponseDto[]): AdvertBrandGroupDto[] {
  const groups = new Map<string, AdvertBrandGroupDto>();
  for (const row of rows) {
    const brand = row.version?.brand;
    const key = brand?.id ?? 'unbranded';
    let group = groups.get(key);
    if (!group) {
      group = plainToInstance(
        AdvertBrandGroupDto,
        {
          brand: {
            id: brand?.id ?? 'unbranded',
            brand_name: brand?.brand_name ?? 'Unbranded',
            is_flagged: brand?.is_flagged ?? false,
          },
          adverts: [],
          count: 0,
        },
        { excludeExtraneousValues: true },
      );
      groups.set(key, group);
    }
    group.adverts.push(row);
    group.count += 1;
  }
  return [...groups.values()];
}

export interface AdvertSearchEcho {
  lat: number | null;
  lng: number | null;
  radius_km: number | null;
  industry: string | null;
  brand_id: string | null;
  start: string | null;
  end: string | null;
  sort: AdvertSearchSort;
  query_hash: string | null;
  max_distance: number | null;
}

export interface AdvertSearchResult {
  items: AdvertResponseDto[] | AdvertBrandGroupDto[];
  meta: StandardMeta;
  search: AdvertSearchEcho;
}

export interface AdvertImageSearchResult {
  items: AdvertResponseDto[];
  meta: StandardMeta;
  search: AdvertSearchEcho;
}

export interface RecentAdvertSearch {
  id: string;
  params: unknown;
  adverts_matched: number;
  /** Media snapshot of the top matched adverts at search time (empty for older rows). */
  preview: AdvertSearchPreview[];
  searched_at: Date;
  hours_ago: number;
}

/** Compact card data for one matched advert inside a recent-search preview. */
export interface AdvertSearchPreview {
  advert_id: string;
  media_url: string | null;
  creative_name: string | null;
  brand_name: string | null;
  address_text: string | null;
  city_name: string | null;
  status: string;
  distance_km: number | null;
}

/** Preview rows kept per history entry (first page only). */
export const RECENT_SEARCH_PREVIEW_LIMIT = 4;

/** 7-day revisit window for recent searches. */
export const RECENT_SEARCH_DAYS = 7;
export const RECENT_SEARCH_LIMIT = 20;

export interface AdvertExportRow {
  id: string;
  version_id: string;
  creative: string;
  brand: string;
  status: string;
  address: string | null;
  location: string | null;
  radius_km: number | null;
  start_date: Date;
  end_date: Date;
  city: string | null;
  zone: string | null;
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
 * Shared list/export predicate. Schedule-window filters overlap
 * [startDate, endDate]: start_date keeps rows ending on/after it, end_date
 * keeps rows starting on/before it.
 */
export function buildAdvertWhere(filters: AdvertListFilters): Prisma.AdvertWhereInput {
  const brandId = filters.brandId ?? filters.brand_id;
  let start: Date | undefined;
  let end: Date | undefined;
  if (filters.start_date) {
    start = dayStart(filters.start_date);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Invalid start_date');
  }
  if (filters.end_date) {
    end = dayEnd(filters.end_date);
    if (Number.isNaN(end.getTime())) throw new BadRequestException('Invalid end_date');
  }
  const creative: Prisma.CreativeWhereInput = {
    ...(brandId ? { brandId } : {}),
    ...(filters.industry || filters.brand_status
      ? {
          brand: {
            is: {
              ...(filters.industry
                ? { industryCategory: { equals: filters.industry, mode: 'insensitive' as const } }
                : {}),
              ...(filters.brand_status ? { isFlagged: filters.brand_status === 'flagged' } : {}),
            },
          },
        }
      : {}),
  };
  return {
    ...(filters.ids?.length ? { id: { in: filters.ids } } : {}),
    ...(filters.status ? { status: filters.status as AdvertStatus } : {}),
    ...(Object.keys(creative).length ? { version: { creative } } : {}),
    ...(filters.search
      ? {
          OR: [
            { id: { contains: filters.search } },
            { addressText: { contains: filters.search, mode: 'insensitive' } },
            {
              version: {
                creative: {
                  brand: { is: { brandName: { contains: filters.search, mode: 'insensitive' } } },
                },
              },
            },
            {
              version: {
                creative: {
                  brand: {
                    is: { industryCategory: { contains: filters.search, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        }
      : {}),
    ...(filters.city ? { cityName: { contains: filters.city, mode: 'insensitive' } } : {}),
    ...(filters.zone ? { zoneName: { contains: filters.zone, mode: 'insensitive' } } : {}),
    ...(start || end
      ? {
          AND: [
            ...(start ? [{ endDate: { gte: start } }] : []),
            ...(end ? [{ startDate: { lte: end } }] : []),
          ],
        }
      : {}),
  };
}

const ADVERT_ORDER_BY: Record<
  AdvertSortKey,
  'createdAt' | 'startDate' | 'endDate' | 'status' | 'id'
> = {
  created_at: 'createdAt',
  start_date: 'startDate',
  end_date: 'endDate',
  status: 'status',
  id: 'id',
};

export function advertOrderBy(
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'desc',
): Prisma.AdvertOrderByWithRelationInput {
  const key = (sortBy ?? 'created_at') as AdvertSortKey;
  if (!(ADVERT_SORT_KEYS as readonly string[]).includes(key)) {
    throw new BadRequestException(`sortBy must be one of: ${ADVERT_SORT_KEYS.join(', ')}`);
  }
  return { [ADVERT_ORDER_BY[key]]: sortOrder };
}

const STATUS_EVENT: Record<AdvertStatus, EventType> = {
  SCHEDULED: EventTypes.advertScheduled,
  LIVE: EventTypes.advertLive,
  PAUSED: EventTypes.advertPaused,
  EXPIRED: EventTypes.advertExpired,
  REVOKED: EventTypes.advertRevoked,
};

type VersionWithContext = Prisma.CreativeVersionGetPayload<{
  include: { creative: { include: { brand: true } } };
}>;

/**
 * Advert control (REQUIREMENTS.md §3.2). Adverts may only be created for
 * APPROVED versions of active brands — violations emit advert.deploy_blocked.
 * The location column is PostGIS, which Prisma Client cannot write, so the
 * deploy/update paths use parameterised raw SQL and idempotency is guaranteed
 * by the unique upstream_advert_id.
 */
@Injectable()
export class AdvertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EventOutboxService,
    private readonly activity: ActivityLogService,
  ) {}

  /**
   * Schedules a version at a physical site. Booking is pre-approval by design
   * (agency books inventory first): any live-thread version is accepted and
   * only REJECTED / WITHDRAWN versions are refused. The compliance gate lives
   * at go-live — syncDueSchedules promotes APPROVED versions only. Single
   * guarded path shared by govt deploy and the test intake: PostGIS point via
   * raw SQL, advert.scheduled event.
   */
  async scheduleVersion(
    dto: {
      version_id: string;
      lat: number;
      lng: number;
      address_text: string;
      start_date: Date;
      end_date: Date;
      city_name?: string | null;
      zone_name?: string | null;
      radius?: number | null;
      image_hash?: string | null;
    },
    actorId: string,
  ): Promise<AdvertResponseDto> {
    assertCoordinates(dto.lat, dto.lng);
    assertDateRange(dto.start_date, dto.end_date);
    if (dto.image_hash !== undefined && dto.image_hash !== null) {
      assertImageHash(dto.image_hash);
    }

    const version = await this.prisma.client.creativeVersion.findUnique({
      where: { id: dto.version_id },
      include: { creative: { include: { brand: true } } },
    });
    if (!version) throw new NotFoundException(`Creative version ${dto.version_id} not found`);

    // Schedules arrive pre-approval (agency books first); only dead-end
    // versions are refused here. The compliance gate lives at go-live.
    if (!isSchedulableVersionStatus(version.status)) {
      await this.emitDeployBlocked(version.id, 'version_not_schedulable', actorId, version.status);
      assertSchedulableVersionStatus(version.status);
    }
    if (version.creative.brand.isActive === false) {
      await this.emitDeployBlocked(version.id, 'brand_inactive', actorId, version.status);
      throw new BadRequestException(
        'Brand is deactivated (global kill-switch); deployment blocked',
      );
    }

    const advertId = randomUUID();
    const wkt = `POINT(${dto.lng} ${dto.lat})`;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "Advert" ("id", "version_id", "location", "address_text", "status", "start_date", "end_date", "city_name", "zone_name", "radius_km", "image_hash", "created_at")
        VALUES (${advertId}, ${version.id}, ST_GeomFromText(${wkt}, 4326), ${dto.address_text}, ${AdvertStatus.SCHEDULED}::"AdvertStatus", ${dto.start_date}, ${dto.end_date}, ${dto.city_name ?? null}, ${dto.zone_name ?? null}, ${dto.radius ?? null}, ${dto.image_hash ?? null}, CURRENT_TIMESTAMP)
      `;
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.advertScheduled,
        entityType: 'Advert',
        entityId: advertId,
        actorId,
        key: advertId,
        payload: {
          advert_id: advertId,
          version_id: version.id,
          creative_id: version.creative.id,
          brand_id: version.creative.brandId,
          lat: dto.lat,
          lng: dto.lng,
          address_text: dto.address_text,
          start_date: dto.start_date.toISOString(),
          end_date: dto.end_date.toISOString(),
          city_name: dto.city_name ?? null,
          zone_name: dto.zone_name ?? null,
          radius_km: dto.radius ?? null,
          image_hash: dto.image_hash ?? null,
        },
      });
    });

    return this.readEnriched(advertId);
  }

  /** Radius search via PostGIS ST_DWithin; falls back to a plain filter query without coordinates. */
  async searchByRadius(filters: {
    lat?: number;
    lng?: number;
    radius?: number;
    radiusKm?: number;
    industry?: string;
    brand_id?: string;
    start?: Date;
    end?: Date;
    sort?: AdvertSearchSort;
    page?: number;
    limit?: number;
    group_by?: 'brand';
    image_hash?: string;
    max_distance?: number;
    actor_id?: string;
  }): Promise<AdvertSearchResult> {
    const hasLat = filters.lat !== undefined;
    const hasLng = filters.lng !== undefined;
    if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
      throw new BadRequestException('lat and lng must be searched together');
    }
    if (filters.radius !== undefined && (!hasLat || !hasLng)) {
      throw new BadRequestException('radius needs lat and lng and cannot be searched alone');
    }
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const sort = filters.sort ?? 'distance_asc';
    const imageMode = filters.image_hash !== undefined;
    if (imageMode) assertImageHash(filters.image_hash as string);
    const maxDistance = Math.min(
      Math.max(filters.max_distance ?? IMAGE_SEARCH_DEFAULT_MAX_DISTANCE, 0),
      IMAGE_SEARCH_MAX_DISTANCE,
    );
    const { skip, take } = toSkipTake({ page, limit, sortOrder: 'desc' });
    const echo: AdvertSearchEcho = {
      lat: filters.lat ?? null,
      lng: filters.lng ?? null,
      radius_km: hasLat && hasLng ? (filters.radiusKm ?? filters.radius ?? 5) : null,
      industry: filters.industry ?? null,
      brand_id: filters.brand_id ?? null,
      start: filters.start?.toISOString() ?? null,
      end: filters.end?.toISOString() ?? null,
      sort,
      query_hash: filters.image_hash ?? null,
      max_distance: imageMode ? maxDistance : null,
    };
    let rows: AdvertResponseDto[];
    let total: number;
    if (hasLat && hasLng) {
      ({ rows, total } = await this.geoSearch(
        filters,
        echo.radius_km as number,
        sort,
        skip,
        take,
        imageMode,
      ));
    } else {
      ({ rows, total } = await this.plainSearch(filters, skip, take, imageMode));
    }
    if (imageMode) {
      // Image ranking happens in memory over the candidate page: nearest
      // first, unhashable rows excluded, then re-sliced to the page.
      const ranked = rows
        .filter((row) => typeof row.image_hash === 'string' && row.image_hash.length > 0)
        .map((row) => ({
          row,
          distance: hammingDistanceHex(filters.image_hash as string, row.image_hash as string),
        }))
        .filter((entry) => entry.distance <= maxDistance)
        .sort((a, b) => a.distance - b.distance);
      total = ranked.length;
      rows = ranked
        .slice(skip, skip + take)
        .map((entry) => ({ ...entry.row, hash_distance: entry.distance }));
    }
    await this.recordSearch(filters.actor_id, echo, total, rows);
    const items = filters.group_by === 'brand' ? groupAdvertsByBrand(rows) : rows;
    return {
      items,
      meta: standardMeta(total, page, limit, items.length),
      search: echo,
    };
  }

  /**
   * Reverse-image search (single endpoint): rank adverts by Hamming distance
   * (nearest first) from a query hash that comes either from an uploaded
   * PNG/JPEG file or from explicit image_hash/advert_id params. A present file
   * always wins over params. Only adverts with a stored image_hash
   * participate; the search is recorded in history like radius search.
   */
  async searchByImage(
    buffer: Buffer | undefined,
    opts: {
      image_hash?: string;
      advert_id?: string;
      max_distance?: number;
      status?: string;
      brand_id?: string;
      page?: number;
      limit?: number;
      actor_id?: string;
    },
  ): Promise<AdvertImageSearchResult> {
    let queryHash: string | undefined;
    if (buffer && buffer.length > 0) {
      if (buffer.length > IMAGE_UPLOAD_MAX_BYTES) {
        throw new BadRequestException(`image must be smaller than ${IMAGE_UPLOAD_MAX_BYTES} bytes`);
      }
      try {
        const sharp = (await import('sharp')).default;
        const pixels = await sharp(buffer)
          .greyscale()
          .resize(9, 8, { fit: 'fill' })
          .raw()
          .toBuffer();
        queryHash = dHashFromGrayscale(pixels, 9, 8);
      } catch {
        throw new BadRequestException('image must be a PNG or JPEG file');
      }
    } else {
      queryHash = opts.image_hash;
      if (opts.advert_id) {
        const ref = await this.prisma.client.advert.findUnique({ where: { id: opts.advert_id } });
        if (!ref) throw new NotFoundException('Reference advert not found');
        if (!ref.imageHash) {
          throw new BadRequestException('Reference advert has no image_hash to search by.');
        }
        queryHash = ref.imageHash;
      }
      if (!queryHash) {
        throw new BadRequestException('Provide an image file or image_hash/advert_id');
      }
      assertImageHash(queryHash);
    }
    if (opts.status !== undefined && !isAdvertStatus(opts.status)) {
      throw new BadRequestException('Invalid advert status');
    }
    const maxDistance = Math.min(
      Math.max(opts.max_distance ?? IMAGE_SEARCH_DEFAULT_MAX_DISTANCE, 0),
      IMAGE_SEARCH_MAX_DISTANCE,
    );
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 50, 100);
    const { skip, take } = toSkipTake({ page, limit, sortOrder: 'desc' });

    const candidates = await this.prisma.client.advert.findMany({
      where: {
        ...(opts.status ? { status: opts.status as AdvertStatus } : {}),
        ...(opts.brand_id ? { version: { creative: { brandId: opts.brand_id } } } : {}),
      },
      take: IMAGE_SEARCH_CANDIDATE_LIMIT,
      orderBy: { createdAt: 'desc' },
      include: { version: { include: { creative: { include: { brand: true } } } } },
    });
    const locations = await this.fetchLocationWkt(candidates.map((advert) => advert.id));
    const ranked = candidates
      .filter(
        (advert): advert is typeof advert & { imageHash: string } =>
          typeof advert.imageHash === 'string' &&
          advert.imageHash.length === (queryHash as string).length &&
          advert.imageHash.length > 0,
      )
      .map((advert) => ({
        advert,
        distance: hammingDistanceHex(queryHash as string, advert.imageHash),
      }))
      .filter((entry) => entry.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance);
    const total = ranked.length;
    const rows = ranked.slice(skip, skip + take).map((entry) =>
      this.toResponse(entry.advert, undefined, {
        location: locations.get(entry.advert.id) ?? null,
        hashDistance: entry.distance,
      }),
    );
    const echo: AdvertSearchEcho = {
      lat: null,
      lng: null,
      radius_km: null,
      industry: null,
      brand_id: opts.brand_id ?? null,
      start: null,
      end: null,
      sort: 'distance_asc',
      query_hash: queryHash,
      max_distance: maxDistance,
    };
    await this.recordSearch(opts.actor_id, echo, total, rows);
    return { items: rows, meta: standardMeta(total, page, limit, rows.length), search: echo };
  }

  private async geoSearch(
    filters: {
      lat?: number;
      lng?: number;
      industry?: string;
      brand_id?: string;
      start?: Date;
      end?: Date;
    },
    radiusKm: number,
    sort: AdvertSearchSort,
    skip: number,
    take: number,
    imageMode = false,
  ): Promise<{ rows: AdvertResponseDto[]; total: number }> {
    // Caller guarantees lat+lng on the geo path.
    assertCoordinates(filters.lat as number, filters.lng as number);
    // Image ranking happens in memory: pull the candidate pool, rank below.
    const industryClause =
      filters.industry !== undefined
        ? Prisma.sql`AND LOWER(b."industryCategory") = LOWER(${filters.industry})`
        : Prisma.empty;
    const brandClause =
      filters.brand_id !== undefined
        ? Prisma.sql`AND c."brandId" = ${filters.brand_id}`
        : Prisma.empty;
    const startClause =
      filters.start !== undefined ? Prisma.sql`AND a."endDate" >= ${filters.start}` : Prisma.empty;
    const endClause =
      filters.end !== undefined ? Prisma.sql`AND a."startDate" <= ${filters.end}` : Prisma.empty;
    const orderClause =
      sort === 'distance_desc'
        ? Prisma.sql`ORDER BY "distanceKm" DESC, a."id" ASC`
        : sort === 'id_asc'
          ? Prisma.sql`ORDER BY a."id" ASC`
          : sort === 'id_desc'
            ? Prisma.sql`ORDER BY a."id" DESC`
            : Prisma.sql`ORDER BY "distanceKm" ASC, a."id" ASC`;

    const rows = await this.prisma.client.$queryRaw<
      Array<{
        id: string;
        versionId: string;
        addressText: string | null;
        status: AdvertStatus;
        startDate: Date;
        endDate: Date;
        cityName: string | null;
        zoneName: string | null;
        imageHash: string | null;
        upstreamAdvertId: string | null;
        createdAt: Date;
        versionId2: string;
        versionNumber: number;
        versionStatus: ReviewStatus;
        creativeId: string;
        creativeName: string;
        brandId: string;
        brandName: string;
        isFlagged: boolean;
        industryCategory: string | null;
        mediaUrl: string;
        mediaType: string;
        location: string | null;
        distanceKm: number;
        radiusKm: number | null;
        total: number;
      }>
    >(Prisma.sql`
      SELECT a."id", a."version_id" AS "versionId", a."address_text" AS "addressText",
             a."status", a."start_date" AS "startDate", a."end_date" AS "endDate",
             a."city_name" AS "cityName", a."zone_name" AS "zoneName",
             a."image_hash" AS "imageHash", a."upstream_advert_id" AS "upstreamAdvertId",
             a."created_at" AS "createdAt",
             a."radius_km" AS "radiusKm",
             v."id" AS "versionId2", v."version_number" AS "versionNumber", v."status" AS "versionStatus",
             v."media_url" AS "mediaUrl", v."media_type" AS "mediaType",
             c."id" AS "creativeId", c."creative_name" AS "creativeName",
             b."id" AS "brandId", b."brand_name" AS "brandName", b."isFlagged" AS "isFlagged",
             b."industry_category" AS "industryCategory",
             ST_AsText(a."location") AS "location",
             ST_Distance(a."location"::geography, ST_MakePoint(${filters.lng}, ${filters.lat})::geography) / 1000 AS "distanceKm",
             COUNT(*) OVER() AS "total"
      FROM "Advert" a
      JOIN "CreativeVersion" v ON v."id" = a."version_id"
      JOIN "Creative" c ON c."id" = v."creative_id"
      JOIN "Brand" b ON b."id" = c."brand_id"
      WHERE ST_DWithin(a."location"::geography, ST_MakePoint(${filters.lng}, ${filters.lat})::geography, ${radiusKm * 1000})
        ${industryClause} ${brandClause} ${startClause} ${endClause}
      ${orderClause}
      LIMIT ${imageMode ? IMAGE_SEARCH_CANDIDATE_LIMIT : take} OFFSET ${imageMode ? 0 : skip}
    `);
    return {
      rows: rows.map((row) => this.toResponse(row, { ...row, distanceKm: Number(row.distanceKm) })),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
    };
  }

  private async plainSearch(
    filters: {
      industry?: string;
      brand_id?: string;
      start?: Date;
      end?: Date;
    },
    skip: number,
    take: number,
    imageMode = false,
  ): Promise<{ rows: AdvertResponseDto[]; total: number }> {
    // No coordinates: the same filters through Prisma (sort applies to geo mode only).
    const creative: Prisma.CreativeWhereInput = {
      ...(filters.brand_id ? { brandId: filters.brand_id } : {}),
      ...(filters.industry
        ? { brand: { is: { industryCategory: { equals: filters.industry, mode: 'insensitive' } } } }
        : {}),
    };
    const where: Prisma.AdvertWhereInput = {
      ...(Object.keys(creative).length ? { version: { creative } } : {}),
      ...(filters.start || filters.end
        ? {
            AND: [
              ...(filters.start ? [{ endDate: { gte: filters.start } }] : []),
              ...(filters.end ? [{ startDate: { lte: filters.end } }] : []),
            ],
          }
        : {}),
    };
    const [adverts, total] = await Promise.all([
      this.prisma.client.advert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: imageMode ? 0 : skip,
        take: imageMode ? IMAGE_SEARCH_CANDIDATE_LIMIT : take,
        include: { version: { include: { creative: { include: { brand: true } } } } },
      }),
      this.prisma.client.advert.count({ where }),
    ]);
    const locations = await this.fetchLocationWkt(adverts.map((advert) => advert.id));
    return {
      rows: adverts.map((advert) =>
        this.toResponse(advert, undefined, { location: locations.get(advert.id) ?? null }),
      ),
      total,
    };
  }

  /**
   * Best-effort search telemetry: a history write must never fail a search,
   * so failures are swallowed. Skipped for anonymous (no-actor) callers.
   * Stores a small media snapshot (top matches) so the revisit list can
   * render previews without re-running every stored search.
   */
  private async recordSearch(
    actorId: string | undefined,
    params: AdvertSearchEcho,
    resultCount: number,
    rows: AdvertResponseDto[] = [],
  ): Promise<void> {
    if (!actorId) return;
    try {
      await this.prisma.client.advertSearchHistory.create({
        data: {
          userId: actorId,
          params: params as unknown as Prisma.InputJsonValue,
          resultCount,
          preview: buildSearchPreview(rows) as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // History is auxiliary; the search result already stands.
    }
  }

  /** Revisit window: this operator's searches from the last 7 days, newest first. */
  async listRecentSearches(actorId: string): Promise<RecentAdvertSearch[]> {
    const since = new Date(Date.now() - RECENT_SEARCH_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.client.advertSearchHistory.findMany({
      where: { userId: actorId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: RECENT_SEARCH_LIMIT,
    });
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      params: row.params,
      adverts_matched: row.resultCount,
      preview: Array.isArray(row.preview) ? (row.preview as unknown as AdvertSearchPreview[]) : [],
      searched_at: row.createdAt,
      hours_ago: Math.round(((now - row.createdAt.getTime()) / 3600000) * 10) / 10,
    }));
  }

  /**
   * Government-origin status change (compliance: pause/revoke).
   * Optimistic locking via expectedStatus: a stale caller gets 409, as does
   * a row deleted between read and write — mirroring review takeAction.
   */
  async updateStatus(
    id: string,
    status: string,
    actorId: string,
    expectedStatus?: string,
    reason?: string,
  ): Promise<AdvertResponseDto> {
    if (!isAdvertStatus(status)) {
      throw new BadRequestException(
        `status must be one of: SCHEDULED, LIVE, PAUSED, EXPIRED, REVOKED`,
      );
    }
    const current = await this.prisma.client.advert.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Advert with ID ${id} not found`);
    if (expectedStatus !== undefined && current.status !== expectedStatus) {
      throw new ConflictException(
        'This advert has been updated by another user; refresh and retry',
      );
    }
    // Resume restores the pre-pause state from the schedule window: before
    // startDate the advert must go back to SCHEDULED (the system sweeper
    // promotes it to LIVE when due); inside the window it resumes to LIVE.
    // Forcing LIVE early or SCHEDULED late would desync the flight.
    if (current.status === AdvertStatus.PAUSED && (status as AdvertStatus) === AdvertStatus.LIVE) {
      const now = new Date();
      if (current.startDate > now) {
        throw new ConflictException(
          `Advert is scheduled to go live on ${current.startDate.toISOString()}; resume to SCHEDULED until its start date`,
        );
      }
      if (current.endDate < now) {
        throw new ConflictException('Advert flight window has ended; it cannot resume to LIVE');
      }
    }
    if (
      current.status === AdvertStatus.PAUSED &&
      (status as AdvertStatus) === AdvertStatus.SCHEDULED
    ) {
      const now = new Date();
      if (current.endDate < now) {
        throw new ConflictException(
          'Advert flight window has ended; it cannot resume to SCHEDULED',
        );
      }
      if (current.startDate <= now) {
        throw new ConflictException(
          'Advert start date has arrived; resume to LIVE instead of SCHEDULED',
        );
      }
    }
    assertAdvertTransition(current.status, status, 'govt');

    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.advert.updateMany({
        where: { id },
        data: { status: status as AdvertStatus },
      });
      if (saved.count === 0) {
        throw new ConflictException(
          'This advert has been updated by another user; refresh and retry',
        );
      }
      await this.activity.recordInTx(tx, {
        actorId,
        action: `advert.${status.toLowerCase()}`,
        entityType: 'Advert',
        entityId: id,
        metadata: { from_status: current.status, status, reason: reason?.trim() || null },
      });
      await this.outbox.emitInTx(tx, {
        eventType: STATUS_EVENT[status],
        entityType: 'Advert',
        entityId: id,
        actorId,
        key: id,
        payload: {
          advert_id: id,
          from_status: current.status,
          status,
          actor: actorId,
          reason: reason?.trim() || null,
        },
      });
    });

    return this.readEnriched(id);
  }

  /**
   * Multi-select bulk status change (Advert Control): replaces N ×
   * PATCH /:id/status with one request. Every advert is applied through the
   * standard single-advert path — identical optimistic-lock check, resume
   * window rules, audit trail, outbox events and reason payload. Adverts
   * that cannot accept the status (stale expected_status, flight window
   * rules, missing) are skipped with a per-id reason instead of failing the
   * batch; each applied advert commits in its own transaction.
   */
  async bulkStatus(
    ids: string[],
    status: string,
    actorId: string,
    expectedStatus?: string,
    reason?: string,
  ): Promise<{
    applied: { advert_id: string; status: string }[];
    skipped: { advert_id: string; reason: string }[];
  }> {
    if (!isAdvertStatus(status)) {
      throw new BadRequestException(
        `status must be one of: SCHEDULED, LIVE, PAUSED, EXPIRED, REVOKED`,
      );
    }
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new BadRequestException('ids must contain at least one non-empty advert id');
    }

    const applied: { advert_id: string; status: string }[] = [];
    const skipped: { advert_id: string; reason: string }[] = [];
    for (const id of unique) {
      try {
        await this.updateStatus(id, status, actorId, expectedStatus, reason);
        applied.push({ advert_id: id, status });
      } catch (error) {
        skipped.push({
          advert_id: id,
          reason:
            error instanceof HttpException ? error.message : 'unexpected error updating the advert',
        });
      }
    }
    return { applied, skipped };
  }

  /**
   * Upstream intake write for advert scheduling (UPSTREAM_INTEGRATION_API.md
   * §4.4). Idempotent on upstream_advert_id; schedule/location/address may only
   * change while SCHEDULED (409 otherwise).
   */
  async upsertFromUpstream(
    input: AdvertUpstreamInput,
  ): Promise<{ advert: AdvertResponseDto; created: boolean }> {
    assertCoordinates(input.lat, input.lng);
    assertDateRange(input.start_date, input.end_date);
    if (input.image_hash !== undefined && input.image_hash !== null) {
      assertImageHash(input.image_hash);
    }
    const version = await this.resolveVersionForUpstream(
      input.upstream_version_id,
      input.upstream_creative_id,
    );

    // Pre-approval booking: schedules arrive with the creative, so only
    // dead-end versions are refused. The compliance gate lives at go-live.
    if (!isSchedulableVersionStatus(version.status)) {
      await this.emitDeployBlocked(
        version.id,
        'version_not_schedulable',
        input.upstream_portal,
        version.status,
      );
      assertSchedulableVersionStatus(version.status);
    }
    if (version.creative.brand.isActive === false) {
      await this.emitDeployBlocked(
        version.id,
        'brand_inactive',
        input.upstream_portal,
        version.status,
      );
      throw new BadRequestException(
        'Brand is deactivated (global kill-switch); scheduling blocked',
      );
    }

    const existing = await this.prisma.client.advert.findUnique({
      where: { upstreamAdvertId: input.upstream_advert_id },
    });
    const wkt = `POINT(${input.lng} ${input.lat})`;

    if (existing) {
      if (existing.status !== AdvertStatus.SCHEDULED) {
        throw new ConflictException(
          'Schedule and location can only change while the advert is SCHEDULED',
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "Advert"
          SET "location" = ST_GeomFromText(${wkt}, 4326),
              "address_text" = ${input.address_text},
              "start_date" = ${input.start_date},
              "end_date" = ${input.end_date},
              "city_name" = ${input.city_name ?? null},
              "zone_name" = ${input.zone_name ?? null},
              "radius_km" = ${input.radius_km ?? null},
              "image_hash" = ${input.image_hash ?? null}
          WHERE "id" = ${existing.id}
        `;
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.advertScheduled,
          entityType: 'Advert',
          entityId: existing.id,
          actorId: input.upstream_portal,
          key: existing.id,
          payload: {
            advert_id: existing.id,
            version_id: version.id,
            creative_id: version.creative.id,
            brand_id: version.creative.brandId,
            lat: input.lat,
            lng: input.lng,
            address_text: input.address_text,
            start_date: input.start_date.toISOString(),
            end_date: input.end_date.toISOString(),
            city_name: input.city_name ?? null,
            zone_name: input.zone_name ?? null,
            radius_km: input.radius_km ?? null,
            image_hash: input.image_hash ?? null,
            updated: true,
            origin: 'upstream',
          },
        });
      });
      return { advert: await this.readEnriched(existing.id), created: false };
    }

    const advertId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "Advert" ("id", "version_id", "location", "address_text", "status", "start_date", "end_date", "city_name", "zone_name", "radius_km", "image_hash", "upstream_advert_id", "created_at")
        VALUES (${advertId}, ${version.id}, ST_GeomFromText(${wkt}, 4326), ${input.address_text}, ${AdvertStatus.SCHEDULED}::"AdvertStatus", ${input.start_date}, ${input.end_date}, ${input.city_name ?? null}, ${input.zone_name ?? null}, ${input.radius_km ?? null}, ${input.image_hash ?? null}, ${input.upstream_advert_id}, CURRENT_TIMESTAMP)
      `;
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.advertScheduled,
        entityType: 'Advert',
        entityId: advertId,
        actorId: input.upstream_portal,
        key: advertId,
        payload: {
          advert_id: advertId,
          version_id: version.id,
          creative_id: version.creative.id,
          brand_id: version.creative.brandId,
          upstream_advert_id: input.upstream_advert_id,
          lat: input.lat,
          lng: input.lng,
          address_text: input.address_text,
          start_date: input.start_date.toISOString(),
          end_date: input.end_date.toISOString(),
          city_name: input.city_name ?? null,
          zone_name: input.zone_name ?? null,
          radius_km: input.radius_km ?? null,
          image_hash: input.image_hash ?? null,
          origin: 'upstream',
        },
      });
    });
    return { advert: await this.readEnriched(advertId), created: true };
  }

  /** Upstream-origin lifecycle transition (no REVOKED — that is compliance-only). */
  async transitionFromUpstream(
    id: string,
    input: AdvertUpstreamTransitionInput,
  ): Promise<AdvertResponseDto> {
    let current = await this.prisma.client.advert.findUnique({ where: { id } });
    if (!current && input.upstream_portal !== undefined) {
      current = await this.prisma.client.advert.findUnique({ where: { upstreamAdvertId: id } });
    }
    if (!current) throw new NotFoundException(`Advert with ID ${id} not found`);
    // Upstream portal uses COMPLETED/CANCELLED where govt uses EXPIRED.
    const normalized = normalizeUpstreamAdvertStatus(input.status);
    if (!isAdvertStatus(normalized)) {
      throw new BadRequestException(
        `status must be one of: SCHEDULED, LIVE, PAUSED, EXPIRED, REVOKED`,
      );
    }
    // REVOKED is government-origin only — upstream attempts are conflicts (UPSTREAM_INTEGRATION_API.md §6.2).
    if ((normalized as AdvertStatus) === AdvertStatus.REVOKED) {
      throw new ConflictException('REVOKED is government-only; upstream cannot revoke adverts');
    }
    // WORKFLOWS.md §2.2: SCHEDULED goes LIVE only once the start date is reached.
    if (current.status === AdvertStatus.SCHEDULED && normalized === AdvertStatus.LIVE) {
      const now = input.occurred_at ? new Date(input.occurred_at) : new Date();
      if (!Number.isNaN(now.getTime()) && current.startDate > now) {
        throw new ConflictException(
          `Advert is scheduled to go live on ${current.startDate.toISOString()}; it cannot go LIVE before its start date`,
        );
      }
    }
    assertAdvertTransition(current.status, normalized, 'upstream');
    const nextStatus: AdvertStatus = normalized as AdvertStatus;

    await this.prisma.$transaction(async (tx) => {
      await tx.advert.updateMany({
        where: { id: current.id },
        data: { status: nextStatus },
      });
      await this.outbox.emitInTx(tx, {
        eventType: STATUS_EVENT[nextStatus],
        entityType: 'Advert',
        entityId: current.id,
        actorId: input.upstream_portal,
        key: current.id,
        payload: {
          advert_id: current.id,
          from_status: current.status,
          status: nextStatus,
          occurred_at: input.occurred_at ?? null,
          reason: input.reason ?? null,
          origin: 'upstream',
        },
      });
    });

    return this.readEnriched(current.id);
  }

  async findOne(id: string): Promise<AdvertResponseDto> {
    return this.readEnriched(id);
  }

  async findAll(
    query: AdvertListQueryDto,
  ): Promise<
    | { items: AdvertResponseDto[]; meta: StandardMeta }
    | { items: AdvertBrandGroupDto[]; meta: StandardMeta }
  > {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = toSkipTake({ page, limit, sortOrder: query.sortOrder ?? 'desc' });
    const where = buildAdvertWhere(query);
    const [adverts, total] = await Promise.all([
      this.prisma.client.advert.findMany({
        where,
        orderBy: advertOrderBy(query.sortBy, query.sortOrder ?? 'desc'),
        skip,
        take,
        include: { version: { include: { creative: { include: { brand: true } } } } },
      }),
      this.prisma.client.advert.count({ where }),
    ]);
    const locations = await this.fetchLocationWkt(adverts.map((advert) => advert.id));
    const rows = adverts.map((advert) =>
      this.toResponse(advert, undefined, { location: locations.get(advert.id) ?? null }),
    );
    if (query.group_by === 'brand') {
      const items = groupAdvertsByBrand(rows);
      return { items, meta: standardMeta(total, page, limit, items.length) };
    }
    return { items: rows, meta: standardMeta(total, page, limit, rows.length) };
  }

  /** Flat projection used by the CSV export (same filter set as list). */
  async exportAdverts(filters: AdvertListFilters): Promise<AdvertExportRow[]> {
    const where = buildAdvertWhere(filters);
    const adverts = await this.prisma.client.advert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { version: { include: { creative: { include: { brand: true } } } } },
    });
    const locations = await this.fetchLocationWkt(adverts.map((advert) => advert.id));
    return adverts.map((advert) => {
      const version = advert.version;
      return {
        id: advert.id,
        version_id: advert.versionId,
        creative: version?.creative.creativeName ?? '',
        brand: version?.creative.brand.brandName ?? '',
        status: advert.status,
        address: advert.addressText,
        location: locations.get(advert.id) ?? null,
        radius_km: advert.radiusKm ?? null,
        start_date: advert.startDate,
        end_date: advert.endDate,
        city: advert.cityName,
        zone: advert.zoneName,
      };
    });
  }

  /**
   * Schedule sweeper (system origin): due SCHEDULED rows go LIVE only for
   * APPROVED versions — pre-approval bookings wait out their window as
   * SCHEDULED until the review decision lands. Rows whose window already
   * closed go EXPIRED regardless. The future monorepo scheduler owns this
   * cadence; the test intake calls it on demand.
   */
  async syncDueSchedules(
    now: Date,
    actorId = 'system',
  ): Promise<{ promoted: number; expired: number; at: Date }> {
    const due = await this.prisma.client.advert.findMany({
      where: {
        status: 'SCHEDULED',
        startDate: { lte: now },
        endDate: { gte: now },
        version: { status: ReviewStatus.APPROVED },
      },
      select: { id: true, status: true },
    });
    const overdue = await this.prisma.client.advert.findMany({
      where: { status: 'SCHEDULED', endDate: { lt: now } },
      select: { id: true, status: true },
    });
    for (const row of due) {
      await this.applySystemTransition(row.id, row.status, 'LIVE', actorId);
    }
    for (const row of overdue) {
      await this.applySystemTransition(row.id, row.status, 'EXPIRED', actorId);
    }
    return { promoted: due.length, expired: overdue.length, at: now };
  }

  private async applySystemTransition(
    id: string,
    from: AdvertStatus,
    to: AdvertStatus,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.advert.updateMany({
        where: { id, status: from },
        data: { status: to },
      });
      if (saved.count === 0) return;
      await this.activity.recordInTx(tx, {
        actorId,
        action: `advert.${to.toLowerCase()}`,
        entityType: 'Advert',
        entityId: id,
        metadata: { from_status: from, status: to, origin: 'system' },
      });
      await this.outbox.emitInTx(tx, {
        eventType: STATUS_EVENT[to],
        entityType: 'Advert',
        entityId: id,
        actorId,
        key: id,
        payload: { advert_id: id, from_status: from, status: to, origin: 'system' },
      });
    });
  }

  private async emitDeployBlocked(
    versionId: string,
    reason: string,
    actorId: string | undefined,
    status: string,
  ): Promise<void> {
    await this.outbox.emit({
      eventType: EventTypes.advertDeployBlocked,
      entityType: 'CreativeVersion',
      entityId: versionId,
      key: versionId,
      actorId,
      payload: { version_id: versionId, reason, status },
    });
  }

  private async resolveVersionForUpstream(
    upstreamVersionId: string,
    upstreamCreativeId: string,
  ): Promise<VersionWithContext> {
    const version =
      (await this.prisma.client.creativeVersion.findUnique({
        where: { upstreamVersionId },
        include: { creative: { include: { brand: true } } },
      })) ??
      (await this.prisma.client.creativeVersion.findUnique({
        where: { id: upstreamVersionId },
        include: { creative: { include: { brand: true } } },
      }));
    if (!version) throw new NotFoundException(`Creative version ${upstreamVersionId} not found`);
    if (version.creative.upstreamCreativeId !== upstreamCreativeId) {
      throw new BadRequestException('Version does not belong to the upstream creative');
    }
    return version;
  }

  /**
   * WKT locations for a page of rows. Prisma cannot project the PostGIS
   * column, so one ST_AsText query covers list/findOne/export fallbacks.
   */
  private async fetchLocationWkt(ids: string[]): Promise<Map<string, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string; wkt: string | null }>>(
      Prisma.sql`SELECT "id", ST_AsText("location") AS "wkt" FROM "Advert" WHERE "id" IN (${Prisma.join(ids)})`,
    );
    return new Map(rows.map((row) => [row.id, row.wkt]));
  }

  /** Re-read with version context + WKT location merged in. */
  private async readEnriched(id: string): Promise<AdvertResponseDto> {
    const row = await this.prisma.client.advert.findUnique({
      where: { id },
      include: { version: { include: { creative: { include: { brand: true } } } } },
    });
    if (!row) throw new NotFoundException(`Advert with ID ${id} not found`);
    const locations = await this.fetchLocationWkt([id]);
    return this.toResponse(row, undefined, { location: locations.get(id) ?? null });
  }

  private toResponse(
    advert:
      | Prisma.AdvertGetPayload<{
          include: { version: { include: { creative: { include: { brand: true } } } } };
        }>
      | Prisma.AdvertGetPayload<object>,
    geo?: {
      versionId2: string;
      versionNumber: number;
      versionStatus: ReviewStatus;
      creativeId: string;
      creativeName: string;
      brandId: string;
      brandName: string;
      isFlagged: boolean;
      industryCategory: string | null;
      mediaUrl: string;
      mediaType: string;
      location: string | null;
      distanceKm: number | null;
    },
    extra?: { location?: string | null; distanceKm?: number | null; hashDistance?: number | null },
  ): AdvertResponseDto {
    const withVersion = advert as Prisma.AdvertGetPayload<{
      include: { version: { include: { creative: { include: { brand: true } } } } };
    }>;
    const version = geo
      ? {
          id: geo.versionId2,
          version_number: geo.versionNumber,
          status: geo.versionStatus,
          creative_id: geo.creativeId,
          creative_name: geo.creativeName,
          brand: { id: geo.brandId, brand_name: geo.brandName, is_flagged: geo.isFlagged },
        }
      : withVersion.version
        ? {
            id: withVersion.version.id,
            version_number: withVersion.version.versionNumber,
            status: withVersion.version.status,
            creative_id: withVersion.version.creative.id,
            creative_name: withVersion.version.creative.creativeName,
            brand: {
              id: withVersion.version.creative.brand.id,
              brand_name: withVersion.version.creative.brand.brandName,
              is_flagged: withVersion.version.creative.brand.isFlagged,
            },
          }
        : null;
    return plainToInstance(
      AdvertResponseDto,
      {
        id: advert.id,
        version_id: advert.versionId,
        status: advert.status,
        address_text: advert.addressText,
        start_date: advert.startDate,
        end_date: advert.endDate,
        city_name: advert.cityName,
        zone_name: advert.zoneName,
        image_hash: advert.imageHash,
        upstream_advert_id: advert.upstreamAdvertId,
        created_at: advert.createdAt,
        version,
        location: geo?.location ?? extra?.location ?? null,
        radius_km: advert.radiusKm ?? null,
        media_url: geo?.mediaUrl ?? withVersion.version?.mediaUrl ?? null,
        media_type: geo?.mediaType ?? withVersion.version?.mediaType ?? null,
        creative_name: version?.creative_name ?? null,
        creative_id: version?.creative_id ?? null,
        industry:
          geo?.industryCategory ?? withVersion.version?.creative.brand.industryCategory ?? null,
        distance_km:
          geo?.distanceKm !== undefined && geo?.distanceKm !== null
            ? Math.round(geo.distanceKm * 1000) / 1000
            : (extra?.distanceKm ?? null),
        hash_distance: extra?.hashDistance ?? null,
        available_actions: availableGovtActions(advert.status),
      },
      { excludeExtraneousValues: true },
    );
  }
}
