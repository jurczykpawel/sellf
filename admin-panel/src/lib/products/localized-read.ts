import 'server-only';
/**
 * Service-role read of `content_config.localized` for products the caller may already see.
 * `content_config` is not readable by buyers, so only the three public text fields leave this module.
 * @see lib/actions/product-localization.ts
 */
import { localizedFromConfig } from '@/lib/products/localized-metadata';
import type { LocalizedProductText } from '@/lib/products/localized-metadata';
import { createAdminClient } from '@/lib/supabase/admin';

export async function readProductLocalizations(productIds: string[], locale: string, ownedIds: ReadonlySet<string>): Promise<Record<string, LocalizedProductText>> {
  const { data, error } = await createAdminClient().from('products').select('id,is_active,is_listed,content_config').in('id', productIds);
  if (error || !data) return {};
  const result: Record<string, LocalizedProductText> = {};
  for (const row of data) {
    if (!ownedIds.has(row.id) && !(row.is_active && row.is_listed)) continue;
    const localized = localizedFromConfig(row.content_config, locale);
    if (Object.keys(localized).length > 0) result[row.id] = localized;
  }
  return result;
}
