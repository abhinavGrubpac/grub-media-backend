import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class BrandAgencyDto {
  @ApiPropertyOptional({ nullable: true })
  @Expose()
  upstream_agency_id!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  agency_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  city!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  address!: string | null;
}

/** Wire shape of a brand — snake_case, matching the multi-portal contract. */
export class BrandResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  brand_name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  industry_category!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  contact_email!: string | null;

  @ApiPropertyOptional({ description: 'Brand logo URL', nullable: true })
  @Expose()
  logo_url!: string | null;

  @ApiPropertyOptional({ description: 'Brand address', nullable: true })
  @Expose()
  address!: string | null;

  @ApiProperty({ description: 'Government kill-switch state' })
  @Expose()
  is_active!: boolean;

  @ApiProperty({ description: 'Government-owned auto-approve bypass' })
  @Expose()
  auto_approve!: boolean;

  @ApiProperty({ description: 'Non-compliance flag' })
  @Expose()
  is_flagged!: boolean;

  @ApiPropertyOptional({ description: 'Flagging reviewer id', nullable: true })
  @Expose()
  flagged_by!: string | null;

  @ApiPropertyOptional({ description: 'When the brand was flagged', nullable: true })
  @Expose()
  flagged_on!: Date | null;

  @ApiPropertyOptional({ description: 'Upstream (agency portal) brand identifier', nullable: true })
  @Expose()
  upstream_brand_id!: string | null;

  @ApiPropertyOptional({ description: 'Upstream agency identifier', nullable: true })
  @Expose()
  upstream_agency_id!: string | null;

  @ApiPropertyOptional({ description: 'Agency + location enrichment', type: BrandAgencyDto })
  @Expose()
  @Type(() => BrandAgencyDto)
  agency!: BrandAgencyDto | null;

  @ApiProperty()
  @Expose()
  created_at!: Date;

  @ApiProperty()
  @Expose()
  updated_at!: Date;
}
