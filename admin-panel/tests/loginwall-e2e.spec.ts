/**
 * Login wall E2E — covers the per-product handoff redirect chain and
 * the loader script served at /api/loginwall/login.js.
 *
 * Strategy:
 *  - Create a regular (non-admin) test user and a fresh product.
 *  - Drive the protect route without a session, without access, and with
 *    access; assert the redirect targets directly. The customer page that
 *    finally consumes the token is hosted on an arbitrary external origin
 *    in production — we only assert the redirect URL shape.
 *  - Hit /api/loginwall/login.js directly to confirm the JS payload.
 */
import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

const RUN_ID = `lw-e2e-${Date.now()}`;
const CUSTOMER_ORIGIN = 'https://customer.example';
const CUSTOMER_PAGE = `${CUSTOMER_ORIGIN}/${RUN_ID}`;

let testUser: { id: string; email: string; password: string };
let testSeller: { id: string; email: string };
let testProduct: { id: string; slug: string };

test.beforeAll(async () => {
  const email = `${RUN_ID}@example.com`;
  const password = 'password123';
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !user) throw new Error(`createUser failed: ${userErr?.message}`);
  testUser = { id: user.id, email, password };

  const sellerEmail = `${RUN_ID}-seller@example.com`;
  const { data: { user: sellerUser }, error: sellerErr } = await supabaseAdmin.auth.admin.createUser({
    email: sellerEmail,
    password,
    email_confirm: true,
  });
  if (sellerErr || !sellerUser) throw new Error(`createSellerUser failed: ${sellerErr?.message}`);
  testSeller = { id: sellerUser.id, email: sellerEmail };

  const { error: settingsErr } = await supabaseAdmin
    .schema('seller_main')
    .from('seller_embed_settings')
    .upsert({
      seller_id: sellerUser.id,
      allowed_embed_origins: [CUSTOMER_ORIGIN],
    });
  if (settingsErr) throw new Error(`upsert seller_embed_settings failed: ${settingsErr.message}`);

  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Loginwall E2E ${RUN_ID}`,
      slug: RUN_ID,
      price: 0,
      currency: 'USD',
      is_active: true,
      seller_id: sellerUser.id,
    })
    .select('id, slug')
    .single();
  if (productErr || !product) throw new Error(`create product failed: ${productErr?.message}`);
  testProduct = { id: product.id, slug: product.slug };
});

test.afterAll(async () => {
  if (testProduct?.id) {
    await supabaseAdmin.from('user_product_access').delete().eq('product_id', testProduct.id);
    await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
  }
  if (testSeller?.id) {
    await supabaseAdmin
      .schema('seller_main')
      .from('seller_embed_settings')
      .delete()
      .eq('seller_id', testSeller.id);
    await supabaseAdmin.auth.admin.deleteUser(testSeller.id);
  }
  if (testUser?.id) {
    await supabaseAdmin.auth.admin.deleteUser(testUser.id);
  }
});

test.describe('Loginwall flow', () => {
  test('GET /api/loginwall/login.js?id=<uuid> returns script body', async ({ request }) => {
    const res = await request.get(`/api/loginwall/login.js?id=${testProduct.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toContain('application/javascript');
    const body = await res.text();
    expect(body).toContain(testProduct.id);
    expect(body).toContain('_sf_token');
    expect(body).toContain('loginwall/protect');
  });

  test('GET /api/loginwall/login.js with bad id is 400', async ({ request }) => {
    const res = await request.get('/api/loginwall/login.js?id=not-a-uuid');
    expect(res.status()).toBe(400);
  });

  test('GET /loginwall/protect without a session redirects to /login', async ({ request }) => {
    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('redirect_to=');
  });

  test('GET /loginwall/protect with session but no access redirects to /p/{slug}', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);

    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id);

    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location).toContain(`/p/${testProduct.slug}`);
  });

  test('GET /loginwall/protect with session + access redirects back with _sf_token in the URL fragment', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);

    await supabaseAdmin.from('user_product_access').insert({
      user_id: testUser.id,
      product_id: testProduct.id,
      access_expires_at: null,
    });

    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const location = res.headers()['location'] ?? '';
    expect(location.startsWith(CUSTOMER_PAGE)).toBe(true);
    expect(location).toMatch(/#_sf_token=[A-Za-z0-9._-]+$/);
    expect(location).not.toMatch(/[?&]_sf_token=/);

    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id);
  });

  test('GET /loginwall/protect rejects a redirect host that is not in the seller allowlist', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);

    await supabaseAdmin.from('user_product_access').insert({
      user_id: testUser.id,
      product_id: testProduct.id,
      access_expires_at: null,
    });

    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent('https://evil.attacker.com/phish')}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);

    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id);
  });

  test('GET /loginwall/protect rejects an internal-host redirect target', async ({ request }) => {
    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent('http://169.254.169.254/meta')}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });

  test('GET /loginwall/protect rejects a javascript: redirect target', async ({ request }) => {
    const url = `/loginwall/protect?id=${testProduct.id}&redirect=${encodeURIComponent('javascript:alert(1)')}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });
});
