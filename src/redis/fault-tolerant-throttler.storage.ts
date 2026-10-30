import { Logger } from '@nestjs/common';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { ThrottlerStorage } from '@nestjs/throttler';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Wraps ThrottlerStorageRedisService with an in-memory fallback so that a
 * closed or unavailable Redis connection never crashes the throttle guard.
 * Falls back per-call, so recovery is automatic when Redis comes back.
 */
export class FaultTolerantThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(FaultTolerantThrottlerStorage.name);
  private readonly inMemory = new Map<string, { hits: number; expiry: number }>();

  constructor(private readonly redisStorage?: ThrottlerStorageRedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redisStorage) {
      try {
        return await this.redisStorage.increment(key, ttl, limit, blockDuration, throttlerName);
      } catch (err) {
        this.logger.warn(
          `Redis throttle storage error, falling back to in-memory: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return this.incrementInMemory(key, ttl, limit, blockDuration);
  }

  private incrementInMemory(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    const existing = this.inMemory.get(key);

    if (!existing || existing.expiry < now) {
      this.inMemory.set(key, { hits: 1, expiry: now + ttl });
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    existing.hits += 1;
    const isBlocked = existing.hits > limit;
    return {
      totalHits: existing.hits,
      timeToExpire: Math.ceil((existing.expiry - now) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }
}
