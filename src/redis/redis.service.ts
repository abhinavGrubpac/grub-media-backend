import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Thin wrapper around the ioredis client. Centralises the Redis operations the
 * app needs (counters for brute-force lockout, cache get/set, health ping) so
 * modules depend on RedisService rather than ioredis directly.
 *
 * Redis is optional. If not available, methods return safe defaults or no-op.
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger('RedisService');

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  getClient(): Redis | null {
    return this.redis;
  }

  isAvailable(): boolean {
    return this.redis !== null && this.redis !== undefined;
  }

  /**
   * Atomically increment a counter and (re)set its TTL. Returns the new count.
   * Used for failed-login lockout windows. The TTL is reset on every call — an
   * intentional sliding window so an attacker cannot wait out the lockout while
   * continuing to hammer credentials.
   *
   * Returns 0 if Redis is unavailable (disables brute-force protection).
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    if (!this.isAvailable()) {
      this.logger.debug('Redis unavailable for increment operation');
      return 0;
    }

    try {
      const res = await this.redis!.multi().incr(key).expire(key, ttlSeconds).exec();
      const incr = res?.[0];
      if (incr?.[0]) {
        throw incr[0];
      }
      return (incr?.[1] as number | undefined) ?? 0;
    } catch (error) {
      this.logger.warn(`Failed to increment key ${key}: ${error}`);
      return 0;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      return await this.redis!.get(key);
    } catch (error) {
      this.logger.warn(`Failed to get key ${key}: ${error}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    try {
      if (ttlSeconds != null && ttlSeconds > 0) {
        await this.redis!.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.redis!.set(key, value);
      }
    } catch (error) {
      this.logger.warn(`Failed to set key ${key}: ${error}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    try {
      await this.redis!.del(key);
    } catch (error) {
      this.logger.warn(`Failed to delete key ${key}: ${error}`);
    }
  }

  async ping(): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Redis is not available');
    }

    try {
      return await this.redis!.ping();
    } catch (error) {
      this.logger.warn(`Ping failed: ${error}`);
      throw error;
    }
  }
}
