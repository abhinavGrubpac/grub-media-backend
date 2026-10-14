import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { InvalidCredentialsException } from '../../../common/exceptions/domain.exceptions';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn().mockResolvedValue('NEWHASH'),
  argon2id: 2,
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2 = require('argon2') as { verify: jest.Mock; hash: jest.Mock };

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
  prismaUser?: Record<string, unknown> | null;
  claimCount?: number;
  resetRow?: Record<string, unknown> | null;
  nodeEnv?: string;
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
  const config = {
    get: jest.fn().mockImplementation((key: string, defaultVal?: unknown) => {
      if (key === 'app.nodeEnv') return opts.nodeEnv ?? 'test';
      return defaultVal ?? 5;
    }),
  } as never;

  argon2.verify.mockResolvedValue(opts.verify ?? true);
  argon2.hash.mockResolvedValue('NEWHASH');

  const prismaUserResult =
    opts.prismaUser !== undefined ? opts.prismaUser : opts.user !== undefined ? opts.user : userRow;

  const defaultResetRow = {
    id: 'rt1',
    userId: 'u1',
    hashedToken: 'HASH',
    expiresAt: new Date(Date.now() + 3600000),
    usedAt: null,
    user: userRow,
  };

  const prisma = {
    client: {
      user: {
        findFirst: jest.fn().mockResolvedValue(prismaUserResult),
        findUnique: jest.fn().mockResolvedValue(prismaUserResult),
        findUniqueOrThrow: jest.fn().mockResolvedValue(prismaUserResult ?? userRow),
        update: jest.fn().mockResolvedValue({}),
        otpCode: { create: jest.fn().mockResolvedValue({}) },
        otpCode_updateMany: jest.fn(),
      },
    },
    otpCode: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({ id: 'rt1' }),
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.resetRow !== undefined ? opts.resetRow : defaultResetRow),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    user: {
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as never;

  const mailer = {
    sendOtp: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetLink: jest.fn().mockResolvedValue(undefined),
  } as never;

  const logs = { record: jest.fn().mockResolvedValue(undefined) } as never;

  return {
    svc: new AuthService(users, tokens, redis, config, prisma, mailer, logs),
    users,
    tokens,
    redis,
    config,
    prisma,
    mailer,
    logs,
  };
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('AuthService.login', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns tokens + user on valid credentials and clears the attempt counter', async () => {
    const { svc, redis, logs } = build({ verify: true });
    const res = await svc.login({ email: 'a@b.c', password: 'x' }, { ip: '1.1.1.1' });
    expect(res.accessToken).toBe('a');
    expect(res.refreshToken).toBe('r');
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.user.email).toBe('a@b.c');
    expect((redis as never as { del: jest.Mock }).del).toHaveBeenCalled();
    expect((logs as never as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({
        typeEnum: 'SYSTEM', // auth-session events live in the SYSTEM stream
        categoryName: 'Authentication',
        actionName: 'Login',
        userId: 'u1',
      }),
    );
  });

  it('records an ACTIVITY/Failed Login audit row on a wrong password', async () => {
    const { svc, logs } = build({ verify: false });
    await expect(svc.login({ email: 'a@b.c', password: 'x' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
    expect((logs as never as { record: jest.Mock }).record).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'Failed Login', target: 'a@b.c' }),
    );
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

// ---------------------------------------------------------------------------
// refresh / logout / me
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// requestOtpLogin
// ---------------------------------------------------------------------------

describe('AuthService.requestOtpLogin', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates an OTP, invalidates old ones, and sends email for a valid active user', async () => {
    const { svc, prisma, mailer } = build({});
    await svc.requestOtpLogin({ email: 'a@b.c' }, { ip: '1.1.1.1' });

    // Invalidates existing unused OTPs first
    expect(
      (prisma as never as { otpCode: { updateMany: jest.Mock } }).otpCode.updateMany,
    ).toHaveBeenCalledWith(expect.objectContaining({ data: { usedAt: expect.any(Date) } }));
    // Then creates new OTP
    expect(
      (prisma as never as { otpCode: { create: jest.Mock } }).otpCode.create,
    ).toHaveBeenCalled();
    // Sends the email
    expect((mailer as never as { sendOtp: jest.Mock }).sendOtp).toHaveBeenCalledWith(
      'a@b.c',
      expect.stringMatching(/^\d{4}$/),
    );
  });

  it('resolves silently without sending an OTP when the email is not registered (no enumeration)', async () => {
    const { svc, mailer } = build({ prismaUser: null });
    await expect(svc.requestOtpLogin({ email: 'ghost@b.c' })).resolves.toBeUndefined();
    expect((mailer as never as { sendOtp: jest.Mock }).sendOtp).not.toHaveBeenCalled();
  });

  it('throws Forbidden when account is inactive (does not send OTP)', async () => {
    const { svc, mailer } = build({ prismaUser: { ...userRow, status: 'INACTIVE' } });
    await expect(svc.requestOtpLogin({ email: 'a@b.c' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect((mailer as never as { sendOtp: jest.Mock }).sendOtp).not.toHaveBeenCalled();
  });

  it('throws Forbidden when the OTP request rate limit is exceeded', async () => {
    const { svc, mailer } = build({ attempts: 4 });
    await expect(svc.requestOtpLogin({ email: 'a@b.c' }, { ip: '1.1.1.1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect((mailer as never as { sendOtp: jest.Mock }).sendOtp).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// verifyOtpLogin
// ---------------------------------------------------------------------------

describe('AuthService.verifyOtpLogin', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns tokens when OTP claim succeeds', async () => {
    const { svc, redis } = build({ claimCount: 1 });
    const res = await svc.verifyOtpLogin({ email: 'a@b.c', code: '5678' }, { ip: '1.1.1.1' });
    expect(res.accessToken).toBe('a');
    expect(res.refreshToken).toBe('r');
    expect((redis as never as { del: jest.Mock }).del).toHaveBeenCalled();
  });

  it('throws InvalidCredentials when OTP claim returns count 0 (wrong/expired code)', async () => {
    const { svc } = build({ claimCount: 0 });
    await expect(svc.verifyOtpLogin({ email: 'a@b.c', code: '0000' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });

  it('throws InvalidCredentials when user is not found', async () => {
    const { svc } = build({ prismaUser: null });
    await expect(
      svc.verifyOtpLogin({ email: 'ghost@b.c', code: '1234' }, {}),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('throws Forbidden and does NOT hit DB when attempt limit is exceeded', async () => {
    const { svc, prisma } = build({ attempts: 6 });
    await expect(
      svc.verifyOtpLogin({ email: 'a@b.c', code: '1234' }, { ip: '1.1.1.1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (prisma as never as { client: { user: { findFirst: jest.Mock } } }).client.user.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('bypasses OTP DB check in development mode when code is 1234', async () => {
    const { svc, prisma } = build({ nodeEnv: 'development' });
    const res = await svc.verifyOtpLogin({ email: 'a@b.c', code: '1234' }, { ip: '1.1.1.1' });
    expect(res.accessToken).toBe('a');
    // OTP DB lookup must be skipped
    expect(
      (prisma as never as { otpCode: { updateMany: jest.Mock } }).otpCode.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('does NOT bypass OTP check in production mode when code is 1234 (must fail DB lookup)', async () => {
    const { svc } = build({ nodeEnv: 'production', claimCount: 0 });
    await expect(svc.verifyOtpLogin({ email: 'a@b.c', code: '1234' }, {})).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });
});

// ---------------------------------------------------------------------------
// forgotPassword
// ---------------------------------------------------------------------------

describe('AuthService.forgotPassword', () => {
  afterEach(() => jest.clearAllMocks());

  it('invalidates old tokens, creates a new one, and sends email for an active user', async () => {
    const { svc, prisma, mailer } = build({});
    await svc.forgotPassword({ email: 'a@b.c' });

    // Invalidates old tokens first
    expect(
      (prisma as never as { passwordResetToken: { updateMany: jest.Mock } }).passwordResetToken
        .updateMany,
    ).toHaveBeenCalledWith(expect.objectContaining({ data: { usedAt: expect.any(Date) } }));
    // Creates a new token
    expect(
      (prisma as never as { passwordResetToken: { create: jest.Mock } }).passwordResetToken.create,
    ).toHaveBeenCalled();
    expect(
      (mailer as never as { sendPasswordResetLink: jest.Mock }).sendPasswordResetLink,
    ).toHaveBeenCalledWith('a@b.c', expect.stringContaining('.'));
  });

  it('resolves silently without sending a reset link when email is not registered (no enumeration)', async () => {
    const { svc, mailer } = build({ prismaUser: null });
    await expect(svc.forgotPassword({ email: 'ghost@b.c' })).resolves.toBeUndefined();
    expect(
      (mailer as never as { sendPasswordResetLink: jest.Mock }).sendPasswordResetLink,
    ).not.toHaveBeenCalled();
  });

  it('throws Forbidden when account is inactive (does not send reset link)', async () => {
    const { svc, mailer } = build({ prismaUser: { ...userRow, status: 'INACTIVE' } });
    await expect(svc.forgotPassword({ email: 'a@b.c' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (mailer as never as { sendPasswordResetLink: jest.Mock }).sendPasswordResetLink,
    ).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

describe('AuthService.resetPassword', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws BadRequestException for a token missing a dot separator', async () => {
    const { svc } = build({});
    await expect(
      svc.resetPassword({ token: 'nodottoken', password: 'newpassword1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when the reset token row is not found', async () => {
    const { svc } = build({ resetRow: null });
    await expect(
      svc.resetPassword({ token: 'id.secret', password: 'NewPass1!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when the linked account is not active', async () => {
    const { svc } = build({
      resetRow: {
        id: 'rt1',
        userId: 'u1',
        hashedToken: 'HASH',
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
        user: { ...userRow, status: 'INACTIVE' },
      },
    });
    await expect(
      svc.resetPassword({ token: 'rt1.secret', password: 'NewPass1!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when the atomic claim fails (token already used)', async () => {
    const { svc } = build({ claimCount: 0 });
    await expect(
      svc.resetPassword({ token: 'rt1.secret', password: 'NewPass1!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resets password and bumps tokenVersion for a valid token', async () => {
    const { svc, prisma } = build({ claimCount: 1 });
    await svc.resetPassword({ token: 'rt1.secret', password: 'NewPass1!' });
    expect((prisma as never as { user: { update: jest.Mock } }).user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });

  it('audits the reset with redacted markers and never the password itself', async () => {
    const { svc, logs } = build({ claimCount: 1 });
    await svc.resetPassword({ token: 'rt1.secret', password: 'NewPass1!' });

    const arg = (logs as never as { record: jest.Mock }).record.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(arg.actionName).toBe('Password Reset');
    expect(arg.empId).toBe('u1');
    expect(arg.oldDetail).toEqual({ password: '<redacted: previous value>' });
    expect(arg.newDetail).toEqual({ password: '<redacted: new value>' });
    // The reset password may never reach the audit trail.
    expect(JSON.stringify(arg)).not.toContain('NewPass1!');
  });
});

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

describe('AuthService.changePassword', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws InvalidCredentials when the current password is wrong', async () => {
    const { svc } = build({ verify: false });
    await expect(
      svc.changePassword('u1', { currentPassword: 'wrong', newPassword: 'NewPass1!' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('throws BadRequestException when new password is the same as current', async () => {
    // verify: currentPassword → true (correct), then newPassword → true (same hash match)
    argon2.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const { svc } = build({});
    await expect(
      svc.changePassword('u1', { currentPassword: 'SamePass1!', newPassword: 'SamePass1!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('succeeds when current password is correct and new password is different', async () => {
    // verify: currentPassword → true, newPassword → false (different)
    argon2.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { svc, prisma } = build({});
    await svc.changePassword('u1', { currentPassword: 'OldPass1!', newPassword: 'NewPass1!' });
    expect(
      (prisma as never as { client: { user: { update: jest.Mock } } }).client.user.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });

  it('audits the change with redacted markers and never the passwords themselves', async () => {
    argon2.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { svc, logs } = build({});
    await svc.changePassword('u1', { currentPassword: 'OldPass1!', newPassword: 'NewPass1!' });

    const arg = (logs as never as { record: jest.Mock }).record.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(arg.actionName).toBe('Password Changed');
    expect(arg.empId).toBe('u1');
    expect(arg.oldDetail).toEqual({ password: '<redacted: previous value>' });
    expect(arg.newDetail).toEqual({ password: '<redacted: new value>' });
    // Neither submitted password may ever reach the audit trail.
    expect(JSON.stringify(arg)).not.toContain('OldPass1!');
    expect(JSON.stringify(arg)).not.toContain('NewPass1!');
  });
});
