'use server';

/**
 * Locale-specific customer text for products shown on the buyer's My Products page.
 * `content_config` is service-role only, so only the three public text fields are read here and only for
 * products the caller may see anyway (active + listed, or already owned).
 * @see lib/products/localized-metadata.ts
 */
import { z } from 'zod';
import { locales } from '@/lib/locales';
import { readProductLocalizations } from '@/lib/products/localized-read';
import type { LocalizedProductText } from '@/lib/products/localized-metadata';
import { createClient } from '@/lib/supabase/server';

const inputSchema = z.object({ productIds: z.array(z.uuid()).max(200), locale: z.enum(locales) });

export async function getProductLocalizations(productIds: string[], locale: string): Promise<Record<string, LocalizedProductText>> {
  const input = inputSchema.safeParse({ productIds, locale });
  if (!input.success || input.data.productIds.length === 0) return {};
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return {};
    const ids = [...new Set(input.data.productIds)];
    const owned = await supabase.from('user_product_access').select('product_id').eq('user_id', user.id).in('product_id', ids);
    if (owned.error) return {};
    const ownedIds = new Set((owned.data ?? []).map(row => row.product_id));
    return await readProductLocalizations(ids, input.data.locale, ownedIds);
  } catch (error) {
    console.error('[getProductLocalizations] Error:', error instanceof Error ? error.message : 'Unknown error');
    return {};
  }
}
