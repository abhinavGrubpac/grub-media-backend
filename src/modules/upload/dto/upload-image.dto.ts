import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export type UploadTargetType = 'avatar' | 'org-logo';

export class UploadImageDto {
  @ApiProperty({
    enum: ['avatar', 'org-logo'],
    description:
      '"avatar" — updates the current user\'s profile picture. ' +
      '"org-logo" — uploads an organisation logo (targetId required).',
  })
  @IsEnum(['avatar', 'org-logo'], { message: 'type must be "avatar" or "org-logo"' })
  type!: UploadTargetType;

  @ApiPropertyOptional({
    description: 'Required for org-logo: the organisation ID to attach the logo to.',
  })
  @IsOptional()
  @IsString()
  targetId?: string;
}
