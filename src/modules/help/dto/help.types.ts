/**
 * Help response payload types. These are plain interfaces (not Swagger DTO
 * classes) — the wire shapes are documented inline in HelpController's
 * @ApiOkResponse schemas. Field allowlists are enforced by the Prisma `select`
 * in HelpService, so `isActive`/timestamps never cross the API boundary.
 */

export interface HelpCategoryResponse {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  displayOrder?: number | null;
}

export interface HelpFaqListItem {
  id: number;
  question: string;
}

export interface HelpCategoryBrief {
  id: number;
  name: string;
}

/** Complete FAQ including its parent category. */
export interface HelpFaqDetail {
  id: number;
  question: string;
  answer: string;
  category: HelpCategoryBrief;
}

export type HelpSearchResultType = 'category' | 'faq';

/** Dropdown-sized search hit — deliberately excludes the FAQ answer. */
export interface HelpSearchResult {
  type: HelpSearchResultType;
  id: number;
  /** Present when type = category */
  name?: string;
  /** Present when type = faq */
  question?: string;
  /** Present when type = faq */
  category?: HelpCategoryBrief;
}

export interface HelpCategoriesList {
  categories: HelpCategoryResponse[];
}

export interface HelpSearchResults {
  results: HelpSearchResult[];
}
