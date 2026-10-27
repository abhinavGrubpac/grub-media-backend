import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const payload = { sub: 'u1', role: 'EMPLOYEE', tokenVersion: 3 };

function build(userRow: Record<string, unknown> | null) {
  const findFirst = jest.fn().mockResolvedValue(userRow);
  const prisma = { client: { user: { findFirst } } } as never;
  const config = { get: jest.fn().mockReturnValue('x'.repeat(32)) } as never;
  return { strategy: new JwtStrategy(config, prisma), findFirst };
}

describe('JwtStrategy.validate', () => {
  it('returns the AuthUser for an active user whose tokenVersion matches', async () => {
    const { strategy } = build({
      id: 'u1',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      tokenVersion: 3,
    });
    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'u1',
      role: 'EMPLOYEE',
      tokenVersion: 3,
    });
  });

  it('rejects when the user is missing (e.g. soft-deleted → excluded by client extension)', async () => {
    const { strategy } = build(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive (suspended/deactivated) user', async () => {
    const { strategy } = build({
      id: 'u1',
      role: 'EMPLOYEE',
      status: 'SUSPENDED',
      tokenVersion: 3,
    });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose tokenVersion is stale (logout-everywhere)', async () => {
    const { strategy } = build({ id: 'u1', role: 'EMPLOYEE', status: 'ACTIVE', tokenVersion: 4 });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
