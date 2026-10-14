import { Injectable, Logger } from '@nestjs/common';
import { LogType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import { toCsv } from '../../../common/utils/csv';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ExportRequestDto } from '../dto/log-export-query.dto';
import { LogFilterQueryDto } from '../dto/log-filter-query.dto';
import { LogSearchQueryDto } from '../dto/log-search-query.dto';
import { FilterResponseDTO, LogListResponseDTO, RecordLogInput } from '../dto/log.types';

/** Prefix for the human-shareable ticket code stored in `Log.referenceId`. */
const TICKET_PREFIX = 'TCK';

@Injectable()
export class LogsService {
  /** Sortable columns for log listings (allowlist — client sortBy never reaches Prisma raw). */
  private static readonly SORTABLE_FIELDS = ['createdAt', 'id', 'empId', 'referenceId'] as const;

  /** Columns returned by list/search. Relation fields are brief projections. */
  private static readonly SELECT = {
    id: true,
    typeEnum: true,
    actionText: true,
    userId: true,
    empId: true,
    oldDetail: true,
    newDetail: true,
    referenceId: true,
    createdAt: true,
    category: { select: { id: true, name: true } },
    action: { select: { id: true, name: true } },
  } satisfies Prisma.LogSelect;

  /** Columns streamed into the CSV export (snake_case header names per the design). */
  private static readonly CSV_COLUMNS = [
    'id',
    'created_at',
    'logtype',
    'category',
    'action',
    'action_text',
    'user_id',
    'emp_id',
    'old_detail',
    'new_detail',
    'reference_id',
  ] as const;

