import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { buildMeta, toSkipTake } from './paginate';

function dto(partial: Partial<PaginationQueryDto>): PaginationQueryDto {
  return Object.assign(new PaginationQueryDto(), partial);
}

describe('toSkipTake', () => {
  it('computes skip/take from page and limit', () => {
    expect(toSkipTake(dto({ page: 3, limit: 20 }))).toEqual({ skip: 40, take: 20 });
  });

  it('page 1 has skip 0', () => {
    expect(toSkipTake(dto({ page: 1, limit: 50 }))).toEqual({ skip: 0, take: 50 });
  });
});

describe('buildMeta', () => {
  it('computes totalPages by ceiling', () => {
    expect(buildMeta(100, 1, 20)).toEqual({ page: 1, limit: 20, total: 100, totalPages: 5 });
    expect(buildMeta(101, 1, 20)).toEqual({ page: 1, limit: 20, total: 101, totalPages: 6 });
  });

  it('returns totalPages 0 when there are no rows', () => {
    expect(buildMeta(0, 1, 20)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('guards against a zero limit (no divide-by-zero)', () => {
    expect(buildMeta(50, 1, 0)).toEqual({ page: 1, limit: 0, total: 50, totalPages: 0 });
  });
});

describe('PaginationQueryDto defaults', () => {
  it('defaults page=1, limit=20, sortOrder=desc', () => {
    const d = new PaginationQueryDto();
    expect(d.page).toBe(1);
    expect(d.limit).toBe(20);
    expect(d.sortOrder).toBe('desc');
  });
});
