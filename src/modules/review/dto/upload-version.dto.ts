import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UploadVersionDto {
  @ApiProperty({ description: 'Media file URL (bucket key)', maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  media_url!: string;

  @ApiProperty({ description: 'Media type, e.g. Image | Video | PDF', maxLength: 50 })
  @IsString()
  @Length(1, 50)
  media_type!: string;

  @ApiPropertyOptional({ description: 'Display name of the media file', maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  media_name?: string;

  @ApiPropertyOptional({ description: 'Uploaded file size in bytes', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  file_size_bytes?: number;

  @ApiPropertyOptional({
    description: 'Optional reviewer notes attached to the upload',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}
