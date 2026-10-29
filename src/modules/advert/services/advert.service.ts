import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Prisma, AdvertStatus, ReviewStatus, UserRole } from '@prisma/client';
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
  ADVERT_STATUSES,
  assertAdvertTransition,
  assertCoordinates,
  assertDateRange,
  assertSchedulableVersionStatus,
  assertTimeOfDay,
  availableGovtActions,
  formatTimeRange,
  isAdvertStatus,
  isSchedulableVersionStatus,
  normalizeDailyTimeWindow,
  normalizeDailyWindowFilter,
  normalizeMultiValue,
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
  /** Recurring daily display window (HH:mm); both or neither. */
  time_slot_start?: string | null;
  time_slot_end?: string | null;
  city_name?: string | null;
  zone_name?: string | null;
  /** Coverage radius in metres. */
  radius_m?: number | null;
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
  brand_id?: string | string[];
  brandId?: string | string[];
  search?: string;
  industry?: string | string[];
  brand_status?: 'flagged' | 'notflagged';
  city?: string;
  zone?: string;
  start_date?: string;
  end_date?: string;
  /** Exact campaign time bounds; only valid together with both dates. */
  start_time?: string;
  end_time?: string;
  /** Recurring daily display window overlap filter. */
  time_slot_start?: string;
  time_slot_end?: string;
  /** Legacy instant bounds used by GET /adverts/search. */
  start?: Date;
  end?: Date;
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
    proximity: row.distance_m ?? null,
    distance_m: row.distance_m ?? null,
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

/** Echo multi-select values as the stable comma-separated query form. */
function echoMultiValue(value: string | string[] | null | undefined): string | null {
  const values = normalizeMultiValue(value);
  return values.length ? values.join(',') : null;
}

export interface AdvertSearchEcho {
  lat: number | null;
  lng: number | null;
  /** Proximity radius in metres. */
  radius_m: number | null;
  industry: string | null;
  brand_id: string | null;
  start: string | null;
  end: string | null;
  /** Date-range filter echoed exactly as supplied. */
  start_date: string | null;
  end_date: string | null;
  /** Exact campaign time-window filter. */
  start_time: string | null;
  end_time: string | null;
  /** Recurring daily-window overlap filter. */
  time_slot_start: string | null;
  time_slot_end: string | null;
  sort: AdvertSearchSort;
  query_hash: string | null;
  max_distance: number | null;
  /** Free-text search captured by GET /adverts?search=... (not geo mode). */
  search?: string | null;
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
  proximity: number | null;
  distance_m: number | null;
}

/** Preview rows kept per history entry (first page only). */
export const RECENT_SEARCH_PREVIEW_LIMIT = 4;

/** 7-day revisit window for recent searches. */
export const RECENT_SEARCH_DAYS = 7;

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Stable identity for one logical search. Multi-select filters are order
 * independent, and object key order from JSONB is irrelevant, so repeated
 * requests for the same search resolve to the same key.
 */
function searchHistoryKey(params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return stableJson(params);
  }
  const normalized: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  for (const field of ['industry', 'brand_id'] as const) {
    const value = normalized[field];
    if (typeof value === 'string' || Array.isArray(value)) {
      normalized[field] = normalizeMultiValue(value).sort().join(',') || null;
    }
  }
  return stableJson(normalized);
}

export interface AdvertExportRow {
  id: string;
  version_id: string;
  creative: string;
  brand: string;
  status: string;
  address: string | null;
  location: string | null;
  radius_m: number | null;
  start_date: Date;
  end_date: Date;
  time_slot_start: string | null;
  time_slot_end: string | null;
  time_range: string | null;
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

function hasValue(value: string | undefined | null): value is string {
  return value !== undefined && value !== null && value.trim() !== '';
}

/**
 * Combines a date value with an HH:mm time in UTC. The end boundary covers
 * the whole minute so a `17:00` end includes events at 17:00:30.
 */
function combineDateAndTime(value: string, time: string, endOfMinute = false): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date');
  const [hours, minutes] = time.split(':').map(Number);
  const combined = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, 0, 0),
  );
  if (endOfMinute) combined.setUTCSeconds(59, 999);
  return combined;
}

interface AdvertTimeBounds {
  start?: Date;
  end?: Date;
  exact?: { from: Date; to: Date };
}

/**
 * Resolves schedule-time filters. Exact time ranges require both dates;
 * date-only filters keep the existing inclusive-day overlap behaviour.
 */
