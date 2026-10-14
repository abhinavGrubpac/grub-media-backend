import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  ADVERT_GOVT_ACTIONS,
  assertAdvertTransition,
  assertCoordinates,
  assertDateRange,
  assertSchedulableVersionStatus,
  availableGovtActions,
  isSchedulableVersionStatus,
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
