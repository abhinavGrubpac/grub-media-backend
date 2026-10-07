/**
 * Kafka/Redpanda topic catalog. The `.v1` suffix is reserved for schema
 * evolution — never reuse a topic for a new payload shape. Shared contract
 * with the other GrubMedia portals (see media/EVENTS.md in the reference repo).
 */
export const EventTopics = {
  REVIEW: 'grubmedia.review.v1',
  ADVERT: 'grubmedia.advert.v1',
  BRAND: 'grubmedia.brand.v1',
  AUTH: 'grubmedia.auth.v1',
  REFERENCE: 'grubmedia.reference.v1',
  AGENCY: 'grubmedia.agency.v1',
  NOTIFICATION: 'grubmedia.notification.v1',
  AUDIT: 'grubmedia.audit.v1',
  DLQ: 'grubmedia.DLQ.v1',
} as const;

export type EventTopic = (typeof EventTopics)[keyof typeof EventTopics];

/** Topics the relay publishes to; the DLQ is written by consumers only. */
export const ALL_EVENT_TOPICS: readonly EventTopic[] = [
  EventTopics.REVIEW,
  EventTopics.ADVERT,
  EventTopics.BRAND,
  EventTopics.AUTH,
  EventTopics.REFERENCE,
  EventTopics.AGENCY,
  EventTopics.NOTIFICATION,
  EventTopics.AUDIT,
];

/**
 * Full event-type catalog. Names are `prefix.action`; the prefix routes the
 * event to its topic (see topicForEvent). Unknown prefixes fall back to the
 * audit topic so nothing is silently dropped.
 */
export const EventTypes = {
  // review (topic grubmedia.review.v1, key creative_id)
  creativeCreated: 'creative.created',
  creativeUpdated: 'creative.updated',
  versionUploaded: 'version.uploaded',
  reviewApproved: 'review.approved',
  reviewRejected: 'review.rejected',
  reviewOnHold: 'review.on_hold',
  reviewResumed: 'review.resumed',
  reviewNeedsChanges: 'review.needs_changes',
  reviewAutoApproved: 'review.auto_approved',
  creativeWithdrawn: 'creative.withdrawn',

  // advert (topic grubmedia.advert.v1, key advert_id)
  advertScheduled: 'advert.scheduled',
  advertLive: 'advert.live',
  advertPaused: 'advert.paused',
  advertExpired: 'advert.expired',
  advertRevoked: 'advert.revoked',
  advertAutoRevoked: 'advert.auto_revoked',
  advertDeployBlocked: 'advert.deploy_blocked',

  // agency (topic grubmedia.agency.v1, key agency_id)
  agencyCreated: 'agency.created',
  agencyUpdated: 'agency.updated',
  agencyDeactivated: 'agency.deactivated',

  // brand (topic grubmedia.brand.v1, key brand_id)
  brandCreated: 'brand.created',
  brandUpdated: 'brand.updated',
  brandDeactivated: 'brand.deactivated',
  brandReactivated: 'brand.reactivated',
  brandNonCompliantFlagged: 'brand.non_compliant_flagged',
  brandNonCompliantUnflagged: 'brand.non_compliant_unflagged',

  // auth (topic grubmedia.auth.v1, key user_id | email)
  authLoginSuccess: 'auth.login_success',
  authLoginFailed: 'auth.login_failed',
  authRefresh: 'auth.refresh',
  authLogout: 'auth.logout',
  otpRequested: 'otp.requested',
  otpVerified: 'otp.verified',
  otpFailed: 'otp.failed',
  otpThrottled: 'otp.throttled',
  userCreated: 'user.created',
  userDeactivated: 'user.deactivated',
  userActivated: 'user.activated',
  userRoleChanged: 'user.role_changed',
  userDeleted: 'user.deleted',
  userDeleteBlocked: 'user.delete_blocked',
  permissionDenied: 'permission.denied',

  // reference (topic grubmedia.reference.v1, key doc_id)
  referenceUploaded: 'reference.uploaded',
  referenceUpdated: 'reference.updated',
  referenceArchived: 'reference.archived',
  referenceUnarchived: 'reference.unarchived',
  referenceLinkedToVersion: 'reference.linked_to_version',

  // notification / system
  notificationCreated: 'notification.created',
  systemError: 'system.error',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];
