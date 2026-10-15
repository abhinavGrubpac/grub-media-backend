import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { REFERENCE_MAX_FILE_BYTES } from '../services/storage.service';

export class ReferenceUploadUrlDto {
  @ApiProperty({ description: 'Document title', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiProperty({ description: 'Regulatory category', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  category!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Official publication date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  published_on?: string;

  @ApiPropertyOptional({
    description: 'Declared file size in bytes; must be 99 MB or less',
    maximum: REFERENCE_MAX_FILE_BYTES,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REFERENCE_MAX_FILE_BYTES)
  file_size_bytes?: number;
}
