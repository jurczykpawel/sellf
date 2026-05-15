import { test, expect } from '@playwright/test';
import { createTestAdmin, getAdminAuthCookie, supabaseAdmin } from './helpers/admin-auth';

// /api/v1/products PATCH/POST must reject unknown checkout_template slugs and
// malformed custom_checkout_fields. Validators live in lib/validations/product.ts
// and are shared with the admin UI for inline feedback.

test.describe('Products API — checkout_template + custom_checkout_fields', () => {
  test.describe.configure({ mode: 'serial' });

  let cookie: string;
  let cleanupAdmin: (() => Promise<void>) | null = null;
  let productId: string;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('cf-api');
    cleanupAdmin = admin.cleanup;
    cookie = await getAdminAuthCookie();

    const slug = `cf-api-${Date.now()}`;
    const { data } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'API CF Test',
        slug,
        price: 5,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    productId = data!.id;
  });

  test.afterAll(async () => {
    if (productId) await supabaseAdmin.from('products').delete().eq('id', productId);
    if (cleanupAdmin) await cleanupAdmin();
  });

  test('PATCH accepts valid checkout_template', async ({ request }) => {
    const response = await request.patch(`/api/v1/products/${productId}`, {
      data: { checkout_template: 'tip-jar' },
      headers: { Cookie: cookie },
    });
    expect(response.status()).toBe(200);
    const { data } = await supabaseAdmin
      .from('products')
      .select('checkout_template')
      .eq('id', productId)
      .single();
    expect(data?.checkout_template).toBe('tip-jar');
  });

  test('PATCH rejects unknown checkout_template slug', async ({ request }) => {
    const response = await request.patch(`/api/v1/products/${productId}`, {
      data: { checkout_template: 'evil-template' },
      headers: { Cookie: cookie },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/checkout_template/);
  });

  test('PATCH accepts valid custom_checkout_fields', async ({ request }) => {
    const fields = [
      { id: 'message', type: 'textarea', label: 'Wiadomość', required: false, max_length: 200 },
    ];
    const response = await request.patch(`/api/v1/products/${productId}`, {
      data: { custom_checkout_fields: fields },
      headers: { Cookie: cookie },
    });
    expect(response.status()).toBe(200);
    const { data } = await supabaseAdmin
      .from('products')
      .select('custom_checkout_fields')
      .eq('id', productId)
      .single();
    expect(data?.custom_checkout_fields).toEqual(fields);
  });

  test('PATCH rejects invalid custom_checkout_fields shape', async ({ request }) => {
    const response = await request.patch(`/api/v1/products/${productId}`, {
      data: { custom_checkout_fields: [{ id: 'x', type: 'evil', label: 'lbl' }] },
      headers: { Cookie: cookie },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/custom_checkout_fields/);
  });
});
