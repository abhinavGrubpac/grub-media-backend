import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ProfileOtpRequestDto {
  @ApiProperty({ enum: ['email', 'phone'], description: 'Whether you are changing email or phone' })
  @IsIn(['email', 'phone'])
  type!: 'email' | 'phone';

  @ApiProperty({
    description:
      'New email address (when type=email) or phone number with country code (when type=phone, e.g. +919876543210)',
    example: 'new@example.com',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @ValidateIf((o: ProfileOtpRequestDto) => o.type === 'email')
  @IsEmail({}, { message: 'value must be a valid email address' })
  @ValidateIf((o: ProfileOtpRequestDto) => o.type === 'phone')
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'value must be a valid phone number with country code (e.g. +919876543210)',
  })
  value!: string;
}
