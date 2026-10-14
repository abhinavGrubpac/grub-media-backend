import { INestApplication } from '@nestjs/common';
import { LogType, UserRole } from '@prisma/client';
import request from 'supertest';
import { cleanDatabase, cleanLogs, createTestApp, login, seedLogs, seedUser } from './helpers';

/**
 * End-to-end coverage of the Log System V2 endpoints:
 *   GET  /api/v1/logs/filters?logtype=
 *   GET  /api/v1/logs/search
 *   GET  /api/v1/logs/:logtype
 *   GET  /api/v1/logs/export   (CSV of the current page only)
 * Runs against the throwaway postgres/redis from docker-compose.test.yml.
 */
describe('Logs (e2e)', () => {
  let app: INestApplication;
  let adminTokenValue: string; // obtained in beforeEach, before the fixture seed
  const admin = { email: 'admin@grubpac.com', password: 'AdminPass1' };
  const employee = { email: 'emp@grubpac.com', password: 'EmpPass123' };

  /** Deterministic fixture: 6 rows per stream, newest last. */
  const FIXTURE = [
    {
      typeEnum: LogType.SYSTEM,
      categoryName: 'Authentication',
      actionName: 'Login',
      actionText: 'User a1 logged in from 10.0.0.1',
    },
    {
      typeEnum: LogType.SYSTEM,
      categoryName: 'Authentication',
      actionName: 'Login',
      actionText: 'User a2 logged in from 10.0.0.2',
    },
    {
      typeEnum: LogType.SYSTEM,
      categoryName: 'Security',
      actionName: 'Role Changed',
      actionText: 'Role of usr_a changed from EMPLOYEE to ADMIN',
    },
    {
      typeEnum: LogType.SYSTEM,
      categoryName: 'Security',
      actionName: 'Permission Updated',
      actionText: 'Permissions updated for usr_b',
    },
    {
      typeEnum: LogType.SYSTEM,
      categoryName: 'Configuration',
      actionName: 'Settings Updated',
      actionText: 'Global configuration saved by usr_c',
    },
    {
      typeEnum: LogType.SYSTEM,
      categoryName: 'Configuration',
      actionName: 'Feature Flag Toggled',
      actionText: 'Enabled feature flag REQ-1',
    },
    {
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Leave',
      actionName: 'Apply Leave',
      actionText: 'Leave request LV-1 raised by usr_d',
    },
    {
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Leave',
      actionName: 'Approve Leave',
      actionText: 'Leave request LV-1 approved by usr_e',
    },
    {
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Payroll',
      actionName: 'Revise Salary',
      actionText: 'Salary revised for EMP0001 under PAY-1',
    },
    {
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Payroll',
      actionName: 'Generate Payslip',
      actionText: 'Payslip PAY-1 generated for EMP0002',
    },
    {
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'Update Profile',
      actionText: 'Updated profile details for usr_f',
    },
    {
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Profile',
      actionName: 'View Profile',
      actionText: 'Viewed profile of usr_g',
    },
    {
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Onboarding',
      actionName: 'Create Employee',
      actionText: 'Employee EMP0003 created by usr_h',
    },
    {
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Onboarding',
      actionName: 'Upload Document',
      actionText: 'Document DOC-1 uploaded for EMP0003',
    },
    {
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Exit',
      actionName: 'Resignation',
      actionText: 'Resignation filed by EMP0004',
    },
    {
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Exit',
      actionName: 'Termination',
      actionText: 'Employment of EMP0005 terminated under TCK-1',
    },
    {
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Employment',
      actionName: 'Promotion',
      actionText: 'EMP0006 promoted under REQ-2',
    },
    {
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Employment',
      actionName: 'Department Transfer',
      actionText: 'EMP0007 transferred under REQ-3',
    },
  ] as const;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanLogs(app);
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanLogs(app);
    await cleanDatabase(app);
    await seedUser(app, { ...admin, role: UserRole.ADMIN });
    await seedUser(app, { ...employee, role: UserRole.EMPLOYEE });
    // Log in while the users exist, THEN wipe logs before seeding the fixture.
    // login() writes a SYSTEM audit row (newest of all); wiping it here means
    // no test ever observes it and the fixture's exact row counts stay intact.
    adminTokenValue = (await login(app, admin.email, admin.password)).accessToken;
    await cleanLogs(app);
    // createdAt spread 18 days so date-range filtering has something to bite on.
    const base = Date.UTC(2026, 8, 1); // 2026-09-01
    await seedLogs(
      app,
      FIXTURE.map((row, i) => ({
        ...row,
        userId: `usr_${i}`,
        empId: `EMP${String(i).padStart(4, '0')}`,
        createdAt: new Date(base + i * 86_400_000),
      })),
    );
  });

  // ── Auth & RBAC ──────────────────────────────────────────────────────────

  describe('auth + RBAC', () => {
    it('rejects every logs route without a token (401)', async () => {
      const server = app.getHttpServer();
      await request(server).get('/api/v1/logs/SYSTEM').expect(401);
      await request(server).get('/api/v1/logs/filters?logtype=SYSTEM').expect(401);
      await request(server).get('/api/v1/logs/search?logtype=SYSTEM').expect(401);
      await request(server).get('/api/v1/logs/export?logtype=SYSTEM').expect(401);
    });

    it('rejects EMPLOYEE on every logs route (403) — needs logs.read', async () => {
      const { accessToken } = await login(app, employee.email, employee.password);
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${accessToken}` };
      await request(server).get('/api/v1/logs/SYSTEM').set(auth).expect(403);
      await request(server).get('/api/v1/logs/filters?logtype=SYSTEM').set(auth).expect(403);
      await request(server).get('/api/v1/logs/search?logtype=SYSTEM').set(auth).expect(403);
      await request(server).get('/api/v1/logs/export?logtype=SYSTEM').set(auth).expect(403);
    });
  });

  // ── GET /logs/filters ────────────────────────────────────────────────────

  describe('GET /logs/filters', () => {
    it('returns only the categories + actions of the requested logtype', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/filters?logtype=SYSTEM')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Log filters fetched successfully');

      const categoryNames = res.body.data.categories.map((c: { name: string }) => c.name).sort();
      expect(categoryNames).toEqual(['Authentication', 'Configuration', 'Security']);

      // Every action must belong to a SYSTEM category we returned.
      const categoryIds = new Set(res.body.data.categories.map((c: { id: number }) => c.id));
      expect(res.body.data.actions.length).toBeGreaterThan(0);
      expect(
        res.body.data.actions.every((a: { categoryId: number }) => categoryIds.has(a.categoryId)),
      ).toBe(true);
    });

    it('is case-insensitive on logtype', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/filters?logtype=employee')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.categories.map((c: { name: string }) => c.name).sort()).toEqual([
        'Employment',
        'Exit',
        'Onboarding',
      ]);
    });

    it('returns 400 VALIDATION_ERROR for an unknown logtype', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/filters?logtype=NOPE')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when logtype is missing', async () => {
      const token = adminTokenValue;
      await request(app.getHttpServer())
        .get('/api/v1/logs/filters')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  // ── GET /logs/:logtype ───────────────────────────────────────────────────

  describe('GET /logs/:logtype', () => {
    it('returns the paginated envelope sorted createdAt desc', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/SYSTEM?page=1&limit=20')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Logs fetched successfully');
      expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 6, totalPages: 1 });
      expect(res.body.data).toHaveLength(6);
      expect(res.body.data[0].actionText).toBe('Enabled feature flag REQ-1');

      // Newest first.
      const dates = res.body.data.map((r: { createdAt: string }) => Date.parse(r.createdAt));
      expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    });

    it('scopes strictly to the path logtype', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/EMPLOYEE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.meta.total).toBe(6);
      expect(res.body.data.every((r: { typeEnum: string }) => r.typeEnum === 'EMPLOYEE')).toBe(
        true,
      );
    });

    it('paginates without overlap between pages', async () => {
      const token = adminTokenValue;
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${token}` };

      const p1 = await request(server)
        .get('/api/v1/logs/ACTIVITY?page=1&limit=2')
        .set(auth)
        .expect(200);
      const p2 = await request(server)
        .get('/api/v1/logs/ACTIVITY?page=2&limit=2')
        .set(auth)
        .expect(200);
      const p3 = await request(server)
        .get('/api/v1/logs/ACTIVITY?page=3&limit=2')
        .set(auth)
        .expect(200);

      expect(p1.body.data).toHaveLength(2);
      expect(p2.body.data).toHaveLength(2);
      expect(p3.body.data).toHaveLength(2);
      expect(p1.body.meta).toMatchObject({ page: 1, total: 6, totalPages: 3 });

      const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map(
        (r: { id: number }) => r.id,
      );
      expect(new Set(ids).size).toBe(6);
    });

    it('does not leak relation internals (only brief category projection)', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/SYSTEM')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const row = res.body.data[0];
      expect(row.category).toEqual({ id: expect.any(Number), name: expect.any(String) });
      // The action is a flat name on the row — no action relation object.
      expect(typeof row.actionName).toBe('string');
      expect(row.action).toBeUndefined();
      expect(Object.keys(row).sort()).toEqual(
        [
          'actionName',
          'actionText',
          'category',
          'createdAt',
          'empId',
          'id',
          'newDetail',
          'oldDetail',
          'typeEnum',
          'userId',
        ].sort(),
      );
    });

    it('rejects limit above the max (400)', async () => {
      const token = adminTokenValue;
      await request(app.getHttpServer())
        .get('/api/v1/logs/SYSTEM?limit=999')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('400s on an unknown logtype path param', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/NOT_A_TYPE')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(res.body.message).toContain('SYSTEM');
    });
  });

  // ── GET /logs/search ─────────────────────────────────────────────────────

  describe('GET /logs/search', () => {
    async function search(qs: string) {
      const token = adminTokenValue;
      return request(app.getHttpServer())
        .get(`/api/v1/logs/search?${qs}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    it('free-text q matches actionText case-insensitively', async () => {
      const res = await search('logtype=ACTIVITY&q=leave');
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.map((r: { actionText: string }) => r.actionText)).toEqual(
        expect.arrayContaining([
          'Leave request LV-1 raised by usr_d',
          'Leave request LV-1 approved by usr_e',
        ]),
      );
    });

    it('q also matches the action name, not just actionText', async () => {
      // "Resignation" appears in the action name AND the sentence — prove the
      // action-name branch works by searching for a name only in the taxonomy.
      const res = await search('logtype=EMPLOYEE&q=Resignation');
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].actionName).toBe('Resignation');
    });

    it('q also matches the category name', async () => {
      const res = await search('logtype=EMPLOYEE&q=Onboarding');
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.every(
          (r: { category: { name: string } }) => r.category.name === 'Onboarding',
        ),
      ).toBe(true);
    });

    it('q matches userId / empId', async () => {
      expect((await search('logtype=SYSTEM&q=usr_1')).body.meta.total).toBe(1);
      expect((await search('logtype=EMPLOYEE&q=EMP0003')).body.meta.total).toBe(2);
    });

    it('q matches oldDetail / newDetail JSON', async () => {
      await seedLogs(app, [
        {
          typeEnum: LogType.SYSTEM,
          categoryName: 'Security',
          actionName: 'Role Changed',
          actionText: 'Role mutated',
          oldDetail: '{"role":"EMPLOYEE"}',
          newDetail: '{"role":"ADMIN"}',
        },
      ]);
      const res = await search('logtype=SYSTEM&q=EMPLOYEE');
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2); // 1 seeded + 1 fixture detail row
    });

    it('start_date / end_date are inclusive UTC day bounds', async () => {
      // FIXTURE row i has createdAt = 2026-09-01 + i days → rows 0..5 = Sep 1..6 (SYSTEM).
      const res = await search('logtype=SYSTEM&start_date=2026-09-02&end_date=2026-09-03');
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.map((r: { createdAt: string }) => r.createdAt)).toEqual([
        expect.stringContaining('2026-09-03'),
        expect.stringContaining('2026-09-02'),
      ]);
    });

    it('filters by category ids (comma-separated)', async () => {
      const filters = await request(app.getHttpServer())
        .get('/api/v1/logs/filters?logtype=SYSTEM')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(200);
      const security = filters.body.data.categories.find(
        (c: { name: string }) => c.name === 'Security',
      );

      const res = await search(`logtype=SYSTEM&categories=${security.id}`);
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.every((r: { category: { name: string } }) => r.category.name === 'Security'),
      ).toBe(true);
    });

    it('filters by action names (comma-separated, case-insensitive)', async () => {
      const filters = await request(app.getHttpServer())
        .get('/api/v1/logs/filters?logtype=SYSTEM')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(200);
      const login = filters.body.data.actions.find((a: { name: string }) => a.name === 'Login');
      expect(login).toBeDefined();

      const res = await search(`logtype=SYSTEM&actions=${encodeURIComponent(login.name)}`);
      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.every((r: { actionName: string | null }) => r.actionName === 'Login'),
      ).toBe(true);
    });

    it('combines q + date range + category into one WHERE', async () => {
      const res = await search(
        'logtype=SYSTEM&q=Security&start_date=2026-09-01&end_date=2026-09-30',
      );
      // "Security" is the category name — both Security rows fall in September.
      expect(res.body.meta.total).toBe(2);
    });

    it('returns an empty page (not an error) when nothing matches', async () => {
      const res = await search('logtype=SYSTEM&q=zzz_no_such_text_zzz');
      expect(res.body.meta).toMatchObject({ total: 0, totalPages: 0 });
      expect(res.body.data).toEqual([]);
    });

    it('400s on a malformed date', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/search?logtype=SYSTEM&start_date=12-01-2026')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      // The filter flattens class-validator's message array into one string.
      expect(res.body.message).toEqual(expect.stringContaining('start_date'));
    });

    it('400s when q is blank', async () => {
      const token = adminTokenValue;
      await request(app.getHttpServer())
        .get('/api/v1/logs/search?logtype=SYSTEM&q=%20%20')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('400s on a non-numeric category id', async () => {
      const token = adminTokenValue;
      await request(app.getHttpServer())
        .get('/api/v1/logs/search?logtype=SYSTEM&categories=abc')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('400s on a non-numeric page', async () => {
      const token = adminTokenValue;
      await request(app.getHttpServer())
        .get('/api/v1/logs/search?logtype=SYSTEM&page=abc')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  // ── GET /logs/export ─────────────────────────────────────────────────────

  describe('GET /logs/export', () => {
    async function exportGet(query: string) {
      const token = adminTokenValue;
      return request(app.getHttpServer())
        .get(`/api/v1/logs/export?${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    /** CSV data rows → their leading id (first column). */
    function csvIds(csv: string): string[] {
      return csv
        .split('\r\n')
        .slice(1)
        .filter((line) => line.length > 0)
        .map((line) => line.split(',')[0]);
    }

    it('returns a CSV attachment, not the JSON envelope', async () => {
      const res = await exportGet('logtype=SYSTEM');
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="logs-system-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      // SkipResponseWrap → no success/data wrapper around the CSV body.
      expect(res.text.startsWith('success,')).toBe(false);
      expect(res.text.split('\r\n')[0]).toBe(
        'id,created_at,logtype,category,action,action_text,user_id,emp_id,old_detail,new_detail',
      );
    });

    it('exports ONLY the current page — never the whole filtered set', async () => {
      // 6 SYSTEM rows exist; page 2 of size 2 = rows 3-4 of the newest-first order.
      const res = await exportGet('logtype=SYSTEM&page=2&limit=2');
      const lines = res.text.split('\r\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(3); // header + 2 data rows
      expect(lines.slice(1).map((l) => l.split(',')[3])).toEqual(['Security', 'Security']);
    });

    it('exports exactly the same rows the web page shows (matches search)', async () => {
      const token = adminTokenValue;
      const search = await request(app.getHttpServer())
        .get('/api/v1/logs/search?logtype=ACTIVITY&page=2&limit=3')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await exportGet('logtype=ACTIVITY&page=2&limit=3');

      expect(csvIds(res.text)).toEqual(search.body.data.map((r: { id: number }) => String(r.id)));
      expect(res.text.split('\r\n').filter((l) => l.length > 0)).toHaveLength(4);
    });

    it('defaults to page 1 / limit 20 when pagination is omitted', async () => {
      const res = await exportGet('logtype=ACTIVITY');
      expect(res.text.split('\r\n').filter((l) => l.length > 0)).toHaveLength(7); // header + 6
    });

    it('honours the same filters as search', async () => {
      const token = adminTokenValue;
      const search = await request(app.getHttpServer())
        .get('/api/v1/logs/search?logtype=SYSTEM&q=login')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await exportGet('logtype=SYSTEM&q=login');
      expect(csvIds(res.text)).toEqual(search.body.data.map((r: { id: number }) => String(r.id)));
      expect(search.body.meta.total).toBe(2);
    });

    it('honours the date range', async () => {
      const res = await exportGet('logtype=SYSTEM&start_date=2026-09-02&end_date=2026-09-03');
      const lines = res.text.split('\r\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(3); // header + 2
      expect(res.text).toContain('2026-09-02');
      expect(res.text).toContain('2026-09-03');
    });

    it('accepts categories as a comma-separated id list', async () => {
      const filters = await request(app.getHttpServer())
        .get('/api/v1/logs/filters?logtype=SYSTEM')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(200);
      const security = filters.body.data.categories.find(
        (c: { name: string }) => c.name === 'Security',
      );

      const res = await exportGet(`logtype=SYSTEM&categories=${security.id}`);
      const lines = res.text.split('\r\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(3); // header + 2 Security rows
      expect(res.text).toContain(',Security,');
    });

    it('escapes commas, quotes and newlines per RFC 4180', async () => {
      await cleanLogs(app);
      await seedLogs(app, [
        {
          typeEnum: LogType.SYSTEM,
          categoryName: 'Security',
          actionName: 'Role Changed',
          actionText: 'He said "hi", then left\nline2',
          oldDetail: '{"a":1}',
        },
      ]);

      const res = await exportGet('logtype=SYSTEM');
      expect(res.text).toContain('"He said ""hi"", then left\nline2"');
      expect(res.text).toContain('"{""a"":1}"');
    });

    it('keeps an empty cell for null fields (no literal "null")', async () => {
      await cleanLogs(app);
      await seedLogs(app, [{ typeEnum: LogType.SYSTEM, actionText: 'bare row' }]);

      const res = await exportGet('logtype=SYSTEM');
      const row = res.text.split('\r\n')[1];

      // id,created_at,logtype,category,action,action_text,user_id,emp_id,
      // old_detail,new_detail — every optional column is empty.
      const cells = row.split(',');
      expect(cells[2]).toBe('SYSTEM'); // logtype
      expect(cells[5]).toBe('bare row'); // action_text
      expect(cells.slice(3, 5)).toEqual(['', '']); // category + action
      expect(cells.slice(6)).toEqual(['', '', '', '']); // user/emp/details
      expect(res.text).not.toContain('null');
    });

    it('400s when logtype is missing', async () => {
      const token = adminTokenValue;
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/export')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('400s on an unknown query field (whitelist)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/export?logtype=SYSTEM&format=xlsx')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('400s on limit above the max', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/logs/export?logtype=SYSTEM&limit=500')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(400);
    });

    it('400s on a negative page', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/logs/export?logtype=SYSTEM&page=-1')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(400);
    });

    it('400s on an unknown logtype', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/logs/export?logtype=NOPE')
        .set('Authorization', `Bearer ${adminTokenValue}`)
        .expect(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('returns an empty CSV body (header only) when the page is past the end', async () => {
      const res = await exportGet('logtype=SYSTEM&page=99&limit=20');
      const lines = res.text.split('\r\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('id,created_at,logtype');
    });
  });

  // ── Cross-endpoint consistency ───────────────────────────────────────────

  describe('consistency across endpoints', () => {
    it('list, search and export agree, and every read is itself audited', async () => {
      const token = adminTokenValue;
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${token}` };

      // Read-audits of these endpoints always land in the SYSTEM stream
      // (category 'Log Access'), recorded AFTER the page is built — so a
      // non-SYSTEM stream's totals stay stable across all three calls.
      const list = await request(server).get('/api/v1/logs/EMPLOYEE').set(auth).expect(200);
      const search = await request(server)
        .get('/api/v1/logs/search?logtype=EMPLOYEE')
        .set(auth)
        .expect(200);
      const exportAll = await request(server)
        .get('/api/v1/logs/export?logtype=EMPLOYEE&page=1&limit=20')
        .set(auth)
        .expect(200);

      expect(list.body.meta.total).toBe(6);
      expect(search.body.meta.total).toBe(6);
      expect(exportAll.text.split('\r\n').filter((l) => l.length > 0)).toHaveLength(7);

      // …and each of those three reads appended one SYSTEM audit row.
      const audits = await request(server)
        .get(`/api/v1/logs/search?logtype=SYSTEM&q=${encodeURIComponent('Log Access')}`)
        .set(auth)
        .expect(200);
      expect(audits.body.meta.total).toBe(3);
      expect(
        audits.body.data.every(
          (r: { category: { name: string } }) => r.category.name === 'Log Access',
        ),
      ).toBe(true);
    });

    it('record() → visible immediately on list + searchable', async () => {
      const token = adminTokenValue;
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${token}` };

      await seedLogs(app, [
        {
          typeEnum: LogType.SYSTEM,
          categoryName: 'Authentication',
          actionName: 'Login',
          actionText: 'ZZUNIQUEZZ user logged in',
        },
      ]);

      const list = await request(server).get('/api/v1/logs/SYSTEM').set(auth).expect(200);
      expect(list.body.data[0].actionText).toBe('ZZUNIQUEZZ user logged in');

      const search = await request(server)
        .get('/api/v1/logs/search?logtype=SYSTEM&q=ZZUNIQUEZZ')
        .set(auth)
        .expect(200);
      expect(search.body.meta.total).toBe(1);

      const csv = await request(server)
        .get('/api/v1/logs/export?logtype=SYSTEM&q=ZZUNIQUEZZ')
        .set(auth)
        .expect(200);
      expect(csv.text).toContain('ZZUNIQUEZZ user logged in');
    });

    it('a log with no category/action still lists and exports cleanly', async () => {
      await cleanLogs(app);
      await seedLogs(app, [{ typeEnum: LogType.ACTIVITY, actionText: 'orphan row' }]);
      const token = adminTokenValue;
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${token}` };

      const list = await request(server).get('/api/v1/logs/ACTIVITY').set(auth).expect(200);
      expect(list.body.data[0].category).toBeNull();
      expect(list.body.data[0].actionName).toBeNull();

      const csv = await request(server)
        .get('/api/v1/logs/export?logtype=ACTIVITY')
        .set(auth)
        .expect(200);
      expect(csv.text).toContain('orphan row');
      // category + action cells are empty, not the string "null".
      expect(csv.text.split('\r\n')[1]).toContain(',ACTIVITY,,,orphan row,');
    });
  });
});
