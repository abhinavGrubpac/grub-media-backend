import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { InvalidCredentialsException } from '../../../common/exceptions/domain.exceptions';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
  argon2id: 2,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2 = require('argon2') as { verify: jest.Mock };

const userRow = {
  id: 'u1',
  email: 'a@b.c',
  passwordHash: 'HASH',
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  tokenVersion: 0,
  deletedAt: null,
};

function build(opts: {
  user?: Record<string, unknown> | null;
  attempts?: number;
  verify?: boolean;
}) {
  const users = {
    findByEmailWithHash: jest.fn().mockResolvedValue(opts.user === undefined ? userRow : opts.user),
    findById: jest.fn().mockResolvedValue({ id: 'u1' }),
  } as never;
  const tokens = {
    issuePair: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    rotate: jest.fn(),
    revokeAllForUser: jest.fn(),
  } as never;
  const redis = {
    increment: jest.fn().mockResolvedValue(opts.attempts ?? 1),
    del: jest.fn().mockResolvedValue(undefined),
  } as never;
  const config = { get: jest.fn().mockReturnValue(5) } as never;
  argon2.verify.mockResolvedValue(opts.verify ?? true);
  return { svc: new AuthService(users, tokens, redis, config), users, tokens, redis };
}

describe('AuthService.login', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns tokens + user on valid credentials and clears the attempt counter', async () => {
    const { svc, redis } = build({ verify: true });
    const res = await svc.login({ email: 'a@b.c', password: 'x' }, { ip: '1.1.1.1' });
    expect(res.accessToken).toBe('a');
    expect(res.refreshToken).toBe('r');
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.user.email).toBe('a@b.c');
    expect((redis as never as { del: jest.Mock }).del).toHaveBeenCalled();
  });

  it('throws InvalidCredentials on a wrong password', async () => {
    const { svc } = build({ verify: false });
    await expect(svc.login({ email: 'a@b.c', password: 'x' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });

  it('throws InvalidCredentials for an unknown email (no user enumeration difference)', async () => {
    const { svc } = build({ user: null });
    await expect(svc.login({ email: 'nobody@b.c', password: 'x' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });

  it('locks out after too many failed attempts (Forbidden, before verifying credentials)', async () => {
    const { svc, users } = build({ attempts: 6 });
    await expect(
      svc.login({ email: 'a@b.c', password: 'x' }, { ip: '1.1.1.1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (users as never as { findByEmailWithHash: jest.Mock }).findByEmailWithHash,
    ).not.toHaveBeenCalled();
  });

  it('rejects a soft-deleted user (cannot authenticate)', async () => {
    const { svc } = build({ user: { ...userRow, deletedAt: new Date() } });
    await expect(svc.login({ email: 'a@b.c', password: 'x' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });

  it('rejects an INACTIVE (suspended) user', async () => {
    const { svc } = build({ user: { ...userRow, status: 'SUSPENDED' } });
    await expect(svc.login({ email: 'a@b.c', password: 'x' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });
});

describe('AuthService.refresh / logout / me', () => {
  afterEach(() => jest.clearAllMocks());

  it('refresh delegates to TokenService.rotate and returns the new pair', async () => {
    const { svc, tokens } = build({});
    (tokens as never as { rotate: jest.Mock }).rotate.mockResolvedValue({
      accessToken: 'a2',
      refreshToken: 'r2',
      userId: 'u1',
    });
    const res = await svc.refresh('sid.secret', { ip: '1.1.1.1' });
    expect(res).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect((tokens as never as { rotate: jest.Mock }).rotate).toHaveBeenCalledWith('sid.secret', {
      ip: '1.1.1.1',
    });
  });

  it('logout revokes all sessions for the user', async () => {
    const { svc, tokens } = build({});
    await svc.logout('u1');
    expect(
      (tokens as never as { revokeAllForUser: jest.Mock }).revokeAllForUser,
    ).toHaveBeenCalledWith('u1');
  });

  it('me returns the current user DTO by id', async () => {
    const { svc, users } = build({});
    const res = await svc.me('u1');
    expect(res).toEqual({ id: 'u1' });
    expect((users as never as { findById: jest.Mock }).findById).toHaveBeenCalledWith('u1');
  });
});
