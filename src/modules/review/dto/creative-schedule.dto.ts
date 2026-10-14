import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreativeScheduleInputDto {
  @ApiProperty({ description: 'Latitude of the site', minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ description: 'Longitude of the site', minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ description: 'Human-readable site address', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address_text?: string;

  @ApiProperty({ description: 'Schedule start (ISO 8601, date + time)' })
  @Type(() => Date)
  @IsDate()
  start_date!: Date;

  @ApiProperty({ description: 'Schedule end (ISO 8601, date + time)' })
  @Type(() => Date)
  @IsDate()
  end_date!: Date;

  @ApiPropertyOptional({ description: 'Display city from upstream', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  city_name?: string;

  @ApiPropertyOptional({ description: 'Display zone from upstream', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  zone_name?: string;

  @ApiPropertyOptional({
    description: 'Coverage radius in km for map display',
    minimum: 0.01,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(500)
  radius?: number;
}
