import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ProfileOtpVerifyDto {
  @ApiProperty({ enum: ['email', 'phone'] })
  @IsIn(['email', 'phone'])
  type!: 'email' | 'phone';

  @ApiProperty({
    description: 'The same email or phone you submitted in the OTP request step',
    example: 'new@example.com',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  @ValidateIf((o: ProfileOtpVerifyDto) => o.type === 'email')
  @IsEmail({}, { message: 'value must be a valid email address' })
  @ValidateIf((o: ProfileOtpVerifyDto) => o.type === 'phone')
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'value must be a valid phone number with country code (e.g. +919876543210)',
  })
  value!: string;

  @ApiProperty({ example: '1234', description: '4-digit OTP sent to the new contact' })
  @IsString()
  @Length(4, 4, { message: 'code must be exactly 4 digits' })
  code!: string;
}
