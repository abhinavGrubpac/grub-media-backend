import { EventTopics } from './events.constants';
import { topicForEvent } from './events.types';

describe('topicForEvent', () => {
  it('routes review-family events to the review topic', () => {
    expect(topicForEvent('creative.created')).toBe(EventTopics.REVIEW);
    expect(topicForEvent('version.uploaded')).toBe(EventTopics.REVIEW);
    expect(topicForEvent('review.approved')).toBe(EventTopics.REVIEW);
    expect(topicForEvent('creative.withdrawn')).toBe(EventTopics.REVIEW);
  });

  it('routes domain events to their own topics', () => {
    expect(topicForEvent('advert.auto_revoked')).toBe(EventTopics.ADVERT);
    expect(topicForEvent('brand.non_compliant_flagged')).toBe(EventTopics.BRAND);
    expect(topicForEvent('reference.uploaded')).toBe(EventTopics.REFERENCE);
    expect(topicForEvent('agency.created')).toBe(EventTopics.AGENCY);
    expect(topicForEvent('notification.created')).toBe(EventTopics.NOTIFICATION);
  });

  it('routes identity events to the auth topic', () => {
    expect(topicForEvent('auth.login_failed')).toBe(EventTopics.AUTH);
    expect(topicForEvent('otp.requested')).toBe(EventTopics.AUTH);
    expect(topicForEvent('user.deactivated')).toBe(EventTopics.AUTH);
    expect(topicForEvent('permission.denied')).toBe(EventTopics.AUTH);
  });

  it('falls back to the audit topic for unknown prefixes', () => {
    expect(topicForEvent('mystery.event')).toBe(EventTopics.AUDIT);
  });
});
