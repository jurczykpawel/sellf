/** Premium B composition acceptance. */
import { describe, expect, it, vi } from 'vitest';
import { D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { STOREFRONT_TEMPLATES, validateConfig, normalizeConfigOrders } from '@/lib/storefront-templates/registry';
import { validateThemeContrast } from '@/lib/storefront-templates/public-theme';
import { referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';
import { referenceProducts, referenceCategories } from '../../fixtures/storefront-sections/phase2/reference';

vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
function bConfig() {
  const reference = referenceConfig();
  return { ...D_CONFIG, templateId: 'storefront-b', settingsByTemplate: { ...D_CONFIG.settingsByTemplate, 'storefront-b': reference.settingsByTemplate['storefront-b'] },
    content: Object.fromEntries(Object.entries(reference.content).filter(([key]) => ['home.search', 'home.featured', 'home.catalogue', 'home.starter', 'home.faq', 'home.closing'].includes(key))) };
}
describe('premium B', () => {
  it('ships reviewed tokens and seller-neutral recipe data', () => {
    const entry = STOREFRONT_TEMPLATES['storefront-b'];
    expect(entry).toBeDefined();
    expect(validateThemeContrast(entry.tokens!)).toEqual([]);
    expect(JSON.stringify(entry)).not.toMatch(/techskills|Etsy|PostStack|TSA|n8n/i);
  });
  it('requires its own confirmation and a platform tier', () => {
    for (const [tier, keys, selected] of [
      ['free', ['storefront-b'], 'default'], ['pro', [], 'default'], ['pro', ['storefront-a'], 'default'],
      ['pro', ['storefront-b'], 'storefront-b'], ['business', ['storefront-b'], 'storefront-b'],
    ] as const) expect(resolveSelection(bConfig(), templateRightsForTier(tier, keys).availableTemplateIds).templateId).toBe(selected);
  });
  for (const locale of ['en', 'pl'] as const) it(`${locale}: composes six ordered blocks with public prices and both details destinations`, () => {
    const products = referenceProducts(locale).map((p, i) => ({ ...p, image: null, actions: { ...p.actions, details: `/${locale}/${i === 0 ? 'offer' : 'p'}/${p.slug}` } }));
    const categories = referenceCategories(locale);
    const model = resolvePresentation(resolveSelection(bConfig(), ['default', 'storefront-b']), { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(categories.map(c => [c.id, c])),
      catalogue: { variant: 'compact', groups: { all: { products, nextCursor: null } }, filters: [], pageSize: 24, density: 'comfortable', locale } });
    expect(model.templateId).toBe('storefront-b');
    expect(model.sections.map(s => s.id)).toEqual(['hero', 'featured', 'catalogue', 'starter', 'faq', 'closing']);
    expect(model.sections[0]).toMatchObject({ type: 'task-nav/1', props: { variant: 'search-hero', categories, target: 'catalogue' } });
    expect(model.sections[1]).toMatchObject({ props: { variant: 'featured-grid', products } });
    expect(model.sections[2]).toMatchObject({ props: { variant: 'compact', pageSize: 24 } });
    expect(model.sections[3]).toMatchObject({ props: { product: products[0], action: 'details' } });
    expect(model.sections[5]).toMatchObject({ props: { variant: 'catalogue-link', target: 'catalogue' } });
  });
  it('retains seller copy and inactive settings across B → D → B and anchored normalization', () => {
    const config = bConfig(); const before = JSON.stringify(config);
    expect(validateConfig(config).valid).toBe(true);
    const selected = resolveSelection(config, ['storefront-b']);
    expect(resolveSelection({ ...config, templateId: 'd' }, ['d']).templateId).toBe('d');
    expect(resolveSelection(config, ['storefront-b'])).toEqual(selected);
    expect(JSON.stringify(config)).toBe(before);
    const normalized = normalizeConfigOrders({ ...config, overridesByTemplate: { 'storefront-b': { order: ['hero'], sections: { featured: { visibility: 'hidden' }, starter: { visibility: 'hidden' } } } } } as Parameters<typeof normalizeConfigOrders>[0]);
    expect(normalized.overridesByTemplate['storefront-b']?.order).toEqual(['hero', 'featured', 'catalogue', 'starter', 'faq', 'closing']);
    expect(resolveSelection(normalized, ['storefront-b']).recipe.sections.map(s => s.id)).toEqual(['hero', 'catalogue', 'faq', 'closing']);
    expect(resolveSelection({ ...config, overridesByTemplate: { 'storefront-b': { order: ['catalogue', 'hero'] } } }, ['storefront-b']).diagnostic).toBe('UNSUPPORTED');
  });
});
