/**
 * Guest Payment Data Migration Tests
 *
 * Tests for migrate_guest_payment_data_to_profile() function
 * which transfers payment metadata from guest purchases to user profile on registration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

describe('Guest Payment Data Migration', () => {
  const TEST_EMAIL = `test-guest-${Date.now()}@example.com`;
  let testUserId: string;
  let testProductId: string;

  beforeAll(async () => {
    // Clear ALL rate limits — prevents "Too many admin actions" from other test file runs
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    // Create test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Test Product ${Date.now()}`,
        slug: `test-product-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true
      })
      .select()
      .single();

    if (productError) throw productError;
    testProductId = product.id;
  });

  afterAll(async () => {
    // Clean up test product
    if (testProductId) {
      await supabaseAdmin.from('products').delete().eq('id', testProductId);
    }

    // Clean up test user
    if (testUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
    }
  });

  it('should migrate name fields from latest guest payment', async () => {
    // 1. Create guest payment with customer name (NO invoice)
    const { error: paymentError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        product_id: testProductId,
        customer_email: TEST_EMAIL,
        amount: 100,
        currency: 'PLN',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${Date.now()}`,
        session_id: `cs_test_${Date.now()}`,
        metadata: {
          full_name: 'Jan Kowalski',
          first_name: 'Jan',
          last_name: 'Kowalski',
          needs_invoice: 'false' // No invoice, so company data should NOT be migrated
        }
      });

    if (paymentError) throw paymentError;

    // 2. Create user with same email
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: 'test123456',
      email_confirm: true
    });

    if (authError) throw authError;
    testUserId = authData.user.id;

    // Wait for trigger to execute
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Verify profile has name data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', testUserId)
      .single();

    if (profileError) throw profileError;

    expect(profile.full_name).toBe('Jan Kowalski');
    expect(profile.first_name).toBe('Jan');
    expect(profile.last_name).toBe('Kowalski');

    // Company data should NOT be migrated (no invoice)
    expect(profile.tax_id).toBeNull();
    expect(profile.company_name).toBeNull();
  });

  it('should migrate company data ONLY when invoice was requested', async () => {
    const TEST_EMAIL_2 = `test-guest-invoice-${Date.now()}@example.com`;
    let testUserId2: string;

    try {
      // 1. Create guest payment WITH invoice
      const { error: paymentError } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          product_id: testProductId,
          customer_email: TEST_EMAIL_2,
          amount: 100,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_test_invoice_${Date.now()}`,
          session_id: `cs_test_invoice_${Date.now()}`,
          metadata: {
            full_name: 'Anna Nowak',
            first_name: 'Anna',
            last_name: 'Nowak',
            needs_invoice: 'true',
            nip: '5260250274',
            company_name: 'Test Sp. z o.o.',
            address: 'ul. Testowa 1',
            city: 'Warszawa',
            postal_code: '00-001',
            country: 'PL'
          }
        });

      if (paymentError) throw paymentError;

      // 2. Create user with same email
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: TEST_EMAIL_2,
        password: 'test123456',
        email_confirm: true
      });

      if (authError) throw authError;
      testUserId2 = authData.user.id;

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Verify ALL data was migrated
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', testUserId2)
        .single();

      if (profileError) throw profileError;

      // Name fields
      expect(profile.full_name).toBe('Anna Nowak');
      expect(profile.first_name).toBe('Anna');
      expect(profile.last_name).toBe('Nowak');

      // Company data (only because needs_invoice='true')
      expect(profile.tax_id).toBe('5260250274');
      expect(profile.company_name).toBe('Test Sp. z o.o.');
      expect(profile.address_line1).toBe('ul. Testowa 1');
      expect(profile.city).toBe('Warszawa');
      expect(profile.zip_code).toBe('00-001');
      expect(profile.country).toBe('PL');
    } finally {
      // Clean up
      if (testUserId2) {
        await supabaseAdmin.auth.admin.deleteUser(testUserId2);
      }
    }
  });

  it('should use LATEST payment when multiple guest payments exist', async () => {
    const TEST_EMAIL_3 = `test-guest-multiple-${Date.now()}@example.com`;
    let testUserId3: string;

    try {
      // 1. Create FIRST guest payment
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          product_id: testProductId,
          customer_email: TEST_EMAIL_3,
          amount: 100,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_test_old_${Date.now()}`,
          session_id: `cs_test_old_${Date.now()}`,
          metadata: {
            full_name: 'Old Name',
            first_name: 'Old',
            last_name: 'Name',
            needs_invoice: 'true',
            nip: '1234567890',
            company_name: 'Old Company'
          },
          created_at: new Date(Date.now() - 10000).toISOString() // 10 seconds ago
        });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // 2. Create SECOND (LATEST) guest payment
      await supabaseAdmin
        .from('payment_transactions')
        .insert({
          product_id: testProductId,
          customer_email: TEST_EMAIL_3,
          amount: 200,
          currency: 'PLN',
          status: 'completed',
          stripe_payment_intent_id: `pi_test_new_${Date.now()}`,
          session_id: `cs_test_new_${Date.now()}`,
          metadata: {
            full_name: 'New Name',
            first_name: 'New',
            last_name: 'Name',
            needs_invoice: 'true',
            nip: '5260250274',
            company_name: 'New Company'
          }
        });

      // 3. Create user
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: TEST_EMAIL_3,
        password: 'test123456',
        email_confirm: true
      });

      if (authError) throw authError;
      testUserId3 = authData.user.id;

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 4. Verify LATEST payment data was used
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', testUserId3)
        .single();

      if (profileError) throw profileError;

      expect(profile.full_name).toBe('New Name');
      expect(profile.first_name).toBe('New');
      expect(profile.last_name).toBe('Name');
      expect(profile.tax_id).toBe('5260250274'); // Latest NIP
      expect(profile.company_name).toBe('New Company'); // Latest company
    } finally {
      // Clean up
      if (testUserId3) {
        await supabaseAdmin.auth.admin.deleteUser(testUserId3);
      }
    }
  });

  it('should not overwrite profile if no guest payments exist', async () => {
    const TEST_EMAIL_4 = `test-no-payments-${Date.now()}@example.com`;
    let testUserId4: string;

    try {
      // Create user WITHOUT any guest payments
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: TEST_EMAIL_4,
        password: 'test123456',
        email_confirm: true,
        user_metadata: {
          full_name: 'Original Name'
        }
      });

      if (authError) throw authError;
      testUserId4 = authData.user.id;

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify profile still has original data (or null)
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', testUserId4)
        .single();

      if (profileError) throw profileError;

      // Should have original name from user_metadata or null
      // but NOT be overwritten by non-existent payment data
      expect(profile.tax_id).toBeNull();
      expect(profile.company_name).toBeNull();
    } finally {
      // Clean up
      if (testUserId4) {
        await supabaseAdmin.auth.admin.deleteUser(testUserId4);
      }
    }
  });
});
