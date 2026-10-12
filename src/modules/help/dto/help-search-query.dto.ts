import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * Query for GET /help/search — the single search endpoint.
 * Without `categoryId` it searches category names + FAQ questions globally;
 * with `categoryId` it is scoped to that category's FAQ questions only.
 */
export class HelpSearchQueryDto {
  @ApiProperty({
    description: 'Search term (matches category name or FAQ question)',
    example: 'attendance',
  })
  @IsString()
  @Matches(/\S/, { message: 'q must not be blank' })
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Scope the search to one category (FAQ questions only)',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;
}
