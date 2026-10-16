/** Private current-draft evidence shared by session and API adapters. @see preview-render.tsx */
import 'server-only';
import { z } from 'zod';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createPlatformClient } from '@/lib/supabase/admin';
import { inspectTemplate } from '@/lib/storefront-templates/lifecycle-validation';
import { getTemplatePrincipal, templateFailure } from '@/lib/storefront-templates/mutations';
import { readStorefrontConfig } from '@/lib/storefront-templates/repository';
import { revisionSchema } from '@/lib/storefront-templates/schemas';
import { isPlainJson, result } from '@/lib/storefront-templates/json';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { resolvePublicTheme } from '@/lib/storefront-templates/public-theme';
import { loadCatalogueGroups, loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import { PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { renderPreviewSnapshot } from '@/lib/storefront-templates/preview-render';
import type { StorefrontMutationResult } from '@/lib/storefront-templates/mutations';
import type { EffectiveToken } from '@/lib/storefront-templates/public-theme';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';

export const PREVIEW_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
export const PREVIEW_BYTES = 4 * 1024 * 1024;
export const PREVIEW_FIXTURES = ['standard', 'empty', 'long', 'unavailable', 'published-products'] as const;
export const previewSchema = z.strictObject({ revision: revisionSchema, locale: z.enum(['en', 'pl']), fixture: z.string().max(40).regex(/^[a-z][a-z-]*$/) });
export interface PreviewResult {
  revision: number; locale: 'en' | 'pl'; fixture: string; expiresAt: string;
  html: string; css: string; assets: { id: string; url: string; kind: 'image' | 'font' }[];
  validation: ValidationResult; effectiveTokens: EffectiveToken[]; unusedSlots: string[];
}
export type PreviewResponse = { success: true; data: PreviewResult } | Extract<StorefrontMutationResult, { success: false }>;

export async function previewStorefront(auth: unknown, input: unknown, startedAt = Date.now()): Promise<PreviewResponse> {
  const actor = getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_READ);
  if (!actor) return templateFailure('FORBIDDEN') as Extract<StorefrontMutationResult, { success: false }>;
  const fail = (code: Parameters<typeof templateFailure>[0], validation: ValidationResult | null = null, revision: number | null = null) => templateFailure(code, validation, revision) as Extract<StorefrontMutationResult, { success: false }>;
  const parsed = isPlainJson(input) ? previewSchema.safeParse(input) : null;
  if (!parsed?.success) {
    const limit = parsed && parsed.error.issues.some(issue => issue.path.includes('revision'));
    return fail(limit ? 'LIMIT' : 'INVALID', result([{ code: limit ? 'LIMIT' : 'SCHEMA', path: '', message: 'Invalid preview input' }]));
  }
  const { revision, locale, fixture } = parsed.data;
  if (!(PREVIEW_FIXTURES as readonly string[]).includes(fixture)) return fail('NOT_FOUND');
  try {
    if (!(await checkRateLimit('storefront_preview', 30, 1, actor.userId))) return fail('RATE_LIMITED');
    const client = createPlatformClient();
    const initial = await readStorefrontConfig(client);
    if (!initial.success) return fail('UNAVAILABLE');
    if (initial.data.revision !== revision || !initial.data.draft) return fail('CONFLICT', null, initial.data.revision);
    const config = initial.data.draft;
    const structural = validateConfig(config);
    if (!structural.valid) return fail('INVALID', structural);
    const inspection = inspectTemplate(config, templateRightsForTier(getPublicLicenseTier()), 'draft');
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
    let groups: CatalogueProps['groups'] = spec.variant === 'detail-cards' ? { all: page(products) } : {
      featured: page(products.slice(0, 1)), free: page(products.filter(p => p.price.kind === 'free')), paid: page(products.filter(p => p.price.kind !== 'free')),
    };
    if (fixture === 'published-products') {
      const [pages, bound] = await Promise.all([
        loadCatalogueGroups(client, { locale, pageSize: spec.pageSize }, spec.variant),
        loadStorefrontBindings(client, { locale, heroProduct: selection.settings.heroProduct, closingProduct: selection.settings.closingProduct, starterProducts: selection.settings.starterProducts, taskCategories: selection.settings.taskCategories, target: spec.id }),
      ]);
      if (!pages.success || !bound.success) return fail('UNAVAILABLE');
      products = [bound.data.hero, bound.data.closing, ...bound.data.starters].filter((p): p is PublicProductInfo => p !== null);
      categories = bound.data.categories; groups = pages.data;
    }
    const catalogue: CatalogueProps = { id: spec.id, variant: spec.variant, groups, filters: spec.filters, pageSize: spec.pageSize, density: selection.settings.density ?? 'comfortable', locale, categories };
    const model = resolvePresentation(selection, { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(categories.map(c => [c.id, c])), catalogue });
    const rendered = await renderPreviewSnapshot({ model, tokens: theme.tokens });
    const current = await readStorefrontConfig(client);
    if (!current.success) return fail('UNAVAILABLE');
    if (current.data.revision !== revision || !current.data.draft || Date.now() >= startedAt + 600000) return fail('CONFLICT', null, current.data.revision);
    const data: PreviewResult = { revision, locale, fixture, expiresAt: new Date(startedAt + 600000).toISOString(), ...rendered, validation: inspection.validation, effectiveTokens: inspection.effectiveTokens, unusedSlots: inspection.unusedSlots };
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > PREVIEW_BYTES) return fail('LIMIT', result([{ code: 'LIMIT', path: '', message: 'Preview exceeds byte limit', limit: PREVIEW_BYTES }]));
    return { success: true, data };
  } catch { return fail('UNAVAILABLE'); }
}
