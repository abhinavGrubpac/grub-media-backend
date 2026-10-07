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
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 1000);

function build(session: Record<string, unknown> | null, updateManyCount = 1) {
  const sessionApi = {
    create: jest.fn().mockResolvedValue({ id: 's-new' }),
    findFirst: jest.fn().mockResolvedValue(session),
    updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
  };
  const prisma = {
    client: {
      session: sessionApi,
      user: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    },
  } as never;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') } as never;
  const config = { get: jest.fn().mockReturnValue('15m') } as never;
  return { svc: new TokenService(prisma, jwt, config), prisma, sessionApi };
}

async function sessionWithToken(secret: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    userId: 'u1',
    hashedToken: await argon2.hash(secret),
    revokedAt: null,
    expiresAt: future,
    user: activeUser,
    ...overrides,
  };
}

describe('TokenService.issuePair', () => {
  it('stores an argon2 hash of the secret and returns `${sessionId}.${secret}`', async () => {
    const { svc, sessionApi } = build(null);
    const pair = await svc.issuePair(activeUser as never, { ip: '1.1.1.1' });
    expect(pair.accessToken).toBe('access.jwt');
    expect(pair.refreshToken.startsWith('s-new.')).toBe(true);
    const data = sessionApi.create.mock.calls[0][0].data;
    const secret = pair.refreshToken.slice('s-new.'.length);
    expect(data.hashedToken.startsWith('$argon2')).toBe(true);
    expect(data.hashedToken).not.toContain(secret);
    expect(await argon2.verify(data.hashedToken, secret)).toBe(true);
  });

  it('refuses to issue tokens for a soft-deleted/inactive user (R4 defense-in-depth)', async () => {
    const { svc, sessionApi } = build(null);
    await expect(
      svc.issuePair({ ...activeUser, deletedAt: new Date() } as never, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessionApi.create).not.toHaveBeenCalled();
  });
});

describe('TokenService.rotate', () => {
  it('rotates a valid token: atomically revokes the old session, then issues a new pair', async () => {
    const secret = 'valid-secret';
    const { svc, sessionApi } = build(await sessionWithToken(secret));
    const result = await svc.rotate(`s1.${secret}`, { ip: '1.1.1.1' });
    expect(result.userId).toBe('u1');
    expect(result.accessToken).toBe('access.jwt');
    expect(sessionApi.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(sessionApi.create).toHaveBeenCalled();
  });

  it('detects reuse when the atomic revoke affects zero rows: nukes family + bumps tokenVersion + throws', async () => {
    const secret = 'leaked-secret';
    const { svc, prisma } = build(await sessionWithToken(secret), 0); // updateMany -> count 0
    await expect(svc.rotate(`s1.${secret}`, {})).rejects.toBeInstanceOf(UnauthorizedException);
    const client = (prisma as never as { client: { $transaction: jest.Mock } }).client;
    expect(client.$transaction).toHaveBeenCalled();
  });

  it('catches reuse of a revoked token even when it has already expired', async () => {
    const secret = 'old-secret';
    const session = await sessionWithToken(secret, { revokedAt: new Date(), expiresAt: past });
    const { svc, prisma } = build(session, 0); // already revoked -> count 0
    await expect(svc.rotate(`s1.${secret}`, {})).rejects.toThrow('reuse detected');
    const client = (prisma as never as { client: { $transaction: jest.Mock } }).client;
    expect(client.$transaction).toHaveBeenCalled();
  });

  it('rejects an expired (but never revoked) token without issuing new tokens', async () => {
    const secret = 'expired-secret';
    const session = await sessionWithToken(secret, { expiresAt: past });
    const { svc, sessionApi } = build(session, 1);
    await expect(svc.rotate(`s1.${secret}`, {})).rejects.toThrow('expired');
    expect(sessionApi.create).not.toHaveBeenCalled();
  });

  it('throws on a malformed token (no separator)', async () => {
    const { svc } = build(null);
    await expect(svc.rotate('no-separator', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the session id is unknown', async () => {
    const { svc } = build(null);
    await expect(svc.rotate('sX.some-secret', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when the secret does not verify against the stored hash', async () => {
    const session = await sessionWithToken('the-real-secret');
    const { svc } = build(session);
    await expect(svc.rotate('s1.wrong-secret', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['soft-deleted', { deletedAt: new Date() }],
    ['suspended', { status: 'SUSPENDED' }],
  ])(
    'refuses to rotate for a %s user (R4) without issuing tokens',
    async (_label, userOverride) => {
      const secret = 'ok-secret';
      const session = await sessionWithToken(secret, { user: { ...activeUser, ...userOverride } });
      const { svc, sessionApi } = build(session, 1);
      await expect(svc.rotate(`s1.${secret}`, {})).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionApi.create).not.toHaveBeenCalled();
    },
  );
});

describe('TokenService.revokeAllForUser', () => {
  it('bumps tokenVersion and revokes live sessions in one transaction', async () => {
    const { svc, prisma } = build(null);
    await svc.revokeAllForUser('u1');
    const client = (prisma as never as { client: { $transaction: jest.Mock } }).client;
    expect(client.$transaction).toHaveBeenCalledWith([expect.anything(), expect.anything()]);
  });
});
