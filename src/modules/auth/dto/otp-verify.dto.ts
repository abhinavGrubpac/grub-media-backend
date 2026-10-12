import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class OtpVerifyDto {
  @ApiProperty({ example: 'user@grubpac.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '1234' })
  @IsString()
  @Length(4, 4)
  code!: string;
}
