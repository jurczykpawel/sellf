/** Synthetic catalogue data; no instance connection. */
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';

export function catalogueProduct(index: number): PublicProductInfo {
  return {
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    slug: `product-${index}`,
    title: `Product ${index}`,
    price: {
      display: index % 4 === 1 ? '0 PLN / month' : index % 4 === 2 ? 'Free' : '49 PLN',
      kind: index % 4 === 1 ? 'subscription' : index % 4 === 2 ? 'free' : index % 4 === 3 ? 'pwyw' : 'one-time',
      taxNote: null,
      omnibus: null,
    },
    marketing: {
      format: 'workshop',
      sourceLocale: 'en',
      en: { result: 'Build a useful report', tools: ['Spreadsheet'], requirements: ['Basic knowledge'] },
    },
    image: null,
    actions: { details: `/en/p/product-${index}`, buy: `/en/checkout/product-${index}` },
    availability: 'available',
  };
}
export function catalogueFixture(variant: CatalogueProps['variant'] = 'detail-cards'): CatalogueProps {
  const products = Array.from({ length: 9 }, (_, i) => catalogueProduct(i + 1));
  return {
    id: 'catalogue',
    variant,
    filters: ['category', 'price-kind', 'format'],
    pageSize: 9,
    density: 'comfortable',
    locale: 'en',
    categories: [{ id: '55555555-5555-4555-8555-555555555555', label: 'Reports', filterTarget: 'catalogue' }],
    groups:
      variant === 'detail-cards'
        ? { all: { products, nextCursor: 'all-cursor' } }
        : {
            featured: { products: [products[0]], nextCursor: 'featured-cursor' },
            free: { products: [products[1]], nextCursor: 'free-cursor' },
            paid: { products: [products[0], products[2]], nextCursor: 'paid-cursor' },
          },
  };
}
