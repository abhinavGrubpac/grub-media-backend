import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import {
  assertValidTakeAction,
  assertWithdrawable,
  isReviewAction,
  statusForAction,
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
