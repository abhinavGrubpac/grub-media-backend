import { UsersController } from './users.controller';
import { AuthUser } from '../../auth/decorators/current-user.decorator';

const actor: AuthUser = { id: 'admin-1', role: 'ADMIN' as never, tokenVersion: 0 };

describe('UsersController (thin delegation)', () => {
  it('create delegates to the service with the actor id', async () => {
    const service = { create: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.create({ email: 'a@b.c' } as never, actor);
    expect((service as { create: jest.Mock }).create).toHaveBeenCalledWith(
      { email: 'a@b.c' },
      'admin-1',
    );
  });

  it('list passes the query through to the service', async () => {
    const service = { list: jest.fn().mockResolvedValue({ data: [], meta: {} }) } as never;
    const ctrl = new UsersController(service);
    const query = { page: 2, limit: 10, sortOrder: 'asc' };
    await ctrl.list(query as never);
    expect((service as { list: jest.Mock }).list).toHaveBeenCalledWith(query);
  });

  it('remove delegates to softDelete and returns null', async () => {
    const service = { softDelete: jest.fn().mockResolvedValue(undefined) } as never;
    const ctrl = new UsersController(service);
    const result = await ctrl.remove('u1');
    expect(result).toBeNull();
    expect((service as { softDelete: jest.Mock }).softDelete).toHaveBeenCalledWith('u1');
  });

  it('findOne delegates to findById', async () => {
    const service = { findById: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.findOne('u1');
    expect((service as { findById: jest.Mock }).findById).toHaveBeenCalledWith('u1');
  });

  it('update forwards id, dto and actor id', async () => {
    const service = { update: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.update('u1', { firstName: 'X' } as never, actor);
    expect((service as { update: jest.Mock }).update).toHaveBeenCalledWith(
      'u1',
      { firstName: 'X' },
      'admin-1',
    );
  });
});
