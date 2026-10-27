import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ADVERT_STATUSES } from '../validators';

/**
 * Multi-select compliance status change (Advert Control): applies the same
 * status to every advert in the selection in one call, replacing
 * N × PATCH /:id/status. Adverts that cannot accept the status are skipped
 * with a per-id reason rather than failing the batch.
 */
export class AdvertBulkStatusDto {
  @ApiProperty({ description: 'Advert ids to apply the status to', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];

  @ApiProperty({ enum: [...ADVERT_STATUSES], description: 'Target status for every advert' })
  @IsIn([...ADVERT_STATUSES])
  status!: (typeof ADVERT_STATUSES)[number];

  @ApiPropertyOptional({
    description:
      'Optimistic-lock guard applied to every advert: any advert whose current status differs ' +
      'from this value is skipped as stale instead of 409-ing the batch.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...ADVERT_STATUSES])
  expected_status?: (typeof ADVERT_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Reason for the compliance action; written to every applied advert audit trail.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
