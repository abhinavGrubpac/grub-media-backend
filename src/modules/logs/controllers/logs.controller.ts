import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
 */
@ApiTags('Logs')
@ApiBearerAuth()
@RequirePermissions('logs.read')
@Controller({ path: 'logs', version: '1' })
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get('filters')
  @ApiOperation({ summary: 'Categories + actions for the log filter panel' })
  @ResponseMessage('Log filters fetched successfully')
  getFilters(@Query() query: LogFiltersQueryDto): Promise<FilterResponseDTO> {
    return this.logs.getFilters(query.logtype);
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search logs by free text, date range, categories and actions',
    description:
      'Case-insensitive q over action text, ids and details. Dates are ' +
      'inclusive UTC days (YYYY-MM-DD). categories/actions are comma-separated ids.',
  })
  @ResponseMessage('Logs fetched successfully')
  search(@Query() query: LogSearchQueryDto): Promise<LogListResponseDTO> {
    return this.logs.search(query);
  }

  @Get('export')
  @SkipResponseWrap()
  @ApiOperation({
    summary: 'Export the logs of the current page as CSV',
    description: 'Same filters as search — page/limit select which rows are written to the CSV.',
  })
  async exportGet(
    @Query() query: ExportRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    return this.streamCsv(query, res);
  }

  /** Shared CSV response writer: sets the attachment headers and streams the body. */
  private async streamCsv(query: ExportRequestDto, res: Response): Promise<string> {
    const csv = await this.logs.exportCsv(query);
    const filename = `logs-${query.logtype.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  @Get(':logtype')
  @ApiOperation({ summary: 'List one log stream, newest first (page, limit)' })
  @ResponseMessage('Logs fetched successfully')
  list(
    @Param('logtype', ParseLogTypePipe) logtype: LogType,
    @Query() query: PaginationQueryDto,
  ): Promise<LogListResponseDTO> {
    return this.logs.list(logtype, query);
  }
}
