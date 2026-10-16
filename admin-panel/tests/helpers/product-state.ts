/**
 * Product State Guard
 *
 * Saves and restores the active state of all products in public.
 * Use in test suites that deactivate ALL products (e.g., storefront scenarios).
 *
 * Usage:
 *   const guard = new ProductStateGuard(supabaseAdmin);
 *   test.beforeAll(async () => { await guard.save(); });
 *   test.afterEach(async () => { await guard.restore(); });
 *   test.afterAll(async () => { await guard.restore(); });
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Canonical product slugs from supabase/seed.sql — every one of them is seeded with
 * `is_active = true`. Keep this list in sync with seed.sql when products are added.
 *
 * Some specs (storefront-landing.spec.ts, smart-landing.spec.ts) deactivate every
 * product row to assert empty/filtered storefront states, then restore the
 * originally-active set via ProductStateGuard. That restore runs in afterEach/afterAll
 * and is reliable against a normal assertion failure — but if the run itself is
 * interrupted mid-test (a hung dev server under full-suite memory pressure, a killed
 * process — see scripts/run-pw-sharded.sh's own notes on Turbopack's memory growth),
 * the hook never gets a chance to run and a seed row can be left inactive, poisoning
 * later tests/runs that assume it (e.g. tests/unit/security/pending-free-grants.test.ts
 * expects `free-tutorial` to be an active free product).
 */
export const SEED_PRODUCT_SLUGS = [
  'free-tutorial',
  'premium-course',
  'pro-toolkit',
  'vip-masterclass',
  'enterprise-package',
  'community-guide',
  'design-system-bundle',
  'postaw-mi-kawe',
  'test-oto-active',
  'test-product-redirect',
  'test-custom-redirect',
  'test-oto-owned',
  'test-no-redirect',
  'test-oto-target',
  'variant-demo-starter',
  'variant-demo-pro',
  'variant-demo-enterprise',
  'pro-membership-monthly',
  'pro-membership-yearly',
  'funnel-mini-pdf',
  'funnel-premium-course',
  'funnel-toolkit',
  'starter-bundle',
] as const;

/**
 * Last-resort safety net: unconditionally reactivates every known seed product.
 * Safe to call at any time (idempotent). Wired into Playwright's globalTeardown
 * (see tests/global-teardown.ts) so a run always leaves seed data in its seeded
 * state, regardless of which spec deactivated it or whether that spec's own
 * restore step got to run.
 */
export async function restoreSeedProductState(client: SupabaseClient): Promise<void> {
  await client
    .from('products')
    .update({ is_active: true })
    .in('slug', SEED_PRODUCT_SLUGS);
}

export class ProductStateGuard {
  private originallyActiveIds: string[] = [];
  private client: SupabaseClient;

  constructor(client: SupabaseClient, private request?: APIRequestContext) {
    this.client = client;
  }

  /** Save IDs of all currently active products */
  async save(): Promise<void> {
    const { data, error } = await this.client
      .from('products')
      .select('id')
      .eq('is_active', true);
    expect(error).toBeNull();
    this.originallyActiveIds = data!.map(p => p.id);
  }

  /** Use the real mutation path so public cache invalidation is exercised. */
  async setActive(id: string, isActive: boolean): Promise<void> {
    if (!this.request) throw new Error('Product API request context is required');
    const response = await this.request.patch(`/api/v1/products/${id}`, { data: { is_active: isActive } });
    expect(response.status(), await response.text()).toBe(200);
  }

  async deactivateAll(): Promise<void> {
    const { data, error } = await this.client.from('products').select('id').eq('is_active', true);
    expect(error).toBeNull();
    for (const product of data!) await this.setActive(product.id, false);
  }

  /** Restore all originally active products to active state */
  async restore(): Promise<void> {
    if (this.originallyActiveIds.length > 0) {
      if (this.request) {
        for (const id of this.originallyActiveIds) await this.setActive(id, true);
        return;
      }
      await this.client
        .from('products')
        .update({ is_active: true })
        .in('id', this.originallyActiveIds);
    }
  }

  /** Get saved IDs (for tests that need to reference them) */
  get activeIds(): string[] {
    return this.originallyActiveIds;
  }
}
