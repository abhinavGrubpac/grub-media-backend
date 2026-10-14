import { LogType } from '@prisma/client';
import { ExportRequestDto } from '../dto/log-export-query.dto';
import { LogSearchQueryDto } from '../dto/log-search-query.dto';
import { LogsService } from './logs.service';

const logRow = {
  id: 10,
  typeEnum: LogType.ACTIVITY,
  actionName: 'Update Profile',
  actionText: 'Updated profile',
  userId: 'user-1',
  empId: null,
  oldDetail: null,
  newDetail: null,
  createdAt: new Date('2026-10-10T10:00:00.000Z'),
  category: { id: 1, name: 'Profile' },
};

type Mocks = {
  findMany?: jest.Mock;
  count?: jest.Mock;
  create?: jest.Mock;
  groupBy?: jest.Mock;
  upsert?: jest.Mock;
};

function prismaMock(log: Mocks = {}, logCategory: Mocks = {}) {
  return {
    client: {
      log: {
        findMany: log.findMany ?? jest.fn().mockResolvedValue([]),
        count: log.count ?? jest.fn().mockResolvedValue(0),
        create: log.create ?? jest.fn().mockResolvedValue({ id: 99 }),
        groupBy: log.groupBy ?? jest.fn().mockResolvedValue([]),
      },
      logCategory: {
        findMany: logCategory.findMany ?? jest.fn().mockResolvedValue([]),
        upsert:
          logCategory.upsert ??
          jest.fn().mockResolvedValue({ id: 1, typeEnum: LogType.SYSTEM, name: 'X', image: null }),
      },
    },
  } as never;
}

describe('LogsService.list', () => {
  it('scopes to the logtype, sorts createdAt desc and paginates', async () => {
    const findMany = jest.fn().mockResolvedValue([logRow]);
    const count = jest.fn().mockResolvedValue(51);
    const svc = new LogsService(prismaMock({ findMany, count }));

    const result = await svc.list(LogType.ACTIVITY, { page: 2, limit: 25, sortOrder: 'desc' });

    const call = findMany.mock.calls[0][0];
    expect(call.where).toEqual({ typeEnum: LogType.ACTIVITY });
    expect(call.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(call.skip).toBe(25);
    expect(call.take).toBe(25);
    expect(call.select.actionName).toBe(true);
    expect(call.select.category).toEqual({ select: { id: true, name: true } });
    expect(result.data).toEqual([logRow]);
    expect(result.meta).toEqual({ page: 2, limit: 25, total: 51, totalPages: 3 });
  });

  it('ignores a client sortBy outside the allowlist (no Prisma 500)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new LogsService(prismaMock({ findMany }));

    await svc.list(LogType.SYSTEM, {
      page: 1,
      limit: 20,
      sortBy: 'passwordHash',
      sortOrder: 'asc',
    });

    // Invalid sortBy is dropped, but the valid sortOrder is still honoured.
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'desc' }]);
  });

  it('no longer honours a referenceId sortBy (column was removed)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new LogsService(prismaMock({ findMany }));

    await svc.list(LogType.SYSTEM, {
      page: 1,
      limit: 20,
      sortBy: 'referenceId',
      sortOrder: 'desc',
    });

    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});

describe('LogsService.getFilters', () => {
  it('returns logtype categories and the distinct action names of the stream', async () => {
    const categoryFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 1, typeEnum: LogType.SYSTEM, name: 'Auth', image: null }]);
    const groupBy = jest.fn().mockResolvedValue([
      { actionName: 'Login', categoryId: 1 },
      { actionName: 'Role Changed', categoryId: null },
    ]);
    const svc = new LogsService(prismaMock({ groupBy }, { findMany: categoryFindMany }));

    const result = await svc.getFilters(LogType.SYSTEM);

    expect(categoryFindMany.mock.calls[0][0].where).toEqual({ typeEnum: LogType.SYSTEM });
    expect(groupBy.mock.calls[0][0].by).toEqual(['actionName', 'categoryId']);
    expect(groupBy.mock.calls[0][0].where).toEqual({
      typeEnum: LogType.SYSTEM,
      actionName: { not: null },
    });
    expect(result).toEqual({
      categories: [{ id: 1, typeEnum: LogType.SYSTEM, name: 'Auth', image: null }],
      actions: [
        { name: 'Login', categoryId: 1 },
        { name: 'Role Changed', categoryId: null },
      ],
    });
  });
});

