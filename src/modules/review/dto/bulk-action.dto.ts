import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { REVIEW_ACTIONS } from '../transitions';

/**
 * Multi-select bulk review decision: applies the same action to a selection
 * of creative versions in one call, replacing N × POST /creatives/:id/action.
 * Rows that cannot accept the action (already decided, ON_HOLD without
 * RESUME, missing) are skipped with a per-id reason instead of failing the
 * batch.
 */
export class BulkTakeActionDto {
  @ApiProperty({ description: 'Creative version ids to review at once', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  version_ids!: string[];

  @ApiProperty({ enum: [...REVIEW_ACTIONS], description: 'Review decision for every version' })
  @IsIn([...REVIEW_ACTIONS])
  action!: (typeof REVIEW_ACTIONS)[number];

  @ApiPropertyOptional({
    description: 'Free-form comments recorded on every version',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  comments?: string;

  @ApiPropertyOptional({
    description:
      'Structured reason, mandatory for REJECT / HOLD / REQUEST_CHANGES ' +
      '(applied to every version in the selection)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
