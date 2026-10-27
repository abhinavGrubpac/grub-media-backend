import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Paginated } from '../../../common/dto/paginated';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { SkipResponseWrap } from '../../../common/decorators/skip-response-wrap.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { BrandFlagDto } from '../dto/brand-flag.dto';
import { BrandBulkFlagDto } from '../dto/brand-bulk-flag.dto';
import { BrandKillDto } from '../dto/brand-kill.dto';
import { BrandOptionDto, BrandOptionsQueryDto } from '../dto/brand-options.dto';
import { BrandQueryDto } from '../dto/brand-query.dto';
import { BrandResponseDto } from '../dto/brand-response.dto';
import { CreateBrandDto } from '../dto/create-brand.dto';
import { UpdateBrandDto } from '../dto/update-brand.dto';
import { BrandService } from '../services/brand.service';

@ApiTags('brands')
@ApiBearerAuth()
@Controller({ path: 'brands', version: '1' })
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  // Aligned to senior auth catalog (users.* only): role-based access here.
  // Future mapping: view -> 'brand:view', mutations -> 'brand:edit', kill -> 'brand:kill'.
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get()
  findAll(@Query() query: BrandQueryDto): Promise<Paginated<BrandResponseDto>> {
    return this.brandService.findAll(query);
  }

  /**
   * CSV export (same filter set as list): all / filtered / flagged /
   * unflagged / auto-approve on-off / activity active-stopped.
   * Static routes stay before `:id` so `export` is never captured as an id.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @SkipResponseWrap()
  @Get('export/csv')
  async exportCsv(@Query() query: BrandQueryDto, @Res() res: Response): Promise<void> {
    const rows = await this.brandService.exportBrands(query);
    const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = rows.map((row) =>
      [
        row.id,
        row.brand_name,
        row.industry_category,
        row.contact_email,
        row.is_active ? 'active' : 'stopped',
        row.auto_approve ? 'on' : 'off',
        row.is_flagged ? 'flagged' : 'unflagged',
        row.agency_name,
        row.updated_at.toISOString(),
      ]
        .map(esc)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="brands.csv"');
    res.send(
      [
        'id,brand_name,industry_category,contact_email,activity,auto_approval,flag_status,agency_name,updated_at',
        ...lines,
      ].join('\n'),
    );
  }

  /** Distinct industry categories for the filter dropdown. */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get('industries')
  industries(): Promise<string[]> {
    return this.brandService.industries();
  }

  /**
   * Minimal unpaginated brand list for creative-review dropdowns.
   * Static route stays before `:id` so `options` is never captured as an id.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get('options')
  brandOptions(@Query() query: BrandOptionsQueryDto): Promise<BrandOptionDto[]> {
    return this.brandService.brandOptions(query);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.EMPLOYEE)
  @Get(':id')
  findOne(@Param('id') id: string): Promise<BrandResponseDto> {
    return this.brandService.findOne(id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateBrandDto): Promise<BrandResponseDto> {
    return this.brandService.create(dto);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBrandDto): Promise<BrandResponseDto> {
    return this.brandService.update(id, dto);
  }

  /**
   * Multi-select bulk flag/unflag: one call instead of N × POST /:id/flag.
   * Same compliance rules as setFlag; rows already in the target state or
   * stopped are skipped with a reason in the response, not a batch failure.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('bulk-flag')
  @ApiOperation({ summary: 'Flag or unflag a selection of brands in one call' })
  bulkFlag(
    @Body() dto: BrandBulkFlagDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ applied: number; skipped: { id: string; reason: string }[] }> {
    return this.brandService.bulkFlag(dto.ids, dto.is_flagged, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post(':id/flag')
  setFlag(
    @Param('id') id: string,
    @Body() dto: BrandFlagDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BrandResponseDto> {
    return this.brandService.setFlag(id, dto.is_flagged ?? true, user.id);
  }

  /**
   * Spec route for the global kill-switch (POST /brands/:id/kill).
   * Deactivation cascades brand adverts to REVOKED.
   */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post(':id/kill')
  @ResponseMessage('Brand kill-switch applied')
  killSwitchPost(
    @Param('id') id: string,
    @Body() dto: BrandKillDto,
  ): Promise<{ brand: BrandResponseDto; revoked_adverts_count: number }> {
    return this.brandService.killSwitch(id, dto.is_active ?? false);
  }

  /** Legacy alias of POST /:id/kill kept for compatibility with early clients. */
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Put(':id/kill')
  @ResponseMessage('Brand kill-switch applied')
  killSwitch(
    @Param('id') id: string,
    @Body() dto: BrandKillDto,
  ): Promise<{ brand: BrandResponseDto; revoked_adverts_count: number }> {
    return this.brandService.killSwitch(id, dto.is_active ?? false);
  }
}
