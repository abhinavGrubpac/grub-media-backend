import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdvertStatus, ReviewStatus } from '@prisma/client';
import { Expose } from 'class-transformer';
import { ADVERT_GOVT_ACTIONS } from '../validators';

export class AdvertBrandSummaryDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  brand_name!: string;

  @ApiProperty({ description: 'Warning shown for non-compliant brands' })
  @Expose()
  is_flagged!: boolean;
}

export class AdvertVersionSummaryDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  version_number!: number;

  @ApiProperty({ enum: ReviewStatus })
  @Expose()
  status!: ReviewStatus;

  @ApiProperty()
  @Expose()
  creative_id!: string;

  @ApiProperty()
  @Expose()
  creative_name!: string;

  @ApiProperty({ type: AdvertBrandSummaryDto })
  @Expose()
  brand!: AdvertBrandSummaryDto;
}

export class AdvertResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  version_id!: string;

  @ApiProperty({ enum: AdvertStatus })
  @Expose()
  status!: AdvertStatus;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  address_text!: string | null;

  @ApiProperty()
  @Expose()
  start_date!: Date;

  @ApiProperty()
  @Expose()
  end_date!: Date;

  @ApiPropertyOptional({
    description: 'Recurring daily display window start (HH:mm)',
    nullable: true,
  })
  @Expose()
  time_slot_start!: string | null;

  @ApiPropertyOptional({
    description: 'Recurring daily display window end (HH:mm)',
    nullable: true,
  })
  @Expose()
  time_slot_end!: string | null;

  @ApiPropertyOptional({
    description: 'Derived daily display window, e.g. "06:00 - 23:00"',
    nullable: true,
  })
  @Expose()
  time_range!: string | null;

  @ApiPropertyOptional({
    description: 'Display annotation of the city from upstream',
    nullable: true,
  })
  @Expose()
  city_name!: string | null;

  @ApiPropertyOptional({
    description: 'Display annotation of the zone from upstream',
    nullable: true,
  })
  @Expose()
  zone_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  image_hash!: string | null;

  @ApiPropertyOptional({
    description: 'Upstream (agency portal) advert identifier',
    nullable: true,
  })
  @Expose()
  upstream_advert_id!: string | null;

  @ApiProperty()
  @Expose()
  created_at!: Date;

  @ApiPropertyOptional({ type: AdvertVersionSummaryDto })
  @Expose()
  version?: AdvertVersionSummaryDto | null;

  @ApiPropertyOptional({
    description: 'PostGIS WKT point of the site (all reads, not only geo-search)',
    nullable: true,
  })
  @Expose()
  location?: string | null;

  @ApiPropertyOptional({
    description: 'Coverage radius in metres for map display',
    nullable: true,
  })
  @Expose()
  radius_m?: number | null;

  @ApiPropertyOptional({ description: 'Creative media bucket key', nullable: true })
  @Expose()
  media_url?: string | null;

  @ApiPropertyOptional({ description: 'Creative media type (always Image)', nullable: true })
  @Expose()
  media_type?: string | null;

  @ApiPropertyOptional({ description: 'Creative name (advert title)', nullable: true })
  @Expose()
  creative_name?: string | null;

  @ApiPropertyOptional({ description: 'Owning creative id', nullable: true })
  @Expose()
  creative_id?: string | null;

  @ApiPropertyOptional({ description: 'Brand industry category', nullable: true })
  @Expose()
  industry?: string | null;

  @ApiPropertyOptional({
    description: 'Owning brand id (flat alias for list/search clients)',
    nullable: true,
  })
  @Expose()
  brand_id?: string | null;

  @ApiPropertyOptional({
    description: 'Owning brand name (flat alias for list/search clients)',
    nullable: true,
  })
  @Expose()
  brand_name?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the owning brand is flagged (flat alias)',
    nullable: true,
  })
  @Expose()
  brand_is_flagged?: boolean | null;

  @ApiPropertyOptional({
    description: 'Brand industry category (flat alias)',
    nullable: true,
  })
  @Expose()
  industry_category?: string | null;

  @ApiPropertyOptional({
    description:
      'Distance in metres from the searched location to the advert site (radius/geo search only)',
    nullable: true,
  })
  @Expose()
  distance_m?: number | null;

  @ApiPropertyOptional({
    description:
      'Advert Control proximity column: distance in metres from the searched location to this advert (search/list with a resolvable search place; null otherwise)',
    nullable: true,
  })
  @Expose()
  proximity?: number | null;

  @ApiPropertyOptional({
    description: 'Hamming distance to the uploaded query image (by-image search only)',
    nullable: true,
  })
  @Expose()
  hash_distance?: number | null;

  @ApiPropertyOptional({
    enum: [...ADVERT_GOVT_ACTIONS],
    description: 'Take-action menu for this row. Empty means view-only (terminal status).',
    isArray: true,
  })
  @Expose()
  available_actions?: (typeof ADVERT_GOVT_ACTIONS)[number][];
}

export class AdvertBrandGroupDto {
  @ApiProperty({ type: AdvertBrandSummaryDto })
  @Expose()
  brand!: AdvertBrandSummaryDto;

  @ApiProperty({ type: [AdvertResponseDto] })
  @Expose()
  adverts!: AdvertResponseDto[];

  @ApiProperty()
  @Expose()
  count!: number;
}
