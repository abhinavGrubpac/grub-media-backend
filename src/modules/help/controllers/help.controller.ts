import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HelpService } from '../services/help.service';
import { HelpSearchQueryDto } from '../dto/help-search-query.dto';
import { HelpCategoryFaqQueryDto } from '../dto/help-category-faq-query.dto';
import { Paginated } from '../../../common/dto/paginated';
import {
  HelpCategoriesList,
  HelpFaqDetail,
  HelpFaqListItem,
  HelpSearchResults,
} from '../dto/help.types';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';

/**
 * Read-only help centre endpoints. No production POST/PATCH/DELETE — content is
 * managed via the Prisma seed (`npm run prisma:seed`).
 *
 * Every route requires a valid JWT (any authenticated role — no
 * @Roles/@RequirePermissions needed).
 */
@ApiTags('Help')
@ApiBearerAuth()
@Controller({ path: 'help', version: '1' })
export class HelpController {
  constructor(
    private readonly help: HelpService,
    private readonly config: ConfigService,
  ) {}

  @Get('categories')
  @ApiOperation({ summary: 'List active help categories (ordered by displayOrder)' })
  @ResponseMessage('Help categories fetched successfully')
  getCategories(): Promise<HelpCategoriesList> {
    return this.help.getCategories();
  }

  @Get('categories/:categoryId/faqs')
  @ApiOperation({ summary: 'List active FAQ questions for a category (paginated)' })
  @ResponseMessage('FAQs fetched successfully')
  getFaqsByCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Query() query: HelpCategoryFaqQueryDto,
  ): Promise<Paginated<HelpFaqListItem>> {
    return this.help.getFaqsByCategory(categoryId, query);
  }

  @Get('faqs/:id')
  @ApiOperation({ summary: 'Get a complete FAQ including its category' })
  @ResponseMessage('FAQ fetched successfully')
  getFaq(@Param('id', ParseIntPipe) id: number): Promise<HelpFaqDetail> {
    return this.help.getFaq(id);
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search help content — categories + FAQs globally, or one category via categoryId',
    description:
      'Without categoryId: matches category names and FAQ questions across the whole help ' +
      'centre. With categoryId: matches FAQ questions inside that category only.',
  })
  @ResponseMessage('Search results fetched successfully')
  search(@Query() query: HelpSearchQueryDto): Promise<HelpSearchResults> {
    return this.help.search(query.q, query.categoryId);
  }

  @Get('contact')
  @ApiOperation({
    summary: 'Support contact — prefilled mailto: link the frontend redirects to',
    description:
      'Returns the support address and a ready-to-use mailto: URI. The frontend opens it ' +
      '(e.g. window.location.href) to hand off to the user’s mail client; no email is sent ' +
      'by the backend. Append ?subject=...&body=... to mailto as needed.',
  })
  @ResponseMessage('Contact link fetched successfully')
  getContact(): { email: string; mailto: string } {
    const email = this.config.get<string>('app.supportEmail') ?? 'support@grubpac.com';
    return { email, mailto: `mailto:${email}` };
  }
}
