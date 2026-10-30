import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { UserRole, UserStatus } from '@prisma/client';

export class OrgInUserDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() name!: string;
  @ApiProperty({ required: false }) @Expose() regNumber?: string;
  @ApiProperty({ required: false }) @Expose() logoUrl?: string;
  @ApiProperty({ required: false }) @Expose() jurisdiction?: string;
  @ApiProperty() @Expose() status!: string;
}

/**
 * Allowlist DTO for user data crossing the API boundary. Only @Expose-d fields
 * survive `plainToInstance(..., { excludeExtraneousValues: true })`, so
 * passwordHash / deletedAt / tokenVersion are never serialised out.
 */
export class UserResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() email!: string;
  @ApiProperty() @Expose() firstName!: string;
  @ApiProperty() @Expose() lastName!: string;

  @ApiProperty({ required: false }) @Expose() phoneNumber?: string;
  @ApiProperty({ required: false }) @Expose() avatarUrl?: string;
  @ApiProperty() @Expose() employeeId!: string;
  @ApiProperty({ required: false }) @Expose() jurisdiction?: string;
  @ApiProperty({ required: false }) @Expose() joiningDate?: Date;

  @ApiProperty({ required: false }) @Expose() organizationId?: string;

  @ApiProperty({ required: false, type: () => OrgInUserDto })
  @Expose()
  @Type(() => OrgInUserDto)
  organization?: OrgInUserDto;

  @ApiProperty({ enum: UserRole }) @Expose() role!: UserRole;
  @ApiProperty({ enum: UserStatus }) @Expose() status!: UserStatus;

  @ApiProperty() @Expose() createdAt!: Date;
  @ApiProperty() @Expose() updatedAt!: Date;
}
