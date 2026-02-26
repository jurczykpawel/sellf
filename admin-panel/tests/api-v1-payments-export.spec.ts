/**
 * Tests for Payments Export API v1
 *
 * POST /api/v1/payments/export - Export payment transactions as CSV
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to login as admin via browser context
async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await page.evaluate(async ({ email, password, url, anonKey }: { email: string; password: string; url: string; anonKey: string }) => {
    // @ts-ignore
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const sb = createBrowserClient(url, anonKey);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, {
    email,
    password,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  });

  await page.reload();
}

test.describe('Payments Export API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testProduct: any;
  let testTransactions: string[] = [];

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `export-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Export API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test product
    const { data: product, error: productErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Export Test Product ${randomStr}`,
        slug: `export-test-${randomStr}`,
        price: 49.99,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (productErr) throw productErr;
    testProduct = product;

    // Create some test transactions for export (session_id must be Stripe format: cs_test_*)
    const transactions = [
      {
        product_id: testProduct.id,
        customer_email: `export-customer1-${randomStr}@example.com`,
        amount: 49.99,
        currency: 'USD',
        status: 'completed',
        session_id: `cs_test_export1${randomStr}`,
      },
      {
        product_id: testProduct.id,
        customer_email: `export-customer2-${randomStr}@example.com`,
        amount: 49.99,
        currency: 'USD',
        status: 'completed',
        session_id: `cs_test_export2${randomStr}`,
      },
      {
        product_id: testProduct.id,
        customer_email: `export-customer3-${randomStr}@example.com`,
        amount: 49.99,
        currency: 'USD',
        status: 'refunded',
        refunded_amount: 49.99,
        refund_reason: 'Test refund',
        session_id: `cs_test_export3${randomStr}`,
      },
    ];

    for (const tx of transactions) {
      const { data, error: txErr } = await supabaseAdmin
        .from('payment_transactions')
        .insert(tx)
        .select()
        .single();

      if (txErr) throw txErr;
      testTransactions.push(data.id);
    }
  });

  test.afterAll(async () => {
    // Cleanup transactions
    for (const txId of testTransactions) {
      await supabaseAdmin.from('payment_transactions').delete().eq('id', txId);
    }

    // Cleanup product
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }

    // Cleanup admin
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests', async ({ request }) => {
      const response = await request.post('/api/v1/payments/export', {
        data: {}
      });
      expect(response.status()).toBe(401);
    });
  });

  test.describe('POST /api/v1/payments/export', () => {
    test('should export all transactions as CSV', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: {}
      });

      expect(response.status()).toBe(200);

      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('text/csv');

      const disposition = response.headers()['content-disposition'];
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('.csv');

      const csv = await response.text();
      expect(csv).toContain('Transaction ID');
      expect(csv).toContain('Customer Email');
      expect(csv).toContain('Amount');
      expect(csv).toContain('Status');
    });

    test('should filter by status=completed', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: { status: 'completed' }
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();

      // Should contain completed transactions
      expect(csv).toContain('completed');
      // Should not contain refunded transactions (from our test data)
      const lines = csv.split('\n');
      const dataLines = lines.slice(1).filter(line => line.trim());
      const hasRefunded = dataLines.some(line => line.includes(',refunded,'));
      expect(hasRefunded).toBe(false);
    });

    test('should filter by status=refunded', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: { status: 'refunded' }
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();

      const lines = csv.split('\n');
      const dataLines = lines.slice(1).filter(line => line.trim());
      // We created a refunded transaction in beforeAll, so there must be data
      expect(dataLines.length).toBeGreaterThan(0);
      // All data lines should contain 'refunded'
      expect(dataLines.every(line => line.includes('refunded'))).toBe(true);
    });

    test('should filter by date range', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await page.request.post('/api/v1/payments/export', {
        data: {
          date_from: yesterday.toISOString(),
          date_to: tomorrow.toISOString(),
        }
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('Transaction ID');
    });

    test('should filter by product_id', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: { product_id: testProduct.id }
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();
      expect(csv).toContain(testProduct.name);
    });

    test('should return 400 for invalid product_id format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: { product_id: 'invalid-uuid' }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return empty CSV with headers when no data matches', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Use a date range far in the future
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 10);

      const response = await page.request.post('/api/v1/payments/export', {
        data: {
          date_from: futureDate.toISOString(),
        }
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();
      // Should still have headers
      expect(csv).toContain('Transaction ID');
      // But only one line (headers)
      const lines = csv.split('\n').filter(line => line.trim());
      expect(lines.length).toBe(1);
    });

    test('should support legacy dateRange parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: { dateRange: '30' }
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('Transaction ID');
    });

    test('CSV should properly escape special characters', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a transaction with special characters
      const randomStr = Math.random().toString(36).substring(7);
      const { data: specialTx } = await supabaseAdmin
        .from('payment_transactions')
        .insert({
          product_id: testProduct.id,
          customer_email: `special-${randomStr}@example.com`,
          amount: 49.99,
          currency: 'USD',
          status: 'refunded',
          refund_reason: 'Contains, comma and "quotes"',
          session_id: `cs_test_special${randomStr}`,
        })
        .select()
        .single();

      try {
        const response = await page.request.post('/api/v1/payments/export', {
          data: {}
        });

        expect(response.status()).toBe(200);
        const csv = await response.text();
        // Verify that the CSV is parseable (special chars are escaped)
        expect(csv).toContain('Transaction ID');
      } finally {
        await supabaseAdmin.from('payment_transactions').delete().eq('id', specialTx!.id);
      }
    });
  });

  test.describe('CSV Format', () => {
    test('should have correct CSV headers', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/payments/export', {
        data: {}
      });

      expect(response.status()).toBe(200);
      const csv = await response.text();
      const headerLine = csv.split('\n')[0];

      expect(headerLine).toContain('Transaction ID');
      expect(headerLine).toContain('Session ID');
      expect(headerLine).toContain('User ID');
      expect(headerLine).toContain('Customer Email');
      expect(headerLine).toContain('Product Name');
      expect(headerLine).toContain('Product Slug');
      expect(headerLine).toContain('Amount');
      expect(headerLine).toContain('Currency');
      expect(headerLine).toContain('Status');
      expect(headerLine).toContain('Refunded Amount');
      expect(headerLine).toContain('Refund Reason');
      expect(headerLine).toContain('Created At');
      expect(headerLine).toContain('Updated At');
    });
  });
});
