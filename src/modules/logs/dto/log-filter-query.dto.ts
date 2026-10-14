import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LogType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Shared query filters for the Log System V2 endpoints (GET /logs/search and
 * GET /logs/export): `q`, `logtype`, `start_date`, `end_date`, `categories`,
 * `actions` per the design PDF. Subclasses add pagination (search) or
 * page/limit so the export covers exactly the rows shown on screen (export).
 *
 * Date contract: `YYYY-MM-DD`, interpreted as UTC day boundaries
 * (start_date → 00:00:00.000Z, end_date → 23:59:59.999Z).
 */
export abstract class LogFilterQueryDto {
  @ApiProperty({
    enum: LogType,
    description: 'Log stream to search/export (case-insensitive)',
    example: LogType.ACTIVITY,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(LogType)
  logtype!: LogType;

  @ApiPropertyOptional({
    description:
      'Free-text search over action text, action name, category name, user/employee ids and details',
    example: 'salary revised',
  })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'q must not be blank' })
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    description: 'Inclusive start date (UTC, YYYY-MM-DD)',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'start_date must be YYYY-MM-DD' })
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end date (UTC, YYYY-MM-DD)',
    example: '2026-10-12',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'end_date must be YYYY-MM-DD' })
  end_date?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated category ids to include',
    example: '1,3',
  })
  @IsOptional()
  @Transform(({ value }) =>
    String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number),
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  categories?: number[];

  @ApiPropertyOptional({
    description: 'Comma-separated action names to include (text match, case-insensitive)',
    example: 'Login,Logout',
  })
  @IsOptional()
  @Transform(({ value }) =>
    String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  actions?: string[];
}
