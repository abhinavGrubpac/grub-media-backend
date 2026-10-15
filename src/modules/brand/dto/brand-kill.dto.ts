import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class BrandKillDto {
  @ApiPropertyOptional({
    description:
      'Kill-switch state; false revokes all non-revoked adverts of the brand. Defaults to false',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_active?: boolean;
}
