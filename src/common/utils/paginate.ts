import { PaginatedMeta } from '../dto/paginated';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

export function toSkipTake(dto: Pick<PaginationQueryDto, 'page' | 'limit'>): {
  skip: number;
  take: number;
} {
  return { skip: (dto.page - 1) * dto.limit, take: dto.limit };
}

export function buildMeta(total: number, page: number, limit: number): PaginatedMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 0 };
}