function resolveAdvertTimeBounds(filters: AdvertListFilters): AdvertTimeBounds {
  const hasStartTime = hasValue(filters.start_time);
  const hasEndTime = hasValue(filters.end_time);
  if (hasStartTime || hasEndTime) {
    if (!hasStartTime || !hasEndTime) {
      throw new BadRequestException('start_time and end_time must be provided together');
    }
    if (!hasValue(filters.start_date) || !hasValue(filters.end_date)) {
      throw new BadRequestException('start_time and end_time require both start_date and end_date');
    }
    const startTime = assertTimeOfDay(filters.start_time as string, 'start_time');
    const endTime = assertTimeOfDay(filters.end_time as string, 'end_time');
    const from = combineDateAndTime(filters.start_date as string, startTime);
    const to = combineDateAndTime(filters.end_date as string, endTime, true);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('start_date/start_time must be before end_date/end_time');
    }
    return { exact: { from, to } };
  }

  let start = filters.start;
  let end = filters.end;
  if (hasValue(filters.start_date)) {
    start = dayStart(filters.start_date as string);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Invalid start_date');
  }
  if (hasValue(filters.end_date)) {
    end = dayEnd(filters.end_date as string);
    if (Number.isNaN(end.getTime())) throw new BadRequestException('Invalid end_date');
  }
  if (start && end && start.getTime() > end.getTime()) {
    throw new BadRequestException('start_date must be on or before end_date');
  }
  return { start, end };
}

/** Prisma predicate for a stored daily window overlapping the requested one. */
function dailyWindowWhere(window: { start?: string; end?: string }): Prisma.AdvertWhereInput {
  if (window.start !== undefined && window.end !== undefined) {
    return {
      OR: [
        { timeSlotStart: null },
        {
          AND: [{ timeSlotStart: { lte: window.end } }, { timeSlotEnd: { gte: window.start } }],
        },
      ],
    };
  }
  if (window.start !== undefined) {
    return { OR: [{ timeSlotStart: null }, { timeSlotEnd: { gte: window.start } }] };
  }
  return { OR: [{ timeSlotStart: null }, { timeSlotStart: { lte: window.end } }] };
}

/**
 * Shared list/export predicate. Schedule-window filters overlap
 * [startDate, endDate]: start_date keeps rows ending on/after it, end_date
 * keeps rows starting on/before it. Exact start_time/end_time refine that
 * window when all four values are supplied; the daily window is matched
 * independently because it is a recurring display annotation.
 */
