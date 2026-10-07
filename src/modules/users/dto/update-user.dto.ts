import { OmitType, PartialType } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * Updatable fields: everything on CreateUserDto except password (password
 * changes go through a dedicated flow), plus account status.
 */
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
