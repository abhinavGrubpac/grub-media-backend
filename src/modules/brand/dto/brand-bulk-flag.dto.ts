import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsString } from 'class-validator';

/** Multi-select flag/unflag: one call replaces N × POST /brands/:id/flag. */
export class BrandBulkFlagDto {
  @ApiProperty({ description: 'Brand ids to flag/unflag in one call', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];

  @ApiProperty({ description: 'true = raise the non-compliance flag, false = lower it' })
  @IsBoolean()
  is_flagged!: boolean;
}
