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
}
