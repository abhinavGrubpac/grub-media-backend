import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { failureAuditMiddleware } from './common/middleware/failure-audit.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Failed-request auditor (SYSTEM/'Request Failed'). Registered before any
  // other middleware so the entire chain — including the body-parser and
  // express-level rejections — runs inside the audit ALS context.
  app.use(failureAuditMiddleware);

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
