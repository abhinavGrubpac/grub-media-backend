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

/**
 * One log row (LogResponseDTO). The action is a flat `actionName` string on
 * the row itself — there is no action relation to project.
 */
export interface LogResponseDTO {
  id: number;
  typeEnum: LogType;
  category: LogCategoryBriefDTO | null;
  actionName: string | null;
  actionText: string | null;
  userId: string | null;
  empId: string | null;
  oldDetail: string | null;
  newDetail: string | null;
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

/**
 * Filter-panel action (ActionDTO) — derived from the distinct `actionName`s
 * present in the stream, each tied to the category it was logged under.
 */
export interface ActionDTO {
  name: string;
  categoryId: number | null;
}

/** GET /logs/filters payload (FilterResponseDTO) — categories + actions for one logtype. */
export interface FilterResponseDTO {
  categories: CategoryDTO[];
  actions: ActionDTO[];
}

/**
 * Input for LogsService.record() — the write side, callable from ANY module
 * (LogsModule is @Global, so only `constructor(private logs: LogsService)`).
 * Callers pass taxonomy NAMES, not ids: the category is upserted on its
 * unique key (name+typeEnum) and the action name is stored directly on the
 * row, so no seeding is needed.
 */
export interface RecordLogInput {
  typeEnum: LogType;
  /** Category to resolve/create, e.g. 'Authentication'. */
  categoryName?: string;
  /** Action name stored on the row, e.g. 'Login'. Independent of the category. */
  actionName?: string;
  /** Human sentence for the row, e.g. 'User foo@bar.com logged in'. */
  actionText?: string;
  /** Actor (JWT user id). */
  userId?: string;
  empId?: string;
  /** Before/after state — objects are JSON.stringified into TEXT. */
  oldDetail?: unknown;
  newDetail?: unknown;
  /**
   * Business pointer for the affected row (user id, bundle id, admin id, …).
   * Folded into newDetail.target so it survives on the row — there is no
   * dedicated reference column anymore.
   */
  target?: string;
}