export function buildAdvertWhere(filters: AdvertListFilters): Prisma.AdvertWhereInput {
  if (filters.status !== undefined && !isAdvertStatus(filters.status)) {
    throw new BadRequestException(`status must be one of: ${ADVERT_STATUSES.join(', ')}`);
  }
  const brandIds = normalizeMultiValue([
    ...normalizeMultiValue(filters.brandId),
    ...normalizeMultiValue(filters.brand_id),
  ]);
  const industries = normalizeMultiValue(filters.industry);
  const search = filters.search?.trim();
  const bounds = resolveAdvertTimeBounds(filters);
  const dailyWindow = normalizeDailyWindowFilter(filters.time_slot_start, filters.time_slot_end);
  const scheduleFilters: Prisma.AdvertWhereInput[] = [];
  if (bounds.exact) {
    scheduleFilters.push(
      { endDate: { gte: bounds.exact.from } },
      { startDate: { lte: bounds.exact.to } },
    );
  } else {
    if (bounds.start) scheduleFilters.push({ endDate: { gte: bounds.start } });
    if (bounds.end) scheduleFilters.push({ startDate: { lte: bounds.end } });
  }
  if (dailyWindow) scheduleFilters.push(dailyWindowWhere(dailyWindow));
  const creative: Prisma.CreativeWhereInput = {
    ...(brandIds.length ? { brandId: { in: brandIds } } : {}),
    ...(industries.length || filters.brand_status
      ? {
          brand: {
            is: {
              ...(industries.length
                ? { industryCategory: { in: industries, mode: 'insensitive' as const } }
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
    ...(search
      ? {
          OR: [
            { id: { contains: search } },
            { addressText: { contains: search, mode: 'insensitive' } },
            { cityName: { contains: search, mode: 'insensitive' } },
            { zoneName: { contains: search, mode: 'insensitive' } },
            {
              version: {
                creative: {
                  creativeName: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              version: {
                creative: {
                  brand: { is: { brandName: { contains: search, mode: 'insensitive' } } },
                },
              },
            },
            {
              version: {
                creative: {
                  brand: {
                    is: { industryCategory: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        }
      : {}),
    ...(filters.city ? { cityName: { contains: filters.city, mode: 'insensitive' } } : {}),
    ...(filters.zone ? { zoneName: { contains: filters.zone, mode: 'insensitive' } } : {}),
    ...(scheduleFilters.length ? { AND: scheduleFilters } : {}),
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
      /** Recurring daily display window (HH:mm); both or neither. */
      time_slot_start?: string | null;
      time_slot_end?: string | null;
      city_name?: string | null;
      zone_name?: string | null;
      /** Coverage radius in metres. */
      radius?: number | null;
      image_hash?: string | null;
    },
    actorId: string,
  ): Promise<AdvertResponseDto> {
    assertCoordinates(dto.lat, dto.lng);
    assertDateRange(dto.start_date, dto.end_date);
    const dailyWindow = normalizeDailyTimeWindow(dto.time_slot_start, dto.time_slot_end);
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
        INSERT INTO "Advert" ("id", "version_id", "location", "address_text", "status", "start_date", "end_date", "time_slot_start", "time_slot_end", "city_name", "zone_name", "radius_m", "image_hash", "created_at")
        VALUES (${advertId}, ${version.id}, ST_GeomFromText(${wkt}, 4326), ${dto.address_text}, ${AdvertStatus.SCHEDULED}::"AdvertStatus", ${dto.start_date}, ${dto.end_date}, ${dailyWindow?.start ?? null}, ${dailyWindow?.end ?? null}, ${dto.city_name ?? null}, ${dto.zone_name ?? null}, ${dto.radius ?? null}, ${dto.image_hash ?? null}, CURRENT_TIMESTAMP)
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
          time_slot_start: dailyWindow?.start ?? null,
          time_slot_end: dailyWindow?.end ?? null,
          city_name: dto.city_name ?? null,
          zone_name: dto.zone_name ?? null,
          radius_m: dto.radius ?? null,
          image_hash: dto.image_hash ?? null,
        },
      });
    });

    return this.readEnriched(advertId);
  }

  /**
   * Location search (Advert Control). The location is always plain text:
   * lat/lng are never accepted, and the searched text resolves to an anchor
   * (lat/lng) at query time from the advert inventory's own city/zone/address
   * data. Radius (radius_m, metres) requires that location — it cannot stand
   * alone; a location without a radius matches all text-matching rows, sorted
   * by proximity, with no distance cut-off. Every result row carries
   * proximity (metres) measured from the resolved anchor. The searched text
   * also stays a row filter (ids, address, city, zone, creative, brand,
   * industry) so location and advanced filters AND-combine; unmappable text
   * yields an empty result set. All distances are in metres.
   */
  async searchByRadius(filters: {
    /** Resolve search radius in metres; requires a location search. */
    radius_m?: number;
    industry?: string | string[];
    search?: string;
    brand_id?: string | string[];
    status?: string;
    brand_status?: 'flagged' | 'notflagged';
    city?: string;
    zone?: string;
    start_date?: string;
    end_date?: string;
    start_time?: string;
    end_time?: string;
    time_slot_start?: string;
    time_slot_end?: string;
    ids?: string[];
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
    // lat/lng are out of contract: location is searched as text only.
    const raw = filters as unknown as Record<string, unknown>;
    if (raw.lat !== undefined || raw.lng !== undefined) {
      throw new BadRequestException('location is searched as text only; lat/lng are not accepted');
    }
    const radiusM = filters.radius_m;
    const search = filters.search?.trim() || undefined;
    if (radiusM !== undefined && !search) {
      throw new BadRequestException(
        'radius_m cannot be searched alone; supply a location (search) too',
      );
    }
    // Validate/normalize the shared filter set before resolving anything.
    buildAdvertWhere(filters);

    // Resolve the searched place to an anchor at query time from the
    // inventory's own city/zone/address data.
    const anchor = search ? await this.resolveSearchAnchor(search) : null;
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
      lat: anchor?.lat ?? null,
      lng: anchor?.lng ?? null,
      radius_m: anchor !== null && radiusM !== undefined ? radiusM : null,
      industry: echoMultiValue(filters.industry),
      search: search ?? null,
      brand_id: echoMultiValue(filters.brand_id),
      start: filters.start?.toISOString() ?? filters.start_date ?? null,
      end: filters.end?.toISOString() ?? filters.end_date ?? null,
      start_date: filters.start_date ?? null,
      end_date: filters.end_date ?? null,
      start_time: filters.start_time ?? null,
      end_time: filters.end_time ?? null,
      time_slot_start: filters.time_slot_start ?? null,
      time_slot_end: filters.time_slot_end ?? null,
      sort,
      query_hash: filters.image_hash ?? null,
      max_distance: imageMode ? maxDistance : null,
    };
    let rows: AdvertResponseDto[];
    let total: number;
    if (search && !anchor) {
      // The searched text maps to no known place: empty result set.
      rows = [];
      total = 0;
    } else if (anchor) {
      // Geo mode: the anchor always comes from the searched text. Radius
      // filters rows only when supplied; proximity is measured on every row
      // and the searched text stays a row filter alongside the advanced ones.
      ({ rows, total } = await this.geoSearch(
        filters,
        anchor,
        radiusM ?? null,
        sort,
        skip,
        take,
        imageMode,
      ));
    } else {
      // No location: plain filtered list (proximity stays null).
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
   * Resolve a text location to coordinates from the advert inventory itself.
   * Exact city/zone/address matches win over fuzzy matches; the latest exact
   * row is used so the anchor is always a real mapped site.
   */
  private async resolveSearchAnchor(search: string): Promise<{ lat: number; lng: number } | null> {
    const term = search.trim();
    if (!term) return null;
    const pattern = `%${term}%`;
    const rows = await this.prisma.client.$queryRaw<Array<{ lat: unknown; lng: unknown }>>(
      Prisma.sql`
        SELECT ST_Y(a."location") AS "lat", ST_X(a."location") AS "lng"
        FROM "Advert" a
        WHERE (
          a."city_name" ILIKE ${term}
          OR a."zone_name" ILIKE ${term}
          OR a."address_text" ILIKE ${term}
          OR a."city_name" ILIKE ${pattern}
          OR a."zone_name" ILIKE ${pattern}
          OR a."address_text" ILIKE ${pattern}
        )
        ORDER BY CASE
          WHEN a."city_name" ILIKE ${term} THEN 0
          WHEN a."zone_name" ILIKE ${term} THEN 1
          WHEN a."address_text" ILIKE ${term} THEN 2
          WHEN a."city_name" ILIKE ${pattern} THEN 3
          WHEN a."zone_name" ILIKE ${pattern} THEN 4
          ELSE 5
        END, a."created_at" DESC, a."id" ASC
        LIMIT 1
      `,
    );
    const anchor = rows[0];
    if (!anchor) return null;
    const lat = Number(anchor.lat);
    const lng = Number(anchor.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
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
      brand_id?: string | string[];
      industry?: string | string[];
      brand_status?: 'flagged' | 'notflagged';
      city?: string;
      zone?: string;
      start_date?: string;
      end_date?: string;
      start_time?: string;
      end_time?: string;
      time_slot_start?: string;
      time_slot_end?: string;
      ids?: string[];
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
      where: buildAdvertWhere(opts),
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
      radius_m: null,
      industry: echoMultiValue(opts.industry),
      brand_id: echoMultiValue(opts.brand_id),
      start: opts.start_date ?? null,
      end: opts.end_date ?? null,
      start_date: opts.start_date ?? null,
      end_date: opts.end_date ?? null,
      start_time: opts.start_time ?? null,
      end_time: opts.end_time ?? null,
      time_slot_start: opts.time_slot_start ?? null,
      time_slot_end: opts.time_slot_end ?? null,
      sort: 'distance_asc',
      query_hash: queryHash,
      max_distance: maxDistance,
    };
    await this.recordSearch(opts.actor_id, echo, total, rows);
    return { items: rows, meta: standardMeta(total, page, limit, rows.length), search: echo };
  }

  private async geoSearch(
    filters: {
      industry?: string | string[];
      search?: string;
      brand_id?: string | string[];
      status?: string;
      brand_status?: 'flagged' | 'notflagged';
      city?: string;
      zone?: string;
      start?: Date;
      end?: Date;
      start_date?: string;
      end_date?: string;
      start_time?: string;
      end_time?: string;
      time_slot_start?: string;
      time_slot_end?: string;
      ids?: string[];
    },
    anchor: { lat: number; lng: number },
    radiusM: number | null,
    sort: AdvertSearchSort,
    skip: number,
    take: number,
    imageMode = false,
  ): Promise<{ rows: AdvertResponseDto[]; total: number }> {
    // Caller guarantees the anchor is resolved (from the searched text) here.
    assertCoordinates(anchor.lat, anchor.lng);
    const timeBounds = resolveAdvertTimeBounds(filters);
    const dailyWindow = normalizeDailyWindowFilter(filters.time_slot_start, filters.time_slot_end);
    // Image ranking happens in memory: pull the candidate pool, rank below.
    const industries = normalizeMultiValue(filters.industry);
    const brandIds = normalizeMultiValue(filters.brand_id);
    const industryClause = industries.length
      ? Prisma.sql`AND LOWER(b."industry_category") IN (${Prisma.join(
          industries.map((value) => value.toLowerCase()),
        )})`
      : Prisma.empty;
    const brandClause = brandIds.length
      ? Prisma.sql`AND c."brand_id" IN (${Prisma.join(brandIds)})`
      : Prisma.empty;
    const statusClause =
      filters.status !== undefined
        ? Prisma.sql`AND a."status" = ${filters.status}::"AdvertStatus"`
        : Prisma.empty;
    const brandStatusClause =
      filters.brand_status !== undefined
        ? Prisma.sql`AND b."isFlagged" = ${filters.brand_status === 'flagged'}`
        : Prisma.empty;
    const cityClause = filters.city
      ? Prisma.sql`AND a."city_name" ILIKE ${`%${filters.city}%`}`
      : Prisma.empty;
    const zoneClause = filters.zone
      ? Prisma.sql`AND a."zone_name" ILIKE ${`%${filters.zone}%`}`
      : Prisma.empty;
    const idsClause = filters.ids?.length
      ? Prisma.sql`AND a."id" IN (${Prisma.join(filters.ids)})`
      : Prisma.empty;
    let dateClause: Prisma.Sql;
    if (timeBounds.exact) {
      dateClause = Prisma.sql`AND a."end_date" >= ${timeBounds.exact.from} AND a."start_date" <= ${timeBounds.exact.to}`;
    } else {
      const startPart = timeBounds.start
        ? Prisma.sql`AND a."end_date" >= ${timeBounds.start}`
        : Prisma.empty;
      const endPart = timeBounds.end
        ? Prisma.sql`AND a."start_date" <= ${timeBounds.end}`
        : Prisma.empty;
      dateClause = Prisma.sql`${startPart} ${endPart}`;
    }
    let dailyClause = Prisma.empty;
    if (dailyWindow?.start !== undefined && dailyWindow?.end !== undefined) {
      dailyClause = Prisma.sql`AND (a."time_slot_start" IS NULL OR (a."time_slot_start" <= ${dailyWindow.end} AND a."time_slot_end" >= ${dailyWindow.start}))`;
    } else if (dailyWindow?.start !== undefined) {
      dailyClause = Prisma.sql`AND (a."time_slot_start" IS NULL OR a."time_slot_end" >= ${dailyWindow.start})`;
    } else if (dailyWindow?.end !== undefined) {
      dailyClause = Prisma.sql`AND (a."time_slot_start" IS NULL OR a."time_slot_start" <= ${dailyWindow.end})`;
    }
    const search = filters.search?.trim();
    const searchClause = search
      ? Prisma.sql`AND (
          a."id" ILIKE ${`%${search}%`}
          OR a."address_text" ILIKE ${`%${search}%`}
          OR a."city_name" ILIKE ${`%${search}%`}
          OR a."zone_name" ILIKE ${`%${search}%`}
          OR c."creative_name" ILIKE ${`%${search}%`}
          OR b."brand_name" ILIKE ${`%${search}%`}
          OR b."industry_category" ILIKE ${`%${search}%`}
        )`
      : Prisma.empty;
    const orderClause =
      sort === 'distance_desc'
        ? Prisma.sql`ORDER BY "distanceM" DESC, a."id" ASC`
        : sort === 'id_asc'
          ? Prisma.sql`ORDER BY a."id" ASC`
          : sort === 'id_desc'
            ? Prisma.sql`ORDER BY a."id" DESC`
            : Prisma.sql`ORDER BY "distanceM" ASC, a."id" ASC`;

    // Radius is optional in geo mode: with one we cut by distance, without
    // one, every text-matching row counts and is ranked by proximity.
    const placementClause =
      radiusM !== null
        ? Prisma.sql`ST_DWithin(a."location"::geography, ST_MakePoint(${anchor.lng}, ${anchor.lat})::geography, ${radiusM})`
        : Prisma.sql`TRUE`;
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        id: string;
        versionId: string;
        addressText: string | null;
        status: AdvertStatus;
        startDate: Date;
        endDate: Date;
        timeSlotStart: string | null;
        timeSlotEnd: string | null;
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
        distanceM: number;
        radiusM: number | null;
        total: number;
      }>
    >(Prisma.sql`
      SELECT a."id", a."version_id" AS "versionId", a."address_text" AS "addressText",
             a."status", a."start_date" AS "startDate", a."end_date" AS "endDate",
             a."time_slot_start" AS "timeSlotStart", a."time_slot_end" AS "timeSlotEnd",
             a."city_name" AS "cityName", a."zone_name" AS "zoneName",
             a."image_hash" AS "imageHash", a."upstream_advert_id" AS "upstreamAdvertId",
             a."created_at" AS "createdAt",
             a."radius_m" AS "radiusM",
             v."id" AS "versionId2", v."version_number" AS "versionNumber", v."status" AS "versionStatus",
             v."media_url" AS "mediaUrl", v."media_type" AS "mediaType",
             c."id" AS "creativeId", c."creative_name" AS "creativeName",
             b."id" AS "brandId", b."brand_name" AS "brandName", b."isFlagged" AS "isFlagged",
             b."industry_category" AS "industryCategory",
             ST_AsText(a."location") AS "location",
             ST_Distance(a."location"::geography, ST_MakePoint(${anchor.lng}, ${anchor.lat})::geography) AS "distanceM",
             COUNT(*) OVER() AS "total"
      FROM "Advert" a
      JOIN "CreativeVersion" v ON v."id" = a."version_id"
      JOIN "Creative" c ON c."id" = v."creative_id"
      JOIN "Brand" b ON b."id" = c."brand_id"
      WHERE ${placementClause}
        ${industryClause} ${brandClause} ${statusClause} ${brandStatusClause}
        ${cityClause} ${zoneClause} ${idsClause} ${dateClause} ${dailyClause} ${searchClause}
      ${orderClause}
      LIMIT ${imageMode ? IMAGE_SEARCH_CANDIDATE_LIMIT : take} OFFSET ${imageMode ? 0 : skip}
    `);
    return {
      rows: rows.map((row) => this.toResponse(row, { ...row, distanceM: Number(row.distanceM) })),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
    };
  }

  private async plainSearch(
    filters: AdvertListFilters,
    skip: number,
    take: number,
    imageMode = false,
  ): Promise<{ rows: AdvertResponseDto[]; total: number }> {
    // No location: the same filters through Prisma (sort and proximity apply
    // to geo mode only). Adverts without a location keep matching.
    const where = buildAdvertWhere(filters);
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
    rows: AdvertResponseDto[] | AdvertBrandGroupDto[] = [],
  ): Promise<void> {
    if (!actorId) return;
    try {
      const paramsJson = params as unknown as Prisma.InputJsonValue;
      const preview = buildSearchPreview(rows) as unknown as Prisma.InputJsonValue;
      const key = searchHistoryKey(params);
      const since = new Date(Date.now() - RECENT_SEARCH_DAYS * 24 * 60 * 60 * 1000);
      const existing = await this.prisma.client.advertSearchHistory.findMany({
        where: { userId: actorId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, params: true },
      });
      const duplicates = existing.filter((row) => searchHistoryKey(row.params) === key);
      if (duplicates.length > 0) {
        // One logical search gets one history row even if the client retries
        // or fires duplicate requests. Keep the newest snapshot and refresh it.
        await this.prisma.client.advertSearchHistory.update({
          where: { id: duplicates[0].id },
          data: {
            params: paramsJson,
            resultCount,
            preview,
            createdAt: new Date(),
          },
        });
        if (duplicates.length > 1) {
          await this.prisma.client.advertSearchHistory.deleteMany({
            where: { id: { in: duplicates.slice(1).map((row) => row.id) } },
          });
        }
        return;
      }
      await this.prisma.client.advertSearchHistory.create({
        data: {
          userId: actorId,
          params: paramsJson,
          resultCount,
          preview,
        },
      });
    } catch {
      // History is auxiliary; the search result already stands.
    }
  }

  /**
   * Revisit window: searches from the last 7 days, newest first.
   * Admins see the team's searches (the Advert Control modal promises "all
   * advert searches from the past week"); employees see their own history.
   */
  async listRecentSearches(actorId: string, actorRole?: UserRole): Promise<RecentAdvertSearch[]> {
    const canViewTeam = actorRole === UserRole.SUPER_ADMIN || actorRole === UserRole.ADMIN;
    const since = new Date(Date.now() - RECENT_SEARCH_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.client.advertSearchHistory.findMany({
      where: {
        createdAt: { gte: since },
        ...(canViewTeam ? {} : { userId: actorId }),
      },
      orderBy: { createdAt: 'desc' },
    });
    // Existing rows may predate write-time coalescing. Collapse identical
    // searches per user here as well, keeping the newest row (already first).
    const seen = new Set<string>();
    const uniqueRows = rows.filter((row) => {
      const key = `${row.userId}\u0000${searchHistoryKey(row.params)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const now = Date.now();
    return uniqueRows.map((row) => ({
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
    const dailyWindow = normalizeDailyTimeWindow(input.time_slot_start, input.time_slot_end);
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
              "time_slot_start" = ${dailyWindow?.start ?? null},
              "time_slot_end" = ${dailyWindow?.end ?? null},
              "city_name" = ${input.city_name ?? null},
              "zone_name" = ${input.zone_name ?? null},
              "radius_m" = ${input.radius_m ?? null},
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
            time_slot_start: dailyWindow?.start ?? null,
            time_slot_end: dailyWindow?.end ?? null,
            city_name: input.city_name ?? null,
            zone_name: input.zone_name ?? null,
            radius_m: input.radius_m ?? null,
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
        INSERT INTO "Advert" ("id", "version_id", "location", "address_text", "status", "start_date", "end_date", "time_slot_start", "time_slot_end", "city_name", "zone_name", "radius_m", "image_hash", "upstream_advert_id", "created_at")
        VALUES (${advertId}, ${version.id}, ST_GeomFromText(${wkt}, 4326), ${input.address_text}, ${AdvertStatus.SCHEDULED}::"AdvertStatus", ${input.start_date}, ${input.end_date}, ${dailyWindow?.start ?? null}, ${dailyWindow?.end ?? null}, ${input.city_name ?? null}, ${input.zone_name ?? null}, ${input.radius_m ?? null}, ${input.image_hash ?? null}, ${input.upstream_advert_id}, CURRENT_TIMESTAMP)
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
          time_slot_start: dailyWindow?.start ?? null,
          time_slot_end: dailyWindow?.end ?? null,
          city_name: input.city_name ?? null,
          zone_name: input.zone_name ?? null,
          radius_m: input.radius_m ?? null,
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
    actorId?: string,
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
    const ids = adverts.map((advert) => advert.id);
    const locations = await this.fetchLocationWkt(ids);
    // Advert Control text searches measure proximity to the searched place:
    // resolve an anchor best-effort (unresolvable text keeps proximity null).
    const searchTerm = query.search?.trim();
    const anchor = searchTerm ? await this.resolveSearchAnchor(searchTerm) : null;
    const distances =
      anchor && ids.length
        ? await this.fetchDistancesM(anchor, ids)
        : new Map<string, number | null>();
    const rows = adverts.map((advert) =>
      this.toResponse(advert, undefined, {
        location: locations.get(advert.id) ?? null,
        distanceM: distances.get(advert.id) ?? null,
      }),
    );
    // Text searches from Advert Control go through the list endpoint, not
    // /adverts/search, so record them here too. Only the first page is
    // recorded to avoid duplicate history while paging.
    const record = async (items: AdvertResponseDto[] | AdvertBrandGroupDto[]) => {
      const search = query.search?.trim();
      if (!actorId || page !== 1 || !search) return;
      await this.recordSearch(
        actorId,
        {
          lat: null,
          lng: null,
          radius_m: null,
          industry: echoMultiValue(query.industry),
          brand_id: echoMultiValue([
            ...normalizeMultiValue(query.brand_id),
            ...normalizeMultiValue(query.brandId),
          ]),
          start: query.start_date ?? null,
          end: query.end_date ?? null,
          start_date: query.start_date ?? null,
          end_date: query.end_date ?? null,
          start_time: query.start_time ?? null,
          end_time: query.end_time ?? null,
          time_slot_start: query.time_slot_start ?? null,
          time_slot_end: query.time_slot_end ?? null,
          sort: 'distance_asc',
          query_hash: null,
          max_distance: null,
          search,
        },
        total,
        items,
      );
    };

    if (query.group_by === 'brand') {
      const items = groupAdvertsByBrand(rows);
      await record(items);
      return { items, meta: standardMeta(total, page, limit, items.length) };
    }
    await record(rows);
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
        radius_m: advert.radiusM ?? null,
        start_date: advert.startDate,
        end_date: advert.endDate,
        time_slot_start: advert.timeSlotStart ?? null,
        time_slot_end: advert.timeSlotEnd ?? null,
        time_range: formatTimeRange(advert.timeSlotStart, advert.timeSlotEnd),
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

  /** Per-advert distance in metres from a fixed anchor (page rows only). Adverts without a location map to null. */
  private async fetchDistancesM(
    anchor: { lat: number; lng: number },
    ids: string[],
  ): Promise<Map<string, number | null>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.$queryRaw<Array<{ id: string; distanceM: unknown }>>(
      Prisma.sql`
        SELECT "id", ST_Distance("location"::geography, ST_MakePoint(${anchor.lng}, ${anchor.lat})::geography) AS "distanceM"
        FROM "Advert"
        WHERE "id" IN (${Prisma.join(ids)}) AND "location" IS NOT NULL
      `,
    );
    return new Map(
      rows.map((row) => {
        const value = Number(row.distanceM);
        return [row.id, Number.isFinite(value) ? value : null];
      }),
    );
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
      distanceM: number | null;
    },
    extra?: { location?: string | null; distanceM?: number | null; hashDistance?: number | null },
  ): AdvertResponseDto {
    const distanceM =
      geo?.distanceM !== undefined && geo?.distanceM !== null
        ? Number(geo.distanceM)
        : (extra?.distanceM ?? null);
    const withVersion = advert as Prisma.AdvertGetPayload<{
      include: { version: { include: { creative: { include: { brand: true } } } } };
    }>;
    const brand = geo
      ? { id: geo.brandId, brand_name: geo.brandName, is_flagged: geo.isFlagged }
      : withVersion.version?.creative.brand
        ? {
            id: withVersion.version.creative.brand.id,
            brand_name: withVersion.version.creative.brand.brandName,
            is_flagged: withVersion.version.creative.brand.isFlagged,
          }
        : null;
    const industryCategory =
      geo?.industryCategory ?? withVersion.version?.creative.brand.industryCategory ?? null;
    const version = geo
      ? {
          id: geo.versionId2,
          version_number: geo.versionNumber,
          status: geo.versionStatus,
          creative_id: geo.creativeId,
          creative_name: geo.creativeName,
          brand: brand!,
        }
      : withVersion.version
        ? {
            id: withVersion.version.id,
            version_number: withVersion.version.versionNumber,
            status: withVersion.version.status,
            creative_id: withVersion.version.creative.id,
            creative_name: withVersion.version.creative.creativeName,
            brand: brand!,
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
        time_slot_start: advert.timeSlotStart ?? null,
        time_slot_end: advert.timeSlotEnd ?? null,
        time_range: formatTimeRange(advert.timeSlotStart, advert.timeSlotEnd),
        city_name: advert.cityName,
        zone_name: advert.zoneName,
        image_hash: advert.imageHash,
        upstream_advert_id: advert.upstreamAdvertId,
        created_at: advert.createdAt,
        version,
        location: geo?.location ?? extra?.location ?? null,
        radius_m: advert.radiusM ?? null,
        media_url: geo?.mediaUrl ?? withVersion.version?.mediaUrl ?? null,
        media_type: geo?.mediaType ?? withVersion.version?.mediaType ?? null,
        creative_name: version?.creative_name ?? null,
        creative_id: version?.creative_id ?? null,
        brand_id: brand?.id ?? null,
        brand_name: brand?.brand_name ?? null,
        brand_is_flagged: brand?.is_flagged ?? null,
        industry: industryCategory,
        industry_category: industryCategory,
        proximity: distanceM != null ? Math.round(distanceM) : null,
        distance_m: distanceM != null ? Math.round(distanceM) : null,
        hash_distance: extra?.hashDistance ?? null,
        available_actions: availableGovtActions(advert.status),
      },
      { excludeExtraneousValues: true },
    );
  }
}
