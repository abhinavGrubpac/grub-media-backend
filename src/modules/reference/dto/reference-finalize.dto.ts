import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { REFERENCE_MAX_FILE_BYTES } from '../services/storage.service';

export class ReferenceFinalizeDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @Length(1, 100)
  category!: string;

  @ApiPropertyOptional({
    description:
      'Stored file URL. Optional when file_key is given; presigned query strings are stripped automatically',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  file_url?: string;

  @ApiPropertyOptional({
    description:
      'Bare bucket key from upload-url (e.g. references/123-slug.pdf). Easiest option — the server builds the file URL',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  file_key?: string;

  @ApiPropertyOptional({ description: 'Stored file size in bytes; must be 99 MB or less' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REFERENCE_MAX_FILE_BYTES)
  file_size_bytes?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  published_on?: string;
}
