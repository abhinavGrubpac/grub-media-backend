import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service';

/**
 * Terminus health indicator for Redis, using the v11 HealthIndicatorService
 * API (returns up/down results rather than throwing).
 *
 * Redis is optional. If not available, returns 'up' with a note that Redis
 * is not configured (which is fine for reduced-feature deployments).
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    if (!this.redis.isAvailable()) {
      return indicator.up({ message: 'Redis not configured (optional)' });
    }

    try {
      const reply = await this.redis.ping();
      if (reply !== 'PONG') {
        return indicator.down({ message: 'Unexpected ping reply' });
      }
      return indicator.up();
    } catch {
      return indicator.down({ message: 'Redis unreachable' });
    }
  }
}
