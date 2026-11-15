'use server';

/**
 * Locale-specific customer text for products shown on the buyer's My Products page.
 * `content_config` is service-role only, so only the three public text fields are read here and only for
 * products the caller's session can read (the products read policy: publication window, inactive, archive).
 * @see lib/products/localized-metadata.ts
 */
import { z } from 'zod';
import { locales } from '@/lib/locales';
import { readProductLocalizations } from '@/lib/products/localized-read';
import { LOCALIZATION_BATCH_SIZE } from '@/lib/products/localized-metadata';
import type { LocalizedProductText } from '@/lib/products/localized-metadata';
import { createClient } from '@/lib/supabase/server';

const inputSchema = z.object({ productIds: z.array(z.uuid()).max(LOCALIZATION_BATCH_SIZE), locale: z.enum(locales) });

export async function getProductLocalizations(productIds: string[], locale: string): Promise<Record<string, LocalizedProductText>> {
  const input = inputSchema.safeParse({ productIds, locale });
  if (!input.success || input.data.productIds.length === 0) return {};
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return {};
    const ids = [...new Set(input.data.productIds)];
    const visible = await supabase.from('products').select('id').in('id', ids);
    if (visible.error) return {};
    return await readProductLocalizations((visible.data ?? []).map(row => row.id), input.data.locale);
  } catch (error) {
    console.error('[getProductLocalizations] Error:', error instanceof Error ? error.message : 'Unknown error');
    return {};
  }
}
