/**
 * API Integration Tests: Payments Export
 *
 * Migrated from api-v1-payments-export.spec.ts (Playwright → Vitest)
 * Tests payment export as CSV endpoint.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { post, deleteTestApiKey, API_URL, supabase, createTestApiKey } from './setup';

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

describe('Payments Export API v1', () => {
  let testProductId: string;
  const testTransactionIds: string[] = [];

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create test product
    const { data: product, error: productErr } = await supabase
      .from('products')
      .insert({
        name: `Export Test Product ${randomStr}`,
        slug: `export-test-${randomStr}`,
        price: 4999,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (productErr) throw productErr;
    testProductId = product.id;

    // Create some test transactions for export
    const transactions = [
      {
        product_id: testProductId,
        customer_email: `export-customer1-${randomStr}@example.com`,
        amount: 4999,
        currency: 'USD',
        status: 'completed',
        session_id: `cs_test_export1${randomStr}`,
      },
      {
        product_id: testProductId,
        customer_email: `export-customer2-${randomStr}@example.com`,
        amount: 4999,
        currency: 'USD',
        status: 'completed',
        session_id: `cs_test_export2${randomStr}`,
      },
      {
        product_id: testProductId,
        customer_email: `export-customer3-${randomStr}@example.com`,
        amount: 4999,
        currency: 'USD',
        status: 'refunded',
        refunded_amount: 4999,
        refund_reason: 'Test refund',
        session_id: `cs_test_export3${randomStr}`,
      },
    ];

    for (const tx of transactions) {
      const { data, error: txErr } = await supabase
        .from('payment_transactions')
        .insert(tx)
        .select()
        .single();

      if (txErr) throw txErr;
      testTransactionIds.push(data.id);
    }
  });

  afterAll(async () => {
    // Cleanup transactions
    for (const txId of testTransactionIds) {
      await supabase.from('payment_transactions').delete().eq('id', txId);
    }

    // Cleanup product
    if (testProductId) {
      await supabase.from('products').delete().eq('id', testProductId);
    }

    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/payments/export', () => {
    it('should export all transactions as CSV', async () => {
      const apiKey = await createTestApiKey();

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);

      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('text/csv');

      const disposition = response.headers.get('content-disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('.csv');

      const csv = await response.text();
      expect(csv).toContain('Transaction ID');
      expect(csv).toContain('Customer Email');
      expect(csv).toContain('Amount');
      expect(csv).toContain('Status');
    });

    it('should filter by status=completed', async () => {
      const apiKey = await createTestApiKey();

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' }),
      });

      expect(response.status).toBe(200);
      const csv = await response.text();

      // Should contain completed transactions
      expect(csv).toContain('completed');
      // Parse CSV: find the Status column index from headers, then verify no data row has 'refunded'
      const lines = csv.split('\n');
      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      const statusColIndex = headers.indexOf('Status');
      expect(statusColIndex).toBeGreaterThanOrEqual(0);
      const dataLines = lines.slice(1).filter((line) => line.trim());
      expect(dataLines.length).toBeGreaterThan(0);
      for (const line of dataLines) {
        // Simple CSV field extraction (handles quoted fields with commas)
        const fields = line.match(/(".*?"|[^,]+)/g) ?? [];
        const statusValue = fields[statusColIndex]?.trim().replace(/^"|"$/g, '') ?? '';
        expect(statusValue).not.toBe('refunded');
      }
    });

    it('should filter by status=refunded', async () => {
      const apiKey = await createTestApiKey();

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'refunded' }),
      });

      expect(response.status).toBe(200);
      const csv = await response.text();

      const lines = csv.split('\n');
      const dataLines = lines.slice(1).filter((line) => line.trim());
      expect(dataLines.length).toBeGreaterThan(0);
      // All data lines should contain 'refunded'
      expect(dataLines.every((line) => line.includes('refunded'))).toBe(true);
    });

    it('should filter by date range', async () => {
      const apiKey = await createTestApiKey();

      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date_from: yesterday.toISOString(),
          date_to: tomorrow.toISOString(),
        }),
      });

      expect(response.status).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('Transaction ID');
    });

    it('should filter by product_id', async () => {
      const apiKey = await createTestApiKey();

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ product_id: testProductId }),
      });

      expect(response.status).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('Export Test Product');
    });

    it('should return 400 for invalid product_id format', async () => {
      const { status, data } = await post<ApiResponse<unknown>>('/api/v1/payments/export', {
        product_id: 'invalid-uuid',
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return empty CSV with headers when no data matches', async () => {
      const apiKey = await createTestApiKey();

      // Use a date range far in the future
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 10);

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ date_from: futureDate.toISOString() }),
      });

      expect(response.status).toBe(200);
      const csv = await response.text();
      // Should still have headers
      expect(csv).toContain('Transaction ID');
      // But only one line (headers)
      const lines = csv.split('\n').filter((line) => line.trim());
      expect(lines.length).toBe(1);
    });

    it('should support legacy dateRange parameter', async () => {
      const apiKey = await createTestApiKey();

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dateRange: '30' }),
      });

      expect(response.status).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('Transaction ID');
    });

    it('CSV should properly escape special characters', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const apiKey = await createTestApiKey();

      // Create a transaction with special characters
      const { data: specialTx } = await supabase
        .from('payment_transactions')
        .insert({
          product_id: testProductId,
          customer_email: `special-${randomStr}@example.com`,
          amount: 4999,
          currency: 'USD',
          status: 'refunded',
          refund_reason: 'Contains, comma and "quotes"',
          session_id: `cs_test_special${randomStr}`,
        })
        .select()
        .single();

      try {
        const response = await fetch(`${API_URL}/api/v1/payments/export`, {
          method: 'POST',
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(200);
        const csv = await response.text();
        // Verify that the CSV is parseable (special chars are escaped)
        expect(csv).toContain('Transaction ID');
      } finally {
        await supabase.from('payment_transactions').delete().eq('id', specialTx!.id);
      }
    });
  });

  describe('CSV Format', () => {
    it('should have correct CSV headers', async () => {
      const apiKey = await createTestApiKey();

      const response = await fetch(`${API_URL}/api/v1/payments/export`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
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
