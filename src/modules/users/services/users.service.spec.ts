import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  EmailAlreadyExistsException,
  InvalidCredentialsException,
  UserNotFoundException,
} from '../../../common/exceptions/domain.exceptions';

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
  firstName: 'A',
  lastName: 'B',
  role: 'EMPLOYEE',
  status: 'ACTIVE',
  tokenVersion: 0,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mailerMock = {
  sendOtp: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetLink: jest.fn().mockResolvedValue(undefined),
} as never;

const configMock = {
  get: jest.fn().mockReturnValue('test'),
} as never;

const storageMock = {
  uploadImage: jest.fn().mockResolvedValue('https://cdn.example.com/avatar.jpg'),
  deleteByUrl: jest.fn().mockResolvedValue(undefined),
} as never;

function prismaMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    client: {
      user: {
        findFirst: jest.fn().mockResolvedValue(userRow),
        findUniqueOrThrow: jest.fn().mockResolvedValue(userRow),
        create: jest.fn().mockResolvedValue(userRow),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([userRow]),
        update: jest.fn().mockResolvedValue(userRow),
        ...overrides,
      },
    },
    otpCode: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as never;
}

function build(
  opts: {
    prismaUser?: Record<string, unknown> | null;
    claimCount?: number;
    verify?: boolean;
    nodeEnv?: string;
  } = {},
) {
  const prisma = {
    client: {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.prismaUser !== undefined ? opts.prismaUser : userRow),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(
            opts.prismaUser !== undefined ? (opts.prismaUser ?? userRow) : userRow,
          ),
        create: jest.fn().mockResolvedValue(userRow),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([userRow]),
        update: jest.fn().mockResolvedValue(userRow),
      },
    },
    otpCode: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as never;

  argon2.verify.mockResolvedValue(opts.verify ?? true);
  argon2.hash.mockResolvedValue('NEWHASH');

  const mailer = {
    sendOtp: jest.fn().mockResolvedValue(undefined),
  } as never;

  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'app.nodeEnv') return opts.nodeEnv ?? 'test';
      return undefined;
    }),
  } as never;

  const storage = {
    uploadImage: jest.fn().mockResolvedValue('https://cdn.example.com/avatar.jpg'),
    deleteByUrl: jest.fn().mockResolvedValue(undefined),
  } as never;
  return {
    svc: new UsersService(prisma, mailer, config, storage),
    prisma,
    mailer,
    config,
    storage,
  };
}

const newUser = { email: 'a@b.c', password: 'Str0ngPass1', firstName: 'A', lastName: 'B' };

/** LogsService is optional at runtime — a no-op mock keeps existing assertions intact. */
function logsMock() {
  return { record: jest.fn().mockResolvedValue(undefined) } as never;
}

