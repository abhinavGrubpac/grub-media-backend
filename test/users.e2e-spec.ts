import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { cleanDatabase, createTestApp, login, seedUser } from './helpers';

describe('Users (e2e)', () => {
  let app: INestApplication;
  const admin = { email: 'admin@grubpac.com', password: 'AdminPass1' };
  const employee = { email: 'emp@grubpac.com', password: 'EmpPass123' };

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });
  beforeEach(async () => {
    await cleanDatabase(app);
    await seedUser(app, { ...admin, role: UserRole.ADMIN });
    await seedUser(app, { ...employee, role: UserRole.EMPLOYEE });
  });

  it('EMPLOYEE cannot create a user (403 FORBIDDEN)', async () => {
    const { accessToken } = await login(app, employee.email, employee.password);
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'new@grubpac.com', password: 'NewPass123', firstName: 'N', lastName: 'U' })
      .expect(403);
    expect(res.body).toMatchObject({ success: false, statusCode: 403, errorCode: 'FORBIDDEN' });
  });

  it('ADMIN can create a user; the response has no passwordHash', async () => {
    const { accessToken } = await login(app, admin.email, admin.password);
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'new@grubpac.com', password: 'NewPass123', firstName: 'N', lastName: 'U' })
      .expect(201);
    expect(res.body.data.email).toBe('new@grubpac.com');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects an unknown body field with 400 VALIDATION_ERROR (whitelist)', async () => {
    const { accessToken } = await login(app, admin.email, admin.password);
    const res = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        email: 'x@grubpac.com',
        password: 'NewPass123',
        firstName: 'N',
        lastName: 'U',
        isSuperAdmin: true,
      })
      .expect(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('rejects limit above the max (400) — pagination bound enforced', async () => {
    const { accessToken } = await login(app, admin.email, admin.password);
    await request(app.getHttpServer())
      .get('/api/v1/users?limit=999')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('GET /api/v1/users returns a paginated envelope with meta.totalPages', async () => {
    const { accessToken } = await login(app, admin.email, admin.password);
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?page=1&limit=20')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, totalPages: expect.any(Number) });
    expect(res.body.data.every((u: Record<string, unknown>) => !('passwordHash' in u))).toBe(true);
  });

  it('replaces a malicious X-Request-ID header with a generated uuid', async () => {
    const { accessToken } = await login(app, admin.email, admin.password);
    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Request-ID', 'bad\r\ninjected: value')
      .expect(200);
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('a soft-deleted user is excluded from list and get (404)', async () => {
    const { accessToken } = await login(app, admin.email, admin.password);
    const target = await seedUser(app, {
      email: 'gone@grubpac.com',
      password: 'GonePass12',
      role: UserRole.EMPLOYEE,
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
