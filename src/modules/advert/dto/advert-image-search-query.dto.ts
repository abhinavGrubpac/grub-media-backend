import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ADVERT_STATUSES } from '../validators';

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

  @ApiPropertyOptional({
    enum: [...ADVERT_STATUSES, 'APPROVED'],
    description:
      'Status filter. APPROVED returns approved creatives that are not deployed yet; omit to search both.',
  })
  @IsOptional()
  @IsIn([...ADVERT_STATUSES, 'APPROVED'])
  status?: (typeof ADVERT_STATUSES)[number] | 'APPROVED';

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  brand_id?: string;

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
