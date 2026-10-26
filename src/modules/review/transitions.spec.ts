import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import {
  assertActionableStatus,
  assertValidMediaType,
  assertValidTakeAction,
  assertValidTransition,
  assertWithdrawable,
  isReviewAction,
  normalizeCreativeStatusFilter,
  statusForAction,
  validateActionableStatus,
  validateTakeAction,
  validateWithdrawal,
} from './transitions';

describe('validateTakeAction', () => {
  it('requires reason for HOLD, REJECT and REQUEST_CHANGES', () => {
    expect(validateTakeAction({ action: 'REJECT' })).toContain('reason is mandatory');
    expect(validateTakeAction({ action: 'REQUEST_CHANGES', comments: 'Fix the claim' })).toContain(
      'reason is mandatory',
    );
    expect(validateTakeAction({ action: 'HOLD', comments: 'Parked' })).toContain(
      'reason is mandatory',
    );
    expect(validateTakeAction({ action: 'REJECT', reason: '   ' })).toContain(
      'reason is mandatory',
    );
  });

  it('allows APPROVE without comments and accepts decisions with reason + comments', () => {
    expect(validateTakeAction({ action: 'APPROVE' })).toBeNull();
    expect(validateTakeAction({ action: 'APPROVE', comments: 'Compliant' })).toBeNull();
    expect(validateTakeAction({ action: 'REJECT', reason: 'NON_COMPLIANT' })).toBeNull();
    expect(
      validateTakeAction({ action: 'HOLD', reason: 'PENDING_LEGAL', comments: 'On hold' }),
    ).toBeNull();
    expect(validateTakeAction({ action: 'REQUEST_CHANGES', reason: 'LOW_QUALITY' })).toBeNull();
  });

  it('accepts decided actions with comments', () => {
    expect(
      validateTakeAction({
        action: 'REJECT',
        reason: 'NON_COMPLIANT',
        comments: 'Non-compliant claim',
      }),
    ).toBeNull();
  });

  it('rejects unknown actions', () => {
    expect(validateTakeAction({ action: 'MAYBE' })).toContain('action must be one of');
  });

  it('assert variant throws BadRequestException on failure', () => {
    expect(() => assertValidTakeAction({ action: 'REJECT' })).toThrow(BadRequestException);
  });
});

describe('assertValidMediaType', () => {
  it('accepts Image and rejects everything else (media is always an image)', () => {
    expect(() => assertValidMediaType('Image')).not.toThrow();
    expect(() => assertValidMediaType('Video')).toThrow(BadRequestException);
    expect(() => assertValidMediaType('image')).toThrow(BadRequestException);
    expect(() => assertValidMediaType(undefined)).toThrow(BadRequestException);
  });
});

describe('statusForAction', () => {
  it('maps each action to its review status', () => {
    expect(statusForAction('APPROVE')).toBe(ReviewStatus.APPROVED);
    expect(statusForAction('REJECT')).toBe(ReviewStatus.REJECTED);
    expect(statusForAction('HOLD')).toBe(ReviewStatus.ON_HOLD);
    expect(statusForAction('REQUEST_CHANGES')).toBe(ReviewStatus.NEEDS_CHANGES);
    expect(statusForAction('RESUME')).toBe(ReviewStatus.PENDING);
  });

  it('isReviewAction narrows correctly', () => {
    expect(isReviewAction('HOLD')).toBe(true);
    expect(isReviewAction('RESUME')).toBe(true);
    expect(isReviewAction('hold')).toBe(false);
  });
});

describe('normalizeCreativeStatusFilter', () => {
  it('maps UI aliases to DB statuses and ALL to no filter', () => {
    expect(normalizeCreativeStatusFilter('PENDING')).toBe(ReviewStatus.PENDING);
    expect(normalizeCreativeStatusFilter('AUTO_APPROVED')).toBe(ReviewStatus.APPROVED);
    expect(normalizeCreativeStatusFilter('NEED_CHANGES')).toBe(ReviewStatus.NEEDS_CHANGES);
    expect(normalizeCreativeStatusFilter('REJECT')).toBe(ReviewStatus.REJECTED);
    expect(normalizeCreativeStatusFilter('ON_HOLD')).toBe(ReviewStatus.ON_HOLD);
    expect(normalizeCreativeStatusFilter('ALL')).toBeUndefined();
    expect(normalizeCreativeStatusFilter(undefined)).toBeUndefined();
  });

  it('rejects unknown statuses', () => {
    expect(() => normalizeCreativeStatusFilter('BOGUS')).toThrow(BadRequestException);
  });
});

describe('validateWithdrawal', () => {
  it('allows undecided versions to be withdrawn', () => {
    expect(validateWithdrawal(ReviewStatus.PENDING)).toBeNull();
    expect(validateWithdrawal(ReviewStatus.ON_HOLD)).toBeNull();
    expect(validateWithdrawal(ReviewStatus.NEEDS_CHANGES)).toBeNull();
    expect(() => assertWithdrawable(ReviewStatus.PENDING)).not.toThrow();
  });

  it('conflicts when the version was already withdrawn', () => {
    expect(validateWithdrawal(ReviewStatus.WITHDRAWN)).toMatchObject({ conflict: true });
    expect(() => assertWithdrawable(ReviewStatus.WITHDRAWN)).toThrow(ConflictException);
  });

  it('conflicts when a decision was already recorded', () => {
    expect(validateWithdrawal(ReviewStatus.APPROVED)).toMatchObject({ conflict: true });
    expect(validateWithdrawal(ReviewStatus.REJECTED)).toMatchObject({ conflict: true });
    expect(() => assertWithdrawable(ReviewStatus.APPROVED)).toThrow(ConflictException);
  });
});

describe('validateActionableStatus', () => {
  it('allows only PENDING to accept a decision', () => {
    expect(validateActionableStatus(ReviewStatus.PENDING)).toBeNull();
    expect(() => assertActionableStatus(ReviewStatus.PENDING)).not.toThrow();
  });

  it('parks ON_HOLD with a resume-first message', () => {
    expect(validateActionableStatus(ReviewStatus.ON_HOLD)).toContain('resume');
    expect(() => assertActionableStatus(ReviewStatus.ON_HOLD)).toThrow(ConflictException);
  });

  it('blocks decided statuses as terminal for that version', () => {
    for (const status of [
      ReviewStatus.APPROVED,
      ReviewStatus.REJECTED,
      ReviewStatus.NEEDS_CHANGES,
      ReviewStatus.WITHDRAWN,
    ]) {
      expect(validateActionableStatus(status)).toContain('decisions are final');
      expect(() => assertActionableStatus(status)).toThrow(ConflictException);
    }
  });
});

describe('assertValidTransition', () => {
  it('allows ON_HOLD -> PENDING as the only on-hold exit', () => {
    expect(() => assertValidTransition(ReviewStatus.ON_HOLD, ReviewStatus.PENDING)).not.toThrow();
  });

  it('forbids every other direct change from ON_HOLD', () => {
    for (const to of [
      ReviewStatus.APPROVED,
      ReviewStatus.REJECTED,
      ReviewStatus.NEEDS_CHANGES,
      ReviewStatus.ON_HOLD,
    ]) {
      expect(() => assertValidTransition(ReviewStatus.ON_HOLD, to)).toThrow(ConflictException);
    }
  });

  it('allows PENDING -> any status', () => {
    expect(() => assertValidTransition(ReviewStatus.PENDING, ReviewStatus.ON_HOLD)).not.toThrow();
    expect(() => assertValidTransition(ReviewStatus.PENDING, ReviewStatus.APPROVED)).not.toThrow();
  });
});
