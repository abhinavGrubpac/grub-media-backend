import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class UploadVersionDto {
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
