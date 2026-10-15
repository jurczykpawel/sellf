/** Bounded full-composition fixtures shared by SSR and hydration checks. */
import { D_CONFIG, DEFAULT_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';
export function compositionFixture(locale: 'en' | 'pl', template: 'default' | 'd') {
  const products = PUBLIC_FIXTURE.products.map(p => ({ ...p, actions: { details: `/${locale}/p/${p.slug}`, buy: `/${locale}/checkout/${p.slug}` } })) as PublicProductInfo[];
  const page = (items: PublicProductInfo[]) => ({ products: items, nextCursor: null });
  const groups = template === 'd' ? { all: page(products) } : { featured: page([products[0]]), free: page(products.filter(p => p.price.kind === 'free')), paid: page(products.filter(p => p.price.kind !== 'free')) };
  const selection = resolveSelection(template === 'd' ? D_CONFIG : DEFAULT_CONFIG, ['default', 'd']);
  const catalogue: CatalogueProps = { variant: template === 'd' ? 'detail-cards' : 'default-groups', groups, filters: ['category', 'price-kind', 'format'], pageSize: template === 'd' ? 9 : 12, density: 'comfortable', locale, categories: PUBLIC_FIXTURE.categories };
  return resolvePresentation(selection, { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(PUBLIC_FIXTURE.categories.map(c => [c.id, c])), catalogue });
}
