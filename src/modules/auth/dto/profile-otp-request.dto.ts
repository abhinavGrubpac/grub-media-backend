import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class ProfileOtpRequestDto {
  @ApiProperty({ enum: ['email', 'phone'] })
  @IsIn(['email', 'phone'])
  type!: 'email' | 'phone';
  @ApiProperty({ description: 'New email or phone number' })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  value!: string;
}
