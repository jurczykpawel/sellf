/** Public task-navigation props and progressive catalogue handoff. @see spec/contracts/section-contract.md */
import type { z } from 'zod';
import type { headingContentSchema } from '@/lib/storefront-templates/schemas';
import type { PublicCategoryInfo } from '@/lib/storefront-templates/catalogue';

export interface TaskNavProps {
  categories: PublicCategoryInfo[];
  content: z.infer<typeof headingContentSchema> | null;
  target: string;
  locale: 'en' | 'pl';
}
export interface TaskNavFilter {
  target: string;
  categoryIds?: string[];
  search?: string;
}
/** A catalogue prevents the event's default only when it owns the supplied target. */
export const TASK_NAV_FILTER_EVENT = 'sellf:catalogue-filter';
export const TASK_NAV_LABELS = {
  en: { search: 'Search the catalogue', submit: 'Search', choose: 'Choose a category', filtering: 'Filtering catalogue: ', tooLong: 'Use no more than 100 characters.' },
  pl: { search: 'Szukaj w katalogu', submit: 'Szukaj', choose: 'Wybierz kategorię', filtering: 'Filtrowanie katalogu: ', tooLong: 'Wpisz maksymalnie 100 znaków.' },
};

export function taskNavHref(target: string, categoryId: string): string {
  return `?category=${encodeURIComponent(categoryId)}#${encodeURIComponent(target)}`;
}
