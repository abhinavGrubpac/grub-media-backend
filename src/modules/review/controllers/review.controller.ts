import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Paginated } from '../../../common/dto/paginated';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CreativeExportQueryDto } from '../dto/creative-export-query.dto';
import { CreativeQueryDto } from '../dto/creative-query.dto';
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

  @RequirePermissions('creative:view')
  @Get()
  findAll(@Query() query: CreativeQueryDto): Promise<Paginated<CreativeResponseDto>> {
    return this.creativeService.findAll(query);
  }

  @RequirePermissions('creative:view')
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
        'Content-Disposition': 'attachment; filename=creatives_export.csv',
      })
      .send(['id,name,brand,status,version,uploaded_on', ...lines].join('\n'));
  }

  @RequirePermissions('creative:view')
  @Get(':id/history')
  async getHistory(
    @Param('id') id: string,
  ): Promise<{ creative: CreativeResponseDto; versions: CreativeVersionResponseDto[] }> {
    return this.creativeService.getHistory(id);
  }

  @RequirePermissions('creative:upload')
  @Post()
  @ResponseMessage('Creative created')
  createCreative(
    @Body() dto: CreateCreativeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CreativeResponseDto> {
    return this.creativeService.createCreative(dto, user.id);
  }

  @RequirePermissions('creative:upload')
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
  @RequirePermissions('creative:review')
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
