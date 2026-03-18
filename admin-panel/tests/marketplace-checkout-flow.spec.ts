/**
 * E2E Tests: Marketplace Checkout Flow (Smoke)
 *
 * Verifies the frontend -> API -> seller schema wiring for the checkout page.
 * Since we can't complete a real Stripe payment, these are smoke tests that
 * verify the API layer correctly routes requests to the seller schema and
 * that the create-payment-intent API handles the sellerSlug parameter.
 *
 * Uses seed data: Kowalski Digital (seller_kowalski_digital) with products.
 * REQUIRES: Supabase running + db reset + dev server running
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sellerClient(schemaName: string) {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: schemaName },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const kowalskiClient = () => sellerClient('seller_kowalski_digital');

test.describe('Marketplace Checkout Flow', () => {

  test('seller checkout page loads without server error', async ({ page }) => {
    // Navigate to the seller checkout page for kurs-ecommerce
    const response = await page.goto(
      '/en/s/kowalski-digital/checkout/kurs-ecommerce',
      { waitUntil: 'domcontentloaded' }
    );

    // Should not be a server error
    expect(response?.status()).not.toBe(500);

    // Wait for client-side rendering to complete (page shows "Loading..." initially)
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('Internal Server Error');
  });

  test('create-payment-intent API with sellerSlug resolves seller data', async ({ page }) => {
    // Get the product ID from the seller schema
    const kc = kowalskiClient();
    const { data: product } = await kc
      .from('products')
      .select('id')
      .eq('slug', 'kurs-ecommerce')
      .single();
    expect(product).not.toBeNull();

    // Call the create-payment-intent API with sellerSlug
    // Without Stripe configured for the seller, we expect a specific error
    // (not a 500 or schema routing error)
    const response = await page.request.post('/api/create-payment-intent', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        productId: product!.id,
        sellerSlug: 'kowalski-digital',
        email: 'test@example.com',
        fullName: 'Test User',
      },
    });

    // The API should not return 500 (would indicate schema routing failure)
    // Expected: 400 or similar (seller not configured for payments / no Stripe account)
    expect(response.status()).not.toBe(500);
    const body = await response.json();

    // If error, it should be about Stripe configuration, not about missing product
    if (body.error) {
      expect(body.error).not.toContain('Product not found');
      expect(body.error).not.toContain('does not exist');
    }
  });

  test('create-payment-intent API without sellerSlug does not find seller product', async ({ page }) => {
    // Get the product ID from the seller schema
    const kc = kowalskiClient();
    const { data: product } = await kc
      .from('products')
      .select('id')
      .eq('slug', 'kurs-ecommerce')
      .single();
    expect(product).not.toBeNull();

    // Call without sellerSlug - should not find product in seller_main
    const response = await page.request.post('/api/create-payment-intent', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        productId: product!.id,
        email: 'test@example.com',
        fullName: 'Test User',
      },
    });

    // Product only exists in seller_kowalski_digital, not seller_main
    // Expect either 404 (product not found) or 400 (product not active in main schema)
    // Either way, it should NOT succeed with the seller product
    const body = await response.json();
    const isProductNotFoundOrError =
      response.status() === 404 ||
      response.status() === 400 ||
      (body.error && (
        body.error.includes('not found') ||
        body.error.includes('not active') ||
        body.error.includes('Product')
      ));
    expect(isProductNotFoundOrError).toBe(true);
  });

  test('create-payment-intent API for non-existent seller returns error', async ({ page }) => {
    // Use a random UUID as product ID
    const response = await page.request.post('/api/create-payment-intent', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        productId: '00000000-0000-0000-0000-000000000000',
        sellerSlug: 'non-existent-seller',
        email: 'test@example.com',
        fullName: 'Test User',
      },
    });

    // Should get an error (seller not found or product not found)
    expect(response.ok()).toBe(false);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
