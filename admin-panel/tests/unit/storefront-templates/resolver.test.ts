/** Composition selection and public-model contracts. */
import { describe, expect, it, vi } from 'vitest';
import { D_CONFIG, DEFAULT_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { resolveSelection, resolvePresentation } from '@/lib/storefront-templates/resolver';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
function inputs(locale: 'en' | 'pl' = 'en') {
  const products = PUBLIC_FIXTURE.products.map(p => ({ ...p, actions: { details: `/${locale}/p/${p.slug}`, buy: `/${locale}/checkout/${p.slug}` } })) as PublicProductInfo[];
  return { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(PUBLIC_FIXTURE.categories.map(c => [c.id, c])),
    catalogue: { variant: 'detail-cards' as const, groups: { all: { products, nextCursor: null } }, filters: [], pageSize: 9 as const, density: 'comfortable' as const, locale } };
}
describe('storefront composition', () => {
  it('selects the free default and requires explicit D rights', () => {
    expect(resolveSelection(DEFAULT_CONFIG).templateId).toBe('default');
    expect(resolveSelection(D_CONFIG).templateId).toBe('default');
    expect(resolveSelection(D_CONFIG, ['default', 'd']).templateId).toBe('d');
  });
  it('retains content and inactive settings across D → default → D', () => {
    const before = JSON.stringify(D_CONFIG);
    const first = resolveSelection(D_CONFIG, ['default', 'd']);
    resolveSelection({ ...D_CONFIG, templateId: 'default' }, ['default', 'd']);
    expect(resolveSelection(D_CONFIG, ['default', 'd'])).toEqual(first);
    expect(JSON.stringify(D_CONFIG)).toBe(before);
  });
  it('defaults unknown templates, unsupported sections and malformed configuration', () => {
    expect(resolveSelection({ ...D_CONFIG, templateId: 'future' }).diagnostic).toBeTruthy();
    expect(resolveSelection(null).templateId).toBe('default');
    const original = STOREFRONT_TEMPLATES.d.defaults;
    try {
      Object.assign(STOREFRONT_TEMPLATES.d, { defaults: { ...original, sections: [{ id: 'future', type: 'future/1' }] } });
      expect(resolveSelection(D_CONFIG, ['default', 'd']).templateId).toBe('default');
    } finally { Object.assign(STOREFRONT_TEMPLATES.d, { defaults: original }); }
  });
  it('defaults entries requiring a later application version', () => {
    const original = STOREFRONT_TEMPLATES.d.minSellf;
    try {
      STOREFRONT_TEMPLATES.d.minSellf = '2099.1.0';
      expect(resolveSelection(D_CONFIG, ['default', 'd']).templateId).toBe('default');
    } finally { STOREFRONT_TEMPLATES.d.minSellf = original; }
  });
  it('applies active overrides and resolves source-locale slots', () => {
    const config = structuredClone(D_CONFIG);
    config.overridesByTemplate.d = { hidden: ['tasks'], variants: { hero: 'simple', start: 'compact' } };
    const model = resolvePresentation(resolveSelection(config, ['default', 'd']), inputs('pl'));
    expect(model.sections.map(s => s.type)).toEqual(['hero-product/1', 'product-list/1', 'catalogue/1', 'faq/1', 'product-cta/1']);
    expect(model.sections[0]).toMatchObject({ props: { variant: 'simple', content: D_CONFIG.content['home.hero']!.en } });
  });
  for (const locale of ['en', 'pl'] as const) it(`${locale}: complete D preserves core public truth`, () => {
    const input = inputs(locale);
    const model = resolvePresentation(resolveSelection(D_CONFIG, ['default', 'd']), input);
    expect(model.sections.map(s => s.id)).toEqual(['hero', 'tasks', 'start', 'catalogue', 'faq', 'closing']);
    expect(model.sections[0]).toMatchObject({ props: { product: input.productsById[PUBLIC_FIXTURE.products[0].id] } });
    expect(model.sections[5]).toMatchObject({ props: { product: input.productsById[PUBLIC_FIXTURE.products[0].id] } });
    expect(JSON.stringify(model)).not.toMatch(/settingsByTemplate|tokens|draft|client|customer|experiment|assignment/);
    expect(resolvePresentation(resolveSelection(D_CONFIG, ['default', 'd']), input)).toEqual(model);
  });
  it('keeps exact independent default groups', () => {
    const input = inputs(); const page = input.catalogue.groups.all;
    const model = resolvePresentation(resolveSelection(DEFAULT_CONFIG), { ...input, catalogue: { ...input.catalogue, variant: 'default-groups', pageSize: 12, groups: { featured: page, free: { products: [], nextCursor: null }, paid: page } } });
    expect(model.sections).toHaveLength(1);
    expect(model.catalogue.groups).toEqual({ featured: page, free: { products: [], nextCursor: null }, paid: page });
  });
});
