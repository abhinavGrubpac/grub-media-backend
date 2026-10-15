import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TestAgencyInput {
  @ApiProperty({ description: 'Agency identifier from the agency portal', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  upstream_agency_id!: string;

  @ApiProperty({ description: 'Display name of the agency', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  agency_name!: string;

  @ApiPropertyOptional({ description: 'Agency city (location)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string;

  @ApiPropertyOptional({ description: 'Agency address (location)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class TestBrandInput {
  @ApiProperty({ description: 'Brand display name (unique)', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  brand_name!: string;

  @ApiPropertyOptional({ description: 'Industry category', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  industry_category?: string;

  @ApiPropertyOptional({ description: 'Brand contact email' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  contact_email?: string;

  @ApiPropertyOptional({ description: 'Upstream brand id; generated when omitted', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_brand_id?: string;

  @ApiPropertyOptional({ description: 'Owning upstream agency id', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_agency_id?: string;
}

export class TestCreativeInput {
  @ApiProperty({ description: 'Creative name', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  creative_name!: string;

  @ApiProperty({ description: 'Media bucket key for v1', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  media_url!: string;

  @ApiProperty({ description: 'Media type (always Image)', maxLength: 50 })
  @IsString()
  @Length(1, 50)
  media_type!: string;

  @ApiPropertyOptional({ description: 'Campaign reference', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  campaign_ref?: string;

  @ApiPropertyOptional({
    description: 'Upstream version id for v1 (replay-safe; derived when omitted)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_version_id?: string;

  @ApiPropertyOptional({
    description: 'Upstream creative id (replay-safe; derived when omitted)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_creative_id?: string;
}

export class TestScheduleInput {
  @ApiProperty({ description: 'Latitude of the physical site', minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ description: 'Longitude of the physical site', minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({ description: 'Human-readable site address', maxLength: 500 })
  @IsString()
  @Length(1, 500)
  address_text!: string;

  @ApiProperty({ description: 'Schedule start (ISO 8601)' })
  @Type(() => Date)
  @IsDate()
  start_date!: Date;

  @ApiProperty({ description: 'Schedule end (ISO 8601, after start)' })
  @Type(() => Date)
  @IsDate()
  end_date!: Date;

  @ApiPropertyOptional({
    description: 'Coverage radius in kilometres for map display',
    minimum: 0.01,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(500)
  radius?: number;

  @ApiPropertyOptional({ description: 'Display city from upstream', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  city_name?: string;

  @ApiPropertyOptional({ description: 'Display zone from upstream', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  zone_name?: string;
}

export class TestAdminApprovalInput {
  @ApiProperty({ description: 'Admin reviewer identity from the admin portal', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  by!: string;

  @ApiPropertyOptional({ description: 'When admin approved (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  at?: Date;

  @ApiPropertyOptional({ description: 'Admin review comments', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  comments?: string;
}

export class RegisterAgencyDto extends TestAgencyInput {}

export class CreateTestBrandDto extends TestBrandInput {}

export class CreateTestCreativeDto extends TestCreativeInput {
  @ApiProperty({
    description: 'Brand the creative belongs to (raw id, or upstream id via upstream_brand_id)',
  })
  @IsString()
  brand_id!: string;

  @ApiPropertyOptional({ description: 'Upstream brand id; falls back to brand_id', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_brand_id?: string;

  @ApiPropertyOptional({ description: 'Owning upstream agency id', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_agency_id?: string;

  @ApiPropertyOptional({
    description: 'Admin-portal decision context (display only; govt review is unaffected)',
    type: TestAdminApprovalInput,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TestAdminApprovalInput)
  admin_approval?: TestAdminApprovalInput;

  @ApiPropertyOptional({
    description:
      'Schedule block: books the advert in the same call (pre-approval booking is normal).',
    type: TestScheduleInput,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TestScheduleInput)
  schedule?: TestScheduleInput;
}

export class ScheduleTestAdvertDto extends TestScheduleInput {
  @ApiProperty({ description: 'APPROVED creative version to schedule' })
  @IsString()
  version_id!: string;

  @ApiPropertyOptional({
    description: 'Upstream advert id: when supplied, scheduling is idempotent on it',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  upstream_advert_id?: string;

  @ApiPropertyOptional({
    description: 'dHash of the creative image (16 hex chars) for reverse-image search',
  })
  @IsOptional()
  @IsString()
  image_hash?: string;
}

export class BootstrapTestFlowDto {
  @ApiProperty({ type: TestAgencyInput })
  @ValidateNested()
  @Type(() => TestAgencyInput)
  agency!: TestAgencyInput;

  @ApiProperty({ type: TestBrandInput })
  @ValidateNested()
  @Type(() => TestBrandInput)
  brand!: TestBrandInput;

  @ApiProperty({ type: TestCreativeInput })
  @ValidateNested()
  @Type(() => TestCreativeInput)
  creative!: TestCreativeInput;

  @ApiPropertyOptional({
    description: 'Admin-portal decision context (display only; govt review is unaffected).',
    type: TestAdminApprovalInput,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TestAdminApprovalInput)
  admin_approval?: TestAdminApprovalInput;

  @ApiPropertyOptional({
    description:
      'Test-only approval: records APPROVE on v1 so the flow can proceed to scheduling in one call. Omit to leave v1 PENDING for manual review testing.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  approve_immediately?: boolean;

  @ApiPropertyOptional({
    description:
      'Schedule block (dates, location, radius). Applied regardless of approval: pre-approval booking is normal, go-live waits for APPROVE.',
    type: TestScheduleInput,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TestScheduleInput)
  schedule?: TestScheduleInput;
}
