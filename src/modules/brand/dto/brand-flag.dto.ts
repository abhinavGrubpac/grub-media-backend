import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class BrandFlagDto {
  @ApiPropertyOptional({
    description:
      'Non-compliance flag shown alongside the brand and its creatives; defaults to true',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_flagged?: boolean;
}
