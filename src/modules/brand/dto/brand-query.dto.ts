import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Manage-brands list keys (UI dropdowns): name (a-z / z-a), updated
 * (newest / oldest). Mapped to Prisma columns in BrandService.
 */
export const BRAND_SORT_KEYS = ['name', 'updated'] as const;
export type BrandSortKey = (typeof BRAND_SORT_KEYS)[number];

export class BrandQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on brand name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['flagged', 'unflagged'], description: 'Flag status filter' })
  @IsOptional()
  @IsIn(['flagged', 'unflagged'])
  flag_status?: 'flagged' | 'unflagged';

  @ApiPropertyOptional({ enum: ['on', 'off'], description: 'Auto-approval filter' })
  @IsOptional()
  @IsIn(['on', 'off'])
  auto_approval?: 'on' | 'off';

  @ApiPropertyOptional({ enum: ['active', 'stopped'], description: 'Brand activity filter' })
  @IsOptional()
  @IsIn(['active', 'stopped'])
  activity?: 'active' | 'stopped';

  @ApiPropertyOptional({ description: 'Industry category filter (exact, case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({
    enum: [...BRAND_SORT_KEYS],
    description: 'Sort dropdown: name (a-z/z-a) / updated (newest/oldest)',
  })
  @IsOptional()
  @IsIn([...BRAND_SORT_KEYS])
  declare sortBy?: string;
}
