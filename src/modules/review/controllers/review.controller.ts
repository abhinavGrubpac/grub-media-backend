import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { StandardMeta } from '../../../common/utils/paginate';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { SkipResponseWrap } from '../../../common/decorators/skip-response-wrap.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreativeExportQueryDto } from '../dto/creative-export-query.dto';
import { CreativeFinalizeDto } from '../dto/creative-finalize.dto';
import { CreativeQueryDto } from '../dto/creative-query.dto';
import { CreativeUploadRequestDto } from '../dto/creative-upload-request.dto';
import { CreativeResponseDto, CreativeVersionResponseDto } from '../dto/creative-response.dto';
import { CreateCreativeDto } from '../dto/create-creative.dto';
import { TakeActionDto } from '../dto/take-action.dto';
import { UploadVersionDto } from '../dto/upload-version.dto';
import { ExportService } from '../services/export.service';
import { CreativeService } from '../services/review.service';

@ApiTags('creatives')
@ApiBearerAuth()
@Controller({ path: 'creatives', version: '1' })
export class ReviewController {
  constructor(
    private readonly creativeService: CreativeService,
    private readonly exportService: ExportService,
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
    const escape = (value: unknown): string => `"${String(value).replace(/"/g, '""')}"`;
    const lines = rows.map((row) =>
      [row.id, row.name, row.brand, row.status, row.version, row.uploadedOn?.toISOString() ?? '']
        .map(escape)
        .join(','),
    );
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="creative_review_report.csv"',
      })
      .send(['id,name,brand,status,version,uploaded_on', ...lines].join('\n'));
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
