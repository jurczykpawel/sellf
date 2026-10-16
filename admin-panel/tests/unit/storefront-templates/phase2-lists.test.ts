/** Phase 2 list bounds and core presentation. @see docs/templates/phase2-contracts.md */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import ProductList from '@/components/storefront/sections/ProductList';
import { resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import { catalogueGroupsSchema, resolveCatalogue } from '@/lib/storefront-templates/catalogue-section';
import { phase2SectionSchema, phase2SettingsSchema, phase2ContentSchema } from '@/lib/storefront-templates/phase2-contracts';
import { referenceConfig, phase2Recipes } from '../../fixtures/storefront-sections/phase2/contracts';
import { referenceProducts } from '../../fixtures/storefront-sections/phase2/reference';

vi.mock('@/components/storefront/sections/ProductList.module.css', () => ({ default: {} }));

const freeLabel = en.checkout.customPrice.freePreset;
const products = referenceProducts('en').map(product => ({ ...product, price: { ...product.price, display: product.price.kind === 'free' ? freeLabel : product.price.display } }));
const config = referenceConfig();
const parsedComparison = phase2SectionSchema.parse(phase2Recipes.a.sections[2]);
if (parsedComparison.type !== 'product-list/1') throw new Error('Expected comparison');
const comparison = parsedComparison;
const parsedFeatured = phase2SectionSchema.parse(phase2Recipes.b.sections[1]);
if (parsedFeatured.type !== 'product-list/1') throw new Error('Expected featured');
const featured = parsedFeatured;
function inputs() {
  return { locale: 'en' as const, settings: { comparisonProducts: products.slice(0, 2).map(p => p.id), featuredProducts: products.map(p => p.id).reverse() }, productsById: Object.fromEntries(products.map(p => [p.id, p])), slots: { 'home.comparison': config.content['home.comparison'].en, 'home.featured': config.content['home.featured'].en } };
}
const render = (props: Parameters<typeof ProductList>[0]) => renderToStaticMarkup(createElement(ProductList, props));
describe('Phase 2 lists', () => {
  it('matches comparison prose by product ID when localized items are reordered', () => {
    const source = inputs();
    source.slots['home.comparison'].items.forEach((item, index) => { item.heading = `Selected offer ${index}`; });
    source.slots['home.comparison'].items.reverse();
    const props = resolveProductList(comparison, source);
    const html = render(props);
    const articles = html.match(/<article[\s\S]*?<\/article>/g)!;
    expect(articles[0]).toContain('Selected offer 0');
    expect(articles[0]).not.toContain('Selected offer 1');
    expect(articles[1]).toContain('Selected offer 1');
    expect(props.variant).toBe('comparison');
    expect(props.products.map(p => p.id)).toEqual(source.settings.comparisonProducts);
    expect(html.indexOf(freeLabel)).toBeLessThan(html.indexOf('PLN 49'));
    for (const product of products.slice(0, 2)) expect(html).toContain(product.actions.details);
    expect(html).toContain(source.slots['home.comparison'].body);
    expect(html).not.toContain('<h1');
  });
  it('retains six ordered featured bindings and removes unavailable or missing products', () => {
    const source = inputs();
    expect(resolveProductList(featured, source).products.map(p => p.id)).toEqual(source.settings.featuredProducts);
    source.productsById[products[4].id] = { ...products[4], availability: 'unavailable' };
    delete source.productsById[products[5].id];
    expect(resolveProductList(featured, source).products.map(p => p.id)).toEqual(products.slice(0, 4).reverse().map(p => p.id));
  });
  it('keeps core prices, notes and details actions for free and subscription products', () => {
    const source = inputs();
    source.productsById[products[1].id] = { ...products[1], price: { kind: 'subscription', display: '0 PLN / month', taxNote: 'Tax note', omnibus: 'Prior price' } };
    for (const spec of [comparison, featured]) {
      const html = render(resolveProductList(spec, source));
      for (const text of [freeLabel, '0 PLN / month', 'Tax note', 'Prior price']) expect(html).toContain(text);
      expect(html).not.toContain('/checkout/');
    }
  });
  it('accepts only matching slot kinds and keeps the independent bounds', () => {
    const source = inputs();
    expect(resolveProductList(featured, { ...source, slots: {} }).content).toBeNull();
    expect(resolveProductList(comparison, { ...source, slots: { 'home.comparison': source.slots['home.featured'] } }).content).toBeNull();
    expect(phase2SettingsSchema.safeParse({ starterProducts: products.slice(0, 4).map(p => p.id) }).success).toBe(false);
    expect(phase2SettingsSchema.safeParse({ featuredProducts: [...source.settings.featuredProducts, products[0].id] }).success).toBe(false);
    expect(phase2SettingsSchema.safeParse({ comparisonProducts: [products[0].id] }).success).toBe(false);
    expect(render({ ...resolveProductList(featured, source), products: [] })).toBe('');
  });
  it('resolves compact catalogue as one bounded all-products group', () => {
    const spec = phase2Recipes.a.sections[4];
    const catalogue = { variant: 'compact' as const, groups: { all: { products: [], nextCursor: null } }, filters: [], pageSize: 24 as const, density: 'compact' as const, locale: 'en' as const };
    expect(resolveCatalogue(spec, { locale: 'en', settings: {}, catalogue }).variant).toBe('compact');
    expect(catalogueGroupsSchema('compact', 24).safeParse({ all: { products: Array.from({ length: 25 }, () => products[0]), nextCursor: null } }).success).toBe(false);
    expect(catalogueGroupsSchema('compact', 24).safeParse({ featured: { products: [], nextCursor: null } }).success).toBe(false);
  });
});

it('bounds optional localized list and catalogue editorial copy', () => {
  const value = { sourceLocale: 'en', en: { kind: 'heading', heading: 'Featured', body: '', eyebrow: 'Browse', items: [{ productId: products[0].id, eyebrow: 'Guide', descriptor: 'Guide and files', detailHeading: 'What you receive', detailBody: 'Follow the instructions.', requirementsLabel: 'Before you begin' }] } };
  expect(phase2ContentSchema.safeParse({ 'home.featured': value }).success).toBe(true);
  expect(phase2ContentSchema.safeParse({ 'home.featured': { ...value, en: { ...value.en, eyebrow: 'x'.repeat(81) } } }).success).toBe(false);
  expect(phase2ContentSchema.safeParse({ 'home.featured': { ...value, en: { ...value.en, items: [...value.en.items, ...value.en.items] } } }).success).toBe(false);
});

for (const [field, limit] of Object.entries({ eyebrow: 80, descriptor: 120, detailHeading: 160, detailBody: 1000, requirementsLabel: 240 })) {
  it(`bounds featured ${field} annotations`, () => {
    const value = (length: number) => ({ 'home.featured': { sourceLocale: 'pl', pl: { kind: 'heading', heading: '', body: '', items: [{ productId: products[0].id, [field]: 'ą'.repeat(length) }] } } });
    expect(phase2ContentSchema.safeParse(value(limit)).success).toBe(true);
    expect(phase2ContentSchema.safeParse(value(limit + 1)).success).toBe(false);
  });
}
