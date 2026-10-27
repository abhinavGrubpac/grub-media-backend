import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/** Boot a Nest app with the same global config as main.ts (minus helmet/cors/swagger). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/** Wipe all rows between tests (base client — not soft-delete filtered). */
export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = prismaOf(app);
  await prisma.session.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({});
}

export interface SeedUserInput {
  email: string;
  password: string;
  role?: UserRole;
  firstName?: string;
  lastName?: string;
}

export async function seedUser(
  app: INestApplication,
  input: SeedUserInput,
): Promise<{ id: string; email: string }> {
  const prisma = prismaOf(app);
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await prisma.client.user.create({
    data: {
      email: input.email,
      passwordHash,
      firstName: input.firstName ?? 'Test',
      lastName: input.lastName ?? 'User',
      role: input.role ?? UserRole.EMPLOYEE,
    },
  });
  return { id: user.id, email: user.email };
}

export async function login(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
}
