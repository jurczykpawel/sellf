/**
 * Tax mode isolation for E2E specs.
 *
 * shop_config is a global singleton and checkout reads it through the public cache in
 * src/lib/public-cache.ts (entries are served for at most 60 s). A direct database write
 * does not invalidate that cache, so after a spec leaves `stripe_tax` the app can still
 * serve `stripe_tax` to the next checkout test and answer 503 STRIPE_TAX_NOT_CONFIGURED.
 * Every spec that changes the tax mode goes through these helpers and restores
 * BASELINE_TAX_MODE; leaving `stripe_tax` waits until a cached copy has expired.
 */

import { test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

export type TaxMode = 'local' | 'stripe_tax';

export const BASELINE_TAX_MODE: TaxMode = 'local';

/** Upper bound of how long the public shop_config cache serves one entry (public-cache.ts). */
const PUBLIC_CACHE_TTL_MS = 60_000;
const SAFETY_MARGIN_MS = 2_000;

export async function setTaxMode(db: SupabaseClient, mode: TaxMode): Promise<void> {
  const { data, error: readError } = await db.from('shop_config').select('tax_mode');
  if (readError) throw readError;
  const leavingStripeTax = (data ?? []).some(row => row.tax_mode === 'stripe_tax') && mode !== 'stripe_tax';

  const { error } = await db.from('shop_config').update({ tax_mode: mode }).not('id', 'is', null);
  if (error) throw error;

  if (leavingStripeTax) {
    const wait = PUBLIC_CACHE_TTL_MS + SAFETY_MARGIN_MS;
    test.setTimeout(test.info().timeout + wait); // the wait counts against the running test/hook timeout
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

export function restoreBaselineTaxMode(db: SupabaseClient): Promise<void> {
  return setTaxMode(db, BASELINE_TAX_MODE);
}
