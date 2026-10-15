import { EventTopics } from './events.constants';

/**
 * Canonical event envelope — the payload stored in the outbox and published
 * to Kafka as the message value. Kafka headers carry x-event-id/x-event-type
 * so consumers can route without parsing.
 */
export interface EventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventTime: string;
  actorId?: string;
  entityType: string;
  entityId: string;
  payload: TPayload;
  schemaVersion: number;
}

export interface EmitInput {
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  actorId?: string;
  /** Partition key; defaults to entityId so ordering is per aggregate root. */
  key?: string;
}

export const EVENT_HEADERS = {
  eventId: 'x-event-id',
  eventType: 'x-event-type',
} as const;

const TOPIC_BY_EVENT_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['creative.', EventTopics.REVIEW],
  ['version.', EventTopics.REVIEW],
  ['review.', EventTopics.REVIEW],
  ['advert.', EventTopics.ADVERT],
  ['brand.', EventTopics.BRAND],
  ['auth.', EventTopics.AUTH],
  ['otp.', EventTopics.AUTH],
  ['user.', EventTopics.AUTH],
  ['permission.', EventTopics.AUTH],
  ['reference.', EventTopics.REFERENCE],
  ['agency.', EventTopics.AGENCY],
  ['notification.', EventTopics.NOTIFICATION],
  ['system.', EventTopics.AUDIT],
  ['audit.', EventTopics.AUDIT],
];

/** Prefix-based routing with the audit topic as the catch-all. */
export function topicForEvent(eventType: string): string {
  const match = TOPIC_BY_EVENT_PREFIX.find(([prefix]) => eventType.startsWith(prefix));
  return match ? match[1] : EventTopics.AUDIT;
}
