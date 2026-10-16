import { ApiProperty } from '@nestjs/swagger';
import { LogType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum } from 'class-validator';

/**
 * Query for GET /logs/filters (V2) — the merged filter panel that replaced
 * V1's separate /logs/categories and /logs/actions endpoints.
 */
export class LogFiltersQueryDto {
  @ApiProperty({
    enum: LogType,
    description: 'Log stream to load category/action filters for (case-insensitive)',
    example: LogType.SYSTEM,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(LogType)
  logtype!: LogType;
}
