import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { cleanDatabase, createTestApp, login, prismaOf, seedUser } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const creds = { email: 'emp@grubpac.com', password: 'Str0ngPass1' };

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });
  beforeEach(async () => {
    await cleanDatabase(app);
    await seedUser(app, { ...creds, role: UserRole.EMPLOYEE });
  });

  it('POST /api/v1/auth/login returns the standard success envelope with tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(creds)
      .expect(200);
    expect(res.body).toMatchObject({ success: true, message: expect.any(String) });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toContain('.');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('rejects a wrong password with a 401 error envelope (UNAUTHORIZED)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...creds, password: 'wrong' })
      .expect(401);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 401,
      errorCode: 'UNAUTHORIZED',
    });
    expect(res.body.requestId).toBeDefined();
  });

  it('GET /api/v1/auth/me without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('GET /api/v1/auth/me with an access token returns the user WITHOUT passwordHash', async () => {
    const { accessToken } = await login(app, creds.email, creds.password);
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.data.email).toBe(creds.email);
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('refresh rotates tokens; reusing the old refresh token then fails 401 (reuse detection)', async () => {
    const { refreshToken } = await login(app, creds.email, creds.password);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(rotated.body.data.refreshToken).not.toBe(refreshToken);

    // Reusing the original (now-rotated) token must be rejected.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('a soft-deleted user cannot log in', async () => {
    const prisma = prismaOf(app);
    await prisma.user.updateMany({
      where: { email: creds.email },
      data: { deletedAt: new Date() },
    });
    await request(app.getHttpServer()).post('/api/v1/auth/login').send(creds).expect(401);
  });

  it('logout revokes refresh tokens (old refresh token no longer rotates)', async () => {
    const { accessToken, refreshToken } = await login(app, creds.email, creds.password);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});
