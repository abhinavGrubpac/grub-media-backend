import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { LogFilterQueryDto } from './log-filter-query.dto';

/**
 * Payload for /logs/export (V2) — LLD name `ExportRequestDTO`.
 * Same filters as search plus the page currently rendered on screen: the CSV
 * contains only those pagination rows, never the whole filtered set.
 */
export class ExportRequestDto extends LogFilterQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page shown in the UI — exported rows start here',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Page size shown in the UI — exported rows per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
