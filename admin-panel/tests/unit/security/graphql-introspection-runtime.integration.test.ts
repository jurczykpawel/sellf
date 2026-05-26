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

  // Storefront tables (products, categories, tags, …) remain anon-readable
  // after the seller_main → public unification, so they show up as auto-
  // generated Collections / CRUD mutations in GraphQL. The two FORBIDDEN_PATTERNS
  // tests above are the real guard — they check that nothing admin-shaped leaks.
  // The previous strict-equality assertions ("Query == ['node']", explicit 13-RPC
  // allowlist) relied on schema isolation (seller_main was outside pg_graphql's
  // scope) and are not achievable post-unification without breaking storefront
  // read paths. See migration 20260527000000_lock_graphql_unified_schema for the
  // REVOKE SELECT applied to admin-only tables (consent_logs, profiles, etc.).

  it('admin-only tables are revoked from anon (not exposed as Collections)', async () => {
    const names = await fetchTypeFields('Query');
    const adminOnly = [
      'consent_logsCollection',
      'coupon_redemptionsCollection',
      'coupon_reservationsCollection',
      'profilesCollection',
      'user_product_accessCollection',
      'video_eventsCollection',
      'video_progressCollection',
    ];
    const leaked = adminOnly.filter((n) => names.includes(n));
    expect(leaked, `Admin tables leaked to GraphQL: ${leaked.join(', ')}`).toEqual([]);
  });

  it('relay node sentinel is present', async () => {
    const names = await fetchTypeFields('Query');
    expect(names).toContain('node');
  });

  /**
   * Storefront tables that pg_graphql is ALLOWED to auto-expose as Collections
   * (Query side) and CRUD mutations (insertInto/update/deleteFrom*).
   *
   * Any table appearing in introspection that is NOT on this list is a leak —
   * it likely needs `REVOKE SELECT FROM anon, authenticated` (see
   * 20260527000000_lock_graphql_unified_schema for the canonical pattern).
   *
   * Adding to this list requires explicit code review: the table will be
   * scriptable by anon over GraphQL within the limits of its RLS policies,
   * which is fine ONLY if the RLS policies are tight AND every column is
   * intended to be public.
   */
  const STOREFRONT_TABLES_ALLOWLIST = new Set([
    'categories',
    'order_bumps',
    'oto_offers',
    'product_categories',
    'product_tags',
    'product_variant_groups',
    'products',
    'shop_config',
    'tags',
    'variant_groups',
  ]);

  /**
   * Explicit allowlist of RPC functions that pg_graphql exposes as Mutations
   * to anon. Adding to this list = the RPC is intentionally part of the
   * public/storefront API surface, has RLS / explicit auth checks inside,
   * and has been threat-modelled (rate-limit + abuse-resistant).
   */
  const STOREFRONT_RPCS_ALLOWLIST = new Set([
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
  ]);

  function classifyMutationField(name: string): { kind: 'crud'; table: string } | { kind: 'rpc' } {
    const crud = name.match(/^(insertInto|update|deleteFrom)(.+)Collection$/);
    if (crud) return { kind: 'crud', table: crud[2] };
    return { kind: 'rpc' };
  }

  it('Query side Collections only target storefront-allowlisted tables', async () => {
    const names = await fetchTypeFields('Query');
    const collections = names.filter((n) => n.endsWith('Collection'));
    const violations = collections
      .map((n) => n.replace(/Collection$/, ''))
      .filter((t) => !STOREFRONT_TABLES_ALLOWLIST.has(t));
    expect(
      violations,
      `Tables leaking to GraphQL Query.<table>Collection that are not in STOREFRONT_TABLES_ALLOWLIST:\n` +
      violations.map((v) => `  - ${v}`).join('\n') + '\n\n' +
      `Either REVOKE SELECT on the table from anon and authenticated (see ` +
      `20260527000000_lock_graphql_unified_schema.sql for the pattern), OR ` +
      `add the table to STOREFRONT_TABLES_ALLOWLIST in this test with a justification.`,
    ).toEqual([]);
  });

  it('Mutation side RPC fields match the storefront allowlist (auto-CRUD ignored)', async () => {
    const names = await fetchTypeFields('Mutation');
    const rpcs = names.filter((n) => classifyMutationField(n).kind === 'rpc');
    const leaks = rpcs.filter((n) => !STOREFRONT_RPCS_ALLOWLIST.has(n));
    expect(
      leaks,
      `Mutation RPCs not in STOREFRONT_RPCS_ALLOWLIST:\n` +
      leaks.map((n) => `  - ${n}`).join('\n') + '\n\n' +
      `Either REVOKE EXECUTE on the function from anon, authenticated, PUBLIC ` +
      `with a matching signature (see graphql-admin-rpcs-revoked.test.ts), OR ` +
      `add the RPC name to STOREFRONT_RPCS_ALLOWLIST in this test with a justification.`,
    ).toEqual([]);
  });

  it('Mutation side auto-CRUD only on storefront-allowlisted tables', async () => {
    const names = await fetchTypeFields('Mutation');
    const violations: string[] = [];
    for (const name of names) {
      const c = classifyMutationField(name);
      if (c.kind === 'crud' && !STOREFRONT_TABLES_ALLOWLIST.has(c.table)) {
        violations.push(`  ${name} (table: ${c.table})`);
      }
    }
    expect(
      violations,
      `Tables with anon-callable insertInto/update/deleteFrom*Collection mutations ` +
      `that are not in STOREFRONT_TABLES_ALLOWLIST:\n${violations.join('\n')}\n\n` +
      `These let anon write to the table within RLS limits — usually a leak. ` +
      `REVOKE INSERT/UPDATE/DELETE on the table from anon, or add to the allowlist.`,
    ).toEqual([]);
  });

  /**
   * Final safety net: even if introspection lists an admin RPC, anon must not
   * be able to actually CALL it. Tests EXECUTE permission at the PostgREST
   * /rpc endpoint level — orthogonal to GraphQL exposure. Catches the case
   * where someone adds an admin RPC + remembers to revoke EXECUTE but forgets
   * the @graphql include:false directive (or vice-versa).
   */
  it('anon cannot invoke admin RPCs via PostgREST /rpc endpoint', async () => {
    // Sample a handful of canonical admin RPCs. We don't probe every admin
    // function — the static graphql-admin-rpcs-revoked test is the exhaustive
    // signature-level guard; this is a runtime spot-check.
    const SAMPLES: { fn: string; body: Record<string, unknown> }[] = [
      { fn: 'get_abandoned_cart_stats', body: { days_ago: 7 } },
      { fn: 'get_dashboard_stats', body: {} },
      { fn: 'get_payment_statistics', body: {
        start_date: '2026-01-01T00:00:00Z',
        end_date: '2026-12-31T23:59:59Z',
      } },
      { fn: 'process_refund_request', body: {
        request_id: '00000000-0000-0000-0000-000000000000',
        action: 'approve',
        admin_notes: '',
      } },
    ];

    const failures: string[] = [];
    for (const { fn, body } of SAMPLES) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      // Acceptable outcomes for anon:
      //   401 — no auth header at all (in practice apikey covers this)
      //   403 — PostgREST refused (permission denied)
      //   404 — pg_graphql cache says no such function (consistent with REVOKE)
      // The body may carry SQLSTATE 42501 (insufficient privilege). Anything 2xx is a leak.
      if (res.status >= 200 && res.status < 300) {
        const text = await res.text();
        failures.push(`${fn}: HTTP ${res.status} (expected 4xx) — body: ${text.slice(0, 200)}`);
      }
    }

    expect(
      failures,
      `Admin RPCs that anon was able to call successfully:\n${failures.join('\n')}\n\n` +
      `Every admin RPC must REVOKE EXECUTE FROM anon, authenticated, PUBLIC ` +
      `on its current signature. See graphql-admin-rpcs-revoked.test.ts for the ` +
      `static check.`,
    ).toEqual([]);
  });
});
