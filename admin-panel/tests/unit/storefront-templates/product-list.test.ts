/** Starter section contract and public rendering. @see tests/fixtures/storefront-sections/product-list.ts */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import ProductList from '@/components/storefront/sections/ProductList';
import { productListSectionSchema, resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import { starterProducts, starterSpec, starterInputs } from '../../fixtures/storefront-sections/product-list';

vi.mock('@/components/storefront/sections/ProductList.module.css', () => ({ default: {} }));

const render = (props = resolveProductList(starterSpec, starterInputs())) => renderToStaticMarkup(createElement(ProductList, props));
describe('starter product list', () => {
  it('reuses strict recipe bindings and slot kinds', () => {
    expect(productListSectionSchema.safeParse(starterSpec).success).toBe(true);
    for (const changes of [{ variant: 'grid' }, { products: { setting: 'heroProduct' } }, { content: { slot: 'home.hero' } }, { extra: true }]) {
      expect(productListSectionSchema.safeParse({ ...starterSpec, ...changes }).success).toBe(false);
    }
  });
  it('resolves only selected distinct available starters in seller order with a three-item bound', () => {
    const inputs = starterInputs();
    const [a, b, c] = starterProducts;
    inputs.settings.starterProducts = [c.id, a.id, c.id, 'missing', b.id, a.id];
    inputs.productsById[b.id] = { ...b, availability: 'unavailable' };
    const props = resolveProductList(starterSpec, inputs);
    expect(props.products.map(product => product.id)).toEqual([c.id, a.id]);
    expect(props.products[0]).toBe(c);
    inputs.productsById[b.id] = b;
    expect(resolveProductList(starterSpec, inputs).products).toHaveLength(3);
    expect(props.content).toEqual(inputs.slots['home.starts']);
  });
  it('omits empty and unavailable-only sections without replacement copy', () => {
    expect(render({ variant: 'detail-cards', products: [], content: null, locale: 'en' })).toBe('');
    expect(render({ variant: 'compact', products: [{ ...starterProducts[0], availability: 'unavailable' }], content: null, locale: 'pl' })).toBe('');
    const inputs = starterInputs();
    inputs.slots = {};
    expect(resolveProductList(starterSpec, inputs).content).toBeNull();
    inputs.slots = { 'home.starts': { kind: 'faq', items: [] } };
    expect(resolveProductList(starterSpec, inputs).content).toBeNull();
  });
  for (const variant of ['detail-cards', 'compact'] as const) {
    it(`${variant} preserves every core price, note, image and details destination`, () => {
      const html = render({ ...resolveProductList(starterSpec, starterInputs()), variant });
      for (const product of starterProducts) {
        expect(html).toContain(product.price.display);
        expect(html).toContain(`href="${product.actions.details}"`);
        expect(html).toContain(product.title);
      }
      expect(html).toContain('0 PLN / month');
      expect(html).toContain('Lowest prior price: 49 PLN');
      expect(html).toContain('Including VAT 23%');
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('width="800" height="500"');
      expect(html).not.toContain('/checkout/');
      expect(html).not.toContain('<h1');
    });
  }
  it('uses source-locale editorial fallback and omits absent metadata', () => {
    const html = render({ variant: 'compact', products: [starterProducts[0]], content: null, locale: 'pl' });
    expect(html).toContain('lang="en"');
    expect(html).toContain('Wymagania');
    const empty = { ...starterProducts[0], image: null, marketing: { format: null, sourceLocale: 'en' as const, en: { result: null, tools: [], requirements: [] } } };
    const blank = render({ variant: 'detail-cards', products: [empty], content: null, locale: 'en' });
    expect(blank).not.toContain('<details');
    expect(blank).not.toContain('<img');
    expect(blank).not.toContain('Requirements');
    expect(blank).toContain(`<h2>${empty.title}</h2>`);
  });
  it('renders core batched binding output in both locales without further reads', async () => {
    for (const locale of ['en', 'pl'] as const) {
      const rows = starterProducts.map((product, index) => ({
        id: product.id, slug: product.slug, name: product.title, created_at: '2026-01-01T00:00:00.000000+00:00',
        price: index === 2 ? 39 : 0, currency: 'PLN', product_type: index === 1 ? 'subscription' : 'one_time',
        recurring_price: index === 1 ? 0 : null, billing_interval: index === 1 ? 'month' : null, billing_interval_count: 1,
        allow_custom_price: false, custom_price_min: null, sale_price: null, sale_price_until: null,
        sale_quantity_limit: null, sale_quantity_sold: 0, marketing_fields: product.marketing, image_url: product.image?.src ?? null,
        vat_rate: 23, vat_exempt: false, vat_exempt_note: null, price_includes_vat: true, tax_mode: 'local', lowest_prior_price: null,
      }));
      const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
      const client = { rpc } as unknown as Parameters<typeof loadStorefrontBindings>[0];
      const result = await loadStorefrontBindings(client, { locale, starterProducts: starterProducts.map(product => product.id).reverse(), target: 'catalogue' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.starters.map(product => product.price.kind)).toEqual(['one-time', 'subscription', 'free']);
      const products = result.data.starters;
      for (const variant of ['detail-cards', 'compact'] as const) {
        const html = render({ variant, locale, products, content: null });
        for (const product of products) {
          expect(html).toContain(product.price.display);
          expect(html).toContain(product.actions.details);
          if (product.price.taxNote) expect(html).toContain(product.price.taxNote);
        }
        expect(html).toContain(`/${locale}/p/starter-1`);
      }
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('escapes text and does not serialize unrelated public-model properties', () => {
    const product = { ...starterProducts[0], title: '<script>window.example=1</script>', internalSentinel: 'PRIVATE_SENTINEL' };
    const html = render({ variant: 'compact', products: [product], content: { kind: 'heading', heading: '<img onerror=alert(1)>', body: '' }, locale: 'en' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('PRIVATE_SENTINEL');
  });
});
