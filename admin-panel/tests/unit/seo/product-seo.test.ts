import { describe, expect, it, vi } from 'vitest';
import { getProductAlternates, getProductJsonLd, isIndexableProduct } from '@/lib/seo/products';
import type { Product } from '@/types';

vi.stubEnv('SITE_URL', 'https://shop.example');
const product = {
  id: 'abc', slug: 'course', name: 'Course </script><script>1</script>', description: 'Learn',
  price: 100, currency: 'PLN', is_active: true, is_listed: true,
  available_from: null, available_until: null,
} as Product;

describe('public product metadata', () => {
  it('uses the unprefixed default locale and the Polish prefix', () => {
    expect(getProductAlternates('course', 'pl')).toEqual({
      canonical: 'https://shop.example/pl/p/course',
      languages: { en: 'https://shop.example/p/course', pl: 'https://shop.example/pl/p/course' },
    });
  });

  it('includes only active, listed products within the publication window', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(isIndexableProduct(product, now)).toBe(true);
    for (const patch of [
      { is_active: false }, { is_listed: false },
      { available_from: '2026-10-15T12:00:01Z' },
      { available_until: now.toISOString() },
    ]) expect(isIndexableProduct({ ...product, ...patch }, now)).toBe(false);
    expect(isIndexableProduct({ ...product, available_from: now.toISOString() }, now)).toBe(true);
  });

  it('serializes Product and the current visible offer without literal markup', () => {
    const json = getProductJsonLd({ ...product, sale_price: 70 }, 'en');
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toMatchObject({
      '@context': 'https://schema.org', '@type': 'Product', name: product.name,
      url: 'https://shop.example/p/course',
      offers: { '@type': 'Offer', price: 70, priceCurrency: 'PLN', availability: 'https://schema.org/InStock' },
    });
  });

  it('uses regular pricing after a sale expires or sells out and supports free products', () => {
    for (const patch of [
      { sale_price: 70, sale_price_until: '2000-01-01' },
      { sale_price: 70, sale_quantity_limit: 2, sale_quantity_sold: 2 },
    ]) expect(JSON.parse(getProductJsonLd({ ...product, ...patch }, 'en')).offers.price).toBe(100);
    expect(JSON.parse(getProductJsonLd({ ...product, price: 0 }, 'en')).offers.price).toBe(0);
  });

  it('uses recurring pricing for subscriptions and does not quote customer-chosen amounts', () => {
    expect(JSON.parse(getProductJsonLd({ ...product, product_type: 'subscription', recurring_price: 25,
      billing_interval: 'month', billing_interval_count: 1, sale_price: 70 }, 'pl')).offers).toMatchObject({
      price: 25, priceSpecification: { billingDuration: 'P1M' },
    });
    expect(JSON.parse(getProductJsonLd({ ...product, allow_custom_price: true }, 'en')).offers).toBeUndefined();
  });
});
