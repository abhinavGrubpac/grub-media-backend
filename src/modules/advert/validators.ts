import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdvertStatus } from '@prisma/client';

/**
 * Advert lifecycle rules (WORKFLOWS.md §2, UPSTREAM_INTEGRATION_API.md §6.2).
 * Pure functions only: rules stay unit-testable without a database.
 */
export const ADVERT_STATUSES = ['SCHEDULED', 'LIVE', 'PAUSED', 'EXPIRED', 'REVOKED'] as const;
export type AdvertStatusType = (typeof ADVERT_STATUSES)[number];

export type TransitionOrigin = 'upstream' | 'govt';

export const ADVERT_TERMINAL_STATUSES: readonly AdvertStatusType[] = [
  AdvertStatus.EXPIRED,
  AdvertStatus.REVOKED,
];

/**
 * Two-origin transition matrix. Upstream (agency portal) owns the operational
 * schedule; the government origin enforces compliance (PAUSED/REVOKED) and can
 * never set LIVE. REVOKED is government-only with legal weight —
 * upstream attempts return conflicts at the intake layer.
 */
export const ADVERT_TRANSITIONS: Record<
  TransitionOrigin,
  Record<AdvertStatusType, readonly AdvertStatusType[]>
> = {
  upstream: {
    SCHEDULED: [AdvertStatus.LIVE],
    LIVE: [AdvertStatus.PAUSED, AdvertStatus.EXPIRED],
    PAUSED: [AdvertStatus.LIVE, AdvertStatus.EXPIRED],
    EXPIRED: [],
    REVOKED: [],
  },
  govt: {
    SCHEDULED: [AdvertStatus.PAUSED, AdvertStatus.REVOKED],
    LIVE: [AdvertStatus.PAUSED, AdvertStatus.REVOKED],
    // Resume restores the pre-pause state: SCHEDULED when the flight has not
    // started yet, LIVE once the window is open. The service layer enforces
    // the date split — the matrix only opens both targets.
    PAUSED: [AdvertStatus.SCHEDULED, AdvertStatus.LIVE, AdvertStatus.REVOKED],
    EXPIRED: [],
    REVOKED: [],
  },
};

export function isAdvertStatus(value: string): value is AdvertStatusType {
  return (ADVERT_STATUSES as readonly string[]).includes(value);
}

/**
 * Normalizes a multi-select query value. Query strings can arrive as either a
 * comma-separated string (`brand_id=a,b`) or repeated parameters (`brand_id=a&
 * brand_id=b`). Empty values are removed and duplicates are collapsed while
 * preserving order.
 */
export function normalizeMultiValue(value: string | string[] | null | undefined): string[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .flatMap((entry) => String(entry).split(','))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Upstream (agency portal) status aliases. The upstream enum uses
 * COMPLETED/CANCELLED where the government portal uses EXPIRED:
 * a finished flight maps to EXPIRED (neutral end-of-window), never to
 * REVOKED (compliance weight). Unknown values pass through so the caller
 * still gets the standard "must be one of" validation error.
 */
export function normalizeUpstreamAdvertStatus(value: string): string {
  if (value === 'COMPLETED' || value === 'CANCELLED') return AdvertStatus.EXPIRED;
  return value;
}

export function validateAdvertTransition(
  from: string,
  to: string,
  origin: TransitionOrigin,
): { message: string; conflict: boolean } | null {
  if (!isAdvertStatus(to)) {
    return { message: `status must be one of: ${ADVERT_STATUSES.join(', ')}`, conflict: false };
  }
  if (!isAdvertStatus(from)) {
    return { message: `current status ${from} is not a known advert status`, conflict: false };
  }
  if (ADVERT_TERMINAL_STATUSES.includes(from)) {
    if (to === from) return { message: `status ${from} is terminal`, conflict: true };
    return {
      message: `Illegal ${origin} transition ${from} -> ${to} (status ${from} is terminal)`,
      conflict: true,
    };
  }
  if (to === from) return null;
  const allowed = ADVERT_TRANSITIONS[origin][from];
  if (!allowed.includes(to)) {
    return { message: `Illegal ${origin} transition ${from} -> ${to}`, conflict: false };
  }
  return null;
}

export function assertAdvertTransition(from: string, to: string, origin: TransitionOrigin): void {
  const failure = validateAdvertTransition(from, to, origin);
  if (!failure) return;
  throw failure.conflict
    ? new ConflictException(failure.message)
    : new BadRequestException(failure.message);
}

/**
 * Booking rule: schedules arrive with the creative (agency books inventory
 * before government approval), so any live-thread version — PENDING /
 * ON_HOLD / NEEDS_CHANGES / APPROVED — can be scheduled. REJECTED and
 * WITHDRAWN versions are dead ends and can never carry a schedule. The
 * compliance gate lives at go-live (syncDueSchedules promotes APPROVED
 * versions only), never at booking time.
 */
export const SCHEDULABLE_VERSION_STATUSES: readonly string[] = [
  'PENDING',
  'ON_HOLD',
  'NEEDS_CHANGES',
  'APPROVED',
];

export function isSchedulableVersionStatus(status: string): boolean {
  return SCHEDULABLE_VERSION_STATUSES.includes(status);
}

export function assertSchedulableVersionStatus(status: string): void {
  if (!isSchedulableVersionStatus(status)) {
    throw new BadRequestException(
      `version in status ${status} cannot be scheduled; only live-thread versions can carry a schedule`,
    );
  }
}

/** DB-sortable keys for GET /adverts (all pushed to Prisma — no to-many ordering here). */
export const ADVERT_SORT_KEYS = ['created_at', 'start_date', 'end_date', 'status', 'id'] as const;
export type AdvertSortKey = (typeof ADVERT_SORT_KEYS)[number];

export const ADVERT_SORT_ORDERS = ['asc', 'desc'] as const;

/** Search-result sort modes for GET /adverts/search. */
export const ADVERT_SEARCH_SORTS = ['distance_asc', 'distance_desc', 'id_asc', 'id_desc'] as const;
export type AdvertSearchSort = (typeof ADVERT_SEARCH_SORTS)[number];

/** Government take-action menu per status (drives the UI action column). */
export const ADVERT_GOVT_ACTIONS = ['PAUSE', 'RESUME', 'REVOKE'] as const;
export type AdvertGovtAction = (typeof ADVERT_GOVT_ACTIONS)[number];

/**
 * Take-action menu for an advert row: PAUSE when the govt matrix allows
 * moving to PAUSED, RESUME when it allows moving to LIVE, REVOKE when it
 * allows moving to REVOKED. Terminal rows (EXPIRED/REVOKED) get view-only [].
 */
export function availableGovtActions(from: string): AdvertGovtAction[] {
  if (!isAdvertStatus(from)) return [];
  const allowed = ADVERT_TRANSITIONS.govt[from];
  const actions: AdvertGovtAction[] = [];
  if (allowed.includes(AdvertStatus.PAUSED)) actions.push('PAUSE');
  if (allowed.includes(AdvertStatus.LIVE)) actions.push('RESUME');
  if (allowed.includes(AdvertStatus.REVOKED)) actions.push('REVOKE');
  return actions;
}

export function assertCoordinates(lat: number, lng: number): void {
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new BadRequestException('lat must be a number between -90 and 90');
  }
  if (Number.isNaN(lng) || lng < -180 || lng > 180) {
    throw new BadRequestException('lng must be a number between -180 and 180');
  }
}

