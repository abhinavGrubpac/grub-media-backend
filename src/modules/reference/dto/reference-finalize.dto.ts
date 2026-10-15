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

  @ApiProperty({ description: 'Bucket-scoped file URL returned after the upload', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  file_url!: string;

  @ApiPropertyOptional({
    description: 'First-page thumbnail preview URL (auto-uploaded with the doc)',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  thumbnail_url?: string;

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
