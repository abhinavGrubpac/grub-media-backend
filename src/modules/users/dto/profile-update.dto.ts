import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class ProfileUpdateDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'firstName must not be blank' })
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'lastName must not be blank' })
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({ description: 'HTTPS URL to a profile image', maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'logoUrl must be a valid HTTPS URL' },
  )
  logoUrl?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(100)
  jurisdiction?: string;
}
