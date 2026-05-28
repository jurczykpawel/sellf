/**
 * Element gating E2E — exercises the multi-product, non-bouncing gate route,
 * the served runtime script, and the bearer verify endpoint against a real
 * Supabase. The customer page is hosted on an arbitrary external origin in
 * production, so (as with the login wall E2E) we assert the redirect/token
 * shape and the server decisions; client DOM resolution is unit-tested.
 */
import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

const RUN_ID = `gate-e2e-${Date.now()}`;
const CUSTOMER_ORIGIN = 'https://customer.example';
const CUSTOMER_PAGE = `${CUSTOMER_ORIGIN}/${RUN_ID}`;

let testUser: { id: string; email: string; password: string };
let sellerA: { id: string };
let sellerB: { id: string };
let productA: { id: string; slug: string };
let productB: { id: string; slug: string };

function decodePayload(token: string): { v: number; auth: boolean; owned: string[]; req: string[] } | null {
  try {
    let b64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

function tokenFromLocation(location: string): string {
  const m = location.match(/#(?:.*&)?_sf_token=([^&]+)$/);
  return m ? m[1] : '';
}

async function createSeller(suffix: string, origins: string[]): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: `${RUN_ID}-${suffix}@example.com`,
    password: 'password123',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createSeller ${suffix}: ${error?.message}`);
  const { error: sErr } = await supabaseAdmin
    .schema('public')
    .from('seller_embed_settings')
    .upsert({ seller_id: data.user.id, allowed_embed_origins: origins });
  if (sErr) throw new Error(`seller_embed_settings ${suffix}: ${sErr.message}`);
  return data.user.id;
}

async function createProduct(sellerId: string, slug: string): Promise<{ id: string; slug: string }> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({ name: `Gate E2E ${slug}`, slug, price: 0, currency: 'USD', is_active: true, seller_id: sellerId })
    .select('id, slug')
    .single();
  if (error || !data) throw new Error(`create product ${slug}: ${error?.message}`);
  return { id: data.id, slug: data.slug };
}

test.beforeAll(async () => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: `${RUN_ID}-user@example.com`,
    password: 'password123',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  testUser = { id: data.user.id, email: `${RUN_ID}-user@example.com`, password: 'password123' };

  sellerA = { id: await createSeller('sellerA', [CUSTOMER_ORIGIN]) };
  sellerB = { id: await createSeller('sellerB', [CUSTOMER_ORIGIN]) };
  productA = await createProduct(sellerA.id, `${RUN_ID}-a`);
  productB = await createProduct(sellerB.id, `${RUN_ID}-b`);
});

test.afterAll(async () => {
  for (const p of [productA, productB]) {
    if (p?.id) {
      await supabaseAdmin.from('user_product_access').delete().eq('product_id', p.id);
      await supabaseAdmin.from('products').delete().eq('id', p.id);
    }
  }
  for (const s of [sellerA, sellerB]) {
    if (s?.id) {
      await supabaseAdmin.schema('public').from('seller_embed_settings').delete().eq('seller_id', s.id);
      await supabaseAdmin.auth.admin.deleteUser(s.id);
    }
  }
  if (testUser?.id) await supabaseAdmin.auth.admin.deleteUser(testUser.id);
});

test.describe('Gate runtime script', () => {
  test('GET /api/loginwall/gate.js returns the runtime', async ({ request }) => {
    const res = await request.get(`/api/loginwall/gate.js?products=${productA.slug}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] ?? '').toContain('application/javascript');
    const body = await res.text();
    expect(body).toContain('SellfGate');
    expect(body).toContain('_sf_token');
  });

  test('GET /api/loginwall/gate.js with a bad slug is 400', async ({ request }) => {
    const res = await request.get('/api/loginwall/gate.js?products=Bad_Slug');
    expect(res.status()).toBe(400);
  });
});

