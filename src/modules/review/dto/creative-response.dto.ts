import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { Expose } from 'class-transformer';

export class CreativeBrandSummaryDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  brand_name!: string;

  @ApiProperty({ description: 'Non-compliance flag of the owning brand' })
  @Expose()
  is_flagged!: boolean;

  @ApiPropertyOptional({ description: 'Brand industry category', nullable: true })
  @Expose()
  industry_category!: string | null;

  @ApiPropertyOptional({ description: 'Brand logo URL', nullable: true })
  @Expose()
  logo_url!: string | null;

  @ApiPropertyOptional({
    description: 'Brand registered address / location (free text)',
    nullable: true,
  })
  @Expose()
  address!: string | null;

  @ApiPropertyOptional({ description: 'Display name of the flagging reviewer', nullable: true })
  @Expose()
  flagged_by!: string | null;

  @ApiPropertyOptional({ description: 'When the brand was flagged', nullable: true })
  @Expose()
  flagged_on!: Date | null;
}

export class CreativeAgencySummaryDto {
  @ApiProperty({ description: 'Upstream agency identifier' })
  @Expose()
  upstream_agency_id!: string;

  @ApiProperty()
  @Expose()
  agency_name!: string;

  @ApiPropertyOptional({ description: 'Agency city', nullable: true })
  @Expose()
  city!: string | null;

  @ApiPropertyOptional({ description: 'Agency address', nullable: true })
  @Expose()
  address!: string | null;
}

export class CreativeScheduleSummaryDto {
  @ApiProperty()
  @Expose()
  advert_id!: string;

  @ApiProperty()
  @Expose()
  version_id!: string;

  @ApiProperty()
  @Expose()
  status!: string;

  @ApiProperty()
  @Expose()
  start_date!: Date;

  @ApiProperty()
  @Expose()
  end_date!: Date;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  address_text!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  city_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  zone_name!: string | null;

  @ApiPropertyOptional({ description: 'Coverage radius in km for map display', nullable: true })
  @Expose()
  radius_km!: number | null;

  @ApiPropertyOptional({ description: 'WKT site location (where the ad will run)', nullable: true })
  @Expose()
  location!: string | null;
}

export class ReviewActionResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  action!: string;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  comments!: string | null;

  @ApiPropertyOptional({
    description: 'Structured decision reason selected or entered by the reviewer',
    nullable: true,
  })
  @Expose()
  reason!: string | null;

  @ApiProperty()
  @Expose()
  actor_id!: string;

  @ApiPropertyOptional({ description: 'Resolved display name of the actor', nullable: true })
  @Expose()
  actor_name!: string | null;

  @ApiProperty()
  @Expose()
  created_at!: Date;
}

export class CreativeVersionResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  version_number!: number;

  @ApiProperty()
  @Expose()
  media_url!: string;

  @ApiProperty()
  @Expose()
  media_type!: string;

  @ApiPropertyOptional({ description: 'Display name of the media file', nullable: true })
  @Expose()
  media_name?: string | null;

  @ApiPropertyOptional({ description: 'Uploaded file size in bytes', nullable: true })
  @Expose()
  file_size_bytes!: number | null;

  @ApiProperty({ enum: ReviewStatus })
  @Expose()
  status!: ReviewStatus;

  @ApiProperty()
  @Expose()
  created_by!: string;

  @ApiPropertyOptional({
    description: 'Display name of the uploader, when resolvable',
    nullable: true,
  })
  @Expose()
  created_by_name!: string | null;

  @ApiProperty()
  @Expose()
  created_at!: Date;

  @ApiPropertyOptional({
    description: 'Admin reviewer identity (upstream context)',
    nullable: true,
  })
  @Expose()
  admin_approved_by!: string | null;

  @ApiPropertyOptional({ description: 'When admin approved (upstream context)', nullable: true })
  @Expose()
  admin_approved_at!: Date | null;

  @ApiPropertyOptional({ description: 'Admin review comments (upstream context)', nullable: true })
  @Expose()
  admin_comments!: string | null;

  @ApiPropertyOptional({ nullable: true, type: ReviewActionResponseDto })
  @Expose()
  latest_action!: ReviewActionResponseDto | null;

  @ApiPropertyOptional({ type: [ReviewActionResponseDto] })
  @Expose()
  actions?: ReviewActionResponseDto[];
}

export class CreativeResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  brand_id!: string;

  @ApiProperty({ type: CreativeBrandSummaryDto })
  @Expose()
  brand!: CreativeBrandSummaryDto;

  @ApiProperty()
  @Expose()
  creative_name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  external_ref_id!: string | null;

  @ApiPropertyOptional({
    description: 'Upstream (agency portal) creative identifier',
    nullable: true,
  })
  @Expose()
  upstream_creative_id!: string | null;

  @ApiPropertyOptional({
    description: 'Display-only campaign annotation from upstream',
    nullable: true,
  })
  @Expose()
  campaign_ref!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  current_version_id!: string | null;

  @ApiProperty()
  @Expose()
  created_at!: Date;

  @ApiPropertyOptional({ nullable: true, type: CreativeVersionResponseDto })
  @Expose()
  latest_version!: CreativeVersionResponseDto | null;

  @ApiPropertyOptional({ description: 'Display name of the latest action actor', nullable: true })
  @Expose()
  last_action_by!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  last_action_at!: Date | null;

  @ApiPropertyOptional({
    description:
      'Primary creative location: first linked hoarding address, else the brand registered address',
    nullable: true,
  })
  @Expose()
  location!: string | null;

  @ApiPropertyOptional({ type: CreativeAgencySummaryDto, nullable: true })
  @Expose()
  agency?: CreativeAgencySummaryDto | null;

  @ApiPropertyOptional({ type: [CreativeVersionResponseDto] })
  @Expose()
  versions?: CreativeVersionResponseDto[];

  @ApiPropertyOptional({ type: [CreativeScheduleSummaryDto] })
  @Expose()
  schedules?: CreativeScheduleSummaryDto[];

  @ApiPropertyOptional({
    description: 'Distinct cities targeted by all adverts linked to this creative (region summary)',
    type: [String],
  })
  @Expose()
  targeted_regions!: string[];

  @ApiPropertyOptional({
    description: 'Total bytes across every uploaded version of this creative',
    nullable: true,
  })
  @Expose()
  total_size_bytes!: number | null;

  @ApiPropertyOptional({ description: 'Display name of the last viewer', nullable: true })
  @Expose()
  last_viewed_by!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  last_viewed_at!: Date | null;

  @ApiPropertyOptional({ description: 'Minutes since last view', nullable: true })
  @Expose()
  viewed_minutes_ago!: number | null;
}
