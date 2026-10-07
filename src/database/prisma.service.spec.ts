import { applyNotDeleted, PrismaService } from './prisma.service';

describe('applyNotDeleted', () => {
  it('adds deletedAt:null when there is no where', () => {
    expect(applyNotDeleted(undefined)).toEqual({ deletedAt: null });
  });

  it('merges deletedAt:null with an existing where', () => {
    expect(applyNotDeleted({ email: 'a@b.c' })).toEqual({ deletedAt: null, email: 'a@b.c' });
  });

  it('lets an explicit deletedAt filter override the default (to query deleted rows)', () => {
    expect(applyNotDeleted({ deletedAt: { not: null } })).toEqual({ deletedAt: { not: null } });
  });
});

describe('PrismaService', () => {
  const original = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  });
  afterAll(() => {
    process.env.DATABASE_URL = original;
  });

  it('exposes an extended client and lifecycle hooks', () => {
    const service = new PrismaService();
    expect(service.client).toBeDefined();
    expect(service.client.user).toBeDefined();
    expect(typeof service.onModuleInit).toBe('function');
    expect(typeof service.onModuleDestroy).toBe('function');
  });
});
