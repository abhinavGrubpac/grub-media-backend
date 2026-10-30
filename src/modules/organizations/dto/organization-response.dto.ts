import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { OrgStatus } from '@prisma/client';

export class OrganizationResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() name!: string;
  @ApiProperty({ required: false }) @Expose() regNumber?: string;
  @ApiProperty({ required: false }) @Expose() logoUrl?: string;
  @ApiProperty({ required: false }) @Expose() jurisdiction?: string;
  @ApiProperty({ enum: OrgStatus }) @Expose() status!: OrgStatus;
  @ApiProperty() @Expose() createdAt!: Date;
  @ApiProperty() @Expose() updatedAt!: Date;
  @ApiProperty({ required: false }) @Expose() userCount?: number;
}
