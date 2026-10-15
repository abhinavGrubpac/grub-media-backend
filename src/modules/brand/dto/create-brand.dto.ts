import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateBrandDto {
  @ApiProperty({ description: 'Unique brand name', minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  brand_name!: string;

  @ApiPropertyOptional({ description: 'Industry category', maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  industry_category?: string;

  @ApiPropertyOptional({ description: 'Brand contact email', format: 'email' })
  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @ApiPropertyOptional({ description: 'Brand logo URL', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  logo_url?: string;

  @ApiPropertyOptional({ description: 'Brand address', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;

  @ApiPropertyOptional({
    description: 'Government kill-switch state; false stops all brand activity',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({
    description: 'Government-owned auto-approve bypass for new versions',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  auto_approve?: boolean;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}
