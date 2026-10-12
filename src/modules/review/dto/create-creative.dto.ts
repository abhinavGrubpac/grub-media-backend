import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Length, ValidateNested } from 'class-validator';

export class InitialVersionDto {
  @ApiProperty({ description: 'Media file URL (bucket key)', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  media_url!: string;

  @ApiProperty({ description: 'Media type, e.g. Image | Video | PDF', maxLength: 50 })
  @IsString()
  @Length(1, 50)
  media_type!: string;

  @ApiPropertyOptional({
    description: 'Optional reviewer notes attached to the upload',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}

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

  @ApiPropertyOptional({
    description: 'Optional first version. Merges create + upload-version into one atomic call.',
    type: InitialVersionDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialVersionDto)
  initial_version?: InitialVersionDto;
}
