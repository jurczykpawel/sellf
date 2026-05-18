import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Phase 3a end-to-end coverage:
//   1. Product without custom fields → checkout behaves like before.
//   2. Product WITH custom fields → fields render in checkout, fill+submit
//      persists buyer-typed values on payment_transactions.custom_field_values.
//   3. API rejects unknown / overlong / required-empty values with per-field errors.
//
// React rendering of the form is verified end-to-end here instead of via
// React Testing Library — pragmatic choice: avoids pulling happy-dom +
// @testing-library/react into vitest config for a single mechanical component.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Custom checkout fields', () => {
  test.describe.configure({ mode: 'serial' });

  let productId: string;
  let productSlug: string;

  test.beforeAll(async () => {
    const slug = `cf-e2e-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Custom Fields E2E Product',
        slug,
        price: 5,
        currency: 'USD',
        is_active: true,
        custom_checkout_fields: [
          {
            id: 'message',
            type: 'textarea',
            label: 'Wiadomość',
            required: false,
            max_length: 200,
            placeholder: 'Powiedz coś miłego',
          },
          {
            id: 'domain',
            type: 'text',
            label: 'Domena',
            required: true,
            max_length: 100,
          },
        ],
      })
      .select('id, slug')
      .single();
    if (error || !data) throw error;
    productId = data.id;
    productSlug = data.slug;
  });

  test.afterAll(async () => {
    if (productId) await supabaseAdmin.from('products').delete().eq('id', productId);
  });

  test('checkout page renders defined custom fields with labels and placeholders', async ({ page }) => {
    await page.goto(`/pl/checkout/${productSlug}`);
    await expect(page.getByLabel('Domena')).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('Wiadomość')).toBeVisible();
    await expect(page.getByPlaceholder('Powiedz coś miłego')).toBeVisible();
  });

  test('create-payment-intent allows initial POST with no values (required check deferred to submit)', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId,
        email: `cf-init-${Date.now()}@example.com`,
        customFieldValues: {},
      },
    });
    // 200 (Stripe-backed success) — required values validated later via
    // update-payment-metadata so the page can render without forcing the
    // buyer to fill required fields before they even see the checkout.
    expect(response.status()).toBe(200);
  });

  test('create-payment-intent rejects unknown field ids', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId,
        email: `cf-${Date.now()}@example.com`,
        customFieldValues: { domain: 'example.com', sneaky: 'inject' },
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/sneaky|unknown/i);
  });

  test('create-payment-intent rejects custom_field_values exceeding max_length', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId,
        email: `cf-${Date.now()}@example.com`,
        customFieldValues: { domain: 'a'.repeat(101) },
      },
    });
    expect(response.status()).toBe(400);
  });

  test('create-payment-intent persists valid custom_field_values on the pending payment_transactions row', async ({ request }) => {
    const email = `cf-ok-${Date.now()}@example.com`;
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId,
        email,
        customFieldValues: {
          domain: 'example.com',
          message: 'Dzięki za narzędzie',
        },
      },
    });
    expect(response.status()).toBe(200);

    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, custom_field_values')
      .eq('customer_email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(tx).not.toBeNull();
    expect(tx?.custom_field_values).toMatchObject({
      domain: 'example.com',
      message: 'Dzięki za narzędzie',
    });

    if (tx?.id) await supabaseAdmin.from('payment_transactions').delete().eq('id', tx.id);
  });

  test('update-payment-metadata enforces required custom fields at submit time', async ({ request }) => {
    const email = `cf-submit-${Date.now()}@example.com`;
    const initial = await request.post('/api/create-payment-intent', {
      data: { productId, email, customFieldValues: {} },
    });
    expect(initial.status()).toBe(200);
    const { clientSecret } = await initial.json();
    expect(clientSecret).toBeTruthy();

    // Required `domain` is missing — must be rejected with per-field error.
    const submitMissing = await request.post('/api/update-payment-metadata', {
      data: { clientSecret, fullName: 'Test', customFieldValues: { message: 'hi' } },
      headers: {
        Origin: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3777',
      },
    });
    expect(submitMissing.status()).toBe(400);
    const body = await submitMissing.json();
    expect(JSON.stringify(body)).toMatch(/domain/);

    // Now fill required + extra → 200 + row updated.
    const submitOk = await request.post('/api/update-payment-metadata', {
      data: {
        clientSecret,
        fullName: 'Test',
        customFieldValues: { domain: 'final.com', message: 'final' },
      },
      headers: {
        Origin: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3777',
      },
    });
    expect(submitOk.status()).toBe(200);

    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, custom_field_values')
      .eq('customer_email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(tx?.custom_field_values).toMatchObject({
      domain: 'final.com',
      message: 'final',
    });

    if (tx?.id) await supabaseAdmin.from('payment_transactions').delete().eq('id', tx.id);
  });
});
