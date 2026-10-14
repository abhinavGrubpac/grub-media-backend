import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';

export type ExportType = 'all' | 'active' | 'suspended' | 'dismissed' | 'selected';

export class ExportUsersDto {
  @ApiProperty({
    enum: ['all', 'active', 'suspended', 'dismissed', 'selected'],
    description:
      '"selected" requires the ids array. Other values export all matching users for that status.',
  })
  @IsEnum(['all', 'active', 'suspended', 'dismissed', 'selected'], {
    message: 'type must be one of: all, active, suspended, dismissed, selected',
  })
  type!: ExportType;

  @ApiPropertyOptional({
    type: [String],
    description: 'Required when type is "selected". List of user IDs to export.',
  })
  @ValidateIf((o: ExportUsersDto) => o.type === 'selected')
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Search by name, email, employee ID, phone, or org' })
  @IsOptional()
  @IsString()
  search?: string;
}
