import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { TokenService } from './token.service';

const activeUser = {
  id: 'u1',
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  tokenVersion: 0,
  deletedAt: null,
};

function deps(sessionRows: Array<Record<string, unknown>>) {
  const prisma = {
    client: {
      session: {
        create: jest.fn().mockResolvedValue({ id: 's-new' }),
        findMany: jest.fn().mockResolvedValue(sessionRows),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    },
  } as never;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') } as never;
  const config = {
    get: jest.fn((k: string) =>
      k === 'jwt.accessTtl' ? '15m' : k === 'jwt.refreshTtl' ? '7d' : 'access-secret',
    ),
  } as never;
  return { prisma, jwt, config };
}

const future = new Date(Date.now() + 86_400_000);

describe('TokenService.issuePair', () => {
  it('persists an argon2 hash of the refresh token (never the plaintext) and returns both tokens', async () => {
    const { prisma, jwt, config } = deps([]);
    const svc = new TokenService(prisma, jwt, config);
    const pair = await svc.issuePair(activeUser as never, { ip: '1.1.1.1' });
    expect(pair.accessToken).toBe('access.jwt');
    expect(typeof pair.refreshToken).toBe('string');
    const createArg = (prisma as never as { client: { session: { create: jest.Mock } } }).client
      .session.create.mock.calls[0][0].data;
    expect(createArg.hashedToken).not.toBe(pair.refreshToken);
    expect(createArg.hashedToken.startsWith('$argon2')).toBe(true);
    expect(createArg.userId).toBe('u1');
  });
});

describe('TokenService.rotate', () => {
  it('rotates a valid refresh token: issues a new pair and revokes the old session', async () => {
    const token = 'valid-refresh-token';
    const hashedToken = await argon2.hash(token);
    const session = {
      id: 's1',
      userId: 'u1',
      hashedToken,
      revokedAt: null,
      expiresAt: future,
      user: activeUser,
    };
    const { prisma, jwt, config } = deps([session]);
    const svc = new TokenService(prisma, jwt, config);
    const result = await svc.rotate(token, { ip: '1.1.1.1' });
    expect(result.userId).toBe('u1');
    expect(result.accessToken).toBe('access.jwt');
    const client = (prisma as never as { client: { session: { update: jest.Mock } } }).client;
    expect(client.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
  });

  it('detects reuse of an already-revoked token: revokes the whole family and throws', async () => {
    const token = 'leaked-token';
    const hashedToken = await argon2.hash(token);
    const session = {
      id: 's1',
      userId: 'u1',
      hashedToken,
      revokedAt: new Date(),
      expiresAt: future,
      user: activeUser,
    };
    const { prisma, jwt, config } = deps([session]);
    const svc = new TokenService(prisma, jwt, config);
    await expect(svc.rotate(token, {})).rejects.toBeInstanceOf(UnauthorizedException);
    const client = (prisma as never as { client: { session: { updateMany: jest.Mock } } }).client;
    expect(client.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
  });

  it('throws when no stored session matches the presented token', async () => {
    const hashedToken = await argon2.hash('some-other-token');
    const session = {
      id: 's1',
      userId: 'u1',
      hashedToken,
      revokedAt: null,
      expiresAt: future,
      user: activeUser,
    };
    const { prisma, jwt, config } = deps([session]);
    const svc = new TokenService(prisma, jwt, config);
    await expect(svc.rotate('wrong-token', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses to rotate for a soft-deleted or inactive user (R4)', async () => {
    const token = 'valid-token';
    const hashedToken = await argon2.hash(token);
    const deletedUser = { ...activeUser, deletedAt: new Date() };
    const session = {
      id: 's1',
      userId: 'u1',
      hashedToken,
      revokedAt: null,
      expiresAt: future,
      user: deletedUser,
    };
    const { prisma, jwt, config } = deps([session]);
    const svc = new TokenService(prisma, jwt, config);
    await expect(svc.rotate(token, {})).rejects.toBeInstanceOf(UnauthorizedException);
    const client = (prisma as never as { client: { session: { create: jest.Mock } } }).client;
    expect(client.session.create).not.toHaveBeenCalled();
  });
});
