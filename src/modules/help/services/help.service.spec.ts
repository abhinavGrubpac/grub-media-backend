import {
  HelpCategoryNotFoundException,
  HelpFaqNotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { HelpCategoryFaqQueryDto } from '../dto/help-category-faq-query.dto';
import { HelpService } from './help.service';

const categoryRow = {
  id: 1,
  name: 'Attendance',
  description: 'Attendance related help',
  icon: 'help/categories/attendance.png',
  displayOrder: 1,
};

const faqRow = {
  id: 101,
  question: "Why can't I mark attendance?",
  answer: 'Check your location permission.',
  category: { id: 1, name: 'Attendance' },
};

type Mocks = { findMany?: jest.Mock; findFirst?: jest.Mock; count?: jest.Mock };

function prismaMock(category: Mocks = {}, faq: Mocks = {}) {
  return {
    client: {
      helpCategory: {
        findMany: category.findMany ?? jest.fn().mockResolvedValue([categoryRow]),
        findFirst: category.findFirst ?? jest.fn().mockResolvedValue({ id: 1 }),
      },
      helpFaq: {
        findMany: faq.findMany ?? jest.fn().mockResolvedValue([]),
        findFirst: faq.findFirst ?? jest.fn().mockResolvedValue(null),
        count: faq.count ?? jest.fn().mockResolvedValue(1),
      },
    },
  } as never;
}

describe('HelpService.getCategories', () => {
  it('returns only active categories with the response allowlist fields', async () => {
    const svc = new HelpService(prismaMock());
    const result = await svc.getCategories();

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toEqual({
      id: 1,
      name: 'Attendance',
      description: 'Attendance related help',
      icon: 'help/categories/attendance.png',
      displayOrder: 1,
    });
  });

  it('queries with isActive:true, displayOrder ordering and the field allowlist', async () => {
    const findMany = jest.fn().mockResolvedValue([categoryRow]);
    const svc = new HelpService(prismaMock({ findMany }));
    await svc.getCategories();

    const call = findMany.mock.calls[0][0];
    expect(call.where).toEqual({ isActive: true });
    expect(call.orderBy).toEqual([{ displayOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
    expect(call.select).toEqual({
      id: true,
      name: true,
      description: true,
      icon: true,
      displayOrder: true,
    });
    expect(call.select).not.toHaveProperty('isActive');
    expect(call.select).not.toHaveProperty('createdAt');
  });
});

describe('HelpService.getFaqsByCategory', () => {
  it('throws HelpCategoryNotFoundException for a missing/inactive category', async () => {
    const svc = new HelpService(prismaMock({ findFirst: jest.fn().mockResolvedValue(null) }));
    await expect(svc.getFaqsByCategory(999, new HelpCategoryFaqQueryDto())).rejects.toBeInstanceOf(
      HelpCategoryNotFoundException,
    );
  });

  it('returns the first page of id+question rows with meta', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 101, question: 'How do I check in?' }]);
    const count = jest.fn().mockResolvedValue(3);
    const svc = new HelpService(prismaMock({}, { findMany, count }));
    const result = await svc.getFaqsByCategory(1, new HelpCategoryFaqQueryDto());

    expect(result.data).toEqual([{ id: 101, question: 'How do I check in?' }]);
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, categoryId: 1 },
        select: { id: true, question: true },
        skip: 0,
        take: 20,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: { isActive: true, categoryId: 1 } });
  });

  it('offsets skip by page (page 2, limit 5)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new HelpService(prismaMock({}, { findMany }));
    await svc.getFaqsByCategory(1, { page: 2, limit: 5 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5 }));
  });
});

describe('HelpService.getFaq', () => {
  it('throws HelpFaqNotFoundException when missing or inactive', async () => {
    const svc = new HelpService(prismaMock({}, { findFirst: jest.fn().mockResolvedValue(null) }));
    await expect(svc.getFaq(404)).rejects.toBeInstanceOf(HelpFaqNotFoundException);
  });

  it('returns the complete FAQ with its category from a single relation query', async () => {
    const findFirst = jest.fn().mockResolvedValue(faqRow);
    const svc = new HelpService(prismaMock({}, { findFirst }));
    const result = await svc.getFaq(101);

    expect(result).toEqual({
      id: 101,
      question: "Why can't I mark attendance?",
      answer: 'Check your location permission.',
      category: { id: 1, name: 'Attendance' },
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 101, isActive: true },
        select: {
          id: true,
          question: true,
          answer: true,
          category: { select: { id: true, name: true } },
        },
      }),
    );
  });
});

describe('HelpService.search', () => {
  it('marks result types and never includes the FAQ answer', async () => {
    const faqFindMany = jest
      .fn()
      .mockResolvedValue([
        { id: 101, question: 'How do I check in?', category: { id: 1, name: 'Attendance' } },
      ]);
    const categoryFindMany = jest.fn().mockResolvedValue([{ id: 1, name: 'Attendance' }]);
    const svc = new HelpService(
      prismaMock({ findMany: categoryFindMany }, { findMany: faqFindMany }),
    );

    const { results } = await svc.search('attendance');

    expect(results).toEqual([
      {
        type: 'faq',
        id: 101,
        question: 'How do I check in?',
        category: { id: 1, name: 'Attendance' },
      },
      { type: 'category', id: 1, name: 'Attendance' },
    ]);
    for (const result of results) {
      expect(result).not.toHaveProperty('answer');
    }
  });

  it('caps combined results at 10 (FAQs first)', async () => {
    const manyFaqs = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      question: `Question ${i + 1}`,
      category: { id: 1, name: 'Attendance' },
    }));
    const manyCategories = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: `Category ${i + 1}`,
    }));
    const svc = new HelpService(
      prismaMock(
        { findMany: jest.fn().mockResolvedValue(manyCategories) },
        { findMany: jest.fn().mockResolvedValue(manyFaqs) },
      ),
    );

    const { results } = await svc.search('q');

    expect(results).toHaveLength(10);
    expect(results.every((r) => r.type === 'faq')).toBe(true);
  });

  it('uses case-insensitive contains matching on question and name', async () => {
    const faqFindMany = jest.fn().mockResolvedValue([]);
    const categoryFindMany = jest.fn().mockResolvedValue([]);
    const svc = new HelpService(
      prismaMock({ findMany: categoryFindMany }, { findMany: faqFindMany }),
    );

    await svc.search('Check');

    expect(faqFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          question: { contains: 'Check', mode: 'insensitive' },
        }),
      }),
    );
    expect(categoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'Check', mode: 'insensitive' },
        }),
      }),
    );
  });
});

describe('HelpService.search with categoryId', () => {
  it('throws HelpCategoryNotFoundException for a missing/inactive category', async () => {
    const svc = new HelpService(prismaMock({ findFirst: jest.fn().mockResolvedValue(null) }));
    await expect(svc.search('x', 999)).rejects.toBeInstanceOf(HelpCategoryNotFoundException);
  });

  it('searches only FAQs of the given category and takes at most 10', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new HelpService(prismaMock({}, { findMany }));
    await svc.search('check', 1);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          categoryId: 1,
          question: { contains: 'check', mode: 'insensitive' },
        },
        take: 10,
      }),
    );
  });

  it('does not query categories when scoped to a category', async () => {
    const categoryFindMany = jest.fn().mockResolvedValue([]);
    const svc = new HelpService(
      prismaMock({ findMany: categoryFindMany }, { findMany: jest.fn().mockResolvedValue([]) }),
    );

    await svc.search('check', 1);

    expect(categoryFindMany).not.toHaveBeenCalled();
  });
});
