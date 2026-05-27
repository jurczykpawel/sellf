/**
 * Storefront anon read — guards against the class of bug where a REVOKE
 * EXECUTE on an RLS-helper function (e.g. is_admin) breaks every anon SELECT
 * because the qualifier in RLS policies can't be evaluated. Symptom is
 * "permission denied for function is_admin" / 42501 on /rest/v1/products etc.
 *
 * The static graphql-admin-rpcs-revoked test only checks that admin-pattern
 * RPCs ARE revoked; it doesn't catch the reverse — revoking something the
 * storefront needs.
 */
import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const isLocalSupabase =
  /(^https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?/.test(SUPABASE_URL);
if (!isLocalSupabase) {
  throw new Error(`Refusing to run against non-local Supabase: ${SUPABASE_URL}`);
}

// Tables that storefront pages MUST be able to read as anon. Add to this list
// whenever a new storefront-facing table is introduced.
const STOREFRONT_ANON_READ_TABLES = [
  'products',
  'categories',
  'tags',
  'order_bumps',
  'oto_offers',
  'variant_groups',
  'product_variant_groups',
  'product_categories',
  'product_tags',
  'shop_config',
] as const;

describe('Storefront anon read access', () => {
  it.each(STOREFRONT_ANON_READ_TABLES)(
    'anon GET /rest/v1/%s returns 2xx (RLS evaluable, no 42501)',
    async (table) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
      });
      const body = res.ok ? null : await res.text();
      expect(
        res.status,
        `anon SELECT on public.${table} failed with HTTP ${res.status}. ` +
          `Body: ${body ?? '<ok>'}. ` +
          `This usually means an RLS-helper function (is_admin, has_role, etc.) ` +
          `had its EXECUTE grant REVOKE'd from anon — the qualifier raises 42501 ` +
          `before RLS can return zero rows.`,
      ).toBeLessThan(300);
    },
  );
});
