import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ProfileOtpVerifyDto {
  @ApiProperty({ enum: ['email', 'phone'] })
  @IsIn(['email', 'phone'])
  type!: 'email' | 'phone';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(254) value!: string;
  @ApiProperty({ example: '1234' }) @IsString() @Length(4, 4) code!: string;
}
