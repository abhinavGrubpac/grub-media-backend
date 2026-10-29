import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ADVERT_STATUSES, TIME_OF_DAY_PATTERN, normalizeMultiValue } from '../validators';

export class AdvertImageSearchQueryDto {
  @ApiPropertyOptional({
    description: 'Reference dHash (even-length hex, 8-64 chars). Optional when a file is uploaded.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  image_hash?: string;

  @ApiPropertyOptional({
    description:
      'Reference advert id (uses its stored image_hash). Optional when a file is uploaded.',
  })
  @IsOptional()
  @IsString()
  advert_id?: string;

  @ApiPropertyOptional({ description: 'Max Hamming distance', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(256)
  max_distance?: number;

  @ApiPropertyOptional({ enum: [...ADVERT_STATUSES] })
  @IsOptional()
  @IsIn([...ADVERT_STATUSES])
  status?: (typeof ADVERT_STATUSES)[number];

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
      'start_date and end_date.',
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

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
