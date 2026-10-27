import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReviewStatus } from '@prisma/client';
import { StandardMeta } from '../../../common/utils/paginate';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { SkipResponseWrap } from '../../../common/decorators/skip-response-wrap.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreativeExportQueryDto } from '../dto/creative-export-query.dto';
import { BulkTakeActionDto } from '../dto/bulk-action.dto';
import { CreativeFinalizeDto } from '../dto/creative-finalize.dto';
import { CreativeQueryDto } from '../dto/creative-query.dto';
import { CreativeUploadRequestDto } from '../dto/creative-upload-request.dto';
import { CreativeResponseDto, CreativeVersionResponseDto } from '../dto/creative-response.dto';
import { CreateCreativeDto } from '../dto/create-creative.dto';
import { TakeActionDto } from '../dto/take-action.dto';
import { UploadVersionDto } from '../dto/upload-version.dto';
import { ExportService } from '../services/export.service';
import { CreativePdfService } from '../services/creative-pdf.service';
import { CreativeService } from '../services/review.service';

@ApiTags('creatives')
@ApiBearerAuth()
@Controller({ path: 'creatives', version: '1' })
export class ReviewController {
  constructor(
    private readonly creativeService: CreativeService,
    private readonly exportService: ExportService,
    private readonly pdfService: CreativePdfService,
  ) {}

  // Aligned to senior auth catalog (users.* only): use @Roles here.
  // Future permission mapping once catalog grows:
  // view/history/export -> 'creative:view', upload -> 'creative:upload', action -> 'creative:review'.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get()
  findAll(@Query() query: CreativeQueryDto): Promise<{
    items: (CreativeResponseDto & { versions?: CreativeVersionResponseDto[] })[];
    meta: StandardMeta;
  }> {
    return this.creativeService.findAll(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @SkipResponseWrap()
  @Get('export')
  async export(@Res() res: Response, @Query() query: CreativeExportQueryDto): Promise<void> {
    const rows = await this.exportService.exportCreatives(query);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === 'csv') {
      res
        .status(200)
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="creative_review_report_${date}.csv"`,
        })
        .send(this.toCsv(rows));
      return;
    }

    const pdf = await this.pdfService.render(rows, {
      status: query.status,
      industry: query.industry,
      search: query.search,
      startDate: query.startDate,
      endDate: query.endDate,
      generatedAt: new Date(),
    });
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="creative_review_report_${date}.pdf"`,
        'Content-Length': String(pdf.length),
      })
      .send(pdf);
  }

  /**
   * Flat CSV fallback (one row per version). The PDF is the business
   * document; CSV remains for spreadsheet users and existing automation.
   */
  private toCsv(rows: Awaited<ReturnType<ExportService['exportCreatives']>>): string {
    const escape = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = [
      'creative_id',
      'creative_name',
      'brand',
      'industry',
      'media_name',
      'agency',
      'location',
      'uploaded_on',
      'last_action_by',
      'last_action_at',
      'approval_status',
      'version',
      'version_status',
      'version_media_name',
      'version_file_size_bytes',
      'version_uploaded_on',
      'version_uploaded_by',
      'version_last_action',
      'version_last_action_by',
      'version_reason',
      'version_comments',
    ];
    const lines: string[] = [];
    for (const row of rows) {
      const shared = [
        row.id,
        row.creative_name,
        row.brand_name,
        row.industry ?? '',
        row.media_name ?? '',
        row.agency_name ?? '',
        row.location ?? '',
        row.uploaded_on?.toISOString() ?? '',
        row.last_action_by ?? '',
        row.last_action_at?.toISOString() ?? '',
        row.approval_status,
      ];
      if (row.versions.length === 0) {
        lines.push([...shared, '', '', '', '', '', '', '', '', '', ''].map(escape).join(','));
        continue;
      }
      for (const version of row.versions) {
        lines.push(
          [
            ...shared,
            version.version_number,
            version.status,
            version.media_name ?? '',
            version.file_size_bytes ?? '',
            version.uploaded_on?.toISOString() ?? '',
            version.uploaded_by ?? '',
            version.last_action ?? '',
            version.last_action_by ?? '',
            version.reason ?? '',
            version.comments ?? '',
          ]
            .map(escape)
            .join(','),
        );
      }
    }
    return [header.join(','), ...lines].join('\n');
  }

  /**
   * Filter-modal support data (locations, actioners, per-creative geo).
   * NOTE: static single-segment GET routes (`export` above, `filter-options`
   * here) must stay declared BEFORE the parameterized GET route below
   * (`:id`); otherwise `/filter-options` is captured as `:id` and answers
   * "Creative with ID filter-options not found".
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get('filter-options')
  filterOptions(): Promise<{
    locations: string[];
    actioners: string[];
    geo: Record<string, string[]>;
  }> {
    return this.creativeService.filterOptions();
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get(':id')
  getCreative(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<CreativeResponseDto> {
    return this.creativeService.getCreative(id, user.id);
  }

  /**
   * S3 presigned upload handshake (API_SPECIFICATION.md §4). The client PUTs
   * file bytes to upload_url, then calls finalize.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('upload')
  @ResponseMessage('Upload URL issued')
  requestUploadUrl(
    @Body() dto: CreativeUploadRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ upload_url: string; s3_key: string; file_url: string }> {
    return this.creativeService.requestUploadUrl(dto, user.id);
  }

  /** Confirms a client upload (creates the creative or a new version). */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('finalize')
  @ResponseMessage('Upload finalized')
  finalizeUpload(
    @Body() dto: CreativeFinalizeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreativeResponseDto | CreativeVersionResponseDto> {
    return this.creativeService.finalizeUpload(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post()
  @ResponseMessage('Creative created')
  createCreative(
    @Body() dto: CreateCreativeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreativeResponseDto> {
    return this.creativeService.createCreative(dto, user.id);
  }

  /**
   * Multi-select bulk review decision (Review screen): applies the same
   * action to a selection of versions in ONE call instead of N ×
   * POST /:versionId/action. Shared validation 400s up front; versions that
   * cannot accept the action are skipped with a per-id reason.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('bulk-action')
  @ResponseMessage('Bulk review decisions applied')
  bulkAction(
    @Body() dto: BulkTakeActionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{
    applied: { version_id: string; new_status: ReviewStatus }[];
    skipped: { version_id: string; reason: string }[];
  }> {
    return this.creativeService.bulkAction(
      {
        action: dto.action,
        comments: dto.comments,
        reason: dto.reason,
        version_ids: dto.version_ids,
      },
      user.id,
    );
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post(':id/version')
  @ResponseMessage('Creative version uploaded')
  uploadVersion(
    @Param('id') id: string,
    @Body() dto: UploadVersionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ version: CreativeVersionResponseDto; replayed: boolean }> {
    return this.creativeService.uploadVersion(id, dto, user.id);
  }

  /**
   * Records a review decision on a version. Comments are mandatory for
   * REJECT / REQUEST_CHANGES; decisions cascade advert revocations.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post(':versionId/action')
  @ResponseMessage('Review decision recorded')
  takeAction(
    @Param('versionId') versionId: string,
    @Body() dto: TakeActionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreativeVersionResponseDto> {
    return this.creativeService.takeAction(versionId, dto, user.id);
  }
}
