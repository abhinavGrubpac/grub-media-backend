import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  HelpCategoryNotFoundException,
  HelpFaqNotFoundException,
} from '../../../common/exceptions/domain.exceptions';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta } from '../../../common/utils/paginate';
import { HelpCategoryFaqQueryDto } from '../dto/help-category-faq-query.dto';
import {
  HelpCategoriesList,
  HelpFaqDetail,
  HelpFaqListItem,
  HelpSearchResults,
} from '../dto/help.types';

/**
 * Read-only help centre data: categories, FAQs and search.
 * Every query filters isActive=true and uses Prisma `select` so only the
 * fields the frontend needs ever leave the database.
 */
@Injectable()
export class HelpService {
  /** Global cap for search dropdown results. */
  private static readonly SEARCH_LIMIT = 10;

  /** displayOrder is nullable — push nulls last, break ties deterministically by id. */
  private static readonly BY_DISPLAY_ORDER = [
    { displayOrder: { sort: 'asc', nulls: 'last' } },
    { id: 'asc' },
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  async getCategories(): Promise<HelpCategoriesList> {
    const categories = await this.prisma.client.helpCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true, description: true, icon: true, displayOrder: true },
      orderBy: [...HelpService.BY_DISPLAY_ORDER],
    });
    return { categories };
  }

  async getFaqsByCategory(
    categoryId: number,
    query: HelpCategoryFaqQueryDto,
  ): Promise<Paginated<HelpFaqListItem>> {
    await this.requireActiveCategory(categoryId);
    const where = { isActive: true, categoryId };
    const skip = (query.page - 1) * query.limit;
    const [total, data] = await Promise.all([
      this.prisma.client.helpFaq.count({ where }),
      this.prisma.client.helpFaq.findMany({
        where,
        select: { id: true, question: true },
        orderBy: [...HelpService.BY_DISPLAY_ORDER],
        skip,
        take: query.limit,
      }),
    ]);
    return { data, meta: buildMeta(total, query.page, query.limit) };
  }

  /** Complete FAQ + parent category in a single relation-aware query (no N+1). */
  async getFaq(id: number): Promise<HelpFaqDetail> {
    const faq = await this.prisma.client.helpFaq.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        question: true,
        answer: true,
        category: { select: { id: true, name: true } },
      },
    });
    if (!faq) {
      throw new HelpFaqNotFoundException();
    }
    return faq;
  }

  /**
   * Single search entry point.
   * - `categoryId` given: FAQ questions inside that category only (validated up front).
   * - otherwise: global search across category names + FAQ questions
   *   (two parallel queries, capped).
   */
  async search(q: string, categoryId?: number): Promise<HelpSearchResults> {
    if (categoryId !== undefined) {
      await this.requireActiveCategory(categoryId);
      const rows = await this.prisma.client.helpFaq.findMany({
        where: {
          isActive: true,
          categoryId,
          question: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, question: true },
        orderBy: [...HelpService.BY_DISPLAY_ORDER],
        take: HelpService.SEARCH_LIMIT,
      });
      return { results: rows.map((row) => ({ type: 'faq' as const, ...row })) };
    }

    const [faqs, categories] = await Promise.all([
      this.prisma.client.helpFaq.findMany({
        where: { isActive: true, question: { contains: q, mode: 'insensitive' } },
        select: {
          id: true,
          question: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { id: 'asc' },
        take: HelpService.SEARCH_LIMIT,
      }),
      this.prisma.client.helpCategory.findMany({
        where: { isActive: true, name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true },
        orderBy: [...HelpService.BY_DISPLAY_ORDER],
        take: HelpService.SEARCH_LIMIT,
      }),
    ]);

    const results = [
      ...faqs.map((faq) => ({
        type: 'faq' as const,
        id: faq.id,
        question: faq.question,
        category: faq.category,
      })),
      ...categories.map((category) => ({
        type: 'category' as const,
        id: category.id,
        name: category.name,
      })),
    ].slice(0, HelpService.SEARCH_LIMIT);

    return { results };
  }

  private async requireActiveCategory(categoryId: number): Promise<{ id: number }> {
    const category = await this.prisma.client.helpCategory.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new HelpCategoryNotFoundException();
    }
    return category;
  }
}
