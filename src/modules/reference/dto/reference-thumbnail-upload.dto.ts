import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { REFERENCE_THUMBNAIL_MAX_BYTES } from '../services/storage.service';

export class ReferenceThumbnailUploadUrlDto {
  @ApiProperty({
    description: 'Source document title (used for the thumbnail key)',
    maxLength: 200,
  })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiPropertyOptional({ description: 'Thumbnail image type', enum: ['jpeg', 'png', 'webp'] })
  @IsOptional()
  @IsIn(['jpeg', 'png', 'webp'])
  content_type?: 'jpeg' | 'png' | 'webp';

  @ApiPropertyOptional({ description: 'Declared thumbnail size in bytes; 5 MB max' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REFERENCE_THUMBNAIL_MAX_BYTES)
  file_size_bytes?: number;
}
