import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LogType } from '@prisma/client';
import type { Response } from 'express';
import { LogsService } from '../services/logs.service';
import { ParseLogTypePipe } from '../pipes/parse-log-type.pipe';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { LogFiltersQueryDto } from '../dto/log-filters-query.dto';
import { LogSearchQueryDto } from '../dto/log-search-query.dto';
import { ExportRequestDto } from '../dto/log-export-query.dto';
import { FilterResponseDTO, LogListResponseDTO } from '../dto/log.types';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { SkipResponseWrap } from '../../../common/decorators/skip-response-wrap.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';

/**
 * Log System V2 endpoints (see `logs Grubmedia .drawio.pdf`):
 *
 *  1. GET /api/v1/logs/:logtype        page, limit (sorted default desc)
 *  2. GET /api/v1/logs/filters?logtype categories + actions for the filter panel
 *  3. GET /api/v1/logs/search          q, logtype, page, limit, start_date, end_date, categories, actions
 *  4. GET /api/v1/logs/export    logtype, start_date, end_date, categories, actions, q, page, limit → CSV
 *                                 (only the rows of the current page are exported)
 *
 * Every route requires a valid JWT plus the `logs.read` permission
 * (SUPER_ADMIN/ADMIN). Static routes are declared before `:logtype` so
 * Nest never matches them as a logtype param.
 *
 * Each read is itself audited into the SYSTEM stream under the
 * 'Log Access' category — the read is recorded AFTER the page is built, so the
 * response never contains its own audit row (later requests will see it).
 */
@ApiTags('Logs')
@ApiBearerAuth()
@RequirePermissions('logs.read')
@Controller({ path: 'logs', version: '1' })
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  /** Audit a read of the log endpoints (SYSTEM / Log Access). */
  private auditRead(u: AuthUser, actionName: string, actionText: string): Promise<void> {
    return this.logs.record({
      typeEnum: LogType.SYSTEM,
      categoryName: 'Log Access',
      actionName,
      actionText,
      userId: u.id,
    });
  }

  @Get('filters')
  @ApiOperation({ summary: 'Categories + actions for the log filter panel' })
  @ResponseMessage('Log filters fetched successfully')
  async getFilters(
    @Query() query: LogFiltersQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<FilterResponseDTO> {
    const filters = await this.logs.getFilters(query.logtype);
    await this.auditRead(
      u,
      'View Log Filters',
      `Viewed the filter options for the ${query.logtype.toLowerCase()} logs`,
    );
    return filters;
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search logs by free text, date range, categories and actions',
    description:
      'Case-insensitive q over action text, action/category names, ids and ' +
      'details. Dates are inclusive UTC days (YYYY-MM-DD). categories = ' +
      'comma-separated category ids, actions = comma-separated action names.',
  })
  @ResponseMessage('Logs fetched successfully')
  async search(
    @Query() query: LogSearchQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<LogListResponseDTO> {
    const result = await this.logs.search(query);
    // Note: the sentence must not embed the search term itself — audit rows
    // are free-text searchable, and a row repeating the term would match every
    // later search for it (breaking search/export parity).
    await this.auditRead(u, 'Search Logs', `Searched the ${query.logtype.toLowerCase()} logs`);
    return result;
  }

  @Get('export')
  @SkipResponseWrap()
  @ApiOperation({
    summary: 'Export the logs of the current page as CSV',
    description: 'Same filters as search — page/limit select which rows are written to the CSV.',
  })
  async exportGet(
    @Query() query: ExportRequestDto,
    @CurrentUser() u: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    return this.streamCsv(query, res, u);
  }

  /** Shared CSV response writer: sets the attachment headers and streams the body. */
  private async streamCsv(query: ExportRequestDto, res: Response, u: AuthUser): Promise<string> {
    const csv = await this.logs.exportCsv(query);
    await this.auditRead(
      u,
      'Export Logs',
      `Downloaded the ${query.logtype.toLowerCase()} logs as a CSV file`,
    );
    const filename = `logs-${query.logtype.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  /** Shared list handler: build the page, then audit the read. */
  private async listStream(
    logtype: LogType,
    query: PaginationQueryDto,
    u: AuthUser,
  ): Promise<LogListResponseDTO> {
    const result = await this.logs.list(logtype, query);
    await this.auditRead(u, 'View Logs', `Viewed the ${logtype.toLowerCase()} logs`);
    return result;
  }

  // Explicit per-stream routes mirror the documented endpoints and give each
  // stream its own Swagger entry. They are declared before `:logtype` so Nest
  // matches them first; `:logtype` still handles any other casing (e.g.
  // lowercase `system`) via ParseLogTypePipe.

  @Get('SYSTEM')
  @ApiOperation({ summary: 'List the SYSTEM log stream, newest first (page, limit)' })
  @ResponseMessage('Logs fetched successfully')
  listSystem(
    @Query() query: PaginationQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<LogListResponseDTO> {
    return this.listStream(LogType.SYSTEM, query, u);
  }

  @Get('ACTIVITY')
  @ApiOperation({ summary: 'List the ACTIVITY log stream, newest first (page, limit)' })
  @ResponseMessage('Logs fetched successfully')
  listActivity(
    @Query() query: PaginationQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<LogListResponseDTO> {
    return this.listStream(LogType.ACTIVITY, query, u);
  }

  @Get('EMPLOYEE')
  @ApiOperation({ summary: 'List the EMPLOYEE log stream, newest first (page, limit)' })
  @ResponseMessage('Logs fetched successfully')
  listEmployee(
    @Query() query: PaginationQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<LogListResponseDTO> {
    return this.listStream(LogType.EMPLOYEE, query, u);
  }

  @Get(':logtype')
  @ApiOperation({ summary: 'List one log stream, newest first (page, limit)' })
  @ApiParam({ name: 'logtype', enum: LogType, description: 'Case-insensitive log stream' })
  @ResponseMessage('Logs fetched successfully')
  async list(
    @Param('logtype', ParseLogTypePipe) logtype: LogType,
    @Query() query: PaginationQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<LogListResponseDTO> {
    return this.listStream(logtype, query, u);
  }
}
