import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ADVERT_SEARCH_SORTS,
  ADVERT_STATUSES,
  TIME_OF_DAY_PATTERN,
  normalizeMultiValue,
} from '../validators';

export class AdvertSearchQueryDto {
  @ApiPropertyOptional({ enum: [...ADVERT_STATUSES] })
  @IsOptional()
  @IsIn([...ADVERT_STATUSES])
  status?: (typeof ADVERT_STATUSES)[number];

  @ApiPropertyOptional({
    description:
      'Search radius in metres. Requires a location search (search text): radius cannot be searched alone. ' +
      'Without a radius the location matches place rows with no distance cut-off.',
    minimum: 1,
    maximum: 500000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500000)
  radius_m?: number;

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
    description:
      'The searched location as plain text (city, zone, address). lat/lng are never accepted; ' +
      'coordinates are resolved from this text at query time and the text also filters rows by ' +
      'address, city, zone, creative, brand, or industry. Unmappable text yields an empty result set.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  @ApiPropertyOptional({
    description:
      'Filter by brand. Accepts comma-separated or repeated brand ids; matches any selected brand.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeMultiValue(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  brand_id?: string[];

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

  @ApiPropertyOptional({ description: 'Schedules overlapping on/after this instant (ISO)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  start?: Date;

  @ApiPropertyOptional({ description: 'Schedules overlapping on/before this date (ISO)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  end?: Date;

  @ApiPropertyOptional({
    description:
      'Reverse-image match: 64-bit dHash of the query image (16 hex chars). ' +
      'Rows rank nearest-first by Hamming distance; only adverts with a stored image_hash participate. ' +
      'Client-side hash: grayscale, resize to 9x8, one bit per row-adjacent pair (left > right), 16 hex chars.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F]{16}$/, { message: 'image_hash must be 16 hex chars' })
  image_hash?: string;

  @ApiPropertyOptional({
    description: 'Max Hamming distance for image matches (0-64)',
    minimum: 0,
    maximum: 64,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(64)
  max_distance?: number;

  @ApiPropertyOptional({
    enum: [...ADVERT_SEARCH_SORTS],
    description: 'Distance sorts need a location search (search text). Default distance_asc.',
  })
  @IsOptional()
  @IsIn([...ADVERT_SEARCH_SORTS])
  sort?: (typeof ADVERT_SEARCH_SORTS)[number];

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['brand'],
    description: 'Group page rows under their brand headers.',
  })
  @IsOptional()
  @IsIn(['brand'])
  group_by?: 'brand';
}
