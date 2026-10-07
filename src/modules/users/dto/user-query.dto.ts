import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Columns a client is allowed to sort users by. Enforced authoritatively in
 * UsersService.list (any other value falls back to 'createdAt'), so an arbitrary
 * sortBy can never reach Prisma's orderBy regardless of validation wiring.
 */
export const USER_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'email',
  'firstName',
  'lastName',
] as const;
export type UserSortField = (typeof USER_SORTABLE_FIELDS)[number];

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
