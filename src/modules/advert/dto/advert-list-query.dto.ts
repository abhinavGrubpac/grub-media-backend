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
import {
  ADVERT_SORT_KEYS,
  ADVERT_STATUSES,
  normalizeStatusFilter,
  type AdvertStatusType,
} from '../validators';

export class AdvertListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [...ADVERT_STATUSES],
    isArray: true,
    description: 'One status or a comma-separated list (LIVE,PAUSED). Unknown values return 400.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeStatusFilter(value))
  @IsArray()
  @IsIn([...ADVERT_STATUSES], { each: true })
  status?: AdvertStatusType[];

  @ApiPropertyOptional({ description: 'Filter by brand (snake_case spelling)' })
  @IsOptional()
  @IsString()
  brand_id?: string;

  @ApiPropertyOptional({ description: 'Filter by brand (camelCase alias kept for compatibility)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandId?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on address text' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  @ApiPropertyOptional({ description: 'Brand industry (case-insensitive exact match)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({
    description: 'Schedules overlapping on/after this date (ISO, inclusive day)',
  })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Schedules overlapping on/before this date (ISO, inclusive day)',
  })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({ enum: ['flagged', 'notflagged'], description: 'Filter by brand flag' })
  @IsOptional()
  @IsIn(['flagged', 'notflagged'])
  brand_status?: 'flagged' | 'notflagged';

  @ApiPropertyOptional({ description: 'Case-insensitive match on city name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on zone name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  zone?: string;

  @ApiPropertyOptional({
    enum: ['brand'],
    description: 'Group page rows under their brand headers.',
  })
  @IsOptional()
  @IsIn(['brand'])
  group_by?: 'brand';

  @ApiPropertyOptional({
    enum: [...ADVERT_SORT_KEYS],
    description: 'All keys sort in the database. Default created_at desc.',
  })
  @IsOptional()
  @IsIn([...ADVERT_SORT_KEYS])
  declare sortBy?: string;

  @ApiPropertyOptional({
    description: 'Restrict to exactly these advert ids (comma-separated or repeated).',
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
