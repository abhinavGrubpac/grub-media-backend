import { Injectable, Logger } from '@nestjs/common';
import { LogType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { markRequestAudited, setAuditSink } from '../../../common/audit/request-audit';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import { toCsv } from '../../../common/utils/csv';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ExportRequestDto } from '../dto/log-export-query.dto';
import { LogFilterQueryDto } from '../dto/log-filter-query.dto';
import { LogSearchQueryDto } from '../dto/log-search-query.dto';
import { FilterResponseDTO, LogListResponseDTO, RecordLogInput } from '../dto/log.types';

@Injectable()
export class LogsService {
  /** Sortable columns for log listings (allowlist — client sortBy never reaches Prisma raw). */
  private static readonly SORTABLE_FIELDS = ['createdAt', 'id', 'empId'] as const;

  /** Columns returned by list/search. The category is a brief projection. */
  private static readonly SELECT = {
    id: true,
    typeEnum: true,
    actionName: true,
    actionText: true,
    userId: true,
    empId: true,
    oldDetail: true,
    newDetail: true,
    createdAt: true,
    category: { select: { id: true, name: true } },
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
  ] as const;

  private readonly logger = new Logger(LogsService.name);

  constructor(private readonly prisma: PrismaService) {
    // Single writer for audit rows — also used by the failure auditor.
    setAuditSink(this);
  }

  /** GET /logs/:logtype — one stream of logs, paginated, sorted desc by default. */
  async list(logtype: LogType, query: PaginationQueryDto): Promise<LogListResponseDTO> {
    return this.paginate({ typeEnum: logtype }, query);
  }

  /** GET /logs/filters?logtype= — categories + actions for the filter panel (V2). */
  async getFilters(logtype: LogType): Promise<FilterResponseDTO> {
    const [categories, actionRows] = await Promise.all([
      this.prisma.client.logCategory.findMany({
        where: { typeEnum: logtype },
        select: { id: true, typeEnum: true, name: true, image: true },
        orderBy: { id: 'asc' },
      }),
      // Actions are no longer a taxonomy table — the panel lists the distinct
      // (action name, category) pairs actually present in the stream.
      this.prisma.client.log.groupBy({
        by: ['actionName', 'categoryId'],
        where: { typeEnum: logtype, actionName: { not: null } },
        orderBy: { actionName: 'asc' },
      }),
    ]);

    const actions = actionRows
      .filter((row) => row.actionName !== null)
      .map((row) => ({ name: row.actionName as string, categoryId: row.categoryId }));

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
        actionName: true,
        actionText: true,
        userId: true,
        empId: true,
        oldDetail: true,
        newDetail: true,
        category: { select: { name: true } },
      },
    });

    const rows = data.map((row) => [
      row.id,
      row.createdAt,
      row.typeEnum,
      row.category?.name ?? null,
      row.actionName,
      row.actionText,
      row.userId,
      row.empId,
      row.oldDetail,
      row.newDetail,
    ]);

    return toCsv(LogsService.CSV_COLUMNS, rows);
  }

  /**
   * WRITE side — records one audit log row. LogsModule is @Global, so any
   * module injects LogsService and calls this directly:
   *   await this.logs.record({ typeEnum, categoryName, actionName, ... })
   * - The category is upserted on its unique key (idempotent); `actionName`
   *   is a plain column stored as-is — no taxonomy table to resolve.
   * - NEVER rejects: a failed audit write is warned through pino and swallowed
   *   so it can never break the calling business flow.
   */
  async record(input: RecordLogInput): Promise<void> {
    // This request now has (or is getting) its own audit row — suppress the
    // generic failure audit even if the insert below fails.
    markRequestAudited();
    try {
      // Best-effort: never let taxonomy bookkeeping lose the audit row.
      const categoryId = await this.resolveCategoryId(input.typeEnum, input.categoryName);

      await this.prisma.client.log.create({
        data: {
          typeEnum: input.typeEnum,
          categoryId,
          actionName: input.actionName ?? null,
          actionText: input.actionText ?? null,
          userId: input.userId ?? null,
          empId: input.empId ?? null,
          oldDetail: this.serializeDetail(input.oldDetail),
          // The caller's business pointer (bundle id, admin id, …) is folded
          // into newDetail.target so the reference lives on the row itself.
          newDetail: this.serializeDetail(this.withTarget(input.newDetail, input.target)),
        },
      });
    } catch (err) {
      this.logger.warn(`record() failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Resolves (creating on first use) the category for a row — BEST-EFFORT:
   * returns null instead of ever throwing, because losing the audit row over
   * taxonomy bookkeeping is never acceptable.
   *
   * Concurrent first-writes of the same (name, typeEnum) race on the unique
   * constraint: one upsert wins, the others get P2002. Those fall back to a
   * plain read of the now-existing row; if even that fails (or the upsert
   * errors for any other reason), the log row still lands without a category.
   */
  private async resolveCategoryId(typeEnum: LogType, name?: string): Promise<number | null> {
    if (!name) return null;
    try {
      const row = await this.prisma.client.logCategory.upsert({
        where: { name_typeEnum: { name, typeEnum } },
        create: { name, typeEnum },
        update: {},
      });
      return row.id;
    } catch (err) {
      const raced =
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: unknown }).name === 'PrismaClientKnownRequestError' &&
        (err as { code?: unknown }).code === 'P2002';
      if (raced) {
        try {
          const existing = await this.prisma.client.logCategory.findFirst({
            where: { name, typeEnum },
          });
          if (existing) return existing.id;
        } catch (findErr) {
          this.logger.warn(
            `record() category fallback failed: ${findErr instanceof Error ? findErr.message : String(findErr)}`,
          );
        }
      } else {
        this.logger.warn(
          `record() category upsert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }
  }

  /**
   * Folds the caller's business pointer into newDetail under `target` so the
   * reference always lives on the row.
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
   * category id / action name filters and the free-text q (OR across the
   * human readable columns, case-insensitive).
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
      where.actionName = { in: query.actions, mode: 'insensitive' };
    }

    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { actionText: this.containsInsensitive(q) },
        { actionName: this.containsInsensitive(q) },
        { userId: this.containsInsensitive(q) },
        { empId: this.containsInsensitive(q) },
        { oldDetail: this.containsInsensitive(q) },
        { newDetail: this.containsInsensitive(q) },
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
