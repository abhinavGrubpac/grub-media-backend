import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Thin wrapper around the ioredis client. Centralises the Redis operations the
 * app needs (counters for brute-force lockout, cache get/set, health ping) so
 * modules depend on RedisService rather than ioredis directly.
 */
@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  getClient(): Redis {
    return this.redis;
  }

  /**
   * Atomically increment a counter and (re)set its TTL. Returns the new count.
   * Used for failed-login lockout windows.
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const res = await this.redis.multi().incr(key).expire(key, ttlSeconds).exec();
    return (res?.[0]?.[1] as number | undefined) ?? 0;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async ping(): Promise<string> {
    return this.redis.ping();
  }
}
