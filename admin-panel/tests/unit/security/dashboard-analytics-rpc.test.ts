/**
 * ============================================================================
 * SECURITY TEST: Dashboard & Analytics RPC Functions
 * ============================================================================
 *
 * Tests admin-only database functions for dashboard statistics,
 * revenue analytics, sales charts, hourly breakdowns, revenue goals,
 * and abandoned cart stats.
 *
 * Covered scenarios per function:
 * - Returns correct data with test transactions
 * - Returns zeros/empty for clean DB (where applicable)
 * - Authorization: only admin/service_role can access (non-admin rejected)
 * - Date range / product filtering where applicable
 * - Correct aggregation (sum, count, avg)
 *
 * Revenue goal CRUD:
 * - Set and retrieve goal (global + per-product)
 * - Update existing goal
 * - Delete/clear goal
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20250103000000_features.sql
 * @see supabase/migrations/20260115163547_abandoned_cart_recovery.sql
 * @see supabase/migrations/20260310180000_proxy_functions.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TS = Date.now();

// Capture "today" once at module load to avoid midnight boundary race conditions.
// All transaction timestamps and assertions use this consistent date.
const TEST_NOW = new Date();
const TEST_TODAY = TEST_NOW.toISOString().split('T')[0]; // YYYY-MM-DD

// ============================================================================
// Shared test data
// ============================================================================

let productA: { id: string };
let productB: { id: string };
let adminUser: { userId: string; client: SupabaseClient };
let regularUser: { userId: string; client: SupabaseClient };
let anonClient: SupabaseClient;

const createdProductIds: string[] = [];
const createdTransactionIds: string[] = [];
const createdUserIds: string[] = [];
const createdAccessIds: string[] = [];

async function createAuthenticatedUser(
  email: string,
  opts: { isAdmin?: boolean } = {},
): Promise<{ userId: string; client: SupabaseClient }> {
  const password = 'test-password-123';
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: opts.isAdmin ? { is_admin: true } : {},
  });
  if (error || !user) throw new Error(`Failed to create user: ${error?.message}`);
  createdUserIds.push(user.id);

  if (opts.isAdmin) {
    // Ensure admin_users entry exists
    await supabaseAdmin.from('admin_users').upsert({ user_id: user.id });
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });

  return { userId: user.id, client };
}

// ============================================================================
// Setup & Teardown
// ============================================================================

beforeAll(async () => {
  // Clear rate limits to avoid interference
  await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

  // Create two test products
  const { data: pA, error: pAErr } = await supabaseAdmin
    .schema('seller_main' as any)
    .from('products')
    .insert({
      name: `Dashboard Test A ${TS}`,
      slug: `dash-test-a-${TS}`,
      // Price is in dollars (NUMERIC column). Use realistic product prices.
      price: 49.99,
      currency: 'USD',
      is_active: true,
    })
    .select('id')
    .single();
  if (pAErr) throw pAErr;
  productA = { id: pA.id };
  createdProductIds.push(pA.id);

  const { data: pB, error: pBErr } = await supabaseAdmin
    .schema('seller_main' as any)
    .from('products')
    .insert({
      name: `Dashboard Test B ${TS}`,
      slug: `dash-test-b-${TS}`,
      // Price is in dollars (NUMERIC column). Use realistic product prices.
      price: 99.99,
      currency: 'PLN',
      is_active: true,
    })
    .select('id')
    .single();
  if (pBErr) throw pBErr;
  productB = { id: pB.id };
  createdProductIds.push(pB.id);

  // Create admin user
  adminUser = await createAuthenticatedUser(`dash-admin-${TS}@example.com`, {
    isAdmin: true,
  });

  // Create regular (non-admin) user
  regularUser = await createAuthenticatedUser(`dash-regular-${TS}@example.com`);

  // Create anon client
  anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Create test transactions (completed) for product A (USD)
  const yesterday = new Date(TEST_NOW.getTime() - 86400000).toISOString();

  const transactions = [
    {
      session_id: `cs_dash1${TS}`,
      stripe_payment_intent_id: `pi_dash1${TS}`,
      product_id: productA.id,
      customer_email: `buyer1-${TS}@example.com`,
      amount: 5000,
      currency: 'USD',
      status: 'completed',
      created_at: new Date(`${TEST_TODAY}T10:30:00Z`).toISOString(),
    },
    {
      session_id: `cs_dash2${TS}`,
      stripe_payment_intent_id: `pi_dash2${TS}`,
      product_id: productA.id,
      customer_email: `buyer2-${TS}@example.com`,
      amount: 5000,
      currency: 'USD',
      status: 'completed',
      created_at: new Date(`${TEST_TODAY}T14:15:00Z`).toISOString(),
    },
    // Product B transaction in PLN
    {
      session_id: `cs_dash3${TS}`,
      stripe_payment_intent_id: `pi_dash3${TS}`,
      product_id: productB.id,
      customer_email: `buyer3-${TS}@example.com`,
      amount: 10000,
      currency: 'PLN',
      status: 'completed',
      created_at: new Date(`${TEST_TODAY}T16:00:00Z`).toISOString(),
    },
    // Yesterday transaction
    {
      session_id: `cs_dash4${TS}`,
      stripe_payment_intent_id: `pi_dash4${TS}`,
      product_id: productA.id,
      customer_email: `buyer4-${TS}@example.com`,
      amount: 5000,
      currency: 'USD',
      status: 'completed',
      created_at: yesterday,
    },
    // Abandoned transaction for cart stats
    {
      session_id: `cs_dashabn1${TS}`,
      stripe_payment_intent_id: `pi_dashabn1${TS}`,
      product_id: productA.id,
      customer_email: `abandoned1-${TS}@example.com`,
      amount: 5000,
      currency: 'USD',
      status: 'abandoned',
      created_at: TEST_NOW.toISOString(),
    },
    // Pending transaction for cart stats
    {
      session_id: `cs_dashpend1${TS}`,
      stripe_payment_intent_id: `pi_dashpend1${TS}`,
      product_id: productB.id,
      customer_email: `pending1-${TS}@example.com`,
      amount: 10000,
      currency: 'PLN',
      status: 'pending',
      created_at: TEST_NOW.toISOString(),
      expires_at: new Date(TEST_NOW.getTime() + 86400000).toISOString(),
    },
  ];

  for (const tx of transactions) {
    const { data, error } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('payment_transactions')
      .insert(tx)
      .select('id')
      .single();
    if (error) throw new Error(`Failed to insert transaction: ${error.message}`);
    createdTransactionIds.push(data.id);
  }

  // Create user_product_access for active users count
  const { data: access, error: accessErr } = await supabaseAdmin
    .schema('seller_main' as any)
    .from('user_product_access')
    .insert({
      user_id: regularUser.userId,
      product_id: productA.id,
    })
    .select('id')
    .single();
  if (accessErr) throw new Error(`Failed to insert access: ${accessErr.message}`);
  createdAccessIds.push(access.id);
});

afterAll(async () => {
  // Clean up revenue goals
  for (const pid of createdProductIds) {
    await supabaseAdmin
      .schema('seller_main' as any)
      .from('revenue_goals')
      .delete()
      .eq('product_id', pid);
  }
  // Global goal
  await supabaseAdmin
    .schema('seller_main' as any)
    .from('revenue_goals')
    .delete()
    .is('product_id', null);

  // Clean up access
  for (const id of createdAccessIds) {
    await supabaseAdmin
      .schema('seller_main' as any)
      .from('user_product_access')
      .delete()
      .eq('id', id);
  }

  // Clean up transactions
  for (const id of createdTransactionIds) {
    await supabaseAdmin
      .schema('seller_main' as any)
      .from('payment_transactions')
      .delete()
      .eq('id', id);
  }

  // Clean up products
  for (const id of createdProductIds) {
    await supabaseAdmin.schema('seller_main' as any).from('products').delete().eq('id', id);
  }

  // Clean up users
  for (const id of createdUserIds) {
    await supabaseAdmin.from('admin_users').delete().eq('user_id', id);
    await supabaseAdmin.auth.admin.deleteUser(id);
  }
});

// ============================================================================
// get_dashboard_stats
// ============================================================================

describe('get_dashboard_stats', () => {
  // Query baseline counts independently and verify the RPC returns consistent values.
  it('returns correct dashboard stats via service_role', async () => {
    // Query actual counts directly to establish baseline for comparison
    const { count: actualProductCount } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const { count: actualAccessCount } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('user_product_access')
      .select('*', { count: 'exact', head: true });

    const { data, error } = await supabaseAdmin.rpc('get_dashboard_stats');

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data).toHaveProperty('totalProducts');
    expect(data).toHaveProperty('totalUsers');
    expect(data).toHaveProperty('totalAccess');
    expect(data).toHaveProperty('activeUsers');
    expect(data).toHaveProperty('totalRevenue');

    // Verify totalProducts matches actual active product count from DB
    expect(data.totalProducts).toBe(actualProductCount);

    // Verify totalAccess matches actual access count from DB
    expect(data.totalAccess).toBe(actualAccessCount);

    // Revenue includes our 4 completed transactions (amounts in cents):
    // 5000 + 5000 + 10000 + 5000 = 25000
    // Verify revenue is within a tight range of expected test data
    expect(data.totalRevenue).toBeGreaterThanOrEqual(25000);
    // We created at least 2 users
    expect(data.totalUsers).toBeGreaterThanOrEqual(2);
    // We created 1 access record in last 7 days
    expect(data.activeUsers).toBeGreaterThanOrEqual(1);

    // Cross-check: totalRevenue must equal sum of all currency amounts
    // from get_detailed_revenue_stats (verified in aggregation correctness suite)
    const { data: detailed } = await supabaseAdmin.rpc('get_detailed_revenue_stats');
    const detailedTotal = Object.values(detailed.totalRevenue as Record<string, number>).reduce(
      (sum: number, v) => sum + Number(v),
      0,
    );
    expect(data.totalRevenue).toBe(detailedTotal);
  });

  it('returns correct stats via admin authenticated client', async () => {
    const { data, error } = await adminUser.client.rpc('get_dashboard_stats');

    expect(error).toBeNull();
    expect(data).toBeDefined();
    // Verify against known test data
    expect(data.totalProducts).toBeGreaterThanOrEqual(2);
    expect(data.totalRevenue).toBeGreaterThanOrEqual(25000);
  });

  it('rejects non-admin authenticated user', async () => {
    const { data, error } = await regularUser.client.rpc('get_dashboard_stats');

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Access denied');
    expect(data).toBeNull();
  });

  it('rejects anon user', async () => {
    const { data, error } = await anonClient.rpc('get_dashboard_stats');

    // Anon has EXECUTE revoked on this function — should get 42501 (permission denied)
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// ============================================================================
// get_detailed_revenue_stats
// ============================================================================

describe('get_detailed_revenue_stats', () => {
  it('returns overall revenue stats (no filters)', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_detailed_revenue_stats');

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data).toHaveProperty('totalRevenue');
    expect(data).toHaveProperty('todayRevenue');
    expect(data).toHaveProperty('todayOrders');
    expect(data).toHaveProperty('lastOrderAt');

    // totalRevenue is grouped by currency
    expect(typeof data.totalRevenue).toBe('object');
    // We have USD transactions: 3x5000 = 15000 (today 2x5000=10000, yesterday 1x5000)
    // and PLN transactions: 1x10000 = 10000
    const usdRevenue = Number(data.totalRevenue.USD);
    const plnRevenue = Number(data.totalRevenue.PLN);
    expect(usdRevenue).toBeGreaterThanOrEqual(15000);
    expect(usdRevenue).toBeLessThan(10_000_000); // sanity upper bound
    expect(plnRevenue).toBeGreaterThanOrEqual(10000);
    expect(plnRevenue).toBeLessThan(10_000_000); // sanity upper bound

    // At least 3 orders today, but not an absurd number
    expect(data.todayOrders).toBeGreaterThanOrEqual(3);
    expect(data.todayOrders).toBeLessThan(10000);
  });

  it('filters by product_id', async () => {
    // Get unfiltered revenue first for comparison
    const { data: unfilteredData, error: unfilteredErr } = await supabaseAdmin.rpc(
      'get_detailed_revenue_stats',
    );
    expect(unfilteredErr).toBeNull();

    const { data, error } = await supabaseAdmin.rpc('get_detailed_revenue_stats', {
      p_product_id: productA.id,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    // Product A has 3 USD transactions: 3 x 5000 = 15000
    const filteredUsdRevenue = Number(data.totalRevenue.USD);
    expect(filteredUsdRevenue).toBeGreaterThanOrEqual(15000);

    // Filtered revenue should be LESS than unfiltered (since productB has PLN revenue too)
    const unfilteredTotal = Object.values(
      unfilteredData.totalRevenue as Record<string, number>,
    ).reduce((sum: number, v) => sum + Number(v), 0);
    const filteredTotal = Object.values(data.totalRevenue as Record<string, number>).reduce(
      (sum: number, v) => sum + Number(v),
      0,
    );
    expect(filteredTotal).toBeLessThan(unfilteredTotal);

    // Product A has no PLN transactions
    expect(data.totalRevenue.PLN).toBeUndefined();
  });

  it('filters by goal_start_date', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const { data, error } = await supabaseAdmin.rpc('get_detailed_revenue_stats', {
      p_goal_start_date: tomorrow,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    // No transactions after tomorrow
    expect(data.totalRevenue).toEqual({});
  });

  it('rejects non-admin authenticated user', async () => {
    const { data, error } = await regularUser.client.rpc('get_detailed_revenue_stats');

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Access denied');
    expect(data).toBeNull();
  });

  it('rejects anon user', async () => {
    const { data, error } = await anonClient.rpc('get_detailed_revenue_stats');

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// ============================================================================
// get_sales_chart_data
// ============================================================================

describe('get_sales_chart_data', () => {
  it('returns chart data for date range', async () => {
    const startOfDay = new Date(`${TEST_TODAY}T00:00:00Z`);
    const endOfDay = new Date(`${TEST_TODAY}T23:59:59Z`);

    const { data, error } = await supabaseAdmin.rpc('get_sales_chart_data', {
      p_start_date: startOfDay.toISOString(),
      p_end_date: endOfDay.toISOString(),
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);

    // Querying a single day should produce exactly 1 row (one date bucket).
    // NOTE: The SQL function's inner GROUP BY includes pt.created_at (the full timestamp),
    // which means rows are NOT aggregated by day but by exact timestamp. The outer
    // GROUP BY on TO_CHAR date re-aggregates via jsonb_object_agg, so the final output
    // is correct per day BUT only because the outer query fixes it. If the inner
    // GROUP BY were fixed to remove pt.created_at, performance would improve.
    // See: 20250103000000_features.sql line 1465
    expect(data.length).toBe(1);

    const todayRow = data[0];
    expect(todayRow).toHaveProperty('date');
    expect(todayRow.date).toBe(TEST_TODAY);
    expect(todayRow).toHaveProperty('amount_by_currency');
    expect(todayRow).toHaveProperty('orders');
    // We inserted 3 completed transactions for today (2xUSD + 1xPLN)
    expect(todayRow.orders).toBeGreaterThanOrEqual(3);

    // Verify the date range is actually respected by comparing against a
    // non-overlapping range. A future range should return 0 rows, confirming
    // the function doesn't ignore date boundaries.
    const futureStart = new Date(Date.now() + 86400000 * 30).toISOString();
    const futureEnd = new Date(Date.now() + 86400000 * 60).toISOString();
    const { data: futureData } = await supabaseAdmin.rpc('get_sales_chart_data', {
      p_start_date: futureStart,
      p_end_date: futureEnd,
    });
    expect(futureData.length).toBe(0);

    // The today range has data while the future range has none,
    // confirming the function respects the date range parameter.
    expect(todayRow.orders).toBeGreaterThan(futureData.length);
  });

  it('returns empty for future date range', async () => {
    const futureStart = new Date(Date.now() + 86400000 * 30).toISOString();
    const futureEnd = new Date(Date.now() + 86400000 * 60).toISOString();

    const { data, error } = await supabaseAdmin.rpc('get_sales_chart_data', {
      p_start_date: futureStart,
      p_end_date: futureEnd,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it('filters by product_id', async () => {
    const startOfDay = new Date(`${TEST_TODAY}T00:00:00Z`);
    const endOfDay = new Date(`${TEST_TODAY}T23:59:59Z`);

    const { data, error } = await supabaseAdmin.rpc('get_sales_chart_data', {
      p_start_date: startOfDay.toISOString(),
      p_end_date: endOfDay.toISOString(),
      p_product_id: productB.id,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);

    // Product B has 1 completed transaction today - data must not be empty
    expect(data.length).toBe(1);
    // Only PLN for product B
    expect(data[0].amount_by_currency).toHaveProperty('PLN');
    expect(Number(data[0].amount_by_currency.PLN)).toBe(10000);
    expect(data[0].amount_by_currency.USD).toBeUndefined();
    expect(data[0].orders).toBe(1);
  });

  it('rejects non-admin authenticated user', async () => {
    const now = new Date();
    const { data, error } = await regularUser.client.rpc('get_sales_chart_data', {
      p_start_date: new Date(now.getTime() - 86400000).toISOString(),
      p_end_date: now.toISOString(),
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Access denied');
    expect(data).toBeNull();
  });

  it('rejects anon user', async () => {
    const now = new Date();
    const { data, error } = await anonClient.rpc('get_sales_chart_data', {
      p_start_date: new Date(now.getTime() - 86400000).toISOString(),
      p_end_date: now.toISOString(),
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// ============================================================================
// get_hourly_revenue_stats
// ============================================================================

describe('get_hourly_revenue_stats', () => {
  it('returns 24 hours of data for today', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_hourly_revenue_stats', {
      p_target_date: TEST_TODAY,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(24);

    // Verify hours 0-23
    for (let h = 0; h < 24; h++) {
      expect(data[h].hour).toBe(h);
      expect(data[h]).toHaveProperty('amount_by_currency');
      expect(data[h]).toHaveProperty('orders');
    }

    // Verify specific hours that match our test data insertion times have non-zero revenue.
    // We inserted completed transactions at hours 10 (5000 USD), 14 (5000 USD), and 16 (10000 PLN) UTC.
    const hour10 = data[10];
    const hour14 = data[14];
    const hour16 = data[16];

    expect(hour10.orders).toBeGreaterThanOrEqual(1);
    expect(Number(hour10.amount_by_currency.USD)).toBeGreaterThanOrEqual(5000);

    expect(hour14.orders).toBeGreaterThanOrEqual(1);
    expect(Number(hour14.amount_by_currency.USD)).toBeGreaterThanOrEqual(5000);

    expect(hour16.orders).toBeGreaterThanOrEqual(1);
    expect(Number(hour16.amount_by_currency.PLN)).toBeGreaterThanOrEqual(10000);

    // Hours without test data should have 0 orders (pick an hour we know is empty)
    // Hour 3 UTC has no test transactions
    expect(data[3].orders).toBe(0);
    expect(data[3].amount_by_currency).toEqual({});
  });

  it('returns all zeros for a future date', async () => {
    const futureDate = new Date(TEST_NOW.getTime() + 86400000 * 30).toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin.rpc('get_hourly_revenue_stats', {
      p_target_date: futureDate,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.length).toBe(24);

    for (const row of data) {
      expect(row.orders).toBe(0);
      expect(row.amount_by_currency).toEqual({});
    }
  });

  it('filters by product_id', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_hourly_revenue_stats', {
      p_target_date: TEST_TODAY,
      p_product_id: productB.id,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();

    // Only PLN for product B
    const hoursWithData = data.filter((h: any) => h.orders > 0);
    // Product B has 1 transaction at hour 16 UTC, so at least 1 hour must have data
    expect(hoursWithData.length).toBeGreaterThan(0);
    for (const h of hoursWithData) {
      expect(h.amount_by_currency).toHaveProperty('PLN');
      expect(h.amount_by_currency.USD).toBeUndefined();
    }
  });

  it('rejects non-admin authenticated user', async () => {
    const { data, error } = await regularUser.client.rpc('get_hourly_revenue_stats', {
      p_target_date: TEST_TODAY,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('Access denied');
    expect(data).toBeNull();
  });

  it('rejects anon user', async () => {
    const { data, error } = await anonClient.rpc('get_hourly_revenue_stats', {
      p_target_date: TEST_TODAY,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// ============================================================================
// set_revenue_goal / get_revenue_goal
// ============================================================================

describe('set_revenue_goal / get_revenue_goal', () => {
  const goalStartDate = new Date('2026-01-01T00:00:00Z').toISOString();

  // Helper to clean all revenue goals created by this test suite
  async function clearAllGoals() {
    for (const pid of createdProductIds) {
      await supabaseAdmin
        .schema('seller_main' as any)
        .from('revenue_goals')
        .delete()
        .eq('product_id', pid);
    }
    await supabaseAdmin
      .schema('seller_main' as any)
      .from('revenue_goals')
      .delete()
      .is('product_id', null);
  }

  describe('global goal (no product_id)', () => {
    it('sets and retrieves a global revenue goal', async () => {
      await clearAllGoals();

      // Set
      const { error: setErr } = await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 100000,
        p_start_date: goalStartDate,
      });
      expect(setErr).toBeNull();

      // Get
      const { data, error: getErr } = await supabaseAdmin.rpc('get_revenue_goal');
      expect(getErr).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(Number(data[0].goal_amount)).toBe(100000);
      expect(data[0].start_date).toBeDefined();
    });

    it('updates an existing global goal via upsert', async () => {
      await clearAllGoals();

      // Set initial goal
      await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 100000,
        p_start_date: goalStartDate,
      });

      // Update via upsert
      const { error: setErr } = await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 200000,
        p_start_date: goalStartDate,
      });
      expect(setErr).toBeNull();

      const { data, error: getErr } = await supabaseAdmin.rpc('get_revenue_goal');
      expect(getErr).toBeNull();
      expect(data.length).toBe(1);
      expect(Number(data[0].goal_amount)).toBe(200000);
    });
  });

  describe('product-specific goal', () => {
    it('sets and retrieves a product-specific goal', async () => {
      await clearAllGoals();

      const { error: setErr } = await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 50000,
        p_start_date: goalStartDate,
        p_product_id: productA.id,
      });
      expect(setErr).toBeNull();

      const { data, error: getErr } = await supabaseAdmin.rpc('get_revenue_goal', {
        p_product_id: productA.id,
      });
      expect(getErr).toBeNull();
      expect(data.length).toBe(1);
      expect(Number(data[0].goal_amount)).toBe(50000);
    });

    it('updates existing product goal', async () => {
      await clearAllGoals();

      // Set initial product goal
      await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 50000,
        p_start_date: goalStartDate,
        p_product_id: productA.id,
      });

      // Update it
      const { error: setErr } = await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 75000,
        p_start_date: goalStartDate,
        p_product_id: productA.id,
      });
      expect(setErr).toBeNull();

      const { data, error: getErr } = await supabaseAdmin.rpc('get_revenue_goal', {
        p_product_id: productA.id,
      });
      expect(getErr).toBeNull();
      expect(Number(data[0].goal_amount)).toBe(75000);
    });

    it('product goal is independent from global goal', async () => {
      await clearAllGoals();

      // Set up both goals explicitly
      await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 200000,
        p_start_date: goalStartDate,
      });
      await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 75000,
        p_start_date: goalStartDate,
        p_product_id: productA.id,
      });

      // Verify they are independent
      const { data: globalData } = await supabaseAdmin.rpc('get_revenue_goal');
      expect(Number(globalData[0].goal_amount)).toBe(200000);

      const { data: productData } = await supabaseAdmin.rpc('get_revenue_goal', {
        p_product_id: productA.id,
      });
      expect(Number(productData[0].goal_amount)).toBe(75000);
    });

    it('returns empty for product with no goal set', async () => {
      await clearAllGoals();

      const { data, error } = await supabaseAdmin.rpc('get_revenue_goal', {
        p_product_id: productB.id,
      });
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.length).toBe(0);
    });
  });

  describe('goal deletion', () => {
    it('can delete a product goal by removing from table', async () => {
      await clearAllGoals();

      // Set a goal for product B
      await supabaseAdmin.rpc('set_revenue_goal', {
        p_goal_amount: 30000,
        p_start_date: goalStartDate,
        p_product_id: productB.id,
      });

      // Verify it exists
      const { data: before } = await supabaseAdmin.rpc('get_revenue_goal', {
        p_product_id: productB.id,
      });
      expect(before.length).toBe(1);

      // Delete via direct table access (service_role)
      await supabaseAdmin
        .schema('seller_main' as any)
        .from('revenue_goals')
        .delete()
        .eq('product_id', productB.id);

      // Verify it's gone
      const { data: after } = await supabaseAdmin.rpc('get_revenue_goal', {
        p_product_id: productB.id,
      });
      expect(after.length).toBe(0);
    });
  });

  describe('authorization', () => {
    it('admin user can set and get goals', async () => {
      await clearAllGoals();

      const { error: setErr } = await adminUser.client.rpc('set_revenue_goal', {
        p_goal_amount: 99000,
        p_start_date: goalStartDate,
      });
      expect(setErr).toBeNull();

      const { data, error: getErr } = await adminUser.client.rpc('get_revenue_goal');
      expect(getErr).toBeNull();
      expect(data.length).toBe(1);
      expect(Number(data[0].goal_amount)).toBe(99000);
    });

    it('rejects non-admin for set_revenue_goal', async () => {
      await clearAllGoals();

      const { error } = await regularUser.client.rpc('set_revenue_goal', {
        p_goal_amount: 10000,
        p_start_date: goalStartDate,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain('Access denied');

      // Verify no goal was written to DB (query the correct schema: seller_main)
      const { data: goals } = await supabaseAdmin
        .schema('seller_main' as any)
        .from('revenue_goals')
        .select('id')
        .eq('goal_amount', 10000);
      expect(goals?.length ?? 0).toBe(0);
    });

    it('rejects non-admin for get_revenue_goal', async () => {
      const { data, error } = await regularUser.client.rpc('get_revenue_goal');
      expect(error).not.toBeNull();
      expect(error!.message).toContain('Access denied');
      expect(data).toBeNull();
    });

    it('rejects anon for set_revenue_goal', async () => {
      const { error } = await anonClient.rpc('set_revenue_goal', {
        p_goal_amount: 10000,
        p_start_date: goalStartDate,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('rejects anon for get_revenue_goal', async () => {
      const { data, error } = await anonClient.rpc('get_revenue_goal');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
      expect(data).toBeNull();
    });
  });
});

// ============================================================================
// get_abandoned_cart_stats
// ============================================================================

describe('get_abandoned_cart_stats', () => {
  it('returns correct stats structure via service_role', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data).toHaveProperty('total_abandoned');
    expect(data).toHaveProperty('total_pending');
    expect(data).toHaveProperty('total_value');
    expect(data).toHaveProperty('avg_cart_value');
    expect(data).toHaveProperty('period_days');
    expect(data.period_days).toBe(7);
  });

  it('includes test abandoned and pending transactions in counts', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });

    expect(error).toBeNull();
    // We created 1 abandoned + 1 pending
    expect(data.total_abandoned).toBeGreaterThanOrEqual(1);
    expect(data.total_abandoned).toBeLessThan(10000); // sanity upper bound
    expect(data.total_pending).toBeGreaterThanOrEqual(1);
    expect(data.total_pending).toBeLessThan(10000); // sanity upper bound
    // Total value: abandoned(5000) + pending(10000) = 15000
    expect(data.total_value).toBeGreaterThanOrEqual(15000);
    expect(data.total_value).toBeLessThan(100_000_000); // sanity upper bound
  });

  it('calculates correct average cart value', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });

    expect(error).toBeNull();
    const totalCarts = data.total_abandoned + data.total_pending;
    // We know we inserted at least 2 carts (1 abandoned + 1 pending)
    expect(totalCarts).toBeGreaterThanOrEqual(2);

    // Verify avg is a meaningful number, not zero or negative.
    // Pre-existing data in the DB may shift the average, so we use loose bounds.
    // The key assertion is that avg is positive and within a reasonable range
    // (not zero, not astronomically large), proving the function aggregates real data.
    expect(data.avg_cart_value).toBeGreaterThan(0);
    expect(data.avg_cart_value).toBeLessThan(100_000_000); // sanity upper bound
  });

  it('returns zeros or near-zeros for days_ago=0 (minimal time window)', async () => {
    // days_ago=0 means NOW() - '0 days'::INTERVAL = NOW(), so the window
    // is created_at > NOW(). Since our test transactions were created
    // in the past (even if just milliseconds ago), they should not appear.
    const { data, error } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 0,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.period_days).toBe(0);

    // With days_ago=0 the SQL filter is `created_at > NOW()`, meaning only
    // transactions created in the future would match. Values should be 0.
    expect(data.total_abandoned).toBe(0);
    expect(data.total_pending).toBe(0);
    expect(data.total_value).toBe(0);
    expect(data.avg_cart_value).toBe(0);

    // Verify that a wider window (7 days) returns more data,
    // confirming the filtering actually works
    const { data: wideData } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });
    expect(wideData.total_abandoned + wideData.total_pending).toBeGreaterThan(0);
  });

  it('respects days_ago filtering', async () => {
    // Large window should include everything
    const { data: wide, error: wideErr } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 365,
    });
    expect(wideErr).toBeNull();

    // Narrow window (1 day) should include today's data
    const { data: narrow, error: narrowErr } = await supabaseAdmin.rpc('get_abandoned_cart_stats', {
      days_ago: 1,
    });
    expect(narrowErr).toBeNull();

    // Wide window (365 days) should have at least as many carts as narrow (1 day).
    // More importantly, verify both windows return data and that filtering is meaningful:
    // the wide window's total_value should be >= narrow window's total_value.
    const wideTotal = wide.total_abandoned + wide.total_pending;
    const narrowTotal = narrow.total_abandoned + narrow.total_pending;
    expect(wideTotal).toBeGreaterThanOrEqual(narrowTotal);
    // Both windows must have captured our test data (inserted today)
    expect(wideTotal).toBeGreaterThan(0);
    expect(narrowTotal).toBeGreaterThan(0);
    // Wide window value must be >= narrow window value
    expect(wide.total_value).toBeGreaterThanOrEqual(narrow.total_value);
  });

  it('admin user can call get_abandoned_cart_stats', async () => {
    const { data, error } = await adminUser.client.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data).toHaveProperty('total_abandoned');
  });

  it('rejects non-admin authenticated user', async () => {
    const { data, error } = await regularUser.client.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });

    // get_abandoned_cart_stats raises 'Access denied' for non-admin users
    // (P0001 = RAISE EXCEPTION in the function body, not 42501 permission denied)
    expect(error).not.toBeNull();
    expect(error!.code).toBe('P0001');
    expect(error!.message).toContain('Access denied');
    expect(data).toBeNull();
  });

  it('rejects anon user', async () => {
    const { data, error } = await anonClient.rpc('get_abandoned_cart_stats', {
      days_ago: 7,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });
});

// ============================================================================
// Cross-function aggregation verification
// ============================================================================

describe('aggregation correctness', () => {
  it('dashboard totalRevenue matches sum of detailed revenue across currencies', async () => {
    const { data: dashboard } = await supabaseAdmin.rpc('get_dashboard_stats');
    const { data: detailed } = await supabaseAdmin.rpc('get_detailed_revenue_stats');

    // Dashboard totalRevenue is a single number (sum of all amounts regardless of currency)
    // Detailed totalRevenue is grouped by currency
    const detailedTotal = Object.values(detailed.totalRevenue as Record<string, number>).reduce(
      (sum: number, v) => sum + Number(v),
      0,
    );

    expect(dashboard.totalRevenue).toBe(detailedTotal);
  });

  it('hourly orders sum matches sales chart orders for same day', async () => {
    const startOfDay = `${TEST_TODAY}T00:00:00Z`;
    const endOfDay = `${TEST_TODAY}T23:59:59Z`;

    const { data: hourly } = await supabaseAdmin.rpc('get_hourly_revenue_stats', {
      p_target_date: TEST_TODAY,
    });

    const { data: chart } = await supabaseAdmin.rpc('get_sales_chart_data', {
      p_start_date: startOfDay,
      p_end_date: endOfDay,
    });

    const hourlyOrdersTotal = hourly.reduce((sum: number, h: any) => sum + h.orders, 0);
    const chartOrdersTotal = chart.reduce((sum: number, d: any) => sum + d.orders, 0);

    expect(hourlyOrdersTotal).toBe(chartOrdersTotal);
  });
});
