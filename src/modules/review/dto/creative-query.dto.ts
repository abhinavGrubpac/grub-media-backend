import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreativeQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ReviewStatus,
    description: 'Filter by the status of the latest version',
  })
  @IsOptional()
  @IsIn([...Object.values(ReviewStatus)])
  status?: ReviewStatus;

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  brand_id?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on creative name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
