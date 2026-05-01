/**
 * Static SQL grep coverage for pg_graphql scope configuration. Live
 * introspection coverage lives in
 * `graphql-introspection-runtime.integration.test.ts`.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

function getAllMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
    .join('\n');
}

const HIDDEN_FUNCTIONS = [
  // Admin-prefixed functions.
  'public.admin_delete_oto_offer',
  'public.admin_get_product_order_bumps',
  'public.admin_get_product_oto_offer',
  'public.admin_save_oto_offer',
  'public.get_admin_refund_requests',
  // Internal helpers.
  'public.is_sale_price_active',
  'public.validate_email_format',
  // Internal data-mutation / cleanup functions.
  'public.cleanup_expired_oto_coupons',
  'public.cleanup_old_guest_purchases',
  'public.grant_product_access_service_role',
  'public.migrate_guest_payment_data_to_profile',
  'public.migrate_guest_purchases',
  'public.process_stripe_payment_completion',
  'public.process_stripe_payment_completion_with_bump',
  'public.validate_payment_transaction',
  // Internal analytics / admin actions.
  'public.claim_guest_purchases_for_user',
  'public.get_abandoned_cart_stats',
  'public.get_abandoned_carts',
  'public.get_dashboard_stats',
  'public.get_detailed_revenue_stats',
  'public.get_hourly_revenue_stats',
  'public.get_payment_statistics',
  'public.get_revenue_goal',
  'public.get_sales_chart_data',
  'public.get_user_payment_history',
  'public.get_user_purchases_with_refund_status',
  'public.grant_free_product_access',
  'public.increment_coupon_usage',
  'public.increment_sale_quantity_sold',
  'public.mark_expired_pending_payments',
  'public.process_refund_request',
  'public.set_revenue_goal',
  'public.update_video_progress',
];

describe('GraphQL RPC introspection scope', () => {
  const allSql = getAllMigrationSql();

  describe.each(HIDDEN_FUNCTIONS)('function %s', (fnName) => {
    const escaped = fnName.replace(/\./g, '\\.');

    it('is excluded from the pg_graphql schema via comment directive', () => {
      // Function signature may include parameter list; allow anything before IS.
      const re = new RegExp(
        String.raw`COMMENT\s+ON\s+FUNCTION\s+${escaped}\b[^;]*?IS\s+E?'[^']*@graphql\(\s*\{\s*"include"\s*:\s*false\s*\}\s*\)[^']*'\s*;`,
        'i',
      );
      expect(allSql).toMatch(re);
    });

    it('has REVOKE EXECUTE FROM PUBLIC (Postgres default grant removed)', () => {
      // Match: REVOKE [EXECUTE|ALL] ON FUNCTION public.<name> ... FROM ... PUBLIC ...
      const re = new RegExp(
        String.raw`REVOKE\s+(?:EXECUTE|ALL)\s+ON\s+FUNCTION\s+${escaped}\b[^;]*FROM[^;]*\bPUBLIC\b[^;]*;`,
        'i',
      );
      expect(allSql).toMatch(re);
    });
  });
});
