import { PaginatedMeta } from '../dto/paginated';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

/**
 * Translate page/limit into Prisma `skip`/`take`.
 * Accepts anything carrying page/limit — PaginationQueryDto itself, or a query
 * DTO that defines its own pagination fields (e.g. LogSearchQueryDto).
 */
export function toSkipTake(
  dto: Pick<PaginationQueryDto, 'page' | 'limit'> &
    Partial<Pick<PaginationQueryDto, 'sortBy' | 'sortOrder'>>,
): {
  skip: number;
  take: number;
} {
  return { skip: (dto.page - 1) * dto.limit, take: dto.limit };
}

/** Build the response `meta` block for a paginated result. */
export function buildMeta(total: number, page: number, limit: number): PaginatedMeta {
  return { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}

/** §8 standard envelope meta (row-for-row with the documented contract). */
export interface StandardMeta {
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}

export function standardMeta(
  total: number,
  page: number,
  limit: number,
  count: number,
): StandardMeta {
  return {
    totalItems: total,
    itemCount: count,
    itemsPerPage: limit,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
  };
}
