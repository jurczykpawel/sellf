/**
 * ============================================================================
 * SECURITY TEST: process_refund_request & validate_payment_transaction RPC
 * ============================================================================
 *
 * Tests the two database functions via Supabase RPC calls using
 * service_role client for setup and admin-authenticated clients for
 * authorization checks.
 *
 * Requires: local Supabase running (npx supabase start + db reset)
 *
 * Functions under test:
 * - seller_main.process_refund_request(request_id_param, action_param, admin_response_param)
 * - seller_main.validate_payment_transaction(transaction_id)
 *
 * @see supabase/migrations/20250102000000_payment_system.sql
 * ============================================================================
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

// ===== SUPABASE CLIENT SETUP =====

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ===== HELPER FUNCTIONS =====

const cleanupIds = {
  transactions: [] as string[],
  refundRequests: [] as string[],
  users: [] as string[],
  userProductAccess: [] as Array<{ userId: string; productId: string }>,
};

// NOTE: getTestProduct() depends on seed data (supabase/seed.sql) containing at least
// one active product with a non-null price > 0. Run `npx supabase db reset` to ensure
// seed data is present before running these tests.
async function getTestProduct() {
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, name, price, currency')
    .eq('is_active', true)
    .not('price', 'is', null)
    .gt('price', 0)
    .limit(1)
    .single();
  if (!data) throw new Error('No active product with price found for testing. Ensure seed data exists (npx supabase db reset).');
  return data;
}

async function createTestTransaction(productId: string, overrides: Record<string, unknown> = {}) {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: `cs_test_rpc_${uniqueId}`,
      product_id: productId,
      customer_email: 'rpc-test@example.com',
      amount: 4999,
      currency: 'usd',
      status: 'completed',
      stripe_payment_intent_id: `pi_test_rpc_${uniqueId}`,
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create test transaction: ${error.message}`);
  cleanupIds.transactions.push(data.id);
  return data;
}

async function createTestRefundRequest(
  transactionId: string,
  productId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await supabaseAdmin
    .from('refund_requests')
    .insert({
      transaction_id: transactionId,
      customer_email: 'rpc-test@example.com',
      product_id: productId,
      requested_amount: 4999,
      currency: 'usd',
      status: 'pending',
      reason: 'Test refund request',
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create refund request: ${error.message}`);
  cleanupIds.refundRequests.push(data.id);
  return data;
}

async function createTestAdminUser(): Promise<{
  userId: string;
  client: SupabaseClient;
}> {
  const randomStr = Math.random().toString(36).substring(2, 9);
  const email = `rpc-admin-${Date.now()}-${randomStr}@example.com`;
  const password = 'password123';

  const {
    data: { user },
    error: createError,
  } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !user) throw new Error(`Failed to create admin user: ${createError?.message}`);

  await supabaseAdmin.from('admin_users').insert({ user_id: user.id });
  cleanupIds.users.push(user.id);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });

  return { userId: user.id, client };
}

async function createTestRegularUser(): Promise<{
  userId: string;
  client: SupabaseClient;
}> {
  const randomStr = Math.random().toString(36).substring(2, 9);
  const email = `rpc-user-${Date.now()}-${randomStr}@example.com`;
  const password = 'password123';

  const {
    data: { user },
    error: createError,
  } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !user) throw new Error(`Failed to create regular user: ${createError?.message}`);
  cleanupIds.users.push(user.id);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password });

  return { userId: user.id, client };
}

async function cleanup() {
  // Clean up in reverse dependency order
  for (const id of cleanupIds.refundRequests) {
    await supabaseAdmin.from('refund_requests').delete().eq('id', id);
  }
  for (const { userId, productId } of cleanupIds.userProductAccess) {
    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);
  }
  for (const id of cleanupIds.transactions) {
    await supabaseAdmin.from('payment_transactions').delete().eq('id', id);
  }
  for (const id of cleanupIds.users) {
    await supabaseAdmin.from('admin_users').delete().eq('user_id', id);
    await supabaseAdmin.auth.admin.deleteUser(id);
  }
  cleanupIds.transactions = [];
  cleanupIds.refundRequests = [];
  cleanupIds.users = [];
  cleanupIds.userProductAccess = [];
}

// ===== TESTS =====

let testProduct: { id: string; name: string; price: number; currency: string };
let adminUser: { userId: string; client: SupabaseClient };

beforeAll(async () => {
  testProduct = await getTestProduct();
  adminUser = await createTestAdminUser();
});

afterAll(async () => {
  await cleanup();
});

afterEach(async () => {
  // Clean up per-test data but keep shared fixtures (product, admin)
  for (const id of cleanupIds.refundRequests) {
    await supabaseAdmin.from('refund_requests').delete().eq('id', id);
  }
  for (const { userId, productId } of cleanupIds.userProductAccess) {
    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);
  }
  for (const id of cleanupIds.transactions) {
    await supabaseAdmin.from('payment_transactions').delete().eq('id', id);
  }
  // Clean up per-test users (not the shared admin)
  const perTestUsers = cleanupIds.users.filter((id) => id !== adminUser.userId);
  for (const id of perTestUsers) {
    await supabaseAdmin.from('admin_users').delete().eq('user_id', id);
    await supabaseAdmin.auth.admin.deleteUser(id);
  }
  cleanupIds.transactions = [];
  cleanupIds.refundRequests = [];
  cleanupIds.userProductAccess = [];
  cleanupIds.users = cleanupIds.users.filter((id) => id === adminUser.userId);
});

// =============================================================================
// process_refund_request
// =============================================================================

describe('process_refund_request RPC', () => {
  it('1. Successfully approves a refund request', async () => {
    const transaction = await createTestTransaction(testProduct.id);
    const request = await createTestRefundRequest(transaction.id, testProduct.id);

    const { data, error } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'approve',
      admin_response_param: 'Approved by admin',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(true);
    expect(data.status).toBe('approved');
    expect(data.message).toContain('approved');
    expect(data.transaction_id).toBe(transaction.id);
    expect(data.stripe_payment_intent_id).toBe(transaction.stripe_payment_intent_id);
    expect(data.amount).toBe(request.requested_amount);
    expect(data.currency).toBe(request.currency);

    // Verify DB state
    const { data: updatedRequest } = await supabaseAdmin
      .from('refund_requests')
      .select('status, admin_id, admin_response, processed_at')
      .eq('id', request.id)
      .single();

    expect(updatedRequest?.status).toBe('approved');
    expect(updatedRequest?.admin_id).toBe(adminUser.userId);
    expect(updatedRequest?.admin_response).toBe('Approved by admin');
    expect(updatedRequest?.processed_at).not.toBeNull();
  });

  it('2. Rejects a refund request', async () => {
    const transaction = await createTestTransaction(testProduct.id);
    const request = await createTestRefundRequest(transaction.id, testProduct.id);

    const { data, error } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'reject',
      admin_response_param: 'Outside refund window',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(true);
    expect(data.status).toBe('rejected');
    expect(data.message).toContain('rejected');
    expect(data.admin_response).toBe('Outside refund window');

    // Verify DB state (including admin_response persisted in DB, not just RPC return)
    const { data: updatedRequest } = await supabaseAdmin
      .from('refund_requests')
      .select('status, admin_id, admin_response, processed_at')
      .eq('id', request.id)
      .single();

    expect(updatedRequest?.status).toBe('rejected');
    expect(updatedRequest?.admin_id).toBe(adminUser.userId);
    expect(updatedRequest?.admin_response).toBe('Outside refund window');
    expect(updatedRequest?.processed_at).not.toBeNull();
  });

  it('3. Returns error for invalid request_id', async () => {
    const fakeRequestId = '00000000-0000-0000-0000-000000000099';

    const { data, error } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: fakeRequestId,
      action_param: 'approve',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(false);
    expect(data.error).toContain('not found');
  });

  it('4. Already processed request returns idempotent error', async () => {
    const transaction = await createTestTransaction(testProduct.id);
    const request = await createTestRefundRequest(transaction.id, testProduct.id);

    // First call - approve (must succeed before testing idempotency)
    const { data: firstData, error: firstError } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'approve',
    });
    expect(firstError).toBeNull();
    expect(firstData?.success).toBe(true);

    // Second call - try to process again
    const { data, error } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'approve',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(false);
    expect(data.error).toContain('already processed');
    expect(data.current_status).toBe('approved');
  });

  it('5. Non-admin user cannot process refund requests', async () => {
    const transaction = await createTestTransaction(testProduct.id);
    const request = await createTestRefundRequest(transaction.id, testProduct.id);
    const regularUser = await createTestRegularUser();

    const { data, error } = await regularUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'approve',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Admin privileges required');

    // Verify request was NOT processed and admin_id was not set
    const { data: unchanged } = await supabaseAdmin
      .from('refund_requests')
      .select('status, admin_id, admin_response, processed_at')
      .eq('id', request.id)
      .single();

    expect(unchanged?.status).toBe('pending');
    expect(unchanged?.admin_id).toBeNull();
    expect(unchanged?.admin_response).toBeNull();
    expect(unchanged?.processed_at).toBeNull();
  });

  it('6. Invalid action_param is rejected and DB status unchanged', async () => {
    const transaction = await createTestTransaction(testProduct.id);
    const request = await createTestRefundRequest(transaction.id, testProduct.id);

    const { data, error } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'invalid_action',
    });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Invalid action');

    // Verify DB state was NOT modified after rejection
    const { data: unchangedRequest } = await supabaseAdmin
      .from('refund_requests')
      .select('status, admin_id, admin_response, processed_at')
      .eq('id', request.id)
      .single();

    expect(unchangedRequest?.status).toBe('pending');
    expect(unchangedRequest?.admin_id).toBeNull();
    expect(unchangedRequest?.admin_response).toBeNull();
    expect(unchangedRequest?.processed_at).toBeNull();
  });

  it('7. Approval returns Stripe payment details for downstream processing', async () => {
    const transaction = await createTestTransaction(testProduct.id, {
      amount: 9999,
    });
    const request = await createTestRefundRequest(transaction.id, testProduct.id, {
      requested_amount: 9999,
      currency: 'usd',
    });

    const { data } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'approve',
    });

    expect(data.success).toBe(true);

    // The primary purpose of this test is to verify the JOIN between refund_requests
    // and payment_transactions works correctly. The function must retrieve and return
    // fields from BOTH tables in a single structured response for downstream Stripe
    // refund processing.

    // Fields from payment_transactions (prove JOIN retrieves transaction data):
    expect(data.stripe_payment_intent_id).toBeTruthy();
    expect(data.stripe_payment_intent_id).toMatch(/^pi_/);
    expect(data.transaction_id).toBe(transaction.id);

    // Amount validates the JOIN path: the function reads requested_amount from
    // refund_requests which references the payment_transactions record.
    expect(typeof data.amount).toBe('number');
    expect(data.amount).toBe(request.requested_amount);
    expect(data.currency).toBe(request.currency);

    // Fields from refund_requests (prove JOIN retrieves request data):
    expect(data.status).toBe('approved');
    expect(data.message).toContain('approved');

    // Verify the DB was actually updated with computed timestamps and admin metadata
    const { data: updatedRequest } = await supabaseAdmin
      .from('refund_requests')
      .select('status, admin_id, processed_at, updated_at')
      .eq('id', request.id)
      .single();

    expect(updatedRequest?.status).toBe('approved');
    expect(updatedRequest?.admin_id).toBe(adminUser.userId);
    expect(updatedRequest?.processed_at).not.toBeNull();
    expect(updatedRequest?.updated_at).not.toBeNull();
  });

  it('8. Anon (unauthenticated) user cannot call process_refund_request', async () => {
    const transaction = await createTestTransaction(testProduct.id);
    const request = await createTestRefundRequest(transaction.id, testProduct.id);

    // Create an unauthenticated (anon) client - no sign-in
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await anonClient.rpc('process_refund_request', {
      request_id_param: request.id,
      action_param: 'approve',
    });

    // REVOKE EXECUTE from anon should result in permission denied
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('9. NULL request_id_param returns "not found" error', async () => {
    const { data, error } = await adminUser.client.rpc('process_refund_request', {
      request_id_param: null as unknown as string,
      action_param: 'approve',
    });

    // The function handles NULL gracefully: NULL uuid matches no row in the
    // SELECT ... WHERE id = request_id_param query, so it returns "not found".
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Refund request not found');
  });
});

// =============================================================================
// validate_payment_transaction
// =============================================================================

describe('validate_payment_transaction RPC', () => {
  // NOTE: Tests 1-6, 9-10 use service_role (supabaseAdmin) because EXECUTE on
  // validate_payment_transaction is restricted to service_role only (see migration
  // 20260302000000_restrict_rpc_function_access.sql). The SQL function contains a
  // `user_id = current_user_id` ownership path, but it is unreachable since no
  // authenticated user can call the function. Tests 7 and 8 verify this restriction.

  it('1. Returns true for a valid completed transaction', async () => {
    const transaction = await createTestTransaction(testProduct.id);

    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('2. Returns true for a transaction with valid partial refund', async () => {
    const transaction = await createTestTransaction(testProduct.id, {
      amount: 5000,
      refunded_amount: 2500,
      status: 'completed',
    });

    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('3. Returns false for non-existent transaction', async () => {
    const fakeId = '00000000-0000-4000-a000-000000000099';

    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: fakeId,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('4. Returns false for nil UUID (00000000...)', async () => {
    const nilUuid = '00000000-0000-0000-0000-000000000000';

    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: nilUuid,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('4b. Returns false for actual NULL transaction_id', async () => {
    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: null as unknown as string,
    });

    // NULL UUID parameter: PostgreSQL coerces NULL to the function's UUID param type.
    // The function should handle NULL gracefully by returning false (no matching row),
    // not by raising a PostgreSQL error.
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('5. Returns false for refunded transaction missing refunded_at', async () => {
    const transaction = await createTestTransaction(testProduct.id, {
      status: 'refunded',
      refunded_amount: 4999,
    });

    // The function checks: status = 'refunded' AND refunded_at IS NULL -> false
    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('6. Returns true for properly refunded transaction with refunded_at set', async () => {
    const transaction = await createTestTransaction(testProduct.id, {
      status: 'refunded',
      refunded_amount: 4999,
      refunded_at: new Date().toISOString(),
    });

    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('7. Authenticated users are denied direct access (service_role only)', async () => {
    // validate_payment_transaction EXECUTE is restricted to service_role.
    // Authenticated users (including admins) get permission denied.
    const transaction = await createTestTransaction(testProduct.id);
    const regularUser = await createTestRegularUser();

    const { data, error } = await regularUser.client.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501'); // permission denied
    expect(data).toBeNull();
  });

  it('8. Admin users are also denied direct RPC access (service_role only)', async () => {
    // Even admin-authenticated clients cannot call this function directly.
    // It is restricted to service_role for server-side validation only.
    const transaction = await createTestTransaction(testProduct.id, {
      user_id: adminUser.userId,
    });

    const { data, error } = await adminUser.client.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(data).toBeNull();
  });

  it('9. Service role can validate any transaction', async () => {
    const regularUser = await createTestRegularUser();

    const transaction = await createTestTransaction(testProduct.id, {
      user_id: regularUser.userId,
    });

    // Service role validates a transaction it doesn't own
    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it('10. Returns true for refunded transaction with full refund amount and refunded_at set', async () => {
    // Tests the valid state when refunded_amount == amount: status should be 'refunded'
    // with refunded_at set. This is the expected production state after a full refund
    // is processed. The function should return true for this consistent data state.
    const transaction = await createTestTransaction(testProduct.id, {
      amount: 3000,
      refunded_amount: 3000,
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    });

    const { data, error } = await supabaseAdmin.rpc('validate_payment_transaction', {
      transaction_id: transaction.id,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});
