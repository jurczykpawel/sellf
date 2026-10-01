/**
 * ============================================================================
 * Account deletion: retention vs. cascade for auth.users foreign keys
 * ============================================================================
 *
 * An operator deletes a Sellf user from Supabase Auth (dashboard "Delete
 * user", or `auth.admin.deleteUser`) for reasons such as a GDPR erasure
 * request. This must succeed for a user with a realistic history, and the
 * outcome per table must match one of two rules:
 *
 * - Financial / legal records (payments, refunds, price-history compliance
 *   snapshots, the signup audit trail) are KEPT with the user reference set
 *   to NULL.
 * - Pure per-account data (access grants, admin membership, API keys,
 *   viewing progress) is REMOVED along with the account.
 *
 * REQUIRES: Supabase running locally (npx supabase start / already running).
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 * @see supabase/migrations/20250101000000_core_schema.sql (audit_log)
 * @see supabase/migrations/20250102000000_payment_system.sql (payment_transactions, refund_requests, admin_actions)
 * @see supabase/migrations/20251229120000_omnibus_directive.sql (product_price_history)
 * @see supabase/migrations/20260529000000_license_keys.sql (issued_licenses)
 *
 * Two tables get their own describe blocks further down because they needed a
 * product decision rather than a mechanical "keep vs remove" call:
 *
 * - `subscriptions.user_id` blocks deletion only while the subscription is in a
 *   status where Stripe is still charging (or about to charge) the customer.
 *   Once it has ended, the row is kept with user_id set to NULL like the other
 *   financial tables above.
 * - `seller_license_keys.seller_id` is kept (NULLed) like `issued_licenses`, and
 *   both tables get a permanent `original_seller_id` so a buyer's license keeps
 *   verifying (JWKS + CRL) even after the seller's account is deleted.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deleteChecked } from '../../helpers/db-cleanup';
import { generateSellerKeypair } from '@/lib/license-keys/keys';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Stripe-style ids (session_id, stripe_payment_intent_id, refund_id) are
// constrained to `[a-zA-Z0-9_]+` after their prefix — no dashes.
const ALNUM_ID = TEST_ID.replace(/[^a-zA-Z0-9]/g, '');

async function createTestProduct(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const slug = `test-del-${TEST_ID}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await admin
    .from('products')
    .insert({
      name: `Test Product ${slug}`,
      slug,
      price: 4900,
      currency: 'USD',
      is_active: true,
      is_refundable: true,
      ...overrides,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create product: ${error.message}`);
  return data as { id: string };
}

async function createTestSubscription(
  userId: string,
  productId: string,
  status: string
): Promise<{ id: string }> {
  const suffix = `${TEST_ID}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await admin
    .from('subscriptions')
    .insert({
      user_id: userId,
      product_id: productId,
      stripe_customer_id: `cus_test_${suffix}`,
      stripe_subscription_id: `sub_test_${suffix}`,
      status,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create subscription (status=${status}): ${error.message}`);
  return data as { id: string };
}

// Cleanup that runs regardless of which assertions fail, so a RED run never
// leaves rows behind for the next one. Rows kept on purpose by the FK change
// under test (audit_log, admin_actions) have their user reference nulled out
// by the time the account is deleted, so they can't be found by that
// reference afterwards — track their own ids instead.
const createdProductIds: string[] = [];
const createdUserIds: string[] = [];
const createdAuditLogIds: string[] = [];
const createdAdminActionIds: string[] = [];
// subscriptions.product_id is ON DELETE RESTRICT — a kept (ended) subscription row
// must be removed before its product, or the product cleanup below fails outright.
const createdSubscriptionIds: string[] = [];

afterAll(async () => {
  if (createdSubscriptionIds.length > 0) {
    await deleteChecked('subscriptions (test rows)', admin.from('subscriptions').delete().in('id', createdSubscriptionIds));
  }
  if (createdAuditLogIds.length > 0) {
    await deleteChecked('audit_log (test rows)', admin.from('audit_log').delete().in('id', createdAuditLogIds));
  }
  if (createdAdminActionIds.length > 0) {
    await deleteChecked('admin_actions (test rows)', admin.from('admin_actions').delete().in('id', createdAdminActionIds));
  }
  await deleteChecked('consent_logs (test rows)', admin.from('consent_logs').delete().in('user_id', createdUserIds));
  if (createdProductIds.length > 0) {
    // Deleting the product cascades to payment_transactions, refund_requests,
    // product_price_history, issued_licenses, user_product_access and
    // video_progress rows created for it.
    await deleteChecked('products (test rows)', admin.from('products').delete().in('id', createdProductIds));
  }
  for (const id of createdUserIds) {
    // Best-effort: if a test left the user behind (e.g. an early assertion
    // threw before deletion), remove it so it doesn't linger in auth.users.
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe('auth.admin.deleteUser() with a full account history', () => {
  it('succeeds, keeps financial/audit rows with the reference set to NULL, and removes per-account rows', async () => {
    const email = `test-del-${TEST_ID}@example.com`;
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'Test-password-1234!',
      email_confirm: true,
    });
    if (userError || !userData.user) throw new Error(`Failed to create user: ${userError?.message}`);
    const userId = userData.user.id;
    createdUserIds.push(userId);

    // handle_new_user_registration() already wrote one audit_log row for this
    // signup (user_id = userId) — track it for cleanup now, before its
    // user_id reference is nulled by the deletion under test.
    const { data: signupAuditRow, error: signupAuditReadError } = await admin
      .from('audit_log')
      .select('id')
      .eq('table_name', 'auth.users')
      .eq('user_id', userId)
      .single();
    if (signupAuditReadError || !signupAuditRow) {
      throw new Error(`Failed to read signup audit_log row: ${signupAuditReadError?.message}`);
    }
    createdAuditLogIds.push(signupAuditRow.id);

    const product = await createTestProduct();
    createdProductIds.push(product.id);

    // This user is also an admin/seller (Sellf's common single-tenant setup),
    // so they can own an API key and be recorded as the admin on an action.
    const { error: adminUsersError } = await admin
      .from('admin_users')
      .upsert({ user_id: userId }, { onConflict: 'user_id' });
    if (adminUsersError) throw new Error(`Failed to insert admin_users: ${adminUsersError.message}`);

    const { data: adminUserRow, error: adminUserRowError } = await admin
      .from('admin_users')
      .select('id')
      .eq('user_id', userId)
      .single();
    if (adminUserRowError || !adminUserRow) throw new Error(`Failed to read admin_users: ${adminUserRowError?.message}`);

    const { error: apiKeyError } = await admin.from('api_keys').insert({
      name: `test key ${TEST_ID}`,
      key_prefix: 'sf_test_' + TEST_ID.slice(0, 4),
      key_hash: `hash-${TEST_ID}`,
      admin_user_id: adminUserRow.id,
    });
    if (apiKeyError) throw new Error(`Failed to insert api_keys: ${apiKeyError.message}`);

    const { error: accessError } = await admin
      .from('user_product_access')
      .insert({ user_id: userId, product_id: product.id });
    if (accessError) throw new Error(`Failed to insert user_product_access: ${accessError.message}`);

    const { data: txRow, error: txError } = await admin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test${ALNUM_ID}`,
        user_id: userId,
        product_id: product.id,
        customer_email: email,
        amount: 4900,
        currency: 'USD',
        stripe_payment_intent_id: `pi_test${ALNUM_ID}`,
        status: 'refunded',
        refunded_amount: 4900,
        refunded_at: new Date().toISOString(),
        refunded_by: userId,
        refund_id: `re_test${ALNUM_ID}`,
      })
      .select('id')
      .single();
    if (txError || !txRow) throw new Error(`Failed to insert payment_transactions: ${txError?.message}`);

    const { data: refundRow, error: refundError } = await admin
      .from('refund_requests')
      .insert({
        transaction_id: txRow.id,
        user_id: userId,
        customer_email: email,
        product_id: product.id,
        admin_id: userId,
        status: 'approved',
        requested_amount: 4900,
        currency: 'USD',
      })
      .select('id')
      .single();
    if (refundError || !refundRow) throw new Error(`Failed to insert refund_requests: ${refundError?.message}`);

    const { data: adminActionRow, error: adminActionError } = await admin
      .from('admin_actions')
      .insert({
        admin_id: userId,
        action: 'refund_processed',
        target_type: 'payment_transactions',
        target_id: txRow.id,
      })
      .select('id')
      .single();
    if (adminActionError || !adminActionRow) throw new Error(`Failed to insert admin_actions: ${adminActionError?.message}`);
    createdAdminActionIds.push(adminActionRow.id);

    const { data: priceHistoryRow, error: priceHistoryError } = await admin
      .from('product_price_history')
      .insert({
        product_id: product.id,
        price: 4900,
        currency: 'USD',
        changed_by: userId,
      })
      .select('id')
      .single();
    if (priceHistoryError || !priceHistoryRow) throw new Error(`Failed to insert product_price_history: ${priceHistoryError?.message}`);

    const { error: consentError } = await admin.from('consent_logs').insert({
      user_id: userId,
      consent_version: '1',
      consents: { analytics: true, marketing: false },
    });
    if (consentError) throw new Error(`Failed to insert consent_logs: ${consentError.message}`);

    const { error: videoProgressError } = await admin.from('video_progress').insert({
      user_id: userId,
      product_id: product.id,
      video_id: `video-${TEST_ID}`,
      last_position_seconds: 30,
      max_position_seconds: 30,
    });
    if (videoProgressError) throw new Error(`Failed to insert video_progress: ${videoProgressError.message}`);

    // A signup audit_log row (user_id = the new user) already exists from the
    // handle_new_user_registration() trigger fired by createUser() above.
    // Add one more with performed_by = this user, to cover that column too.
    const { data: performedByAuditRow, error: performedByAuditError } = await admin
      .from('audit_log')
      .insert({
        table_name: 'products',
        operation: 'UPDATE',
        performed_by: userId,
        user_id: userId,
      })
      .select('id')
      .single();
    if (performedByAuditError || !performedByAuditRow) throw new Error(`Failed to insert audit_log: ${performedByAuditError?.message}`);
    createdAuditLogIds.push(performedByAuditRow.id);

    // ===== Act: delete the account =====
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    expect(deleteError).toBeNull();

    // ===== Assert: financial / legal records survive with the reference NULLed =====
    const { data: auditRows, error: auditReadError } = await admin
      .from('audit_log')
      .select('user_id, performed_by')
      .or(`user_id.eq.${userId},performed_by.eq.${userId}`);
    expect(auditReadError).toBeNull();
    // The rows themselves are found by columns that must now be NULL, so a
    // match here would mean the FK still points at the deleted user.
    expect(auditRows).toEqual([]);

    const { data: keptAuditRow, error: keptAuditError } = await admin
      .from('audit_log')
      .select('id, user_id, performed_by')
      .eq('id', performedByAuditRow.id)
      .single();
    expect(keptAuditError).toBeNull();
    expect(keptAuditRow).toMatchObject({ user_id: null, performed_by: null });

    const { data: keptSignupAuditRow, error: keptSignupAuditError } = await admin
      .from('audit_log')
      .select('id, user_id')
      .eq('id', signupAuditRow.id)
      .single();
    expect(keptSignupAuditError).toBeNull();
    expect(keptSignupAuditRow).toMatchObject({ user_id: null });

    const { data: keptTx, error: keptTxError } = await admin
      .from('payment_transactions')
      .select('id, user_id, refunded_by, status, amount')
      .eq('id', txRow.id)
      .single();
    expect(keptTxError).toBeNull();
    expect(keptTx).toMatchObject({ user_id: null, refunded_by: null, status: 'refunded', amount: 4900 });

    const { data: keptRefund, error: keptRefundError } = await admin
      .from('refund_requests')
      .select('id, user_id, admin_id, status')
      .eq('id', refundRow.id)
      .single();
    expect(keptRefundError).toBeNull();
    expect(keptRefund).toMatchObject({ user_id: null, admin_id: null, status: 'approved' });

    const { data: keptAdminAction, error: keptAdminActionError } = await admin
      .from('admin_actions')
      .select('id, admin_id, action')
      .eq('id', adminActionRow.id)
      .single();
    expect(keptAdminActionError).toBeNull();
    expect(keptAdminAction).toMatchObject({ admin_id: null, action: 'refund_processed' });

    const { data: keptPriceHistory, error: keptPriceHistoryError } = await admin
      .from('product_price_history')
      .select('id, changed_by')
      .eq('id', priceHistoryRow.id)
      .single();
    expect(keptPriceHistoryError).toBeNull();
    expect(keptPriceHistory).toMatchObject({ changed_by: null });

    // consent_logs has no FK at all to auth.users — the row and its
    // user_id value must be completely untouched by the deletion.
    const { data: keptConsent, error: keptConsentError } = await admin
      .from('consent_logs')
      .select('id, user_id')
      .eq('user_id', userId);
    expect(keptConsentError).toBeNull();
    expect(keptConsent).toHaveLength(1);

    // ===== Assert: per-account rows are gone =====
    const { data: leftoverAccess } = await admin
      .from('user_product_access')
      .select('id')
      .eq('user_id', userId);
    expect(leftoverAccess).toEqual([]);

    const { data: leftoverVideoProgress } = await admin
      .from('video_progress')
      .select('id')
      .eq('user_id', userId);
    expect(leftoverVideoProgress).toEqual([]);

    const { data: leftoverAdminUsers } = await admin
      .from('admin_users')
      .select('id')
      .eq('user_id', userId);
    expect(leftoverAdminUsers).toEqual([]);

    const { data: leftoverApiKeys } = await admin
      .from('api_keys')
      .select('id')
      .eq('admin_user_id', adminUserRow.id);
    expect(leftoverApiKeys).toEqual([]);

    // The user itself is gone.
    const { data: authUsersPage } = await admin.auth.admin.listUsers();
    expect(authUsersPage.users.some((u) => u.id === userId)).toBe(false);
  });
});

describe('auth.admin.deleteUser() for a seller with issued license history', () => {
  it('keeps issued_licenses rows with seller_id set to NULL', async () => {
    const email = `test-del-lic-${TEST_ID}@example.com`;
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'Test-password-1234!',
      email_confirm: true,
    });
    if (userError || !userData.user) throw new Error(`Failed to create user: ${userError?.message}`);
    const sellerId = userData.user.id;
    createdUserIds.push(sellerId);

    const product = await createTestProduct();
    createdProductIds.push(product.id);

    const { data: licenseRow, error: licenseError } = await admin
      .from('issued_licenses')
      .insert({
        seller_id: sellerId,
        product_id: product.id,
        email: 'buyer@example.com',
        order_id: `order_${TEST_ID}`,
        kid: `kid_${TEST_ID}`,
        license_key: `header.payload.signature-${TEST_ID}`,
      })
      .select('id')
      .single();
    if (licenseError || !licenseRow) throw new Error(`Failed to insert issued_licenses: ${licenseError?.message}`);

    const { error: deleteError } = await admin.auth.admin.deleteUser(sellerId);
    expect(deleteError).toBeNull();

    const { data: keptLicense, error: keptLicenseError } = await admin
      .from('issued_licenses')
      .select('id, seller_id')
      .eq('id', licenseRow.id)
      .single();
    expect(keptLicenseError).toBeNull();
    expect(keptLicense).toMatchObject({ seller_id: null });
  });
});

describe('auth.admin.deleteUser() with a subscription: blocked while Stripe is still billing', () => {
  // Read off Stripe's own subscription-status semantics (see the migration's
  // "Account deletion: subscriptions" comment for the full reasoning): these are
  // the statuses where Stripe is currently charging the customer or about to.
  const BLOCKING_STATUSES = ['trialing', 'active', 'past_due', 'incomplete'] as const;

  it.each(BLOCKING_STATUSES)(
    'rejects deletion while a "%s" subscription exists, and succeeds once it is gone',
    async (status) => {
      const email = `test-del-sub-block-${status}-${TEST_ID}@example.com`;
      const { data: userData, error: userError } = await admin.auth.admin.createUser({
        email,
        password: 'Test-password-1234!',
        email_confirm: true,
      });
      if (userError || !userData.user) throw new Error(`Failed to create user: ${userError?.message}`);
      const userId = userData.user.id;
      createdUserIds.push(userId);

      const product = await createTestProduct();
      createdProductIds.push(product.id);

      const sub = await createTestSubscription(userId, product.id, status);
      createdSubscriptionIds.push(sub.id);

      // GoTrue wraps the underlying Postgres exception into a generic 500 —
      // the trigger's specific message reaches the server logs, not this
      // response (measured: `docker logs supabase_auth_sellf` shows the raw
      // "Cannot delete user: an active Stripe subscription exists..." text
      // for the same call that gets this generic error back here). Assert
      // what the caller actually observes: the delete is rejected, not what
      // Postgres said internally.
      const { error: blockedDeleteError } = await admin.auth.admin.deleteUser(userId);
      expect(blockedDeleteError).not.toBeNull();
      expect(blockedDeleteError?.status).toBe(500);

      // Rejected, not silently skipped — the account must still exist.
      const { data: afterBlockPage } = await admin.auth.admin.listUsers();
      expect(afterBlockPage.users.some((u) => u.id === userId)).toBe(true);

      // Once the subscription is gone (e.g. canceled in Stripe and removed here),
      // the same delete call succeeds.
      await deleteChecked('subscriptions (blocking-status test)', admin.from('subscriptions').delete().eq('id', sub.id));
      const { error: secondDeleteError } = await admin.auth.admin.deleteUser(userId);
      expect(secondDeleteError).toBeNull();
    }
  );

  // Statuses where Stripe has already stopped (or never started) attempting to
  // collect — these must NOT block deletion, and the row survives with user_id
  // set to NULL like every other financial table above.
  const NON_BLOCKING_STATUSES = ['canceled', 'incomplete_expired', 'unpaid', 'paused'] as const;

  it.each(NON_BLOCKING_STATUSES)(
    'allows deletion with an ended ("%s") subscription, keeping the row with user_id set to NULL',
    async (status) => {
      const email = `test-del-sub-ok-${status}-${TEST_ID}@example.com`;
      const { data: userData, error: userError } = await admin.auth.admin.createUser({
        email,
        password: 'Test-password-1234!',
        email_confirm: true,
      });
      if (userError || !userData.user) throw new Error(`Failed to create user: ${userError?.message}`);
      const userId = userData.user.id;
      createdUserIds.push(userId);

      const product = await createTestProduct();
      createdProductIds.push(product.id);

      const sub = await createTestSubscription(userId, product.id, status);
      createdSubscriptionIds.push(sub.id);

      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      expect(deleteError).toBeNull();

      const { data: keptSub, error: keptSubError } = await admin
        .from('subscriptions')
        .select('id, user_id, status')
        .eq('id', sub.id)
        .single();
      expect(keptSubError).toBeNull();
      expect(keptSub).toMatchObject({ user_id: null, status });
    }
  );
});

describe('auth.admin.deleteUser() for a seller with an issued license key: verification keeps working', () => {
  it('keeps seller_license_keys with seller_id set to NULL, and JWKS/CRL still resolve by the original seller id', async () => {
    const email = `test-del-lic-key-${TEST_ID}@example.com`;
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: 'Test-password-1234!',
      email_confirm: true,
    });
    if (userError || !userData.user) throw new Error(`Failed to create user: ${userError?.message}`);
    const sellerId = userData.user.id;
    createdUserIds.push(sellerId);

    const product = await createTestProduct();
    createdProductIds.push(product.id);

    const keypair = generateSellerKeypair();
    const { data: keyRow, error: keyError } = await admin
      .from('seller_license_keys')
      .insert({
        seller_id: sellerId,
        kid: keypair.kid,
        public_key: keypair.publicKeyPem,
        encrypted_key: 'test-encrypted-key',
        encryption_iv: 'test-iv',
        encryption_tag: 'test-tag',
        custody: 'managed',
        is_active: true,
      })
      .select('id')
      .single();
    if (keyError || !keyRow) throw new Error(`Failed to insert seller_license_keys: ${keyError?.message}`);

    const { data: licenseRow, error: licenseError } = await admin
      .from('issued_licenses')
      .insert({
        seller_id: sellerId,
        product_id: product.id,
        email: 'buyer@example.com',
        order_id: `order_key_${TEST_ID}`,
        kid: keypair.kid,
        license_key: `header.payload.signature-${TEST_ID}`,
      })
      .select('id')
      .single();
    if (licenseError || !licenseRow) throw new Error(`Failed to insert issued_licenses: ${licenseError?.message}`);

    // Confirm the JWKS/CRL lookup works BEFORE deletion, so the post-deletion
    // assertion actually proves continuity rather than a lookup that never worked.
    const { data: keysBefore, error: keysBeforeError } = await admin.rpc('seller_license_public_keys', {
      seller: sellerId,
    });
    expect(keysBeforeError).toBeNull();
    expect(keysBefore).toEqual([{ kid: keypair.kid, public_key: keypair.publicKeyPem, alg: 'ES256' }]);

    const { error: deleteError } = await admin.auth.admin.deleteUser(sellerId);
    expect(deleteError).toBeNull();

    const { data: keptKey, error: keptKeyError } = await admin
      .from('seller_license_keys')
      .select('id, seller_id, original_seller_id')
      .eq('id', keyRow.id)
      .single();
    expect(keptKeyError).toBeNull();
    expect(keptKey).toMatchObject({ seller_id: null, original_seller_id: sellerId });

    // The public JWKS endpoint's RPC still resolves the key by the seller id the
    // buyer's verifier already has, even though the seller account is gone.
    const { data: keysAfter, error: keysAfterError } = await admin.rpc('seller_license_public_keys', {
      seller: sellerId,
    });
    expect(keysAfterError).toBeNull();
    expect(keysAfter).toEqual([{ kid: keypair.kid, public_key: keypair.publicKeyPem, alg: 'ES256' }]);

    // The CRL/revocation RPC resolves the same way for issued_licenses.
    await deleteChecked(
      'issued_licenses (revoke for CRL test)',
      admin.from('issued_licenses').update({ revoked_at: new Date().toISOString() }).eq('id', licenseRow.id)
    );
    const orderHash = createHash('sha256').update(`order_key_${TEST_ID}`).digest('hex');
    const { data: revokedAfter, error: revokedAfterError } = await admin.rpc('seller_revoked_orders', {
      seller: sellerId,
      hash_prefix: orderHash.slice(0, 4),
    });
    expect(revokedAfterError).toBeNull();
    expect(revokedAfter).toEqual([{ order_hash: orderHash }]);
  });
});
