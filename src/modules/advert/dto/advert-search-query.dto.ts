import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ADVERT_SEARCH_SORTS } from '../validators';

export class AdvertSearchQueryDto {
  @ApiPropertyOptional({ description: 'Latitude to search around', minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude to search around', minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    description:
      'Radius in kilometres. Needs a center: lat+lng, or a place name via search ' +
      '(e.g. search=Nashik&radius=5 — the place is geocoded; an unknown place falls back to text search). Cannot be used with no center at all.',
    minimum: 0.01,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(500)
  radius?: number;

  @ApiPropertyOptional({
    description:
      'Text fallback when no coordinates are supplied: matches advert ID, address text, city, or zone (case-insensitive). ' +
      'Together with radius, the text is first resolved as a place (forward geocoded) and the radius is centered on it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  @ApiPropertyOptional({ description: 'Brand industry (case-sensitive exact match)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry?: string;

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand_id?: string;

  @ApiPropertyOptional({ description: 'Schedules overlapping on/after this date (ISO)' })
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
    description: 'distance sorts need lat+lng. Default distance_asc.',
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
