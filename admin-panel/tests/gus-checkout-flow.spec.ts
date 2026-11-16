import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { test } from './helpers/checkout-intent';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Valid test NIP (Polish test company): 5261040828
// This is a public test NIP that should exist in GUS database
const TEST_NIP_VALID = '5261040828';

// Checkout NIP validation and GUS autofill UI moved to tests/checkout-invoice-section.spec.ts (W223a).

test.describe('GUS Checkout Flow - Security', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data } = await supabaseAdmin
      .from('products')
      .insert({
        name: `GUS Security Test ${Date.now()}`,
        slug: `gus-security-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();
    testProduct = data;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should reject requests from invalid origin (CORS)', async ({ page }) => {
    // This test verifies that the API endpoint checks origin
    // We can't easily simulate cross-origin from Playwright, but we can verify the code path

    const response = await page.request.post('/api/gus/fetch-company-data', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://evil.com', // Invalid origin
      },
      data: {
        nip: TEST_NIP_VALID,
      },
    });

    // Should return 403 Forbidden
    expect(response.status()).toBe(403);

    const body = await response.json();
    expect(body.code).toBe('INVALID_ORIGIN');
  });

  // Rate limiting test moved to tests/rate-limiting.spec.ts
  // Run with: RATE_LIMIT_TEST_MODE=true npx playwright test --project=rate-limiting
});
