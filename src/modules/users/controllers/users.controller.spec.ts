import { UsersController } from './users.controller';
import { AuthUser } from '../../auth/decorators/current-user.decorator';

const actor: AuthUser = { id: 'admin-1', role: 'ADMIN' as never, tokenVersion: 0 };
const superActor: AuthUser = { id: 'sa-1', role: 'SUPER_ADMIN' as never, tokenVersion: 0 };

describe('UsersController (thin delegation)', () => {
  it('create delegates to the service with actor id and role', async () => {
    const service = { create: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.create({ email: 'a@b.c' } as never, actor);
    expect((service as { create: jest.Mock }).create).toHaveBeenCalledWith(
      { email: 'a@b.c' },
      'admin-1',
      'ADMIN',
    );
  });

  it('list passes the query through to the service', async () => {
    const service = { list: jest.fn().mockResolvedValue({ data: [], meta: {} }) } as never;
    const ctrl = new UsersController(service);
    const query = { page: 2, limit: 10, sortOrder: 'asc' };
    await ctrl.list(query as never);
    expect((service as { list: jest.Mock }).list).toHaveBeenCalledWith(query);
  });

  it('remove delegates to softDelete with the actor id and returns null', async () => {
    const service = { softDelete: jest.fn().mockResolvedValue(undefined) } as never;
    const ctrl = new UsersController(service);
    const result = await ctrl.remove('u1', actor);
    expect(result).toBeNull();
    expect((service as { softDelete: jest.Mock }).softDelete).toHaveBeenCalledWith(
      'u1',
      'admin-1',
      'ADMIN',
    );
  });

  it('findOne delegates to findById', async () => {
    const service = { findById: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.findOne('u1');
    expect((service as { findById: jest.Mock }).findById).toHaveBeenCalledWith('u1');
  });

  it('update forwards id, dto, actor id and role', async () => {
    const service = { update: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.update('u1', { firstName: 'X' } as never, actor);
    expect((service as { update: jest.Mock }).update).toHaveBeenCalledWith(
      'u1',
      { firstName: 'X' },
      'admin-1',
      'ADMIN',
    );
  });

  it('suspend forwards id, actor id and role', async () => {
    const service = { suspend: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.suspend('u1', actor);
    expect((service as { suspend: jest.Mock }).suspend).toHaveBeenCalledWith(
      'u1',
      'admin-1',
      'ADMIN',
    );
  });

  it('activate forwards id, actor id and role', async () => {
    const service = { activate: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.activate('u1', actor);
    expect((service as { activate: jest.Mock }).activate).toHaveBeenCalledWith(
      'u1',
      'admin-1',
      'ADMIN',
    );
  });

  it('dismiss forwards id, actor id and role', async () => {
    const service = { dismiss: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    const ctrl = new UsersController(service);
    await ctrl.dismiss('u1', superActor);
    expect((service as { dismiss: jest.Mock }).dismiss).toHaveBeenCalledWith(
      'u1',
      'sa-1',
      'SUPER_ADMIN',
    );
  });
});
