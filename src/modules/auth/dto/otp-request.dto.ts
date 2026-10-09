import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class OtpRequestDto {
  @ApiProperty({ example: 'user@grubpac.com' })
  @IsEmail()
  email!: string;
}
