import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class UploadMediaDto {
  @ApiPropertyOptional({ description: 'Existing creative to attach the version to' })
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

  @ApiPropertyOptional({ description: 'Optional external reference', maxLength: 100 })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  external_ref_id?: string;

  @ApiPropertyOptional({ description: 'Media type (always Image)', maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  media_type?: string;

  @ApiPropertyOptional({ description: 'Optional notes attached to the version', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}
