/**
 * DB TEST: who check_rate_limit() counts, and in which bucket
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { execSync } from 'child_process';
import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const CLIENT_OPTS = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
const anon = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const TOO_MANY = 'Too many attempts. Please try again later.';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000000';

/** Runs SQL as the database owner — no request JWT, like a trigger fired by the auth server. */
function sql(query: string): string {
  return execSync(`docker exec -i supabase_db_sellf psql -U postgres -t -A`, {
    input: query,
    encoding: 'utf-8',
    timeout: 10000,
  }).trim();
}

async function verify(client: typeof admin, code: string, email: string | null) {
  const { data, error } = await client.rpc('verify_coupon', {
    code_param: code,
    product_id_param: PRODUCT_ID,
    customer_email_param: email,
    currency_param: 'USD',
  });
  if (error) throw error;
  return data as { valid: boolean; error?: string };
}

afterAll(() => {
  sql(`DELETE FROM public.rate_limits WHERE function_name = 'rl_scope_${RUN_ID}';`);
});

describe('check_rate_limit scope', () => {
  it('does not count calls made without a request JWT (database triggers)', () => {
    const fn = `rl_scope_${RUN_ID}`;
    const results = sql(
      `SELECT public.check_rate_limit('${fn}', 1, 3600); SELECT public.check_rate_limit('${fn}', 1, 3600);`,
    ).split('\n');
    expect(results).toEqual(['t', 't']);
  });

  it('does not limit server-side calls made with the service role', async () => {
    const code = `SVC${RUN_ID}`.toUpperCase();
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await verify(admin, code, null));
    expect(results.map((r) => r.error)).not.toContain(TOO_MANY);
  });

  it('keeps a separate coupon bucket per customer e-mail', async () => {
    const code = `MAIL${RUN_ID}`.toUpperCase();
    for (let i = 0; i < 6; i++) await verify(anon, code, `first-${RUN_ID}@example.com`);
    expect((await verify(anon, code, `first-${RUN_ID}@example.com`)).error).toBe(TOO_MANY);

    const other = await verify(anon, code, `second-${RUN_ID}@example.com`);
    expect(other.error).not.toBe(TOO_MANY);
  });

  it('still limits repeated anonymous calls for one code', async () => {
    const code = `ANON${RUN_ID}`.toUpperCase();
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await verify(anon, code, null));
    expect(results.map((r) => r.error)).toContain(TOO_MANY);
  });
});