describe('LogsService.search', () => {
  it('builds the date range (UTC day bounds), filters and free-text OR', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const svc = new LogsService(prismaMock({ findMany, count }));

    const query = new LogSearchQueryDto();
    query.logtype = LogType.EMPLOYEE;
    query.q = 'salary';
    query.start_date = '2026-10-01';
    query.end_date = '2026-10-12';
    query.categories = [1, 3];
    query.actions = ['Resignation'];
    await svc.search(query);

    const call = findMany.mock.calls[0][0];
    expect(call.where.typeEnum).toBe(LogType.EMPLOYEE);
    expect(call.where.createdAt).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-12T23:59:59.999Z'),
    });
    expect(call.where.categoryId).toEqual({ in: [1, 3] });
    // Action filter is a case-insensitive text match on actionName.
    expect(call.where.actionName).toEqual({ in: ['Resignation'], mode: 'insensitive' });
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { actionText: { contains: 'salary', mode: 'insensitive' } },
        { actionName: { contains: 'salary', mode: 'insensitive' } },
        { category: { name: { contains: 'salary', mode: 'insensitive' } } },
      ]),
    );
    expect(call.where.OR).toHaveLength(7);
  });

  it('omits empty filters entirely', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const svc = new LogsService(prismaMock({ findMany, count }));

    const query = new LogSearchQueryDto();
    query.logtype = LogType.SYSTEM;
    await svc.search(query);

    const call = findMany.mock.calls[0][0];
    expect(call.where).toEqual({ typeEnum: LogType.SYSTEM });
  });
});

describe('LogsService.exportCsv', () => {
  it('writes a header row, escapes separators/quotes and exports one page only', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        ...logRow,
        category: { name: 'Leave, Approval' },
        actionName: 'He said "hi"',
      },
    ]);
    const svc = new LogsService(prismaMock({ findMany }));

    const query = new ExportRequestDto();
    query.logtype = LogType.ACTIVITY;
    const csv = await svc.exportCsv(query);

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'id,created_at,logtype,category,action,action_text,user_id,emp_id,old_detail,new_detail',
    );
    expect(lines[1]).toContain('"Leave, Approval"');
    expect(lines[1]).toContain('"He said ""hi"""');
    // One query, bounded by the page the UI is showing — never the full table.
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].skip).toBe(0);
    expect(findMany.mock.calls[0][0].take).toBe(20);
  });

  it('exports only the requested page (page/limit → skip/take)', async () => {
    const row = { ...logRow };
    const findMany = jest.fn().mockResolvedValue([row, row]);
    const svc = new LogsService(prismaMock({ findMany }));

    const query = new ExportRequestDto();
    query.logtype = LogType.SYSTEM;
    query.page = 3;
    query.limit = 2;
    const csv = await svc.exportCsv(query);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].skip).toBe(4); // (3 - 1) * 2
    expect(findMany.mock.calls[0][0].take).toBe(2);
    expect(csv.split('\r\n')).toHaveLength(3); // header + 2 rows
  });
});

describe('LogsService.record', () => {
  it('upserts the category and creates the row with a flat actionName', async () => {
    const upsertCategory = jest.fn().mockResolvedValue({
      id: 1,
      typeEnum: LogType.ACTIVITY,
      name: 'Authentication',
      image: null,
    });
    const create = jest.fn().mockResolvedValue({ id: 99 });
    const svc = new LogsService(prismaMock({ create }, { upsert: upsertCategory }));

    await svc.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Authentication',
      actionName: 'Login',
      actionText: 'User user-1 logged in',
      userId: 'user-1',
      target: 'user-1',
      oldDetail: { status: 'INACTIVE' },
      newDetail: { status: 'ACTIVE' },
    });

    expect(upsertCategory).toHaveBeenCalledWith({
      where: { name_typeEnum: { name: 'Authentication', typeEnum: LogType.ACTIVITY } },
      create: { name: 'Authentication', typeEnum: LogType.ACTIVITY },
      update: {},
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        typeEnum: LogType.ACTIVITY,
        categoryId: 1,
        actionName: 'Login',
        actionText: 'User user-1 logged in',
        userId: 'user-1',
        empId: null,
        oldDetail: '{"status":"INACTIVE"}',
        // The caller's business pointer is folded into newDetail.target.
        newDetail: '{"status":"ACTIVE","target":"user-1"}',
      },
    });
  });

  it('stores actionName even without a category (no taxonomy FK anymore)', async () => {
    const upsertCategory = jest.fn();
    const create = jest.fn().mockResolvedValue({ id: 101 });
    const svc = new LogsService(prismaMock({ create }, { upsert: upsertCategory }));

    await svc.record({ typeEnum: LogType.SYSTEM, actionName: 'View Logs' });

    expect(upsertCategory).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: {
        typeEnum: LogType.SYSTEM,
        categoryId: null,
        actionName: 'View Logs',
        actionText: null,
        userId: null,
        empId: null,
        oldDetail: null,
        newDetail: null,
      },
    });
  });

  it('skips taxonomy when names are omitted and keeps string details raw', async () => {
    const upsertCategory = jest.fn();
    const create = jest.fn().mockResolvedValue({ id: 100 });
    const svc = new LogsService(prismaMock({ create }, { upsert: upsertCategory }));

    await svc.record({
      typeEnum: LogType.SYSTEM,
      actionText: 'Config changed',
      oldDetail: 'kept raw',
    });

    expect(upsertCategory).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: {
        typeEnum: LogType.SYSTEM,
        categoryId: null,
        actionName: null,
        actionText: 'Config changed',
        userId: null,
        empId: null,
        oldDetail: 'kept raw',
        newDetail: null,
      },
    });
  });

  it('never rejects when the database write fails (business flow is safe)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const svc = new LogsService(prismaMock({ create }));

    await expect(svc.record({ typeEnum: LogType.SYSTEM })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
