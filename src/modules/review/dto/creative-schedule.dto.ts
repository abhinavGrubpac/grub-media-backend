import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TIME_OF_DAY_PATTERN } from '../../advert/validators';

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

  @ApiPropertyOptional({
    description:
      'Recurring daily display window start (HH:mm). Supply together with time_slot_end.',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'time_slot_start must be HH:mm (00:00-23:59)' })
  time_slot_start?: string;

  @ApiPropertyOptional({
    description:
      'Recurring daily display window end (HH:mm). Supply together with time_slot_start.',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: 'time_slot_end must be HH:mm (00:00-23:59)' })
  time_slot_end?: string;

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
    description: 'Coverage radius in metres for map display',
    minimum: 1,
    maximum: 500000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500000)
  radius?: number;
}
