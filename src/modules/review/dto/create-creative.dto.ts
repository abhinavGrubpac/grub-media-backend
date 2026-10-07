import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateCreativeDto {
  @ApiProperty({ description: 'Brand the creative belongs to' })
  @IsString()
  brand_id!: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  creative_name!: string;

  @ApiPropertyOptional({
    description: 'Optional external reference for reconciliation',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  external_ref_id?: string;
}
