import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @IsInt()
  PORT!: number;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL!: string;

  @IsString()
  JWT_REFRESH_TTL!: string;

  @IsString()
  REDIS_HOST!: string;

  @IsInt()
  REDIS_PORT!: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsString()
  CORS_ORIGINS!: string;

  @IsOptional()
  @IsString()
  APP_NAME?: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  // Optional: contact endpoint returns a mailto: link to this address.
  @IsOptional()
  @IsString()
  SUPPORT_EMAIL?: string;

  // THROTTLE_* are intentionally optional: they have safe operational defaults
  // defined canonically in src/config/throttle.config.ts. Validation here only
  // ensures that IF provided they are integers. (Reviewed: T2 finding F1.)
  @IsOptional()
  @IsInt()
  THROTTLE_TTL?: number;

  @IsOptional()
  @IsInt()
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @IsInt()
  THROTTLE_LOGIN_LOCK_MAX?: number;

  // KAFKA (Redpanda-compatible broker). Set KAFKA_ENABLED=false (or omit
  // REDPANDA_BROKERS) to run without Kafka — producer, relay, and consumers
  // all become no-ops. Set KAFKA_ENABLED=true or provide REDPANDA_BROKERS
  // to enable. Safe local defaults live in src/config/kafka.config.ts.
  @IsOptional()
  @IsString()
  KAFKA_ENABLED?: string;

  @IsOptional()
  @IsString()
  REDPANDA_BROKERS?: string;

  @IsOptional()
  @IsString()
  REDPANDA_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  REDPANDA_SASL_USERNAME?: string;

  @IsOptional()
  @IsString()
  REDPANDA_SASL_PASSWORD?: string;

  // STORAGE (S3 media bucket). All optional: absent credentials switch the
  // storage layer to local mock mode (see src/config/storage.config.ts).
  @IsOptional()
  @IsString()
  AWS_S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  AWS_REGION?: string;

  @IsOptional()
  @IsString()
  AWS_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  AWS_SECRET_ACCESS_KEY?: string;

  // SMTP_* are optional; the app starts without them (emails will fail at send time).
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  MAIL_FROM?: string;

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  // ── S3 / Object Storage ───────────────────────────────────
  // All optional — app starts without them; uploads return 500 if missing.
  // storage.config.ts reads AWS_REGION; s3.config.ts reads AWS_S3_REGION.
  @IsOptional()
  @IsString()
  AWS_S3_REGION?: string;

  @IsOptional()
  @IsString()
  AWS_S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  AWS_CLOUDFRONT_URL?: string;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }
  return validated;
}
