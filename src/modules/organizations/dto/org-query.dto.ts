import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrgStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class OrgQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrgStatus })
  @IsOptional()
  @IsEnum(OrgStatus)
  status?: OrgStatus;

  @ApiPropertyOptional({ description: 'Search by name, regNumber, or jurisdiction' })
  @IsOptional()
  @IsString()
  search?: string;
}
