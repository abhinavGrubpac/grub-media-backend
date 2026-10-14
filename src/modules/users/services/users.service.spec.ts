import { UsersService } from './users.service';
import {
  EmailAlreadyExistsException,
  UserNotFoundException,
} from '../../../common/exceptions/domain.exceptions';

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

function prismaMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    client: {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(userRow),
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([userRow]),
        update: jest.fn().mockResolvedValue(userRow),
        ...overrides,
      },
    },
  } as never;
}

const newUser = { email: 'a@b.c', password: 'Str0ngPass1', firstName: 'A', lastName: 'B' };

/** LogsService is optional at runtime — a no-op mock keeps existing assertions intact. */
function logsMock() {
  return { record: jest.fn().mockResolvedValue(undefined) } as never;
}

describe('UsersService', () => {
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
    expect(passed.passwordHash.startsWith('$argon2')).toBe(true);
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
    const svc = new UsersService(prismaMock(), logsMock());
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

  it('softDelete sets deletedAt via update after confirming existence', async () => {
    const update = jest.fn().mockResolvedValue(userRow);
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow), update }),
      logsMock(),
    );
    await svc.softDelete('u1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { deletedAt: expect.any(Date) } }),
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
    );
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('password');
    expect(data).not.toHaveProperty('passwordHash');
    expect(data.firstName).toBe('New');
    expect(data.updatedBy).toBe('admin');
  });

  it('setStatus sends only the status field', async () => {
    const update = jest.fn().mockResolvedValue(userRow);
    const svc = new UsersService(
      prismaMock({ findFirst: jest.fn().mockResolvedValue(userRow), update }),
      logsMock(),
    );
    await svc.setStatus('u1', 'SUSPENDED' as never);
    expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { status: 'SUSPENDED' } });
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
