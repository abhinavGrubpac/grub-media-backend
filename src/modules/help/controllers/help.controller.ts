import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LogType } from '@prisma/client';
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
import { CurrentUser, AuthUser } from '../../auth/decorators/current-user.decorator';
import { LogsService } from '../../logs/services/logs.service';

/**
 * Read-only help centre endpoints. No production POST/PATCH/DELETE — content is
 * managed via the Prisma seed (`npm run prisma:seed`).
 *
 * Every route requires a valid JWT (any authenticated role — no
 * @Roles/@RequirePermissions needed). Reads are audited into the ACTIVITY
 * stream under the 'Help' category, after the response body is built.
 */
@ApiTags('Help')
@ApiBearerAuth()
@Controller({ path: 'help', version: '1' })
export class HelpController {
  constructor(
    private readonly help: HelpService,
    private readonly config: ConfigService,
    private readonly logs: LogsService,
  ) {}

  /** Audit a read of the help centre (ACTIVITY / Help). */
  private auditRead(u: AuthUser, actionName: string, actionText: string): Promise<void> {
    return this.logs.record({
      typeEnum: LogType.ACTIVITY,
      categoryName: 'Help',
      actionName,
      actionText,
      userId: u.id,
    });
  }

  @Get('categories')
  @ApiOperation({ summary: 'List active help categories (ordered by displayOrder)' })
  @ResponseMessage('Help categories fetched successfully')
  async getCategories(@CurrentUser() u: AuthUser): Promise<HelpCategoriesList> {
    const result = await this.help.getCategories();
    await this.auditRead(u, 'View Help Categories', 'Listed help categories');
    return result;
  }

  @Get('categories/:categoryId/faqs')
  @ApiOperation({ summary: 'List active FAQ questions for a category (paginated)' })
  @ResponseMessage('FAQs fetched successfully')
  async getFaqsByCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Query() query: HelpCategoryFaqQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<Paginated<HelpFaqListItem>> {
    const result = await this.help.getFaqsByCategory(categoryId, query);
    await this.auditRead(u, 'View FAQ List', `Listed FAQs of category ${categoryId}`);
    return result;
  }

  @Get('faqs/:id')
  @ApiOperation({ summary: 'Get a complete FAQ including its category' })
  @ResponseMessage('FAQ fetched successfully')
  async getFaq(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() u: AuthUser,
  ): Promise<HelpFaqDetail> {
    const result = await this.help.getFaq(id);
    await this.auditRead(u, 'View FAQ', `Viewed FAQ ${id}`);
    return result;
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search help content — categories + FAQs globally, or one category via categoryId',
    description:
      'Without categoryId: matches category names and FAQ questions across the whole help ' +
      'centre. With categoryId: matches FAQ questions inside that category only.',
  })
  @ResponseMessage('Search results fetched successfully')
  async search(
    @Query() query: HelpSearchQueryDto,
    @CurrentUser() u: AuthUser,
  ): Promise<HelpSearchResults> {
    const result = await this.help.search(query.q, query.categoryId);
    await this.auditRead(u, 'Search Help', 'Searched the help centre');
    return result;
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
  async getContact(@CurrentUser() u: AuthUser): Promise<{ email: string; mailto: string }> {
    const email = this.config.get<string>('app.supportEmail') ?? 'support@grubpac.com';
    const mailto = `mailto:${email}`;
    await this.auditRead(u, 'View Contact', 'Viewed support contact link');
    return { email, mailto };
  }
}
