/** Bounded full-composition fixtures shared by SSR and hydration checks. */
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { referenceConfig } from './phase2/contracts';
import { referenceProducts, referenceCategories } from './phase2/reference';
import { D_CONFIG, DEFAULT_CONFIG, PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';
export function compositionFixture(locale: 'en' | 'pl', template: 'default' | 'd' | 'storefront-a') {
  if (template === 'storefront-a') {
    const reference = referenceConfig();
    const config = configSchema.parse({ ...reference,
      settingsByTemplate: { 'storefront-a': reference.settingsByTemplate['storefront-a'] },
      content: Object.fromEntries(Object.entries(reference.content).filter(([id]) => ['home.hero', 'home.tasks', 'home.starts', 'home.comparison', 'home.catalogue', 'home.faq', 'home.closing'].includes(id))),
    });
    const products = referenceProducts(locale).map(product => ({ ...product, price: { ...product.price, display: product.price.kind === 'free' ? (locale === 'pl' ? pl : en).checkout.customPrice.freePreset : product.price.display }, image: { ...product.image!, src: 'https://composition.test/sample.svg' } }));
    const categories = referenceCategories(locale);
    return resolvePresentation(resolveSelection(config, ['storefront-a']), { locale,
      productsById: Object.fromEntries(products.map(product => [product.id, product])), categoriesById: Object.fromEntries(categories.map(category => [category.id, category])),
      catalogue: { variant: 'compact', groups: { all: { products, nextCursor: null } }, filters: ['category', 'price-kind', 'format'], pageSize: 24, density: 'comfortable', locale, categories } });
  }
  const products = PUBLIC_FIXTURE.products.map(p => ({ ...p, actions: { details: `/${locale}/p/${p.slug}`, buy: `/${locale}/checkout/${p.slug}` } })) as PublicProductInfo[];
  const page = (items: PublicProductInfo[]) => ({ products: items, nextCursor: null });
  const groups = template === 'd' ? { all: page(products) } : { featured: page([products[0]]), free: page(products.filter(p => p.price.kind === 'free')), paid: page(products.filter(p => p.price.kind !== 'free')) };
  const selection = resolveSelection(template === 'd' ? D_CONFIG : DEFAULT_CONFIG, ['default', 'd']);
  const catalogue: CatalogueProps = { variant: template === 'd' ? 'detail-cards' : 'default-groups', groups, filters: ['category', 'price-kind', 'format'], pageSize: template === 'd' ? 9 : 12, density: 'comfortable', locale, categories: PUBLIC_FIXTURE.categories };
  return resolvePresentation(selection, { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(PUBLIC_FIXTURE.categories.map(c => [c.id, c])), catalogue });
}
