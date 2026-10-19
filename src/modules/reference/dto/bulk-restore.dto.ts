import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, IsOptional, IsString } from 'class-validator';

export class BulkRestoreDto {
  @ApiPropertyOptional({ description: 'Document ids to unarchive at once' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}

export class RestoreAllQueryDto {
  @ApiPropertyOptional({ description: 'Restrict unarchive-all to a category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Restrict unarchive-all to a name search' })
  @IsOptional()
  @IsString()
  search?: string;
}
