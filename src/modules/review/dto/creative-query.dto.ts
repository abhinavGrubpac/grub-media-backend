import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { CREATIVE_SORT_KEYS, CREATIVE_SORT_ORDERS, CREATIVE_STATUS_FILTERS } from '../transitions';

export class CreativeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [...CREATIVE_STATUS_FILTERS],
    description:
      'Filter by version status. Aliases: NEED_CHANGES, REJECT, AUTO_APPROVED (=APPROVED). ALL disables the filter.',
  })
  @IsOptional()
  @IsIn([...CREATIVE_STATUS_FILTERS])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  brand_id?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on creative name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Brand industry (case-insensitive exact match)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({ description: 'Versions uploaded on/after this date (ISO, inclusive day)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Versions uploaded on/before this date (ISO, inclusive day)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Only creatives with a review action by this actor (user id)',
  })
  @IsOptional()
  @IsString()
  actor_id?: string;

  @ApiPropertyOptional({
    enum: [...CREATIVE_SORT_KEYS],
    description:
      'Camel-case alias retained for backwards compatibility. Prefer sort_by. ' +
      'created_at/brand_name sort in the database; uploaded_on/last_action_at sort in memory after filtering.',
  })
  @IsOptional()
  @IsIn([...CREATIVE_SORT_KEYS])
  declare sortBy?: string;

  @ApiPropertyOptional({
    enum: [...CREATIVE_SORT_KEYS],
    description:
      'Documented wire-format sort key. created_at/brand_name sort in the database; ' +
      'uploaded_on/last_action_at sort in memory after filtering.',
  })
  @IsOptional()
  @IsIn([...CREATIVE_SORT_KEYS])
  sort_by?: string;

  @ApiPropertyOptional({
    enum: [...CREATIVE_SORT_ORDERS],
    default: 'desc',
    description: 'Documented wire-format sort direction. Default desc.',
  })
  @IsOptional()
  @IsIn([...CREATIVE_SORT_ORDERS])
  sort_order?: 'asc' | 'desc';

  @ApiPropertyOptional({
    enum: ['history'],
    description:
      'Embed the full approval thread (versions + actions) in each row. ' +
      'Merges list + per-row history calls into one request.',
  })
  @IsOptional()
  @IsIn(['history'])
  include?: 'history';

  @ApiPropertyOptional({
    description: 'Restrict to exactly these creative ids (comma-separated or repeated).',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : String(value ?? '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean),
  )
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}
