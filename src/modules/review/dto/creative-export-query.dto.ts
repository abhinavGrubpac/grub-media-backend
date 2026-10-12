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
import { CREATIVE_STATUS_FILTERS } from '../transitions';

export class CreativeExportQueryDto {
  @ApiPropertyOptional({ enum: [...CREATIVE_STATUS_FILTERS] })
  @IsOptional()
  @IsIn([...CREATIVE_STATUS_FILTERS])
  status?: string;

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
    description:
      'Export exactly these creative ids (comma-separated or repeated). Reproduces any filtered list.',
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