export function assertDateRange(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('start_date and end_date must be valid dates');
  }
  if (start.getTime() >= end.getTime()) {
    throw new BadRequestException('start_date must be before end_date');
  }
}

/**
 * Daily display windows are fixed-width 24-hour strings. Fixed width keeps
 * PostgreSQL text comparisons chronological (lexical order == time order).
 */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_PATTERN.test(value);
}

export function assertTimeOfDay(value: string, field = 'time'): string {
  const normalized = value.trim();
  if (!TIME_OF_DAY_PATTERN.test(normalized)) {
    throw new BadRequestException(`${field} must be HH:mm (00:00-23:59)`);
  }
  return normalized;
}

/**
 * Normalizes a stored recurring daily window. Both bounds are required when
 * either is supplied; `00:00`–`00:00` is the legacy all-day spelling and is
 * normalized to `00:00`–`23:59`. Same-day windows only (no overnight wrap).
 */
export function normalizeDailyTimeWindow(
  start?: string | null,
  end?: string | null,
): { start: string; end: string } | null {
  const hasStart = start !== undefined && start !== null && start.trim() !== '';
  const hasEnd = end !== undefined && end !== null && end.trim() !== '';
  if (!hasStart && !hasEnd) return null;
  if (!hasStart || !hasEnd) {
    throw new BadRequestException('time_slot_start and time_slot_end must be provided together');
  }
  const from = assertTimeOfDay(start as string, 'time_slot_start');
  const to = assertTimeOfDay(end as string, 'time_slot_end');
  if (from === '00:00' && to === '00:00') return { start: '00:00', end: '23:59' };
  if (from >= to) {
    throw new BadRequestException('time_slot_start must be before time_slot_end');
  }
  return { start: from, end: to };
}

/**
 * Query-side daily-window filter. Unlike stored windows, either boundary may
 * be supplied alone: start-only keeps windows ending at/after it; end-only
 * keeps windows starting at/before it. Both bounds form an overlap test.
 */
export function normalizeDailyWindowFilter(
  start?: string | null,
  end?: string | null,
): { start?: string; end?: string } | null {
  const hasStart = start !== undefined && start !== null && start.trim() !== '';
  const hasEnd = end !== undefined && end !== null && end.trim() !== '';
  if (!hasStart && !hasEnd) return null;
  const from = hasStart ? assertTimeOfDay(start as string, 'time_slot_start') : undefined;
  const to = hasEnd ? assertTimeOfDay(end as string, 'time_slot_end') : undefined;
  if (from !== undefined && to !== undefined) {
    if (from === '00:00' && to === '00:00') return { start: '00:00', end: '23:59' };
    if (from >= to) {
      throw new BadRequestException('time_slot_start must be before time_slot_end');
    }
  }
  return { start: from, end: to };
}

/** Display annotation for an advert's recurring daily window. */
export function formatTimeRange(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  return `${start} - ${end}`;
}
