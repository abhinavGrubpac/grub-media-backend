import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const host = config.get<string>('redis.host');
        const port = config.get<number>('redis.port');
        const password = config.get<string>('redis.password');

        if (!host || !port) {
          return null;
        }

        const redis = new Redis({
          host,
          port,
          password,
          retryStrategy: () => null,
          reconnectOnError: () => false,
        });

        redis.on('error', (err) => {
          const logger = new Logger('RedisModule');
          logger.warn(`Redis connection error: ${err.message}. Redis will be unavailable.`);
        });

        return redis;
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown, OnModuleInit {
  private readonly logger = new Logger('RedisModule');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Redis client not initialized. Proceeding without Redis.');
      return;
    }

    try {
      const reply = await this.redis.ping();
      this.logger.log(`Redis connection established: ${reply}`);
    } catch (error) {
      this.logger.warn(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}. Proceeding without Redis.`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch (error) {
        this.logger.warn(`Error closing Redis connection: ${error}`);
      }
    }
  }
}
