import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreativeFinalizeDto {
  @ApiPropertyOptional({
    description: 'Existing creative to attach the version to (exclusive with brand_id+name)',
  })
  @IsOptional()
  @IsString()
  creative_id?: string;

  @ApiPropertyOptional({ description: 'Brand for a new creative (required without creative_id)' })
  @IsOptional()
  @IsString()
  brand_id?: string;

  @ApiPropertyOptional({ description: 'Name for a new creative', maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiProperty({ description: 'Uploaded bucket key confirmed by the client', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  s3_key!: string;

  @ApiProperty({ description: 'Media type (always Image)', maxLength: 50 })
  @IsString()
  @Length(1, 50)
  media_type!: string;
}
