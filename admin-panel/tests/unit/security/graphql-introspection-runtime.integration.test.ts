/**
 * Live GraphQL introspection regression — anon hits /graphql/v1 and we
 * assert that the returned Query/Mutation field list does NOT contain admin
 * or internal RPC names.
 *
 * The static SQL grep test (graphql-rpc-introspection.test.ts) verifies the
 * migration includes the right COMMENT directives + REVOKE statements. THIS
 * test verifies pg_graphql actually honours them at runtime — catches cases
 * where pg_graphql cache lags, comment syntax is wrong, or new admin
 * functions slip in without the directive.
 *
 * REQUIRES: Supabase running locally (`npx supabase start`).
 */
import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

async function fetchTypeFields(typeName: 'Query' | 'Mutation'): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/graphql/v1`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `{__type(name:"${typeName}"){fields{name}}}`,
    }),
  });
  const json = (await res.json()) as { data?: { __type?: { fields?: Array<{ name: string }> | null } | null } };
  const fields = json.data?.__type?.fields ?? [];
  return fields.map((f) => f.name);
}

/**
 * Substring patterns that must NOT appear in any anon-visible GraphQL field.
 * If a future RPC matches one of these, either rename the function (preferred)
 * or hide it explicitly via @graphql({"include": false}).
 */
const FORBIDDEN_PATTERNS = [
  // admin_*, get_admin_*
  /^admin_/i,
  /^get_admin_/i,
  // analytics / dashboard / revenue surfaces
  /dashboard/i,
  /revenue/i,
  /payment_statistics/i,
  /sales_chart/i,
  /abandoned/i,
  /payment_history/i,
  // refund admin (process_refund_request)
  /^process_refund/i,
  // payment-completion RPCs
  /^process_stripe/i,
  /^validate_payment_transaction/i,
  // bulk migrate / cleanup
  /^cleanup_/i,
  /^migrate_guest/i,
  /^mark_expired/i,
  // service-role grants
  /grant_product_access_service_role/i,
  // counter increments (admin/internal)
  /^increment_/i,
  // helpers we don't want exposed
  /^validate_email_format$/i,
  /^is_sale_price_active$/i,
];

describe('GraphQL introspection runtime exposure', () => {
  it('Query side exposes no admin/internal RPC names to anon', async () => {
    const names = await fetchTypeFields('Query');
    const leaks = names.filter((n) => FORBIDDEN_PATTERNS.some((p) => p.test(n)));
    expect(leaks, `Leaked admin/internal Query fields: ${leaks.join(', ')}`).toEqual([]);
  });

  it('Mutation side exposes no admin/internal RPC names to anon', async () => {
    const names = await fetchTypeFields('Mutation');
    const leaks = names.filter((n) => FORBIDDEN_PATTERNS.some((p) => p.test(n)));
    expect(leaks, `Leaked admin/internal Mutation fields: ${leaks.join(', ')}`).toEqual([]);
  });

  it('Query side has only the relay node sentinel (we do not expose immutable RPCs)', async () => {
    const names = await fetchTypeFields('Query');
    expect(names).toEqual(['node']);
  });

  it('Mutation side allow-list matches the public API surface', async () => {
    const names = (await fetchTypeFields('Mutation')).sort();
    const expected = [
      'batch_check_user_product_access',
      'check_refund_eligibility',
      'check_user_product_access',
      'check_waitlist_config',
      'create_refund_request',
      'find_auto_apply_coupon',
      'generate_oto_coupon',
      'get_oto_coupon_info',
      'get_public_integrations_config',
      'get_user_profile',
      'is_admin',
      'is_admin_cached',
      'verify_coupon',
    ].sort();
    expect(names).toEqual(expected);
  });
});
