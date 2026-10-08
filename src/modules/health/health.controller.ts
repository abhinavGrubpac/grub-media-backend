import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../auth/decorators/public.decorator';
import { RedisHealthIndicator } from './redis.health';

/**
 * VERSION_NEUTRAL so it serves BOTH `/api/health` (load-balancer probe) and
 * `/api/v1/health` (documented). Public — no auth required. Checks DB + Redis.
 */
@ApiTags('Health')
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Public()
  @Get(['health', 'v1/health'])
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness/readiness check (database + redis)' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
