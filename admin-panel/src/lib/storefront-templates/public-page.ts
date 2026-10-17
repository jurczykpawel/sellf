/** Published storefront orchestration; no identity in the presentation model. @see resolver.ts */
import 'server-only';
import { z } from 'zod';
import { defaultLocale } from '@/lib/locales';
import { getPublicBaseUrl } from '@/lib/utils/canonical-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { readPublishedConfig } from '@/lib/storefront-templates/repository';
import { loadCatalogueGroups, loadCataloguePage, loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { catalogueRequestSchema } from '@/lib/storefront-templates/catalogue-section';
import { getLocalTemplateIds } from '@/lib/storefront-templates/template-license-snapshot';
import { getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import { resolvePublicTheme } from '@/lib/storefront-templates/public-theme';
import type { Metadata } from 'next';
import type { PresentationModel } from '@/lib/storefront-templates/resolver';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';
import type { ResolvedPublicTheme } from '@/lib/storefront-templates/public-theme';

export type StorefrontSearchParams = Record<string, string | string[] | undefined>;
const searchSchema = z.object({ search: catalogueRequestSchema.shape.search.optional(), category: z.uuid().optional() });
type PageResult = { success: true; model: PresentationModel; hasProducts: boolean; theme: ResolvedPublicTheme } | { success: false };

/** Rights are resolved outside the public presentation model on every render. */
export async function loadPublicStorefront(locale: 'en' | 'pl', params: StorefrontSearchParams): Promise<PageResult> {
  try {
    const search = searchSchema.safeParse(params);
    if (!search.success) return { success: false };
    const client = createAdminClient();
    const published = await readPublishedConfig(client);
    const rights = templateRightsForTier(getPublicLicenseTier(), getLocalTemplateIds());
    const selection = resolveSelection(published.success ? published.data : null, rights.availableTemplateIds);
    const theme = resolvePublicTheme(STOREFRONT_TEMPLATES[selection.templateId].tokens, published.success ? published.data.tokens : null, rights.canCustomizeTokens);
    const spec = selection.recipe.sections.find(s => s.type === 'catalogue/1');
    if (!spec || spec.type !== 'catalogue/1') return { success: false };
    const { heroProduct, closingProduct, starterProducts, taskCategories, comparisonProducts, featuredProducts } = selection.settings;
    const query = { locale, search: search.data.search ?? '', categoryIds: search.data.category ? [search.data.category] : [], pageSize: spec.pageSize };
    const [pages, bound] = await Promise.all([
      loadCatalogueGroups(client, query, spec.variant),
      loadStorefrontBindings(client, { locale, heroProduct, closingProduct, starterProducts, taskCategories, comparisonProducts, featuredProducts, target: spec.id }),
    ]);
    if (!pages.success || !bound.success) return { success: false };
    const products = [bound.data.hero, bound.data.closing, ...bound.data.starters, ...bound.data.comparison, ...bound.data.featured].filter(p => p !== null);
    let hasProducts = Object.values(pages.data).some(page => page && page.products.length > 0) || products.length > 0;
    if (!hasProducts && (query.search || query.categoryIds.length)) {
      const unfiltered = await loadCataloguePage(client, { locale, pageSize: 9 });
      if (!unfiltered.success) return { success: false };
      hasProducts = unfiltered.data.products.length > 0;
    }
    const catalogue: CatalogueProps = { id: spec.id, variant: spec.variant, groups: pages.data, filters: spec.filters, pageSize: spec.pageSize,
      density: selection.settings.density ?? 'comfortable', locale, categories: bound.data.categories,
      initialQuery: { search: query.search, categoryIds: query.categoryIds, priceKind: null, format: null } };
    const model = resolvePresentation(selection, { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])),
      categoriesById: Object.fromEntries(bound.data.categories.map(c => [c.id, c])), catalogue });
    return { success: true, model, hasProducts, theme };
  } catch { return { success: false }; }
}

/** Canonical identity is independent of selection and catalogue filter query. */
export function storefrontMetadata(locale: 'en' | 'pl', surface: 'home' | 'store'): Metadata {
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  const path = surface === 'store' ? `${prefix}/store` : prefix || '/';
  return { alternates: { canonical: `${getPublicBaseUrl()}${path}` } };
}
