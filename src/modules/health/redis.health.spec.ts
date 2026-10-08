import { RedisHealthIndicator } from './redis.health';

function healthService() {
  return {
    check: (key: string) => ({
      up: (data?: Record<string, unknown>) => ({ [key]: { status: 'up', ...data } }),
      down: (data?: Record<string, unknown>) => ({ [key]: { status: 'down', ...data } }),
    }),
  } as never;
}

describe('RedisHealthIndicator', () => {
  it('reports up when ping returns PONG', async () => {
    const redis = {
      ping: jest.fn().mockResolvedValue('PONG'),
      isAvailable: jest.fn().mockReturnValue(true),
    } as never;
    const indicator = new RedisHealthIndicator(healthService(), redis);
    await expect(indicator.isHealthy('redis')).resolves.toEqual({ redis: { status: 'up' } });
  });

  it('reports down when ping returns an unexpected reply', async () => {
    const redis = {
      ping: jest.fn().mockResolvedValue('nope'),
      isAvailable: jest.fn().mockReturnValue(true),
    } as never;
    const indicator = new RedisHealthIndicator(healthService(), redis);
    const result = await indicator.isHealthy('redis');
    expect(result.redis.status).toBe('down');
  });

  it('reports down when ping throws (Redis unreachable)', async () => {
    const redis = {
      ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      isAvailable: jest.fn().mockReturnValue(true),
    } as never;
    const indicator = new RedisHealthIndicator(healthService(), redis);
    const result = await indicator.isHealthy('redis');
    expect(result.redis.status).toBe('down');
  });

  it('reports up with optional message when Redis is not available', async () => {
    const redis = {
      isAvailable: jest.fn().mockReturnValue(false),
    } as never;
    const indicator = new RedisHealthIndicator(healthService(), redis);
    const result = await indicator.isHealthy('redis');
    expect(result.redis.status).toBe('up');
    expect(result.redis.message).toBe('Redis not configured (optional)');
  });
});
