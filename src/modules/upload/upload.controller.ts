import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LogType } from '@prisma/client';
import { memoryStorage } from 'multer';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/services/users.service';
import { OrganizationsService } from '../organizations/services/organizations.service';
import { LogsService } from '../logs/services/logs.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ImageFileValidationPipe } from '../../common/pipes/image-file-validation.pipe';
import { UploadImageDto } from './dto/upload-image.dto';

@ApiTags('Upload')
@ApiBearerAuth()
@Controller({ path: 'upload', version: '1' })
export class UploadController {
  constructor(
    private readonly storage: StorageService,
    private readonly users: UsersService,
    private readonly orgs: OrganizationsService,
    private readonly logs: LogsService,
  ) {}

  /**
   * Single upload endpoint for all image types.
   *
   * type=avatar    → replaces the current user's profile picture; old object deleted from S3.
   * type=org-logo  → uploads the logo and returns the URL (org model wires the FK separately).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload an image (avatar or org logo)',
    description:
      'Accepts `multipart/form-data`. Pass `type=avatar` to update your profile picture ' +
      'or `type=org-logo` with a `targetId` (org ID) to upload an organisation logo.\n\n' +
      '**Allowed:** JPEG · PNG · WebP — max **5 MB**\n\n' +
      '**S3 key format:** `{env}/{type}/{ownerId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}`',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Image file — JPEG, PNG, or WebP, max 5 MB',
        },
        type: {
          type: 'string',
          enum: ['avatar', 'org-logo'],
          description: '"avatar" or "org-logo"',
        },
        targetId: {
          type: 'string',
          description: 'Org ID — required when type is "org-logo"',
        },
      },
    },
  })
  @ResponseMessage('Image uploaded successfully')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(
    @CurrentUser() actor: AuthUser,
    @UploadedFile(new ImageFileValidationPipe()) file: Express.Multer.File,
    @Body() dto: UploadImageDto,
  ): Promise<{ url: string }> {
    if (dto.type === 'avatar') {
      const updated = await this.users.uploadAvatar(actor.id, file);
      return { url: updated.avatarUrl! };
    }

    // org-logo — upload to S3; the org service wires the FK when that module is built.
    if (!dto.targetId) {
      throw new BadRequestException('targetId (org ID) is required for org-logo uploads');
    }
    const url = await this.storage.uploadImage('org-logos', dto.targetId, file);

    // Audit row — best-effort org name so the sentence never carries a raw id;
    // an unknown target must not fail the upload (behaviour stays as before).
    // No old/new detail: this branch only stores the file — the FK write lives
    // in POST /organizations/:id/logo, which logs its own row.
    let orgName: string | null = null;
    try {
      orgName = (await this.orgs.findById(dto.targetId)).name;
    } catch {
      // stays null — unknown target must not fail the upload
    }
    await this.logs.record({
      typeEnum: LogType.EMPLOYEE,
      categoryName: 'Organizations',
      actionName: 'Upload Logo Image',
      actionText: orgName
        ? `A logo image for organization ${orgName} was uploaded`
        : 'A logo image for an organisation was uploaded',
      userId: actor.id,
      target: dto.targetId,
    });
    return { url };
  }
}
