/** Buyer facts in all card treatments. @see lib/storefront-templates/catalogue.ts */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Catalogue from '@/components/storefront/sections/Catalogue';
import ProductList from '@/components/storefront/sections/ProductList';
import HeroProduct from '@/components/storefront/sections/HeroProduct';
import ProductCta from '@/components/storefront/sections/ProductCta';
import { cataloguePageSchema } from '@/lib/storefront-templates/catalogue-section';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';

vi.mock('@/components/storefront/sections/Catalogue.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/ProductList.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
vi.mock('@/components/storefront/sections/FaqClosing.module.css', () => ({ default: {} }));

function product(locale: 'en' | 'pl') {
  return {
    id: '10000000-0000-4000-8000-000000000001', slug: 'buyer-facts', title: 'Buyer facts',
    description: 'The original seller description.', accessDurationDays: 30,
    availableUntil: '2030-01-02T12:00:00.000Z', availableUntilLabel: locale === 'en' ? 'Available until Jan 2, 2030, 12:00 PM UTC' : 'Dostępny do 2 sty 2030, 12:00 UTC',
    price: { display: locale === 'en' ? '$10.00' : '10,00 USD', originalDisplay: locale === 'en' ? '$20.00' : '20,00 USD', taxNote: null, omnibus: locale === 'en' ? 'Lowest price: $18.00' : 'Najniższa cena: 18,00 USD', kind: 'one-time' as const },
    marketing: { format: null, sourceLocale: 'en' as const, en: { result: null, tools: [], requirements: [] } },
    image: null, actions: { details: `/${locale}/p/buyer-facts`, buy: `/${locale}/checkout/buyer-facts` }, availability: 'available' as const,
  };
}

describe('card buyer facts', () => {
  for (const locale of ['en', 'pl'] as const) for (const variant of ['default-groups', 'detail-cards', 'compact'] as const) {
    it(`${locale}/${variant} keeps description, current/regular/omnibus prices and access/availability`, () => {
      const value = product(locale);
      const html = renderToStaticMarkup(variant === 'default-groups'
        ? createElement(Catalogue, { variant, locale, pageSize: 12, density: 'comfortable', filters: [], groups: { featured: { products: [], nextCursor: null }, free: { products: [], nextCursor: null }, paid: { products: [value], nextCursor: null } } })
        : createElement(ProductList, { variant, locale, products: [value], content: null }));
      expect(html).toContain(value.description);
      expect(html).toContain(value.price.display);
      expect(html).toMatch(/<del[\s>]/);
      expect(html).toContain(value.price.originalDisplay);
      expect(html).toContain(value.price.omnibus);
      expect(html).toContain(locale === 'en' ? '30d access' : '30d dostęp');
      expect(html).toContain(`dateTime="${value.availableUntil}"`);
      expect(html).toContain(value.availableUntilLabel);
    });
  }
  for (const locale of ['en', 'pl'] as const) it(`${locale} shared offers retain the regular sale price`, () => {
    const value = product(locale);
    for (const view of [createElement(HeroProduct, { variant: 'simple', product: value, content: null, locale }),
      createElement(ProductCta, { product: value, content: null, action: 'details', locale })]) {
      const html = renderToStaticMarkup(view);
      expect(html).toMatch(/<del[\s>]/); expect(html).toContain(value.price.originalDisplay);
      expect(html).toContain(value.price.display); expect(html).toContain(value.price.omnibus);
    }
  });
  it('retains public facts on pagination and rejects unrelated fields', () => {
    const value = product('en');
    const page = { products: [value], nextCursor: null };
    const parsed = cataloguePageSchema(12).safeParse(page);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.products[0]).toMatchObject(value);
    expect(cataloguePageSchema(12).safeParse({ ...page, products: [{ ...value, content_config: 'unrelated' }] }).success).toBe(false);
  });
  it('keeps free labels without a regular-price marker', () => {
    const value: PublicProductInfo = { ...product('en'), price: { kind: 'free', display: 'Free', taxNote: null, omnibus: null } };
    const html = renderToStaticMarkup(createElement(ProductList, { variant: 'compact', locale: 'en', products: [value], content: null }));
    expect(html).toContain('Free'); expect(html).not.toContain('<del');
  });
});
