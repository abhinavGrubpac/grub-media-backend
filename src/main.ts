import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Boot banner: which database this instance talks to (host only, never the
  // secret). Prisma Client loads root .env at import time, so this is the only
  // reliable way to confirm dev-vs-prod wiring — check it on every boot.
  const dbHost = (process.env.DATABASE_URL ?? '').replace(
    /^(\w+:\/\/([^:]+):[^@]+@)?([^:/]+).*$/,
    '$3',
  );

  console.log(`[boot] db=${dbHost || 'MISSING'} cwd=${process.cwd()}`);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Structured logging (pino) as the app logger.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  app.use(helmet());
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins') ?? [],
    credentials: true,
  });

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

  // Close HTTP server, Prisma, and Redis cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('grub-media-backend API')
    .setDescription('GrubPac media backend — Auth, Users, Health')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
}

void bootstrap();
