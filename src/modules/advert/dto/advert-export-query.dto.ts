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
import { ADVERT_STATUSES } from '../validators';

export class AdvertExportQueryDto {
  @ApiPropertyOptional({ enum: [...ADVERT_STATUSES] })
  @IsOptional()
  @IsIn([...ADVERT_STATUSES])
  status?: (typeof ADVERT_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand_id?: string;

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
    description: 'Export exactly these advert ids (comma-separated or repeated).',
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
