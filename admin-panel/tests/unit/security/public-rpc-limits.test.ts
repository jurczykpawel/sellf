/**
 * DB TEST: limits on functions reachable without an account
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { execSync } from 'child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const CLIENT_OPTS = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
const anon = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
const PASSWORD = 'public-rpc-Test-123!';
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let customer: { id: string; client: SupabaseClient };

function clearOtoBucket() {
  execSync(`docker exec -i supabase_db_sellf psql -U postgres -t -A`, {
    input: `DELETE FROM public.rate_limits WHERE function_name = 'get_oto_coupon_info';`,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

/**
 * check_rate_limit()'s window for get_oto_coupon_info is a real 60-second
 * bucket aligned to the wall-clock minute (see
 * 20260924000000_access_scope_tightening.sql). A loop of ~30 live anonymous
 * calls to reach the cap can straddle that boundary under load: the counter
 * resets mid-loop and the call that should be blocked comes back allowed
 * instead. These helpers read back the window the real function assigned to
 * a live probe call and fast-forward its counter directly (via the
 * service-role client, same as the existing bucket cleanup below), so the
 * cap/block edges are verified with two live calls instead of thirty,
 * cutting real-clock exposure by more than an order of magnitude.
 */
async function getOtoBucketWindow(): Promise<string> {
  const { data, error } = await admin
    .from('rate_limits')
    .select('window_start')
    .eq('function_name', 'get_oto_coupon_info')
    .order('window_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Expected a rate_limits row for get_oto_coupon_info after a live probe call');
  return data.window_start;
}

async function setOtoBucketCount(windowStart: string, count: number): Promise<void> {
  const { error } = await admin
    .from('rate_limits')
    .update({ call_count: count })
    .eq('function_name', 'get_oto_coupon_info')
    .eq('window_start', windowStart);
  if (error) throw error;
}

/**
 * Ensures the current get_oto_coupon_info window has at least
 * `minSecondsRemaining` left before it rolls over, retrying against a fresh
 * window otherwise. Returns the window_start to seed a call count into.
 */
async function ensureFreshWindowMargin(minSecondsRemaining: number, maxAttempts = 3): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const windowStart = await getOtoBucketWindow();
    const secondsLeft = (new Date(windowStart).getTime() + 60_000 - Date.now()) / 1000;
    if (secondsLeft >= minSecondsRemaining) return windowStart;

    await new Promise((resolve) => setTimeout(resolve, (secondsLeft + 0.5) * 1000));
    clearOtoBucket();
    const probe = await anon.rpc('get_oto_coupon_info', {
      coupon_code_param: `NOPE-margin-${attempt}`,
      email_param: `probe-${RUN}@example.com`,
    });
    if (probe.data?.error !== 'Coupon not found or expired') {
      throw new Error(`Unexpected response while re-establishing the rate-limit window: ${JSON.stringify(probe.data)}`);
    }
  }
  throw new Error('Could not establish a get_oto_coupon_info rate-limit window with enough margin after retries');
}

beforeAll(async () => {
  const email = `public-rpc-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  customer = { id: data.user.id, client };
});

afterAll(async () => {
  clearOtoBucket();
  if (customer) await admin.auth.admin.deleteUser(customer.id);
});

describe('get_oto_coupon_info', () => {
  it(
    'caps repeated direct anonymous lookups',
    async () => {
      clearOtoBucket();

      // Call #1: bucket is empty, must succeed and create the window's row.
      const first = await anon.rpc('get_oto_coupon_info', {
        coupon_code_param: 'NOPE-first',
        email_param: `probe-${RUN}@example.com`,
      });
      expect(first.data?.error).toBe('Coupon not found or expired');

      // Seed the counter to 29 directly (skip 28 more live round trips — see
      // ensureFreshWindowMargin's doc comment for why looping is flaky here).
      // minSecondsRemaining=5 keeps the worst-case wait below this test's
      // extended 15s timeout with headroom to spare.
      const windowStart = await ensureFreshWindowMargin(5);
      await setOtoBucketCount(windowStart, 29);

      // Call #30 overall: still within the 30-call cap.
      const thirtieth = await anon.rpc('get_oto_coupon_info', {
        coupon_code_param: 'NOPE-30',
        email_param: `probe-${RUN}@example.com`,
      });
      expect(thirtieth.data?.error).toBe('Coupon not found or expired');

      // Call #31 overall: exceeds the cap.
      const thirtyFirst = await anon.rpc('get_oto_coupon_info', {
        coupon_code_param: 'NOPE-31',
        email_param: `probe-${RUN}@example.com`,
      });
      expect(thirtyFirst.data?.error).toBe('Too many attempts. Please try again later.');

      clearOtoBucket();
    },
    15000,
  );

  it('does not limit lookups made by the server', async () => {
    const errors: Array<string | undefined> = [];
    for (let i = 0; i < 31; i++) {
      const { data } = await admin.rpc('get_oto_coupon_info', {
        coupon_code_param: `SVC${i}`,
        email_param: `server-${RUN}@example.com`,
      });
      errors.push(data?.error);
    }
    expect(errors).not.toContain('Too many attempts. Please try again later.');
  });
});

describe('check_waitlist_config', () => {
  it('is not callable anonymously', async () => {
    const { error } = await anon.rpc('check_waitlist_config');
    expect(error).not.toBeNull();
  });

  it('is refused to a signed-in customer', async () => {
    const { error } = await customer.client.rpc('check_waitlist_config');
    expect(error).not.toBeNull();
  });

  it('answers the server', async () => {
    const { data, error } = await admin.rpc('check_waitlist_config');
    expect(error).toBeNull();
    expect(data).toHaveProperty('has_webhook');
  });
});
