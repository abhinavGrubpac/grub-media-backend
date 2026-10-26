import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Reason for the compliance action; written to the audit trail and outbox event.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Alias for reason (frontend compatibility); reason wins when both are sent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comments?: string;
}
