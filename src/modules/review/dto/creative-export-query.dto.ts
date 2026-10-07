import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReviewStatus } from '@prisma/client';

export class CreativeExportQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsIn([...Object.values(ReviewStatus)])
  status?: ReviewStatus;

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand_id?: string;
}
