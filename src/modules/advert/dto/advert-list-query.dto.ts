import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  ADVERT_SORT_KEYS,
  ADVERT_STATUSES,
  TIME_OF_DAY_PATTERN,
  normalizeMultiValue,
} from '../validators';

export class AdvertListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [...ADVERT_STATUSES] })
  @IsOptional()
  @IsIn([...ADVERT_STATUSES])
  status?: (typeof ADVERT_STATUSES)[number];

  @ApiPropertyOptional({
    description:
      'Filter by brand (snake_case spelling). Accepts comma-separated or repeated ids; matches any selected brand.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeMultiValue(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  brand_id?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by brand (camelCase alias kept for compatibility). Accepts comma-separated or repeated ids.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeMultiValue(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  brandId?: string[];

  @ApiPropertyOptional({ description: 'Case-insensitive match on address text' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Brand industry (case-insensitive exact match). Accepts comma-separated or repeated values; matches any selected industry.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeMultiValue(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  industry?: string[];

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

  @ApiPropertyOptional({
    description:
      'Exact campaign start time (HH:mm, UTC). Requires end_time plus both ' +
      'start_date and end_date; the four values form one exact interval filter.',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'start_time must be HH:mm (00:00-23:59)' })
  start_time?: string;

  @ApiPropertyOptional({
    description:
      'Exact campaign end time (HH:mm, UTC). Requires start_time plus both ' +
      'start_date and end_date.',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'end_time must be HH:mm (00:00-23:59)' })
  end_time?: string;

  @ApiPropertyOptional({
    description:
      'Recurring daily display window start (HH:mm). With time_slot_end, ' +
      'matches adverts whose daily window overlaps the requested window.',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'time_slot_start must be HH:mm (00:00-23:59)' })
  time_slot_start?: string;

  @ApiPropertyOptional({
    description:
      'Recurring daily display window end (HH:mm). With time_slot_start, ' +
      'matches adverts whose daily window overlaps the requested window.',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'time_slot_end must be HH:mm (00:00-23:59)' })
  time_slot_end?: string;

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
