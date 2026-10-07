import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { UserRole, UserStatus } from '@prisma/client';

/**
 * Allowlist DTO for user data crossing the API boundary. Only @Expose-d fields
 * survive `plainToInstance(..., { excludeExtraneousValues: true })`, so
 * passwordHash / deletedAt / tokenVersion are never serialised out.
 */
export class UserResponseDto {
  @ApiProperty()
  @Expose()
  id!: string;

  @ApiProperty()
  @Expose()
  email!: string;

  @ApiProperty()
  @Expose()
  firstName!: string;

  @ApiProperty()
  @Expose()
  lastName!: string;

  @ApiProperty({ enum: UserRole })
  @Expose()
  role!: UserRole;

  @ApiProperty({ enum: UserStatus })
  @Expose()
  status!: UserStatus;

  @ApiProperty()
  @Expose()
  createdAt!: Date;

  @ApiProperty()
  @Expose()
  updatedAt!: Date;
}
