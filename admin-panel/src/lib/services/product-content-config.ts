import type { createAdminClient } from '@/lib/supabase/admin';
import type { ProductContentConfig } from '@/types';

/**
 * Load a product's delivered content. `content_config` is readable by the
 * service role only, so callers MUST confirm the requester's access (or admin
 * preview) before calling this.
 */
export async function loadProductContentConfig(
  adminClient: ReturnType<typeof createAdminClient>,
  productId: string,
): Promise<ProductContentConfig | null> {
  const { data, error } = await adminClient
    .from('products')
    .select('content_config')
    .eq('id', productId)
    .maybeSingle();

  if (error) {
    console.error('[product-content-config] Failed to load content config:', error);
    return null;
  }
  return (data?.content_config ?? null) as ProductContentConfig | null;
}
