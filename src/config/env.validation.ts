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

  // KAFKA (Redpanda-compatible broker). All optional: safe local defaults live
  // canonically in src/config/kafka.config.ts; SASL enables TLS when present.
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
