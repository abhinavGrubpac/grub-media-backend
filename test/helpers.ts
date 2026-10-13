import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LogType, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/**
 * The e2e suite must only ever touch the throwaway docker database.
 * `AppModule`'s ConfigModule loads `.env`, which can overwrite the
 * DATABASE_URL that env-e2e.ts set — silently repointing every PrismaClient
 * at the real dev database. Guard against that before any destructive helper
 * runs: refuse unless we are unmistakably on the local test instance.
 */
export const TEST_DB_HOST = 'localhost';
export const TEST_DB_PORT = '5433';
export const TEST_DB_NAME = 'grub_test';

export async function assertTestDatabase(app: INestApplication): Promise<void> {
  const prisma = prismaOf(app);
  const rows = (await prisma.$queryRawUnsafe('SELECT current_database() AS db')) as Array<{
    db: string;
  }>;
  const { db } = rows;

  // The live dev database is Neon's `Grubpac`; the throwaway docker one is
  // `grub_test`. Check the database NAME only: inet_server_addr/port report the
  // server's own view, which inside docker is the container IP and port 5432,
  // not the mapped localhost:5433 the client connected through.
  if (db !== TEST_DB_NAME) {
    throw new Error(
      'Refusing to run e2e database helpers against a non-test database. ' +
        `Connected to db=${db}, expected db=${TEST_DB_NAME}. ` +
        'Check test/env-e2e.ts and DATABASE_URL resolution.',
    );
  }
}

/** The throwaway docker database. Must match docker-compose.test.yml. */
export const TEST_DATABASE_URL = 'postgresql://grub:grub@localhost:5433/grub_test?schema=public';

/**
 * Boot a Nest app with the same global config as main.ts (minus helmet/cors/swagger).
 *
 * PrismaService is overridden with an EXPLICIT test datasource URL: AppModule's
 * ConfigModule loads `.env` at boot, which overwrites the DATABASE_URL that
 * env-e2e.ts set — without this, every query would silently hit the real dev
 * database. assertTestDatabase() double-checks before any destructive helper.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useFactory({
      inject: [],
      factory: () => new PrismaService(TEST_DATABASE_URL),
    })
    .compile();
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
  await assertTestDatabase(app);
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

// ── Log System helpers ──────────────────────────────────────────────────────

/** Wipe every log row + its taxonomy. Separate from cleanDatabase on purpose. */
export async function cleanLogs(app: INestApplication): Promise<void> {
  await assertTestDatabase(app);
  const prisma = prismaOf(app);
  await prisma.log.deleteMany({});
  await prisma.logAction.deleteMany({});
  await prisma.logCategory.deleteMany({});
}

export interface SeedLogInput {
  typeEnum: LogType;
  categoryName?: string;
  actionName?: string;
  actionText?: string;
  userId?: string;
  empId?: string;
  oldDetail?: string;
  newDetail?: string;
  referenceId?: string;
  createdAt?: Date;
}

/**
 * Insert log rows directly, upserting category/action by name exactly the way
 * LogsService.record does, so e2e fixtures exercise the real unique keys.
 */
export async function seedLogs(app: INestApplication, inputs: SeedLogInput[]): Promise<number[]> {
  const prisma = prismaOf(app);
  const ids: number[] = [];

  for (const input of inputs) {
    const category = input.categoryName
      ? await prisma.logCategory.upsert({
          where: { name_typeEnum: { name: input.categoryName, typeEnum: input.typeEnum } },
          create: { name: input.categoryName, typeEnum: input.typeEnum },
          update: {},
        })
      : null;

    const action =
      category && input.actionName
        ? await prisma.logAction.upsert({
            where: { name_categoryId: { name: input.actionName, categoryId: category.id } },
            create: { name: input.actionName, categoryId: category.id },
            update: {},
          })
        : null;

    const row = await prisma.log.create({
      data: {
        typeEnum: input.typeEnum,
        categoryId: category?.id ?? null,
        actionId: action?.id ?? null,
        actionText: input.actionText ?? null,
        userId: input.userId ?? null,
        empId: input.empId ?? null,
        oldDetail: input.oldDetail ?? null,
        newDetail: input.newDetail ?? null,
        referenceId: input.referenceId ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
    ids.push(row.id);
  }

  return ids;
}
