/** Core details destinations, resolved after catalogue caches to avoid nested TTLs. */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';

/** At most one bounded status read per page/binding batch, never one read per card. */
export async function resolveOfferDetails(client: SupabaseClient<Database>, products: PublicProductInfo[], locale: 'en' | 'pl'): Promise<PublicProductInfo[]> {
  if (!products.length) return products;
  try {
    const ids = [...new Set(products.map(product => product.id))];
    const { data, error } = await client.from('product_offer_config').select('product_id').in('product_id', ids).eq('published->>enabled', 'true').limit(ids.length);
    if (error || !data) return products;
    const enabled = new Set(data.map(row => row.product_id));
    return products.map(product => enabled.has(product.id) ? { ...product, actions: { ...product.actions, details: `/${locale}/offer/${product.slug}` } } : product);
  } catch { return products; }
}
