import 'server-only';
/**
 * Service-role read of `content_config.localized` for products the caller has already been shown to see.
 * `content_config` is not readable by buyers, so only the three public text fields leave this module.
 * @see lib/actions/product-localization.ts
 */
import { localizedFromConfig } from '@/lib/products/localized-metadata';
import type { LocalizedProductText } from '@/lib/products/localized-metadata';
import { createAdminClient } from '@/lib/supabase/admin';

/** `visibleIds` must come from a product read under the caller's session (row level security). */
export async function readProductLocalizations(visibleIds: string[], locale: string): Promise<Record<string, LocalizedProductText>> {
  if (visibleIds.length === 0) return {};
  const { data, error } = await createAdminClient().from('products').select('id,content_config').in('id', visibleIds);
  if (error || !data) return {};
  const result: Record<string, LocalizedProductText> = {};
  for (const row of data) {
    const localized = localizedFromConfig(row.content_config, locale);
    if (Object.keys(localized).length > 0) result[row.id] = localized;
  }
  return result;
}
