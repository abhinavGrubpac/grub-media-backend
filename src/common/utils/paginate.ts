import { PaginatedMeta } from '../dto/paginated';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

/** Translate page/limit into Prisma `skip`/`take`. */
export function toSkipTake(dto: PaginationQueryDto): { skip: number; take: number } {
  return { skip: (dto.page - 1) * dto.limit, take: dto.limit };
}

/** Build the response `meta` block for a paginated result. */
export function buildMeta(total: number, page: number, limit: number): PaginatedMeta {
  return { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}
