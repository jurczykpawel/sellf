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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { SHOP_CONFIG_PUBLIC_COLUMNS_CSV } from '@/lib/shop-config-columns';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
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
  // shop_config is NOT here: it uses column-level anon grants (PII is admin-only),
  // so select=* is intentionally denied. It has dedicated tests below.
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

  // shop_config uses COLUMN-LEVEL grants (seller PII — nip/regon/address/dpo — is
  // admin-only, migration 20260621000000). So anon MUST read the public-safe
  // columns, but must NOT be able to read PII. `select=*` is intentionally denied.
  // We query the SAME list the app's anon read uses (shared module), so a column
  // added to one but not GRANTed (the `country` regression) fails this test.
  it('anon CAN read shop_config public columns (no 42501)', async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_config?select=${SHOP_CONFIG_PUBLIC_COLUMNS_CSV}&limit=1`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
    );
    const body = res.ok ? null : await res.text();
    expect(
      res.status,
      `anon SELECT of public columns on shop_config failed with HTTP ${res.status}. ` +
        `Body: ${body ?? '<ok>'}. The anon column-level GRANT (migration 20260621000000) ` +
        `must stay in sync with SHOP_CONFIG_PUBLIC_COLUMNS in shop-config.ts.`,
    ).toBeLessThan(300);
  });

  it('anon CANNOT read shop_config seller PII columns (column-level grant)', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/shop_config?select=nip&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    expect(
      res.status,
      `anon should be DENIED the PII column "nip" on shop_config, but got HTTP ${res.status}. ` +
        `If this is 2xx, seller PII (NIP/REGON/address/DPO) is world-readable via PostgREST.`,
    ).toBeGreaterThanOrEqual(400);
  });
});

// A logged-in user holds the Postgres `authenticated` role. Column-level grants
// are enforced regardless of admin status (the admin panel reads the full row
// via service_role), so `authenticated` gets the same public subset as anon.
describe('Storefront authenticated read access to shop_config', () => {
  const email = `shopcfg-authz-${Date.now()}@example.com`;
  const password = 'test-password-12345';
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let userId: string | undefined;
  let userToken: string;

  beforeAll(async () => {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    userId = created.user?.id;

    const signInClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signInErr } = await signInClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signIn.session) throw signInErr ?? new Error('No session for test user');
    userToken = signIn.session.access_token;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  const authedHeaders = () => ({ apikey: ANON_KEY, Authorization: `Bearer ${userToken}` });

  it('authenticated CAN read shop_config public columns (no 42501)', async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/shop_config?select=${SHOP_CONFIG_PUBLIC_COLUMNS_CSV}&limit=1`,
      { headers: authedHeaders() },
    );
    const body = res.ok ? null : await res.text();
    expect(
      res.status,
      `authenticated SELECT of public columns on shop_config failed with HTTP ${res.status}. Body: ${body ?? '<ok>'}`,
    ).toBeLessThan(300);
  });

  it('authenticated CANNOT read shop_config admin-only columns (column-level grant)', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/shop_config?select=nip&limit=1`, {
      headers: authedHeaders(),
    });
    expect(
      res.status,
      `authenticated should be DENIED the admin-only column "nip" on shop_config, but got HTTP ${res.status}.`,
    ).toBeGreaterThanOrEqual(400);
  });
});
