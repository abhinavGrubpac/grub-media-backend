import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { BulkRestoreDto, RestoreAllQueryDto } from '../dto/bulk-restore.dto';
import { ReferenceFinalizeDto } from '../dto/reference-finalize.dto';
import { ReferenceLinkDto } from '../dto/reference-link.dto';
import { ReferenceListQueryDto } from '../dto/reference-list-query.dto';
import { ReferenceDocResponseDto } from '../dto/reference-response.dto';
import { ReferenceThumbnailUploadUrlDto } from '../dto/reference-thumbnail-upload.dto';
import { ReferenceUpdateDto } from '../dto/reference-update.dto';
import { ReferenceUploadUrlDto } from '../dto/reference-upload-url.dto';
import { ReferenceService } from '../services/reference.service';

@ApiTags('references')
@ApiBearerAuth()
@Controller({ path: 'references', version: '1' })
export class ReferenceController {
  constructor(private readonly referenceService: ReferenceService) {}

  /** Bare array (no pagination): the UI splits archive tabs client-side. */
  // Aligned to senior auth catalog (users.* only); future keys: 'ref:view' / 'ref:upload' / 'ref:archive'.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get()
  findAll(@Query() query: ReferenceListQueryDto): Promise<ReferenceDocResponseDto[]> {
    return this.referenceService.findAll(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get(':id')
  findOne(@Param('id') id: string): Promise<ReferenceDocResponseDto> {
    return this.referenceService.findOne(id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get(':id/download')
  @ApiOperation({ summary: 'Download URL for a document (presigned S3 GET)' })
  download(@Param('id') id: string): Promise<{ download_url: string; file_url: string }> {
    return this.referenceService.downloadUrl(id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('upload-url')
  @ResponseMessage('Upload URL generated')
  requestUploadUrl(
    @Body() dto: ReferenceUploadUrlDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ upload_url: string; file_key: string }> {
    return this.referenceService.generateUploadUrl(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('thumbnail-upload-url')
  @ResponseMessage('Thumbnail upload URL generated')
  requestThumbnailUploadUrl(
    @Body() dto: ReferenceThumbnailUploadUrlDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ upload_url: string; file_key: string; thumbnail_url_hint: string | null }> {
    return this.referenceService.generateThumbnailUploadUrl(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('finalize')
  @ResponseMessage('Reference document created')
  finalizeUpload(@Body() dto: ReferenceFinalizeDto): Promise<ReferenceDocResponseDto> {
    return this.referenceService.finalizeUpload(dto);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('bulk-restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unarchive a selection of documents at once' })
  @ResponseMessage('Reference documents restored')
  bulkRestore(@Body() dto: BulkRestoreDto): Promise<{ restored: number }> {
    return this.referenceService.bulkRestore(dto.ids);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('restore-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unarchive all archived documents at once' })
  @ResponseMessage('All archived documents restored')
  restoreAll(@Query() query: RestoreAllQueryDto): Promise<{ restored: number }> {
    return this.referenceService.restoreAll(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: ReferenceUpdateDto,
  ): Promise<ReferenceDocResponseDto> {
    return this.referenceService.update(id, dto);
  }

  /** Soft delete: the document is archived, never removed. */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Delete(':id')
  @ResponseMessage('Reference document archived')
  archive(@Param('id') id: string): Promise<ReferenceDocResponseDto> {
    return this.referenceService.archive(id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Delete(':id/permanent')
  @ResponseMessage('Reference document permanently deleted')
  hardDelete(@Param('id') id: string): Promise<null> {
    return this.referenceService.hardDelete(id).then(() => null);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post(':id/restore')
  @ResponseMessage('Reference document restored')
  restore(@Param('id') id: string): Promise<ReferenceDocResponseDto> {
    return this.referenceService.restore(id);
  }

  /** Links a document to a creative version to justify a review decision. */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('link')
  @ResponseMessage('Reference linked to version')
  linkToCreative(
    @Body() dto: ReferenceLinkDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ version_id: string; doc_id: string }> {
    return this.referenceService.linkToCreative(dto, user.id);
  }
}
