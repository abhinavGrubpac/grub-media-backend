import { RedisService } from './redis.service';

describe('RedisService', () => {
  it('increment increments and sets TTL on the key', async () => {
    const fake = {
      multi: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 1],
        [null, 1],
      ]),
    };
    const service = new RedisService(fake as never);
    const count = await service.increment('login:a@b.c', 900);

    expect(count).toBe(1);
    expect(fake.incr).toHaveBeenCalledWith('login:a@b.c');
    expect(fake.expire).toHaveBeenCalledWith('login:a@b.c', 900);
  });

  it('increment returns 0 when exec yields no result', async () => {
    const fake = {
      multi: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    };
    const service = new RedisService(fake as never);
    await expect(service.increment('k', 60)).resolves.toBe(0);
  });

  it('set uses EX when a TTL is provided, plain SET otherwise', async () => {
    const fake = { set: jest.fn().mockResolvedValue('OK') };
    const service = new RedisService(fake as never);

    await service.set('k', 'v', 120);
    expect(fake.set).toHaveBeenCalledWith('k', 'v', 'EX', 120);

    await service.set('k2', 'v2');
    expect(fake.set).toHaveBeenLastCalledWith('k2', 'v2');
  });

  it('increment throws when the INCR command errored (never reads as 0)', async () => {
    const commandError = new Error('WRONGTYPE');
    const fake = {
      multi: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [commandError, null],
        [null, 1],
      ]),
    };
    const service = new RedisService(fake as never);
    await expect(service.increment('k', 60)).rejects.toBe(commandError);
  });

  it('get delegates to the client', async () => {
    const fake = { get: jest.fn().mockResolvedValue('v') };
    const service = new RedisService(fake as never);
    await expect(service.get('k')).resolves.toBe('v');
    expect(fake.get).toHaveBeenCalledWith('k');
  });

  it('del delegates to the client', async () => {
    const fake = { del: jest.fn().mockResolvedValue(1) };
    const service = new RedisService(fake as never);
    await service.del('k');
    expect(fake.del).toHaveBeenCalledWith('k');
  });

  it('ping delegates to the client', async () => {
    const fake = { ping: jest.fn().mockResolvedValue('PONG') };
    const service = new RedisService(fake as never);
    await expect(service.ping()).resolves.toBe('PONG');
  });
});
