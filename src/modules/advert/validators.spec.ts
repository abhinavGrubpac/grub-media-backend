import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ADVERT_GOVT_ACTIONS,
  assertAdvertTransition,
  assertCoordinates,
  assertDateRange,
  assertSchedulableVersionStatus,
  assertTimeOfDay,
  availableGovtActions,
  formatTimeRange,
  isSchedulableVersionStatus,
  normalizeDailyTimeWindow,
  normalizeDailyWindowFilter,
  normalizeMultiValue,
  normalizeUpstreamAdvertStatus,
  validateAdvertTransition,
} from './validators';

describe('advert transition matrix', () => {
  it('allows upstream operational transitions', () => {
    expect(validateAdvertTransition('SCHEDULED', 'LIVE', 'upstream')).toBeNull();
    expect(validateAdvertTransition('SCHEDULED', 'EXPIRED', 'upstream')).toMatchObject({
      conflict: false,
    });
    expect(validateAdvertTransition('LIVE', 'PAUSED', 'upstream')).toBeNull();
    expect(validateAdvertTransition('LIVE', 'EXPIRED', 'upstream')).toBeNull();
    expect(validateAdvertTransition('PAUSED', 'LIVE', 'upstream')).toBeNull();
    expect(validateAdvertTransition('PAUSED', 'EXPIRED', 'upstream')).toBeNull();
  });

  it('allows government compliance transitions', () => {
    expect(validateAdvertTransition('SCHEDULED', 'PAUSED', 'govt')).toBeNull();
    expect(validateAdvertTransition('SCHEDULED', 'REVOKED', 'govt')).toBeNull();
    expect(validateAdvertTransition('LIVE', 'REVOKED', 'govt')).toBeNull();
    expect(validateAdvertTransition('PAUSED', 'REVOKED', 'govt')).toBeNull();
    // Resume restores the pre-pause state; the service date guard picks which
    // of the two targets is legal for the current window.
    expect(validateAdvertTransition('PAUSED', 'SCHEDULED', 'govt')).toBeNull();
    expect(validateAdvertTransition('PAUSED', 'LIVE', 'govt')).toBeNull();
  });

  it('forbids cross-origin actions with 400', () => {
    expect(validateAdvertTransition('SCHEDULED', 'LIVE', 'govt')).toMatchObject({
      message: expect.stringContaining('Illegal govt transition'),
      conflict: false,
    });
    expect(validateAdvertTransition('LIVE', 'EXPIRED', 'govt')).toMatchObject({ conflict: false });
    expect(validateAdvertTransition('SCHEDULED', 'REVOKED', 'upstream')).toMatchObject({
      conflict: false,
    });
    expect(validateAdvertTransition('LIVE', 'REVOKED', 'upstream')).toMatchObject({
      conflict: false,
    });
  });

  it('treats terminal statuses as 409 conflicts', () => {
    expect(validateAdvertTransition('REVOKED', 'LIVE', 'govt')).toMatchObject({ conflict: true });
    expect(validateAdvertTransition('EXPIRED', 'EXPIRED', 'upstream')).toMatchObject({
      conflict: true,
    });
    expect(validateAdvertTransition('REVOKED', 'SCHEDULED', 'upstream')).toMatchObject({
      conflict: true,
    });
  });

  it('permits idempotent re-assertion of non-terminal statuses', () => {
    expect(validateAdvertTransition('LIVE', 'LIVE', 'upstream')).toBeNull();
    expect(validateAdvertTransition('PAUSED', 'PAUSED', 'govt')).toBeNull();
  });

  it('assert variant throws 400 for illegal moves and 409 for terminal states', () => {
    expect(() => assertAdvertTransition('SCHEDULED', 'LIVE', 'govt')).toThrow(BadRequestException);
    expect(() => assertAdvertTransition('REVOKED', 'LIVE', 'govt')).toThrow(ConflictException);
    expect(() => assertAdvertTransition('SCHEDULED', 'PAUSED', 'govt')).not.toThrow();
  });
});

describe('availableGovtActions', () => {
  it('menus pause/revoke for SCHEDULED and LIVE', () => {
    expect(availableGovtActions('SCHEDULED')).toEqual(['PAUSE', 'REVOKE']);
    expect(availableGovtActions('LIVE')).toEqual(['PAUSE', 'REVOKE']);
  });

  it('menus resume/revoke for PAUSED', () => {
    expect(availableGovtActions('PAUSED')).toEqual(['RESUME', 'REVOKE']);
  });

  it('is view-only for terminal statuses and unknown input', () => {
    expect(availableGovtActions('REVOKED')).toEqual([]);
    expect(availableGovtActions('EXPIRED')).toEqual([]);
    expect(availableGovtActions('BOGUS')).toEqual([]);
  });

  it('only ever emits known menu actions', () => {
    for (const action of availableGovtActions('LIVE')) {
      expect([...ADVERT_GOVT_ACTIONS]).toContain(action);
    }
  });
});