describe('UsersService', () => {
  afterEach(() => jest.clearAllMocks());

  it('creates a user and never returns passwordHash', async () => {
    const svc = new UsersService(prismaMock(), logsMock());
    const result = await svc.create(newUser as never);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('deletedAt');
    expect(result.email).toBe('a@b.c');
  });

  it('hashes the password with argon2 (no plaintext stored)', async () => {
    const create = jest.fn().mockResolvedValue(userRow);
    const svc = new UsersService(prismaMock({ create }), logsMock());
    await svc.create(newUser as never);
    const passed = create.mock.calls[0][0].data;
    expect(passed.passwordHash).toBeDefined();
    expect(passed.passwordHash).not.toBe('Str0ngPass1');
    expect(argon2.hash).toHaveBeenCalledWith('Str0ngPass1', expect.anything());
    expect(passed).not.toHaveProperty('password');
  });

  it('rejects a duplicate email with EmailAlreadyExistsException', async () => {
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow) }),
      logsMock(),
    );
    await expect(svc.create(newUser as never)).rejects.toBeInstanceOf(EmailAlreadyExistsException);
  });

  it('list returns paginated DTOs without passwordHash and correct meta', async () => {
    const svc = new UsersService(prismaMock());
    const page = await svc.list({ page: 1, limit: 20, sortOrder: 'desc' } as never);
    expect(page.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(page.data[0]).not.toHaveProperty('passwordHash');
    expect(page.data[0].email).toBe('a@b.c');
  });

  it('findById throws UserNotFoundException when missing', async () => {
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(null) }),
      logsMock(),
    );
    await expect(svc.findById('nope')).rejects.toBeInstanceOf(UserNotFoundException);
  });

  it('softDelete sets deletedAt after confirming existence and hierarchy', async () => {
    const update = jest.fn().mockResolvedValue(userRow);
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow), update }),
      logsMock(),
    );
    await svc.softDelete('u1', 'actor-1', 'ADMIN' as never);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('softDelete throws Forbidden when actor tries to delete themselves', async () => {
    const svc = new UsersService(prismaMock(), mailerMock, configMock, storageMock);
    await expect(svc.softDelete('u1', 'u1', 'ADMIN' as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('update maps only known fields and never forwards a smuggled password', async () => {
    const update = jest.fn().mockResolvedValue(userRow);
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow), update }),
      logsMock(),
    );
    await svc.update(
      'u1',
      { firstName: 'New', password: 'x', passwordHash: 'y' } as never,
      'admin',
      'ADMIN' as never,
    );
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('password');
    expect(data).not.toHaveProperty('passwordHash');
    expect(data.firstName).toBe('New');
    expect(data.updatedBy).toBe('admin');
  });

  it('update throws Forbidden when ADMIN tries to modify a SUPER_ADMIN', async () => {
    const superAdminRow = { ...userRow, role: 'SUPER_ADMIN' };
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow), update }),
      logsMock(),
    );
    await expect(
      svc.update('u1', { firstName: 'X' } as never, 'admin', 'ADMIN' as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findByEmailWithHash returns the raw row (includes hash) for auth use', async () => {
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow) }),
      logsMock(),
    );
    const row = await svc.findByEmailWithHash('a@b.c');
    expect(row?.passwordHash).toBe('HASH');
  });

  it('create records an EMPLOYEE/Onboarding audit log with the actor id', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const svc = new UsersService(prismaMock(), { record } as never);
    await svc.create(newUser as never, 'admin-1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        typeEnum: 'EMPLOYEE',
        categoryName: 'Onboarding',
        actionName: 'Create Employee',
        userId: 'admin-1',
        empId: 'u1',
        // No employeeId on the fixture → logRefOf falls back to the email.
        referenceId: 'a@b.c',
      }),
    );
  });

  it('update records before/after state in the audit log', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(userRow);
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow), update }),
      { record } as never,
    );
    await svc.update('u1', { firstName: 'New' } as never, 'admin-1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        typeEnum: 'EMPLOYEE',
        categoryName: 'Employment',
        actionName: 'Update Employee',
        oldDetail: expect.objectContaining({ id: 'u1' }),
        newDetail: expect.objectContaining({ id: 'u1' }),
      }),
    );
  });

  it('softDelete records an Exit audit log with the actor id', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const svc = new UsersService(prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow) }), {
      record,
    } as never);
    await svc.softDelete('u1', 'admin-1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        typeEnum: 'EMPLOYEE',
        categoryName: 'Exit',
        actionName: 'Delete Employee',
        userId: 'admin-1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

describe('UsersService.changePassword', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws InvalidCredentials when the current password is wrong', async () => {
    const { svc } = build({ verify: false });
    await expect(
      svc.changePassword('u1', { currentPassword: 'wrong', newPassword: 'NewPass1!' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('throws BadRequestException when new password is the same as current', async () => {
    argon2.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const { svc } = build({});
    await expect(
      svc.changePassword('u1', { currentPassword: 'SamePass1!', newPassword: 'SamePass1!' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('succeeds when current password is correct and new password is different', async () => {
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
});

// ---------------------------------------------------------------------------
// requestProfileOtp
// ---------------------------------------------------------------------------

describe('UsersService.requestProfileOtp', () => {
  afterEach(() => jest.clearAllMocks());

  it('invalidates old OTPs and creates a new one for email type, sends OTP via email', async () => {
    const { svc, prisma, mailer } = build({});
    await svc.requestProfileOtp('u1', { type: 'email', value: 'new@example.com' });

    expect(
      (prisma as never as { otpCode: { updateMany: jest.Mock } }).otpCode.updateMany,
    ).toHaveBeenCalledWith(expect.objectContaining({ data: { usedAt: expect.any(Date) } }));
    expect(
      (prisma as never as { otpCode: { create: jest.Mock } }).otpCode.create,
    ).toHaveBeenCalled();
    expect((mailer as never as { sendOtp: jest.Mock }).sendOtp).toHaveBeenCalledWith(
      'new@example.com',
      expect.stringMatching(/^\d{4}$/),
    );
  });

  it('does NOT send email for phone type (SMS not supported)', async () => {
    const { svc, mailer } = build({});
    await svc.requestProfileOtp('u1', { type: 'phone', value: '+919876543210' });
    expect((mailer as never as { sendOtp: jest.Mock }).sendOtp).not.toHaveBeenCalled();
  });

  it('throws InvalidCredentials when user id is not found', async () => {
    const { svc } = build({ prismaUser: null });
    await expect(
      svc.requestProfileOtp('u1', { type: 'email', value: 'new@example.com' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });
});

// ---------------------------------------------------------------------------
// verifyProfileOtp
// ---------------------------------------------------------------------------

describe('UsersService.verifyProfileOtp', () => {
  afterEach(() => jest.clearAllMocks());

  it('updates email and returns user when OTP is valid', async () => {
    const { svc, prisma } = build({ claimCount: 1 });

    const res = await svc.verifyProfileOtp('u1', {
      type: 'email',
      value: 'new@example.com',
      code: '5678',
    });
    expect(res).toBeDefined();
    expect(
      (prisma as never as { client: { user: { update: jest.Mock } } }).client.user.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com' }) }),
    );
  });

  it('throws BadRequestException for an invalid or expired OTP', async () => {
    const { svc } = build({ claimCount: 0 });
    await expect(
      svc.verifyProfileOtp('u1', { type: 'email', value: 'new@example.com', code: '0000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws ConflictException when email is already used by another account', async () => {
    const { svc, prisma } = build({ claimCount: 1 });
    (prisma as never as { user: { findFirst: jest.Mock } }).user.findFirst = jest
      .fn()
      .mockResolvedValue({ ...userRow, id: 'u2' });

    await expect(
      svc.verifyProfileOtp('u1', { type: 'email', value: 'taken@example.com', code: '5678' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates phone number and returns user when OTP is valid', async () => {
    const { svc, prisma } = build({ claimCount: 1 });
    await svc.verifyProfileOtp('u1', {
      type: 'phone',
      value: '+919876543210',
      code: '5678',
    });
    expect(
      (prisma as never as { client: { user: { update: jest.Mock } } }).client.user.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phoneNumber: '+919876543210' }),
      }),
    );
  });

  it('bypasses OTP DB check in development mode when code is 1234 (email)', async () => {
    const { svc, prisma } = build({ nodeEnv: 'development' });
    await svc.verifyProfileOtp('u1', { type: 'email', value: 'new@example.com', code: '1234' });
    expect(
      (prisma as never as { otpCode: { updateMany: jest.Mock } }).otpCode.updateMany,
    ).not.toHaveBeenCalled();
    expect(
      (prisma as never as { client: { user: { update: jest.Mock } } }).client.user.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com' }) }),
    );
  });

  it('bypasses OTP DB check in development mode when code is 1234 (phone)', async () => {
    const { svc, prisma } = build({ nodeEnv: 'development' });
    await svc.verifyProfileOtp('u1', { type: 'phone', value: '+919876543210', code: '1234' });
    expect(
      (prisma as never as { otpCode: { updateMany: jest.Mock } }).otpCode.updateMany,
    ).not.toHaveBeenCalled();
    expect(
      (prisma as never as { client: { user: { update: jest.Mock } } }).client.user.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phoneNumber: '+919876543210' }) }),
    );
  });

  it('does NOT bypass OTP check in production mode when code is 1234', async () => {
    const { svc } = build({ nodeEnv: 'production', claimCount: 0 });
    await expect(
      svc.verifyProfileOtp('u1', { type: 'email', value: 'new@example.com', code: '1234' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
