import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { REVIEW_ACTIONS } from '../transitions';

export class TakeActionDto {
  @ApiProperty({ enum: [...REVIEW_ACTIONS], description: 'Review decision' })
  @IsIn([...REVIEW_ACTIONS])
  action!: (typeof REVIEW_ACTIONS)[number];

  @ApiPropertyOptional({ description: 'Mandatory for REJECT and REQUEST_CHANGES', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  comments?: string;

  @ApiPropertyOptional({
    description:
      'Optional structured rejection/hold reason (dropdown value or short label). ' +
      'Stored separately from free-form comments.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Optimistic-lock guard: the version number the caller based the decision on',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
