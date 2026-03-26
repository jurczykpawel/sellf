/**
 * Product State Guard
 *
 * Saves and restores the active state of all products in seller_main.
 * Use in test suites that deactivate ALL products (e.g., storefront scenarios).
 *
 * Usage:
 *   const guard = new ProductStateGuard(supabaseAdmin);
 *   test.beforeAll(async () => { await guard.save(); });
 *   test.afterEach(async () => { await guard.restore(); });
 *   test.afterAll(async () => { await guard.restore(); });
 */

import { SupabaseClient } from '@supabase/supabase-js';

export class ProductStateGuard {
  private originallyActiveIds: string[] = [];
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /** Save IDs of all currently active products */
  async save(): Promise<void> {
    const { data } = await this.client
      .from('products')
      .select('id')
      .eq('is_active', true);
    this.originallyActiveIds = data?.map(p => p.id) || [];
  }

  /** Restore all originally active products to active state */
  async restore(): Promise<void> {
    if (this.originallyActiveIds.length > 0) {
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
