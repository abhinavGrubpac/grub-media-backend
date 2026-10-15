import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ReferenceLinkDto {
  @ApiProperty({ description: 'Creative version to justify' })
  @IsString()
  @Length(1, 200)
  version_id!: string;

  @ApiProperty({ description: 'Reference document to link' })
  @IsString()
  @Length(1, 200)
  doc_id!: string;
}
