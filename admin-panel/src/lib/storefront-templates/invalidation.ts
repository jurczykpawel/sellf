/** Post-commit public data invalidation. Expiry remains the fallback. @see public-cache.ts */
import 'server-only';
import { revalidateTag } from 'next/cache';

export function invalidatePublicProducts(productId?: string, slug?: string | null, taxonomy = false): void {
  const tags = ['product-by-slug', 'storefront-products', ...(productId ? [`product:${productId}`] : []), ...(slug ? [`product:${slug}`] : []), ...(taxonomy ? ['taxonomy'] : [])];
  for (const tag of tags) {
    try { revalidateTag(tag, { expire: 0 }); } catch { console.error('[invalidatePublicProducts] Invalidation unavailable'); }
  }
}
