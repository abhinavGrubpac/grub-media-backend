import { buildMeta, toSkipTake } from './paginate';

describe('pagination helpers', () => {
  it('computes skip/take from page and limit', () => {
    expect(toSkipTake({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
  });

  it('builds meta with totalPages', () => {
    expect(buildMeta(100, 1, 20)).toEqual({ page: 1, limit: 20, total: 100, totalPages: 5 });
  });

  it('builds meta with zero totalPages for an empty result set', () => {
    expect(buildMeta(0, 1, 20)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
