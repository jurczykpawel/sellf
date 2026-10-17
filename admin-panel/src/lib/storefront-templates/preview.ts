/** Authorized current-draft presentation for the inert dynamic preview page. */
import 'server-only';
import { z } from 'zod';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { getLocalTemplateIds } from '@/lib/storefront-templates/template-license-snapshot';
import { getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createPlatformClient } from '@/lib/supabase/admin';
import { inspectTemplate } from '@/lib/storefront-templates/lifecycle-validation';
import { getTemplatePrincipal, templateFailure } from '@/lib/storefront-templates/mutations';
import { readOfferConfig } from '@/lib/storefront-templates/offer-repository';
import { inspectOffer } from '@/lib/storefront-templates/offer-lifecycle';
import { resolveOffer } from '@/lib/storefront-templates/offer';
import { readStorefrontConfig } from '@/lib/storefront-templates/repository';
import { revisionSchema } from '@/lib/storefront-templates/schemas';
import { isPlainJson, result } from '@/lib/storefront-templates/json';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { resolvePublicTheme } from '@/lib/storefront-templates/public-theme';
import { loadCatalogueGroups, loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import { PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import type { StorefrontMutationResult } from '@/lib/storefront-templates/mutations';
import type { EffectiveToken } from '@/lib/storefront-templates/public-theme';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { PresentationModel } from '@/lib/storefront-templates/resolver';
import type { PublicThemeTokens } from '@/lib/storefront-templates/schemas';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';

export const PREVIEW_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
export const PREVIEW_FIXTURES = ['standard', 'empty', 'long', 'unavailable', 'published-products'] as const;
export const previewSchema = z.strictObject({ revision: revisionSchema, locale: z.enum(['en', 'pl']), fixture: z.string().max(40).regex(/^[a-z][a-z-]*$/) });
export interface PreviewResult {
  revision: number; locale: 'en' | 'pl'; fixture: string; expiresAt: string;
  validation: ValidationResult; effectiveTokens: EffectiveToken[]; unusedSlots: string[];
}
export type PreviewResponse = { success: true; data: PreviewResult } | Extract<StorefrontMutationResult, { success: false }>;

export interface PreparedPreview extends PreviewResult { model: PresentationModel<string>; tokens: PublicThemeTokens }
type PreviewFailure = Extract<StorefrontMutationResult, { success: false }>;
const fail = (code: Parameters<typeof templateFailure>[0], validation: ValidationResult | null = null, revision: number | null = null): PreviewFailure => templateFailure(code, validation, revision, 'preview') as PreviewFailure;

export async function preparePreview(auth: unknown, input: unknown, startedAt = Date.now(), productId?: string): Promise<{ success: true; data: PreparedPreview } | PreviewFailure> {
  const actor = getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_READ);
  if (!actor) return fail('FORBIDDEN');
  if (!Number.isSafeInteger(startedAt) || startedAt > Date.now() || Date.now() >= startedAt + 600000) return fail('CONFLICT');
  const parsed = isPlainJson(input) ? previewSchema.safeParse(input) : null;
  if (!parsed?.success) {
    const limit = parsed && parsed.error.issues.some(issue => issue.path.includes('revision'));
    return fail(limit ? 'LIMIT' : 'INVALID', result([{ code: limit ? 'LIMIT' : 'SCHEMA', path: '', message: 'Invalid preview input' }]));
  }
  const { revision, locale, fixture } = parsed.data;
  if (!(PREVIEW_FIXTURES as readonly string[]).includes(fixture)) return fail('NOT_FOUND');
  try {
    if (!(await checkRateLimit('storefront_preview', 120, 1, actor.userId))) return fail('RATE_LIMITED');
    const client = createPlatformClient();
    if (productId !== undefined) {
      if (!z.uuid().safeParse(productId).success) return fail('INVALID');
      productId = productId.toLowerCase();
      const initial = await readOfferConfig(client, productId);
      if (!initial.success) return fail('UNAVAILABLE');
      if (!initial.data?.draft || initial.data.revision !== revision) return fail('CONFLICT', null, initial.data?.revision ?? 0);
      const offer = initial.data.draft;
      const inspection = inspectOffer(offer, 'draft');
      if (!inspection.valid) return fail('INVALID', inspection);
      const bound = await loadStorefrontBindings(client, { locale, heroProduct: productId, closingProduct: productId, target: 'offer' });
      if (!bound.success) return fail('UNAVAILABLE');
      const product = bound.data.hero;
      const model = resolveOffer(offer, locale, productId, product);
      const current = await readOfferConfig(client, productId);
      if (!current.success) return fail('UNAVAILABLE');
      if (!current.data?.draft || current.data.revision !== revision || Date.now() >= startedAt + 600000) return fail('CONFLICT', null, current.data?.revision ?? 0);
      const theme = resolvePublicTheme(null, offer.tokens, true);
      return { success: true, data: { revision, locale, fixture, expiresAt: new Date(startedAt + 600000).toISOString(), model, tokens: theme.tokens, validation: inspection, effectiveTokens: theme.effective, unusedSlots: [] } };
    }
    const initial = await readStorefrontConfig(client);
    if (!initial.success) return fail('UNAVAILABLE');
    if (initial.data.revision !== revision || !initial.data.draft) return fail('CONFLICT', null, initial.data.revision);
    const config = initial.data.draft;
    const structural = validateConfig(config);
    if (!structural.valid) return fail('INVALID', structural);
    const inspection = inspectTemplate(config, templateRightsForTier(getPublicLicenseTier(), getLocalTemplateIds()), 'draft');
    const selection = resolveSelection(config, Object.keys(STOREFRONT_TEMPLATES));
    if (selection.diagnostic) return fail('INVALID', result([{ code: 'COMPATIBILITY', path: '/templateId', message: 'Unsupported preview selection' }]));
    const spec = selection.recipe.sections.find(s => s.type === 'catalogue/1');
    if (!spec || spec.type !== 'catalogue/1') return fail('INVALID', structural);
    const theme = resolvePublicTheme(STOREFRONT_TEMPLATES[selection.templateId].tokens, config.tokens, true);
    let products: PublicProductInfo[] = PUBLIC_FIXTURE.products.map((p, i) => ({ ...p,
      marketing: { ...p.marketing, format: 'workshop', sourceLocale: 'en' },
      title: fixture === 'long' ? (locale === 'pl' ? 'Przykładowy długi tytuł produktu ' : 'Example long product title ').repeat(6) : p.title,
      price: { ...p.price, kind: i === 3 ? 'pwyw' : p.price.kind as PublicProductInfo['price']['kind'] },
      actions: { details: `/${locale}/p/${p.slug}`, buy: `/${locale}/checkout/${p.slug}` },
      availability: fixture === 'unavailable' ? 'unavailable' : 'available',
    }));
    if (fixture === 'empty') products = [];
    let categories = fixture === 'empty' ? [] : PUBLIC_FIXTURE.categories;
    const page = (items: PublicProductInfo[]) => ({ products: items, nextCursor: null });
    let groups: CatalogueProps['groups'] = spec.variant !== 'default-groups' ? { all: page(products) } : {
      featured: page(products.slice(0, 1)), free: page(products.filter(p => p.price.kind === 'free')), paid: page(products.filter(p => p.price.kind !== 'free')),
    };
    if (fixture === 'published-products') {
      const [pages, bound] = await Promise.all([
        loadCatalogueGroups(client, { locale, pageSize: spec.pageSize }, spec.variant),
        loadStorefrontBindings(client, { locale, heroProduct: selection.settings.heroProduct, closingProduct: selection.settings.closingProduct, comparisonProducts: selection.settings.comparisonProducts, featuredProducts: selection.settings.featuredProducts, starterProducts: selection.settings.starterProducts, taskCategories: selection.settings.taskCategories, target: spec.id }),
      ]);
      if (!pages.success || !bound.success) return fail('UNAVAILABLE');
      products = [bound.data.hero, bound.data.closing, ...bound.data.starters, ...bound.data.comparison, ...bound.data.featured].filter((p): p is PublicProductInfo => p !== null);
      categories = bound.data.categories; groups = pages.data;
    }
    const catalogue: CatalogueProps = { id: spec.id, variant: spec.variant, groups, filters: spec.filters, pageSize: spec.pageSize, density: selection.settings.density ?? 'comfortable', locale, categories };
    const model = resolvePresentation(selection, { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(categories.map(c => [c.id, c])), catalogue });
    const current = await readStorefrontConfig(client);
    if (!current.success) return fail('UNAVAILABLE');
    if (current.data.revision !== revision || !current.data.draft || Date.now() >= startedAt + 600000) return fail('CONFLICT', null, current.data.revision);
    return { success: true, data: { revision, locale, fixture, expiresAt: new Date(startedAt + 600000).toISOString(), model, tokens: theme.tokens, validation: inspection.validation, effectiveTokens: inspection.effectiveTokens, unusedSlots: inspection.unusedSlots } };
  } catch { return fail('UNAVAILABLE'); }
}
