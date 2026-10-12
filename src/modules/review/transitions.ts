import { BadRequestException, ConflictException } from '@nestjs/common';
import { ActionType, ReviewStatus } from '@prisma/client';

/**
 * Creative review state machine (WORKFLOWS.md §1).
 *
 * Pure functions only: rules stay unit-testable without a database. Only
 * PENDING and ON_HOLD versions accept a decision; APPROVED / REJECTED /
 * NEEDS_CHANGES / WITHDRAWN are terminal for that version — the only way
 * forward is a version increment (WORKFLOWS.md §1.3). ON_HOLD can move to a
 * decision but never back to PENDING.
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

/**
 * One-way review gate (WORKFLOWS.md §1.3): only a PENDING or ON_HOLD version
 * accepts a decision. PENDING may move to APPROVED / REJECTED / NEEDS_CHANGES
 * / ON_HOLD; ON_HOLD may move to a decision but never back to PENDING. Every
 * decided status is terminal for that version. Further review happens on a
 * new version, which always starts at PENDING.
 */
export function validateActionableStatus(status: ReviewStatus | string): string | null {
  if (
    status === ReviewStatus.PENDING ||
    status === ('PENDING' as string) ||
    status === ReviewStatus.ON_HOLD ||
    status === ('ON_HOLD' as string)
  )
    return null;
  return (
    `version is already ${status}; decisions are final — ` +
    'upload a new version for further review'
  );
}

export function assertActionableStatus(status: ReviewStatus | string): void {
  const message = validateActionableStatus(status);
  if (message) throw new ConflictException(message);
}

/**
 * Additional guard for specific transition prohibitions.
 * ON_HOLD -> PENDING is strictly forbidden.
 */
export function assertValidTransition(
  from: ReviewStatus | string,
  to: ReviewStatus | string,
): void {
  if (
    (from === ReviewStatus.ON_HOLD || from === ('ON_HOLD' as string)) &&
    (to === ReviewStatus.PENDING || to === ('PENDING' as string))
  ) {
    throw new ConflictException('Cannot move a version from ON_HOLD back to PENDING');
  }
}

/**
 * UI status filter values accepted by GET /creatives (WORKFLOWS.md §1).
 * The review tabs speak a slightly different language than the DB enum:
 * NEED_CHANGES (no S), REJECT (not REJECTED), AUTO_APPROVED (auto-approved
 * versions are stored as APPROVED — there is no separate DB status), and ALL
 * (no filter). WITHDRAWN passes through for audit views.
 */
export const CREATIVE_STATUS_FILTERS = [
  'PENDING',
  'APPROVED',
  'AUTO_APPROVED',
  'NEEDS_CHANGES',
  'NEED_CHANGES',
  'REJECTED',
  'REJECT',
  'ON_HOLD',
  'WITHDRAWN',
  'ALL',
] as const;
export type CreativeStatusFilter = (typeof CREATIVE_STATUS_FILTERS)[number];

export function normalizeCreativeStatusFilter(
  value: string | undefined | null,
): ReviewStatus | undefined {
  if (!value || value === 'ALL') return undefined;
  switch (value) {
    case 'PENDING':
      return ReviewStatus.PENDING;
    case 'APPROVED':
      return ReviewStatus.APPROVED;
    case 'AUTO_APPROVED':
      return ReviewStatus.APPROVED;
    case 'NEEDS_CHANGES':
    case 'NEED_CHANGES':
      return ReviewStatus.NEEDS_CHANGES;
    case 'REJECTED':
    case 'REJECT':
      return ReviewStatus.REJECTED;
    case 'ON_HOLD':
      return ReviewStatus.ON_HOLD;
    case 'WITHDRAWN':
      return ReviewStatus.WITHDRAWN;
    default:
      throw new BadRequestException(`status must be one of: ${CREATIVE_STATUS_FILTERS.join(', ')}`);
  }
}

/** DB-sortable keys are pushed to Prisma; version-derived keys sort in memory. */
export const CREATIVE_SORT_KEYS = [
  'created_at',
  'brand_name',
  'uploaded_on',
  'last_action_at',
] as const;
export type CreativeSortKey = (typeof CREATIVE_SORT_KEYS)[number];

export const CREATIVE_SORT_ORDERS = ['asc', 'desc'] as const;

export function isVersionDerivedSort(key: string): boolean {
  return key === 'uploaded_on' || key === 'last_action_at';
}
