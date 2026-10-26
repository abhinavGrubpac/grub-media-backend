import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/**
 * Sortable library keys (UI dropdown): name (a-z / z-a), published
 * (oldest / newest), archived (newest / oldest), uploaded (doc uploaded on).
 * Mapped to Prisma columns in ReferenceService — never passed through raw.
 */
export const REFERENCE_SORT_KEYS = ['name', 'published', 'archived', 'uploaded'] as const;
export type ReferenceSortKey = (typeof REFERENCE_SORT_KEYS)[number];

export const REFERENCE_SORT_ORDERS = ['asc', 'desc'] as const;

export class ReferenceListQueryDto {
  @ApiPropertyOptional({ description: 'Filter by regulatory category', maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;

  @ApiPropertyOptional({
    description: "Archive filter: 'active' docs only, 'archived' docs only, or omitted for all",
    enum: ['active', 'archived'],
  })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';

  @ApiPropertyOptional({ description: 'Case-insensitive match on document name', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    enum: [...REFERENCE_SORT_KEYS],
    description: 'Sort dropdown: name / published / archived / uploaded',
  })
  @IsOptional()
  @IsIn([...REFERENCE_SORT_KEYS])
  sortBy?: ReferenceSortKey;

  @ApiPropertyOptional({ enum: [...REFERENCE_SORT_ORDERS], default: 'desc' })
  @IsOptional()
  @IsIn([...REFERENCE_SORT_ORDERS])
  sortOrder?: 'asc' | 'desc';
}
