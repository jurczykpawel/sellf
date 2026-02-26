import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('GUS Integration - Profile Update After Payment', () => {
  let testUser: any;
  let testProduct: any;

  test.beforeAll(async () => {
    // Create test user
    const email = `gus-payment-test-${Date.now()}@test.com`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    if (authError) throw authError;
    testUser = authData.user;

    // Create profile (profiles table has no email column — email lives in auth.users)
    await supabaseAdmin.from('profiles').insert({
      id: testUser.id,
    });

    // Create test product
    const { data: productData, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GUS Payment Test ${Date.now()}`,
        slug: `gus-payment-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    if (productError) throw productError;
    testProduct = productData;
  });

  test.afterAll(async () => {
    // Cleanup
    if (testUser) {
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should store company data in guest_purchases metadata for guest users', async () => {
    const guestEmail = `guest-gus-${Date.now()}@test.com`;

    const companyData = {
      needs_invoice: 'true',
      nip: '5261040828',
      company_name: 'GUEST FIRMA SP. Z O.O.',
      address: 'ul. Guest 456',
      city: 'Kraków',
      postal_code: '30-001',
      country: 'PL',
    };

    // Create guest purchase with company metadata
    const { data: guestPurchase, error } = await supabaseAdmin
      .from('guest_purchases')
      .insert({
        product_id: testProduct.id,
        customer_email: guestEmail,
        session_id: `pi_guest_${Date.now()}`,
        transaction_amount: 10000, // 100 PLN in cents
        metadata: companyData,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(guestPurchase.metadata).toBeDefined();
    expect(guestPurchase.metadata.nip).toBe('5261040828');
    expect(guestPurchase.metadata.company_name).toBe('GUEST FIRMA SP. Z O.O.');
    expect(guestPurchase.metadata.address).toBe('ul. Guest 456');
    expect(guestPurchase.metadata.city).toBe('Kraków');
    expect(guestPurchase.metadata.postal_code).toBe('30-001');

    // Cleanup
    await supabaseAdmin.from('guest_purchases').delete().eq('id', guestPurchase.id);
  });
});

test.describe('GUS Integration - API Metadata Update', () => {
  test('should validate client secret format', async ({ page }) => {
    const response = await page.request.post('/api/update-payment-metadata', {
      data: {
        // Missing clientSecret
        needsInvoice: true,
        nip: '5261040828',
        companyName: 'TEST',
      },
      headers: {
        'origin': 'http://localhost:3000',
        'referer': 'http://localhost:3000/',
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Client secret is required');
  });

  // Rate limiting test moved to tests/rate-limiting.spec.ts
  // Run with: RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting
});

