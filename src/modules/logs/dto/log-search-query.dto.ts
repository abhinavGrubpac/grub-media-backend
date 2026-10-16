import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { LogFilterQueryDto } from './log-filter-query.dto';

/**
 * Query for GET /logs/search (V2): shared filters (q, logtype, dates,
 * categories, actions) + pagination. Results are always sorted by
 * createdAt desc, id desc.
 */
export class LogSearchQueryDto extends LogFilterQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
