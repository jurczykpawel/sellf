/**
 * DB TEST: the E2E seed-product safety net (Playwright globalTeardown).
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * Regression coverage for a real incident: an E2E spec that bulk-deactivates every
 * product row (to assert empty/filtered storefront states) got interrupted before its
 * own restore step ran, leaving the seeded `free-tutorial` product inactive. That broke
 * tests/unit/security/pending-free-grants.test.ts, which assumes `free-tutorial` is an
 * active free product, on any later run against the same (non-reset) local database.
 *
 * @see tests/helpers/product-state.ts
 * @see tests/global-teardown.ts
 * @see supabase/seed.sql
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { restoreSeedProductState, SEED_PRODUCT_SLUGS } from '../../helpers/product-state';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe('restoreSeedProductState', () => {
  it('reactivates a seed product left inactive by an interrupted test', async () => {
    const slug = 'free-tutorial';

    await admin.from('products').update({ is_active: false }).eq('slug', slug);
    const { data: deactivated } = await admin
      .from('products')
      .select('is_active')
      .eq('slug', slug)
      .single();
    expect(deactivated?.is_active).toBe(false);

    await restoreSeedProductState(admin);

    const { data: restored } = await admin
      .from('products')
      .select('is_active')
      .eq('slug', slug)
      .single();
    expect(restored?.is_active).toBe(true);
  });

  it('lists every canonical seed slug that actually exists in supabase/seed.sql', async () => {
    const { data, error } = await admin
      .from('products')
      .select('slug')
      .in('slug', SEED_PRODUCT_SLUGS as unknown as string[]);

    expect(error).toBeNull();
    const foundSlugs = new Set((data ?? []).map((p) => p.slug));
    for (const slug of SEED_PRODUCT_SLUGS) {
      expect(foundSlugs.has(slug)).toBe(true);
    }
  });
});
