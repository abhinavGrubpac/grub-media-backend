import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreativeUploadRequestDto {
  @ApiProperty({ description: 'Brand the upload belongs to' })
  @IsString()
  brand_id!: string;

  @ApiProperty({ description: 'Creative name for the bucket key', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ description: 'Media type (always Image)', maxLength: 50 })
  @IsString()
  @Length(1, 50)
  media_type!: string;
}