  private readonly logger = new Logger(LogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /logs/:logtype — one stream of logs, paginated, sorted desc by default. */
  async list(logtype: LogType, query: PaginationQueryDto): Promise<LogListResponseDTO> {
    return this.paginate({ typeEnum: logtype }, query);
  }

  /** GET /logs/filters?logtype= — categories + actions for the filter panel (V2). */
  async getFilters(logtype: LogType): Promise<FilterResponseDTO> {
    const [categories, actions] = await Promise.all([
      this.prisma.client.logCategory.findMany({
        where: { typeEnum: logtype },
        select: { id: true, typeEnum: true, name: true, image: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.client.logAction.findMany({
        where: { category: { typeEnum: logtype } },
        select: { id: true, categoryId: true, name: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    return { categories, actions };
  }

  /** GET /logs/search — filtered + free-text search, paginated. */
  async search(query: LogSearchQueryDto): Promise<LogListResponseDTO> {
    return this.paginate(this.buildWhere(query), query);
  }

  /**
   * GET /logs/export — same filters as search, but only the rows of the page
   * currently shown in the UI are written to the CSV (page/limit → skip/take).
   */
  async exportCsv(query: ExportRequestDto): Promise<string> {
    const where = this.buildWhere(query);
    const { skip, take } = toSkipTake(query);

    const data = await this.prisma.client.log.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        typeEnum: true,
        actionText: true,
        userId: true,
        empId: true,
        oldDetail: true,
        newDetail: true,
        referenceId: true,
        category: { select: { name: true } },
        action: { select: { name: true } },
      },
    });

    const rows = data.map((row) => [
      row.id,
      row.createdAt,
      row.typeEnum,
      row.category?.name ?? null,
      row.action?.name ?? null,
      row.actionText,
      row.userId,
      row.empId,
      row.oldDetail,
      row.newDetail,
      row.referenceId,
    ]);

    return toCsv(LogsService.CSV_COLUMNS, rows);
  }

  /**
   * WRITE side — records one audit log row. LogsModule is @Global, so any
   * module injects LogsService and calls this directly:
   *   await this.logs.record({ typeEnum, categoryName, actionName, ... })
   * - Category/action are upserted on their unique keys (idempotent).
   * - `actionName` is only used when `categoryName` is set (FK requirement).
   * - NEVER rejects: a failed audit write is warned through pino and swallowed
   *   so it can never break the calling business flow.
   */
  async record(input: RecordLogInput): Promise<void> {
    try {
      const category = input.categoryName
        ? await this.prisma.client.logCategory.upsert({
            where: { name_typeEnum: { name: input.categoryName, typeEnum: input.typeEnum } },
            create: { name: input.categoryName, typeEnum: input.typeEnum },
            update: {},
          })
        : undefined;

      const action =
        category && input.actionName
          ? await this.prisma.client.logAction.upsert({
              where: { name_categoryId: { name: input.actionName, categoryId: category.id } },
              create: { name: input.actionName, categoryId: category.id },
              update: {},
            })
          : undefined;

      const created = await this.prisma.client.log.create({
        data: {
          typeEnum: input.typeEnum,
          categoryId: category?.id ?? null,
          actionId: action?.id ?? null,
          actionText: input.actionText ?? null,
          userId: input.userId ?? null,
          empId: input.empId ?? null,
          oldDetail: this.serializeDetail(input.oldDetail),
          // The caller's business pointer (bundle id, admin id, …) is folded
          // into newDetail.target so it survives — referenceId itself is
          // reserved for the generated ticket code below.
          newDetail: this.serializeDetail(this.withTarget(input.newDetail, input.referenceId)),
          referenceId: null,
        },
      });

      // referenceId = human-shareable ticket derived from the row's own
      // auto-increment id (id 1400 → "TCK-1400"), so a log can always be
      // cited by its ticket. Second write; if it fails the row is still
      // logged (referenceId stays null) and the error is swallowed below.
      await this.prisma.client.log.update({
        where: { id: created.id },
        data: { referenceId: `${TICKET_PREFIX}-${created.id}` },
      });
    } catch (err) {
      this.logger.warn(`record() failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Folds the caller's business pointer into newDetail under `target` so the
   * reference is not lost when referenceId is overwritten by the ticket code.
   * - object detail → spread + target (non-destructive)
   * - string/absent detail → wrapped as { detail?, target }
   */
  private withTarget(detail: unknown, target: string | null | undefined): unknown {
    if (target === null || target === undefined || target === '') {
      return detail;
    }
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      return { ...(detail as Record<string, unknown>), target };
    }
    return detail === undefined || detail === null ? { target } : { detail, target };
  }

  /** Shared count + page query with allowlisted sorting (default createdAt desc). */
  private async paginate(
    where: Prisma.LogWhereInput,
    query: { page: number; limit: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<LogListResponseDTO> {
    const { skip, take } = toSkipTake(query);
    const sortOrder = query.sortOrder ?? 'desc';
    // Second key keeps paging deterministic when the sort column has ties.
    const orderBy: Prisma.LogOrderByWithRelationInput[] = [
      { [this.resolveSortField(query.sortBy)]: sortOrder },
      { id: 'desc' },
    ];

    const [total, data] = await Promise.all([
      this.prisma.client.log.count({ where }),
      this.prisma.client.log.findMany({
        where,
        select: LogsService.SELECT,
        orderBy,
        skip,
        take,
      }),
    ]);
    return { data, meta: buildMeta(total, query.page, query.limit) };
  }

  /** Map a client sortBy to an allowed column; anything else falls back to createdAt. */
  private resolveSortField(sortBy?: string): (typeof LogsService.SORTABLE_FIELDS)[number] {
    const allowed = LogsService.SORTABLE_FIELDS as readonly string[];
    return allowed.includes(sortBy ?? '')
      ? (sortBy as (typeof LogsService.SORTABLE_FIELDS)[number])
      : 'createdAt';
  }

  /**
   * Where clause shared by search + export: logtype scope, UTC date range,
   * category/action id filters and the free-text q (OR across the human
   * readable columns, case-insensitive).
   */
  private buildWhere(query: LogFilterQueryDto): Prisma.LogWhereInput {
    const where: Prisma.LogWhereInput = { typeEnum: query.logtype };

    if (query.start_date || query.end_date) {
      const range: Prisma.DateTimeFilter = {};
      if (query.start_date) {
        range.gte = new Date(`${query.start_date}T00:00:00.000Z`);
      }
      if (query.end_date) {
        range.lte = new Date(`${query.end_date}T23:59:59.999Z`);
      }
      where.createdAt = range;
    }

    if (query.categories?.length) {
      where.categoryId = { in: query.categories };
    }
    if (query.actions?.length) {
      where.actionId = { in: query.actions };
    }

    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { actionText: this.containsInsensitive(q) },
        { referenceId: this.containsInsensitive(q) },
        { userId: this.containsInsensitive(q) },
        { empId: this.containsInsensitive(q) },
        { oldDetail: this.containsInsensitive(q) },
        { newDetail: this.containsInsensitive(q) },
        { action: { name: this.containsInsensitive(q) } },
        { category: { name: this.containsInsensitive(q) } },
      ];
    }

    return where;
  }

  /** Case-insensitive `contains` filter used by the free-text q branches. */
  private containsInsensitive(contains: string): { contains: string; mode: 'insensitive' } {
    return { contains, mode: 'insensitive' };
  }

  /** undefined → null · string → as-is · object → JSON text (columns are TEXT). */
  private serializeDetail(value: unknown): string | null {
    if (value === undefined) {
      return null;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