test.describe('Gate route (non-bouncing token mint)', () => {
  test('anonymous visitor gets a token with auth:false (no bounce to /login)', async ({ request }) => {
    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const loc = res.headers()['location'] ?? '';
    expect(loc.startsWith(CUSTOMER_PAGE)).toBe(true);
    expect(loc).not.toContain('/login');
    const payload = decodePayload(tokenFromLocation(loc));
    expect(payload).toMatchObject({ v: 2, auth: false, owned: [] });
  });

  test('authenticated owner gets a token with the owned slug', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);
    await supabaseAdmin.from('user_product_access').insert({ user_id: testUser.id, product_id: productA.id, access_expires_at: null });

    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    const loc = res.headers()['location'] ?? '';
    expect(loc).toMatch(/#_sf_token=/);
    expect(loc).not.toMatch(/[?&]_sf_token=/);
    const payload = decodePayload(tokenFromLocation(loc));
    expect(payload).toMatchObject({ v: 2, auth: true });
    expect(payload?.owned).toEqual([productA.slug]);

    await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id).eq('product_id', productA.id);
  });

  test('authenticated non-owner gets a token with empty owned', async ({ page }) => {
    await setAuthSession(page, testUser.email, testUser.password);
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id).eq('product_id', productA.id);

    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    const payload = decodePayload(tokenFromLocation(res.headers()['location'] ?? ''));
    expect(payload).toMatchObject({ v: 2, auth: true, owned: [] });
  });

  test('rejects products spanning multiple sellers', async ({ request }) => {
    const url = `/loginwall/gate?products=${productA.slug},${productB.slug}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });

  test('rejects an unknown slug', async ({ request }) => {
    const url = `/loginwall/gate?products=${productA.slug},${RUN_ID}-nope&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });

  test('rejects a redirect host not in the seller allowlist', async ({ request }) => {
    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent('https://evil.attacker.com/x')}`;
    expect((await request.get(url, { maxRedirects: 0 })).status()).toBe(400);
  });

  test('rejects an internal-host redirect target', async ({ request }) => {
    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent('http://169.254.169.254/meta')}`;
    expect((await request.get(url, { maxRedirects: 0 })).status()).toBe(400);
  });

  test('rejects a javascript: redirect target', async ({ request }) => {
    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent('javascript:alert(1)')}`;
    expect((await request.get(url, { maxRedirects: 0 })).status()).toBe(400);
  });
});

test.describe('Verify endpoint (bearer-only)', () => {
  async function mintToken(page: import('@playwright/test').Page, owns: boolean): Promise<string> {
    await setAuthSession(page, testUser.email, testUser.password);
    if (owns) {
      await supabaseAdmin.from('user_product_access').insert({ user_id: testUser.id, product_id: productA.id, access_expires_at: null });
    } else {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id).eq('product_id', productA.id);
    }
    const url = `/loginwall/gate?products=${productA.slug}&redirect=${encodeURIComponent(CUSTOMER_PAGE)}`;
    const res = await page.context().request.get(url, { maxRedirects: 0 });
    return tokenFromLocation(res.headers()['location'] ?? '');
  }

  test('grants access for an owner and reflects the allowlisted origin without credentials', async ({ page, request }) => {
    const token = await mintToken(page, true);
    const res = await request.post('/api/loginwall/verify', {
      headers: { Authorization: `Bearer ${token}`, Origin: CUSTOMER_ORIGIN, 'Content-Type': 'application/json' },
      data: { product: productA.slug },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ access: true });
    expect(res.headers()['access-control-allow-origin']).toBe(CUSTOMER_ORIGIN);
    expect(res.headers()['access-control-allow-credentials']).toBeUndefined();

    await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id).eq('product_id', productA.id);
  });

  test('denies a non-owner', async ({ page, request }) => {
    const token = await mintToken(page, false);
    const res = await request.post('/api/loginwall/verify', {
      headers: { Authorization: `Bearer ${token}`, Origin: CUSTOMER_ORIGIN, 'Content-Type': 'application/json' },
      data: { product: productA.slug },
    });
    expect(await res.json()).toEqual({ access: false });
  });

  test('denies a garbage bearer token', async ({ request }) => {
    const res = await request.post('/api/loginwall/verify', {
      headers: { Authorization: 'Bearer garbage', Origin: CUSTOMER_ORIGIN, 'Content-Type': 'application/json' },
      data: { product: productA.slug },
    });
    expect(await res.json()).toEqual({ access: false });
  });

  test('does not reflect a non-allowlisted origin', async ({ page, request }) => {
    const token = await mintToken(page, true);
    const res = await request.post('/api/loginwall/verify', {
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.attacker.com', 'Content-Type': 'application/json' },
      data: { product: productA.slug },
    });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();

    await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id).eq('product_id', productA.id);
  });
});
