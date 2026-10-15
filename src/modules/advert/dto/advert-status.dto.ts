import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ADVERT_STATUSES } from '../validators';

export class AdvertStatusDto {
  @ApiProperty({ enum: [...ADVERT_STATUSES] })
  @IsIn([...ADVERT_STATUSES])
  status!: (typeof ADVERT_STATUSES)[number];

  @ApiPropertyOptional({
    description:
      'Optimistic-lock guard: the status the caller based the decision on. A stale value returns 409.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...ADVERT_STATUSES])
  expected_status?: (typeof ADVERT_STATUSES)[number];
}
