import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Selection body for the reference-library bulk endpoints. */
export class BulkSelectionDto {
  @ApiProperty({ description: 'Reference document ids to apply the bulk action to', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}
