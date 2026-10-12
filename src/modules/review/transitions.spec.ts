import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import {
  assertActionableStatus,
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
  it('requires comments for REJECT and REQUEST_CHANGES', () => {
    expect(validateTakeAction({ action: 'REJECT' })).toContain('comments are mandatory');
    expect(validateTakeAction({ action: 'REQUEST_CHANGES', comments: '   ' })).toContain(
      'comments are mandatory',
    );
  });

  it('allows APPROVE and HOLD without comments', () => {
    expect(validateTakeAction({ action: 'APPROVE' })).toBeNull();
    expect(validateTakeAction({ action: 'HOLD' })).toBeNull();
  });

  it('accepts decided actions with comments', () => {
    expect(validateTakeAction({ action: 'REJECT', comments: 'Non-compliant claim' })).toBeNull();
  });

  it('rejects unknown actions', () => {
    expect(validateTakeAction({ action: 'MAYBE' })).toContain('action must be one of');
  });

  it('assert variant throws BadRequestException on failure', () => {
    expect(() => assertValidTakeAction({ action: 'REJECT' })).toThrow(BadRequestException);
  });
});

describe('statusForAction', () => {
  it('maps each action to its review status', () => {
    expect(statusForAction('APPROVE')).toBe(ReviewStatus.APPROVED);
    expect(statusForAction('REJECT')).toBe(ReviewStatus.REJECTED);
    expect(statusForAction('HOLD')).toBe(ReviewStatus.ON_HOLD);
    expect(statusForAction('REQUEST_CHANGES')).toBe(ReviewStatus.NEEDS_CHANGES);
  });

  it('isReviewAction narrows correctly', () => {
    expect(isReviewAction('HOLD')).toBe(true);
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
  it('allows PENDING and ON_HOLD to accept a decision', () => {
    expect(validateActionableStatus(ReviewStatus.PENDING)).toBeNull();
    expect(validateActionableStatus(ReviewStatus.ON_HOLD)).toBeNull();
    expect(() => assertActionableStatus(ReviewStatus.PENDING)).not.toThrow();
    expect(() => assertActionableStatus(ReviewStatus.ON_HOLD)).not.toThrow();
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
  it('forbids ON_HOLD -> PENDING', () => {
    expect(() => assertValidTransition(ReviewStatus.ON_HOLD, ReviewStatus.PENDING)).toThrow(
      ConflictException,
    );
  });

  it('allows ON_HOLD -> decision and PENDING -> ON_HOLD', () => {
    expect(() => assertValidTransition(ReviewStatus.ON_HOLD, ReviewStatus.APPROVED)).not.toThrow();
    expect(() => assertValidTransition(ReviewStatus.PENDING, ReviewStatus.ON_HOLD)).not.toThrow();
  });
});
