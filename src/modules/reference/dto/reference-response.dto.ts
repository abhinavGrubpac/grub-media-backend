import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ReferenceDocResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  title!: string;

  @ApiProperty()
  @Expose()
  file_url!: string;

  @ApiPropertyOptional({ description: 'First-page thumbnail preview (auto-uploaded with the doc)' })
  @Expose()
  thumbnail_url!: string | null;

  @ApiPropertyOptional({ description: 'Stored file size in bytes (99 MB max)' })
  @Expose()
  file_size_bytes!: number | null;

  @ApiProperty()
  @Expose()
  category!: string;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  description!: string | null;

  @ApiPropertyOptional({
    description: 'Official publication date; drives the "Published" badge',
    nullable: true,
  })
  @Expose()
  published_on!: Date | null;

  @ApiProperty({ description: 'Archived documents are never hard-deleted' })
  @Expose()
  is_archived!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @Expose()
  archived_on!: Date | null;

  @ApiProperty()
  @Expose()
  created_at!: Date;

  @ApiProperty()
  @Expose()
  updated_at!: Date;
}
