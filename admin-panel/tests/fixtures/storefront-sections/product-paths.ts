/** Synthetic C path fixtures over bounded public product inputs. */
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { referenceConfig } from './phase2/contracts';
import { referenceCopy, referenceProducts } from './phase2/reference';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';

export const pathsSpec = { id: 'paths', type: 'product-paths/1', content: { slot: 'home.paths' } } as const;
export type PathsState = 'paths' | 'empty' | 'long' | 'unavailable' | 'no-media' | 'prices';
export function pathsFixture(locale: 'en' | 'pl', state: PathsState = 'paths') {
  const t = referenceCopy[locale];
  const source = referenceConfig().content['home.paths'][locale];
  const content = { ...structuredClone(source), eyebrow: t.eyebrow, actionLabel: t.view, items: source.items.map(item => ({ ...item, label: t.format })) };
  const products = referenceProducts(locale).slice(0, 4);
  products[0].price.display = (locale === 'pl' ? pl : en).checkout.customPrice.freePreset;
  if (state === 'long') {
    content.heading = 'ąŻLongText'.repeat(16); content.body = 'longword'.repeat(500);
    content.items.forEach(item => { item.situation = 'ąŻLongText'.repeat(16); item.body = 'longword'.repeat(125); });
    products.forEach(product => { product.title = 'ąŻLongText'.repeat(25); });
  }
  if (state === 'unavailable') products[1].availability = 'unavailable';
  if (state === 'no-media') products.forEach(product => { product.image = null; });
  if (state === 'prices') products.forEach((product, index) => {
    product.price = { kind: (['free', 'one-time', 'subscription', 'pwyw'] as const)[index], display: ['Core free label', 'PLN 49', 'PLN 19 / month', 'PLN 5+'][index], taxNote: 'Core tax note', omnibus: 'Core prior price' };
    product.accessDurationDays = 30;
  });
  return { locale, slots: state === 'empty' ? {} : { 'home.paths': content },
    productsById: Object.fromEntries(products.map(product => [product.id, product])) as Record<string, PublicProductInfo | null> };
}
