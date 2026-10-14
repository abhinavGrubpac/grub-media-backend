import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { SkipResponseWrap } from '../../../common/decorators/skip-response-wrap.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdvertExportQueryDto } from '../dto/advert-export-query.dto';
import { AdvertListQueryDto } from '../dto/advert-list-query.dto';
import { AdvertBrandGroupDto, AdvertResponseDto } from '../dto/advert-response.dto';
import { AdvertSearchQueryDto } from '../dto/advert-search-query.dto';
import { AdvertStatusDto } from '../dto/advert-status.dto';
import type {
  AdvertImageSearchResult,
  AdvertSearchResult,
  RecentAdvertSearch,
} from '../services/advert.service';
import type { StandardMeta } from '../../../common/utils/paginate';
import { IMAGE_UPLOAD_MAX_BYTES } from '../image-hash';
import { AdvertService } from '../services/advert.service';

@ApiTags('adverts')
@ApiBearerAuth()
@Controller({ path: 'adverts', version: '1' })
export class AdvertController {
  constructor(private readonly advertService: AdvertService) {}

  /** Radius search; without lat/lng falls back to a plain filtered list. */
  // Future permission: 'advert:geo_search'.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get('search')
  search(
    @Query() query: AdvertSearchQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdvertSearchResult> {
    return this.advertService.searchByRadius({ ...query, actor_id: user.id });
  }

  /** 7-day revisit window: this operator's recent searches, newest first. */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get('searches/recent')
  recentSearches(@CurrentUser() user: AuthUser): Promise<RecentAdvertSearch[]> {
    return this.advertService.listRecentSearches(user.id);
  }

  /**
   * Reverse-image search: upload a PNG/JPEG and match adverts by visual
   * similarity (dHash Hamming distance, nearest first). Exact duplicates
   * land at distance 0. Only adverts with a stored image_hash participate.
   */
  // Future permission: 'advert:geo_search'.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Post('search/by-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, done) => {
        if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
          done(null, true);
        } else {
          done(new BadRequestException('image must be a PNG or JPEG file'), false);
        }
      },
    }),
  )
  searchByImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Query('max_distance') maxDistance?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<AdvertImageSearchResult> {
    if (!file) {
      throw new BadRequestException('image file is required');
    }
    return this.advertService.searchByImage(file.buffer, {
      max_distance: maxDistance !== undefined ? Number(maxDistance) : undefined,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      actor_id: user.id,
    });
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get()
  findAll(
    @Query() query: AdvertListQueryDto,
  ): Promise<
    | { items: AdvertResponseDto[]; meta: StandardMeta }
    | { items: AdvertBrandGroupDto[]; meta: StandardMeta }
  > {
    return this.advertService.findAll(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @SkipResponseWrap()
  @Get('export')
  async export(@Res() res: Response, @Query() query: AdvertExportQueryDto): Promise<void> {
    const rows = await this.advertService.exportAdverts(query);
    const escape = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((row) =>
      [
        row.id,
        row.version_id,
        row.creative,
        row.brand,
        row.status,
        row.address,
        row.location,
        row.radius_km,
        row.start_date.toISOString(),
        row.end_date.toISOString(),
        row.city,
        row.zone,
      ]
        .map(escape)
        .join(','),
    );
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=adverts_export.csv',
      })
      .send(
        [
          'id,version_id,creative,brand,status,address,location,radius_km,start_date,end_date,city,zone',
          ...lines,
        ].join('\n'),
      );
  }

  /** Government compliance status change (pause/revoke via the govt matrix). */
  // Future permission: 'advert:revoke'.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch(':id/status')
  @ResponseMessage('Advert status updated')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: AdvertStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdvertResponseDto> {
    return this.advertService.updateStatus(id, dto.status, user.id, dto.expected_status);
  }

  /** Spec-shape alias of PATCH /:id/status. */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch(':id')
  @ResponseMessage('Advert status updated')
  updateStatusAlias(
    @Param('id') id: string,
    @Body() dto: AdvertStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdvertResponseDto> {
    return this.advertService.updateStatus(id, dto.status, user.id, dto.expected_status);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get(':id')
  findOne(@Param('id') id: string): Promise<AdvertResponseDto> {
    return this.advertService.findOne(id);
  }
}
