/** Draft for the "Duplicate" action. @see @/components/ProductsPageContent */
import type { Product } from '@/types';

function withoutId<T extends { id?: string }>(value: T): T {
  const copy = { ...value };
  delete copy.id;
  return copy;
}

/** Copy of a product without its identity; event sessions and tiers keep their data but not their ids. */
export function duplicateProductDraft(product: Product, namePrefix: string): Product {
  return {
    ...product,
    name: `${namePrefix}${product.name}`,
    id: '' as Product['id'],
    slug: '',
    created_at: '' as Product['created_at'],
    updated_at: '' as Product['updated_at'],
    sessions: product.sessions?.map(session => ({ ...withoutId(session), tiers: session.tiers.map(withoutId) })),
  };
}