describe('schedulable versions', () => {
  it('accepts live-thread versions for pre-approval booking', () => {
    for (const status of ['PENDING', 'ON_HOLD', 'NEEDS_CHANGES', 'APPROVED']) {
      expect(isSchedulableVersionStatus(status)).toBe(true);
      expect(() => assertSchedulableVersionStatus(status)).not.toThrow();
    }
  });

  it('refuses dead-end versions', () => {
    for (const status of ['REJECTED', 'WITHDRAWN']) {
      expect(isSchedulableVersionStatus(status)).toBe(false);
      expect(() => assertSchedulableVersionStatus(status)).toThrow(BadRequestException);
    }
  });
});

describe('assertCoordinates', () => {
  it('accepts valid coordinates', () => {
    expect(() => assertCoordinates(12.9716, 77.5946)).not.toThrow();
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => assertCoordinates(95, 77)).toThrow(BadRequestException);
    expect(() => assertCoordinates(12, 200)).toThrow(BadRequestException);
    expect(() => assertCoordinates(Number.NaN, 77)).toThrow(BadRequestException);
  });
});

describe('normalizeUpstreamAdvertStatus', () => {
  it('maps upstream terminal aliases to EXPIRED', () => {
    expect(normalizeUpstreamAdvertStatus('COMPLETED')).toBe('EXPIRED');
    expect(normalizeUpstreamAdvertStatus('CANCELLED')).toBe('EXPIRED');
  });

  it('passes government statuses through untouched', () => {
    for (const status of ['SCHEDULED', 'LIVE', 'PAUSED', 'EXPIRED', 'REVOKED']) {
      expect(normalizeUpstreamAdvertStatus(status)).toBe(status);
    }
  });
});

describe('assertDateRange', () => {
  it('accepts start before end', () => {
    expect(() => assertDateRange(new Date('2026-01-01'), new Date('2026-01-02'))).not.toThrow();
  });

  it('rejects inverted or equal ranges and invalid dates', () => {
    expect(() => assertDateRange(new Date('2026-01-02'), new Date('2026-01-01'))).toThrow(
      BadRequestException,
    );
    expect(() => assertDateRange(new Date('2026-01-01'), new Date('2026-01-01'))).toThrow(
      BadRequestException,
    );
    expect(() => assertDateRange(new Date('nope'), new Date('2026-01-01'))).toThrow(
      BadRequestException,
    );
  });
});

describe('daily time windows', () => {
  it('parses fixed-width HH:mm values', () => {
    expect(assertTimeOfDay('09:05')).toBe('09:05');
    expect(assertTimeOfDay(' 23:59 ')).toBe('23:59');
    expect(() => assertTimeOfDay('24:00')).toThrow(BadRequestException);
    expect(() => assertTimeOfDay('9:05')).toThrow(BadRequestException);
  });

  it('normalizes the all-day 00:00-00:00 spelling', () => {
    expect(normalizeDailyTimeWindow('00:00', '00:00')).toEqual({
      start: '00:00',
      end: '23:59',
    });
    expect(normalizeDailyTimeWindow(undefined, undefined)).toBeNull();
  });

  it('rejects partial, equal, or overnight stored windows', () => {
    expect(() => normalizeDailyTimeWindow('09:00', undefined)).toThrow(BadRequestException);
    expect(() => normalizeDailyTimeWindow('09:00', '09:00')).toThrow(BadRequestException);
    expect(() => normalizeDailyTimeWindow('22:00', '06:00')).toThrow(BadRequestException);
  });

  it('allows one-sided query boundaries and overlap windows', () => {
    expect(normalizeDailyWindowFilter('18:00', undefined)).toEqual({
      start: '18:00',
      end: undefined,
    });
    expect(normalizeDailyWindowFilter(undefined, '22:00')).toEqual({
      start: undefined,
      end: '22:00',
    });
    expect(normalizeDailyWindowFilter('18:00', '22:00')).toEqual({
      start: '18:00',
      end: '22:00',
    });
    expect(() => normalizeDailyWindowFilter('22:00', '18:00')).toThrow(BadRequestException);
  });

  it('formats a display range only when both bounds exist', () => {
    expect(formatTimeRange('06:00', '23:00')).toBe('06:00 - 23:00');
    expect(formatTimeRange(null, '23:00')).toBeNull();
  });
});

describe('multi-select query values', () => {
  it('accepts comma-separated and repeated values, trims, and de-duplicates', () => {
    expect(normalizeMultiValue('Food, Retail')).toEqual(['Food', 'Retail']);
    expect(normalizeMultiValue(['Food', 'Retail,Energy'])).toEqual(['Food', 'Retail', 'Energy']);
    expect(normalizeMultiValue(' Food , ,Food ')).toEqual(['Food']);
    expect(normalizeMultiValue(undefined)).toEqual([]);
  });
});
