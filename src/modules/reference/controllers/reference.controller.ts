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
import { BulkSelectionDto } from '../dto/bulk-selection.dto';

import { ReferenceFinalizeDto } from '../dto/reference-finalize.dto';
import { ReferenceListQueryDto } from '../dto/reference-list-query.dto';
import { ReferenceDocResponseDto } from '../dto/reference-response.dto';
import { ReferenceUpdateDto } from '../dto/reference-update.dto';
import { ReferenceUploadUrlDto } from '../dto/reference-upload-url.dto';
import { ReferenceService } from '../services/reference.service';

/**
 * Route order matters: Express matches in declaration order, so every
 * static/bulk path is declared BEFORE the single-segment dynamic routes
 * (`/:id`). Otherwise `DELETE /bulk-hard-delete` would be swallowed by
 * `DELETE /:id` and treated as a document id.
 */
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
  @Post('upload-url')
  @ResponseMessage('Upload URL generated')
  requestUploadUrl(
    @Body() dto: ReferenceUploadUrlDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ upload_url: string; file_key: string; file_url: string }> {
    return this.referenceService.generateUploadUrl(dto, user.id);
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

  /**
   * Multi-select soft archive (documents tab): one call instead of
   * N × DELETE /:id. Already-archived/missing ids are excluded from the
   * write and reflected in the counts.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('bulk-archive')
  @ApiOperation({ summary: 'Archive a selection of documents at once' })
  @ResponseMessage('Reference documents archived')
  bulkArchive(@Body() dto: BulkSelectionDto): Promise<{ archived: number }> {
    return this.referenceService.bulkArchive(dto.ids);
  }

  /**
   * REST alias of POST /bulk-archive. Declared before `DELETE /:id` so the
   * literal path is never mistaken for a document id.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Delete('bulk-archive')
  @ApiOperation({ summary: 'Archive a selection of documents at once (DELETE alias)' })
  @ResponseMessage('Reference documents archived')
  bulkArchiveDeleteAlias(@Body() dto: BulkSelectionDto): Promise<{ archived: number }> {
    return this.referenceService.bulkArchive(dto.ids);
  }

  /**
   * Multi-select permanent delete: one call instead of N ×
   * DELETE /:id/permanent. Docs that still justify review decisions are
   * skipped with a reason.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('bulk-hard-delete')
  @ApiOperation({ summary: 'Permanently delete a selection of documents at once' })
  @ResponseMessage('Reference documents permanently deleted')
  bulkHardDelete(
    @Body() dto: BulkSelectionDto,
  ): Promise<{ deleted: number; skipped: { id: string; reason: string }[] }> {
    return this.referenceService.bulkHardDelete(dto.ids);
  }

  /**
   * REST alias of POST /bulk-hard-delete. Declared before `DELETE /:id` so
   * `DELETE /references/bulk-hard-delete` reaches the bulk handler instead of
   * archiving a document whose id is the literal string "bulk-hard-delete".
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Delete('bulk-hard-delete')
  @ApiOperation({
    summary: 'Permanently delete a selection of documents at once (DELETE alias)',
  })
  @ResponseMessage('Reference documents permanently deleted')
  bulkHardDeleteDeleteAlias(
    @Body() dto: BulkSelectionDto,
  ): Promise<{ deleted: number; skipped: { id: string; reason: string }[] }> {
    return this.referenceService.bulkHardDelete(dto.ids);
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
}
