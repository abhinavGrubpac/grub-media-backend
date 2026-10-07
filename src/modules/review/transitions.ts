import { BadRequestException, ConflictException } from '@nestjs/common';
import { ActionType, ReviewStatus } from '@prisma/client';

/**
 * Creative review state machine (WORKFLOWS.md §1).
 *
 * Pure functions only: rules stay unit-testable without a database. Every
 * review action is legal from any non-terminal status; REJECTED versions are
 * immutable — the only way forward is a version increment (WORKFLOWS.md §1.3).
 */
export const REVIEW_ACTIONS = ['APPROVE', 'REJECT', 'HOLD', 'REQUEST_CHANGES'] as const;
export type ReviewActionType = (typeof REVIEW_ACTIONS)[number];

export const REVIEW_STATUS_BY_ACTION: Record<ReviewActionType, ReviewStatus> = {
  APPROVE: ReviewStatus.APPROVED,
  REJECT: ReviewStatus.REJECTED,
  HOLD: ReviewStatus.ON_HOLD,
  REQUEST_CHANGES: ReviewStatus.NEEDS_CHANGES,
};

export function isReviewAction(value: string): value is ReviewActionType {
  return (REVIEW_ACTIONS as readonly string[]).includes(value);
}

export function statusForAction(action: ReviewActionType): ReviewStatus {
  return REVIEW_STATUS_BY_ACTION[action];
}

export function actionTypeFor(action: ReviewActionType): ActionType {
  return action as ActionType;
}

/** Comments are mandatory for REJECT and REQUEST_CHANGES (WORKFLOWS.md §1.3). */
export function validateTakeAction(input: {
  action: string;
  comments?: string | null;
}): string | null {
  if (!isReviewAction(input.action)) {
    return `action must be one of: ${REVIEW_ACTIONS.join(', ')}`;
  }
  const needsComments = input.action === 'REJECT' || input.action === 'REQUEST_CHANGES';
  const comments = input.comments?.trim();
  if (needsComments && (!comments || comments.length === 0)) {
    return `comments are mandatory for ${input.action}`;
  }
  return null;
}

export function assertValidTakeAction(input: { action: string; comments?: string | null }): void {
  const message = validateTakeAction(input);
  if (message) throw new BadRequestException(message);
}

export const WITHDRAWABLE_STATUSES: readonly ReviewStatus[] = [
  ReviewStatus.PENDING,
  ReviewStatus.ON_HOLD,
  ReviewStatus.NEEDS_CHANGES,
];

/**
 * Withdrawal may only undo an undecided version: a decision beats a
 * withdrawal (MULTI_PORTAL_ARCHITECTURE.md §8.4) and WITHDRAWN is terminal.
 */
export function validateWithdrawal(
  status: ReviewStatus,
): { message: string; conflict: boolean } | null {
  if (status === ReviewStatus.WITHDRAWN) {
    return { message: 'version has already been withdrawn', conflict: true };
  }
  if (status === ReviewStatus.APPROVED || status === ReviewStatus.REJECTED) {
    return {
      message: 'decision already recorded; the version can no longer be withdrawn',
      conflict: true,
    };
  }
  if (!WITHDRAWABLE_STATUSES.includes(status)) {
    return { message: `version in status ${status} cannot be withdrawn`, conflict: false };
  }
  return null;
}

export function assertWithdrawable(status: ReviewStatus): void {
  const failure = validateWithdrawal(status);
  if (!failure) return;
  throw failure.conflict
    ? new ConflictException(failure.message)
    : new BadRequestException(failure.message);
}
