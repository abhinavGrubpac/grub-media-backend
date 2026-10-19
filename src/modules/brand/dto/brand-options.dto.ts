import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class BrandOptionsQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive match on brand name (dropdown search)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    enum: ['active', 'stopped'],
    description: 'Brand activity filter (defaults to all)',
  })
  @IsOptional()
  @IsIn(['active', 'stopped'])
  activity?: 'active' | 'stopped';
}

export class BrandOptionDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  brand_name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  industry_category!: string | null;

  @ApiProperty()
  @Expose()
  is_active!: boolean;
}
