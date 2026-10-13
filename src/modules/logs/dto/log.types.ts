import { LogType } from '@prisma/client';
import { Paginated } from '../../../common/dto/paginated';

/**
 * Log System response payload types (LLD: LogResponseDTO, LogListResponseDTO,
 * CategoryDTO, ActionDTO, FilterResponseDTO). Plain interfaces — the wire
 * shapes are documented inline in LogsController's @ApiOperation/@ApiOkResponse.
 * Field allowlists are enforced by the Prisma `select` in LogsService, so
 * relation internals never cross the API boundary.
 */

export interface LogCategoryBriefDTO {
  id: number;
  name: string;
}

export interface LogActionBriefDTO {
  id: number;
  name: string;
}

/** One log row (LogResponseDTO) — nested category/action are brief projections. */
export interface LogResponseDTO {
  id: number;
  typeEnum: LogType;
  category: LogCategoryBriefDTO | null;
  action: LogActionBriefDTO | null;
  actionText: string | null;
  userId: string | null;
  empId: string | null;
  oldDetail: string | null;
  newDetail: string | null;
  referenceId: string | null;
  createdAt: Date;
}

/** Paginated log page (LogListResponseDTO) — `{ data, meta }` envelope shape. */
export type LogListResponseDTO = Paginated<LogResponseDTO>;

/** Filter-panel category (CategoryDTO). */
export interface CategoryDTO {
  id: number;
  typeEnum: LogType;
  name: string;
  image: string | null;
}

/** Filter-panel action (ActionDTO) — belongs to one category. */
export interface ActionDTO {
  id: number;
  categoryId: number;
  name: string;
}

/** GET /logs/filters payload (FilterResponseDTO) — categories + actions for one logtype. */
export interface FilterResponseDTO {
  categories: CategoryDTO[];
  actions: ActionDTO[];
}

/**
 * Input for LogsService.record() — the write side, callable from ANY module
 * (LogsModule is @Global, so only `constructor(private logs: LogsService)`).
 * Callers pass taxonomy NAMES, not ids: the service upserts them on their
 * unique keys (name+typeEnum / name+categoryId), so no seeding is needed.
 */
export interface RecordLogInput {
  typeEnum: LogType;
  /** Category to resolve/create, e.g. 'Authentication'. */
  categoryName?: string;
  /** Action to resolve/create — only used when categoryName is set. */
  actionName?: string;
  /** Human sentence for the row, e.g. 'User foo@bar.com logged in'. */
  actionText?: string;
  /** Actor (JWT user id). */
  userId?: string;
  empId?: string;
  /** Before/after state — objects are JSON.stringified into TEXT. */
  oldDetail?: unknown;
  newDetail?: unknown;
  /** Id of the affected row. */
  referenceId?: string;
}
