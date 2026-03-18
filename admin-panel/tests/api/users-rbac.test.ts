/**
 * API Integration Tests: Users — Per-Role Access Control
 *
 * Tests that /api/v1/users endpoint correctly handles 3 roles:
 * - platform_admin: sees seller_main users
 * - seller_admin: sees ONLY their schema users
 * - regular user: gets 401 (not admin/seller)
 *
 * Run: bun run test:api (requires dev server + supabase running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const API_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ===== Helpers =====

function generateApiKey() {
  const prefix = 'sf_test_';
  const randomPart = randomBytes(32).toString('hex');
  const plaintext = `${prefix}${randomPart}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, prefix: plaintext.substring(0, 12), hash };
}

async function apiGet(path: string, apiKey: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function apiPost(path: string, body: unknown, apiKey: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// ===== Test state =====

let platformAdminUserId: string;
let platformAdminKeyId: string;
let platformAdminApiKey: string;

let sellerAdminUserId: string;
let sellerAdminKeyId: string;
let sellerAdminApiKey: string;
let sellerSellerId: string;

let regularUserId: string;
let regularKeyPlaintext: string; // This key should NOT work (user is not admin/seller)

// Buyer users — one with access in seller_main, one with access in seller schema
let buyerMainUserId: string;
let buyerSellerUserId: string;
let buyerMainProductId: string;
let sellerProductId: string;

describe('Users API v1 — Per-Role Access Control', () => {
  beforeAll(async () => {
    const rnd = Math.random().toString(36).substring(7);

    // ===== Platform admin + API key =====
    const { data: { user: adminUser } } = await supabase.auth.admin.createUser({
      email: `rbac-admin-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    platformAdminUserId = adminUser!.id;

    const { data: adminRecord } = await supabase
      .from('admin_users')
      .insert({ user_id: platformAdminUserId })
      .select('id')
      .single();

    const adminKey = generateApiKey();
    const { data: adminKeyRecord } = await supabase
      .from('api_keys')
      .insert({
        name: `rbac-test-admin-${rnd}`,
        key_prefix: adminKey.prefix,
        key_hash: adminKey.hash,
        admin_user_id: adminRecord!.id,
        scopes: ['*'],
        rate_limit_per_minute: 1000,
        is_active: true,
      })
      .select('id')
      .single();

    platformAdminKeyId = adminKeyRecord!.id;
    platformAdminApiKey = adminKey.plaintext;

    // ===== Seller admin + API key =====
    const { data: { user: sellerUser } } = await supabase.auth.admin.createUser({
      email: `rbac-seller-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    sellerAdminUserId = sellerUser!.id;

    // Assign as Kowalski Digital owner
    await supabase
      .from('sellers')
      .update({ user_id: sellerAdminUserId })
      .eq('slug', 'kowalski_digital');

    const { data: seller } = await supabase
      .from('sellers')
      .select('id')
      .eq('slug', 'kowalski_digital')
      .single();
    sellerSellerId = seller!.id;

    const sellerKey = generateApiKey();
    const { data: sellerKeyRecord } = await supabase
      .from('api_keys')
      .insert({
        name: `rbac-test-seller-${rnd}`,
        key_prefix: sellerKey.prefix,
        key_hash: sellerKey.hash,
        seller_id: sellerSellerId,
        scopes: ['users:read', 'users:write', 'products:read', 'products:write'],
        rate_limit_per_minute: 1000,
        is_active: true,
      })
      .select('id')
      .single();

    sellerAdminKeyId = sellerKeyRecord!.id;
    sellerAdminApiKey = sellerKey.plaintext;

    // ===== Regular user (NOT admin, NOT seller) =====
    const { data: { user: regUser } } = await supabase.auth.admin.createUser({
      email: `rbac-regular-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    regularUserId = regUser!.id;
    // No admin_users entry, no sellers entry — just a regular user
    // Can't create a valid API key for them (no admin_user_id or seller_id)
    regularKeyPlaintext = 'sf_test_' + randomBytes(32).toString('hex');

    // ===== Create buyer + access in seller_main =====
    const { data: { user: buyerMain } } = await supabase.auth.admin.createUser({
      email: `rbac-buyer-main-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    buyerMainUserId = buyerMain!.id;

    // Get a seller_main product
    const { data: mainProducts } = await supabase
      .from('products')  // public proxy view → seller_main.products
      .select('id')
      .eq('is_active', true)
      .limit(1);

    if (mainProducts && mainProducts.length > 0) {
      buyerMainProductId = mainProducts[0].id;
      await supabase
        .from('user_product_access')  // public proxy → seller_main
        .insert({ user_id: buyerMainUserId, product_id: buyerMainProductId });
    }

    // ===== Create buyer + access in seller_kowalski_digital =====
    const { data: { user: buyerSeller } } = await supabase.auth.admin.createUser({
      email: `rbac-buyer-seller-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    buyerSellerUserId = buyerSeller!.id;

    // Get Kowalski product directly from seller schema (service_role bypasses RLS)
    const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_kowalski_digital' },
    });
    const { data: sellerProducts } = await sellerClient
      .from('products')
      .select('id')
      .eq('is_active', true)
      .limit(1);

    sellerProductId = sellerProducts![0].id;
    await sellerClient
      .from('user_product_access')
      .insert({ user_id: buyerSellerUserId, product_id: sellerProductId });
  });

  afterAll(async () => {
    // Cleanup API keys
    if (platformAdminKeyId) await supabase.from('api_keys').delete().eq('id', platformAdminKeyId);
    if (sellerAdminKeyId) await supabase.from('api_keys').delete().eq('id', sellerAdminKeyId);

    // Cleanup access
    const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      db: { schema: 'seller_kowalski_digital' },
    });
    await sellerClient.from('user_product_access').delete().eq('user_id', buyerSellerUserId);
    await supabase.from('user_product_access').delete().eq('user_id', buyerMainUserId);

    // Restore original seller ownership
    await supabase
      .from('sellers')
      .update({ user_id: 'eeeeeeee-1111-4000-a000-000000000001' })
      .eq('slug', 'kowalski_digital');

    // Cleanup admin
    await supabase.from('admin_users').delete().eq('user_id', platformAdminUserId);

    // Cleanup auth users
    for (const uid of [platformAdminUserId, sellerAdminUserId, regularUserId, buyerMainUserId, buyerSellerUserId]) {
      if (uid) await supabase.auth.admin.deleteUser(uid);
    }
  });

  // =========================================================================
  // Unauthenticated
  // =========================================================================

  describe('Unauthenticated', () => {
    it('GET /api/v1/users returns 401 without API key', async () => {
      const response = await fetch(`${API_URL}/api/v1/users`);
      expect(response.status).toBe(401);
    });

    it('GET /api/v1/users returns 401 with invalid API key', async () => {
      const { status } = await apiGet('/api/v1/users', 'sf_test_invalid000000000000000000000000000000000000000000000000000000000000');
      expect(status).toBe(401);
    });
  });

  // =========================================================================
  // Platform admin
  // =========================================================================

  describe('Platform admin', () => {
    it('can list users (200)', async () => {
      const { status, data } = await apiGet('/api/v1/users?limit=10', platformAdminApiKey);
      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toBeDefined();
    });

    it('sees buyer from seller_main', async () => {
      const { status, data } = await apiGet('/api/v1/users?limit=100', platformAdminApiKey);
      expect(status).toBe(200);
      const userIds = data.data.map((u: { id: string }) => u.id);
      expect(userIds).toContain(buyerMainUserId);
    });

    it('shows 0 products for buyer who only has access in seller schema', async () => {
      const { status, data } = await apiGet(`/api/v1/users/${buyerSellerUserId}`, platformAdminApiKey);
      expect(status).toBe(200);
      // User exists in auth.users (global) so visible, but has no access in seller_main
      expect(data.data.stats.total_products).toBe(0);
    });

    it('can view specific user by ID', async () => {
      const { status, data } = await apiGet(`/api/v1/users/${buyerMainUserId}`, platformAdminApiKey);
      expect(status).toBe(200);
      expect(data.data.id).toBe(buyerMainUserId);
    });

    it('shows products for buyer who has access in seller_main', async () => {
      const { status, data } = await apiGet(`/api/v1/users/${buyerMainUserId}`, platformAdminApiKey);
      expect(status).toBe(200);
      expect(data.data.stats.total_products).toBeGreaterThan(0);
    });

    it('can grant access to seller_main product', async () => {
      // Create a temp user
      const { data: { user: tempUser } } = await supabase.auth.admin.createUser({
        email: `rbac-temp-grant-${Date.now()}@example.com`,
        password: 'password123',
        email_confirm: true,
      });

      try {
        const { status, data } = await apiPost(`/api/v1/users/${tempUser!.id}/access`, {
          product_id: buyerMainProductId,
        }, platformAdminApiKey);
        expect(status).toBe(201);
        expect(data.data.user_id).toBe(tempUser!.id);
      } finally {
        await supabase.from('user_product_access').delete().eq('user_id', tempUser!.id);
        await supabase.auth.admin.deleteUser(tempUser!.id);
      }
    });
  });

  // =========================================================================
  // Seller admin
  // =========================================================================

  describe('Seller admin', () => {
    it('can list users (200)', async () => {
      const { status, data } = await apiGet('/api/v1/users?limit=10', sellerAdminApiKey);
      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toBeDefined();
    });

    it('sees buyer from their schema (seller_kowalski_digital)', async () => {
      const { status, data } = await apiGet('/api/v1/users?limit=100', sellerAdminApiKey);
      expect(status).toBe(200);
      const userIds = data.data.map((u: { id: string }) => u.id);
      expect(userIds).toContain(buyerSellerUserId);
    });

    it('does NOT see buyer from seller_main in list (seller_customer_stats filters)', async () => {
      const { status, data } = await apiGet('/api/v1/users?limit=100', sellerAdminApiKey);
      expect(status).toBe(200);
      const userIds = data.data.map((u: { id: string }) => u.id);
      // seller_customer_stats only includes users with records in seller schema
      expect(userIds).not.toContain(buyerMainUserId);
    });

    it('can view specific user from their schema', async () => {
      const { status, data } = await apiGet(`/api/v1/users/${buyerSellerUserId}`, sellerAdminApiKey);
      expect(status).toBe(200);
      expect(data.data.id).toBe(buyerSellerUserId);
    });

    it('shows products for buyer who has access in seller schema', async () => {
      const { status, data } = await apiGet(`/api/v1/users/${buyerSellerUserId}`, sellerAdminApiKey);
      expect(status).toBe(200);
      expect(data.data.stats.total_products).toBeGreaterThan(0);
    });

    it('can grant access to their own product', async () => {
      const { data: { user: tempUser } } = await supabase.auth.admin.createUser({
        email: `rbac-seller-grant-${Date.now()}@example.com`,
        password: 'password123',
        email_confirm: true,
      });

      const sellerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        db: { schema: 'seller_kowalski_digital' },
      });

      try {
        const { status, data } = await apiPost(`/api/v1/users/${tempUser!.id}/access`, {
          product_id: sellerProductId,
        }, sellerAdminApiKey);
        expect(status).toBe(201);
        expect(data.data.user_id).toBe(tempUser!.id);
        expect(data.data.product_id).toBe(sellerProductId);

        // Verify user now appears in seller's user list
        const listResult = await apiGet('/api/v1/users?limit=100', sellerAdminApiKey);
        const userIds = listResult.data.data.map((u: { id: string }) => u.id);
        expect(userIds).toContain(tempUser!.id);
      } finally {
        await sellerClient.from('user_product_access').delete().eq('user_id', tempUser!.id);
        await supabase.auth.admin.deleteUser(tempUser!.id);
      }
    });

    it('cannot grant access to seller_main product (not in their schema)', async () => {
      const { data: { user: tempUser } } = await supabase.auth.admin.createUser({
        email: `rbac-seller-cross-${Date.now()}@example.com`,
        password: 'password123',
        email_confirm: true,
      });

      try {
        const { status } = await apiPost(`/api/v1/users/${tempUser!.id}/access`, {
          product_id: buyerMainProductId,
        }, sellerAdminApiKey);
        // Product from seller_main doesn't exist in seller_kowalski_digital schema
        expect(status).toBe(404);
      } finally {
        await supabase.auth.admin.deleteUser(tempUser!.id);
      }
    });

    it('search works within seller schema', async () => {
      const { status, data } = await apiGet(
        `/api/v1/users?search=rbac-buyer-seller`,
        sellerAdminApiKey
      );
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].id).toBe(buyerSellerUserId);
    });

    it('search does NOT find seller_main buyer (not in seller_customer_stats)', async () => {
      const { status, data } = await apiGet(
        `/api/v1/users?search=rbac-buyer-main`,
        sellerAdminApiKey
      );
      expect(status).toBe(200);
      // seller_customer_stats only includes customers of this schema
      // buyerMain has no records in seller_kowalski_digital → not returned
      const found = data.data.find((u: { id: string }) => u.id === buyerMainUserId);
      expect(found).toBeUndefined();
    });
  });

  // =========================================================================
  // Regular user (not admin, not seller) — should be fully blocked
  // =========================================================================

  describe('Regular user (no admin/seller role)', () => {
    it('gets 401 — API key not associated with admin or seller', async () => {
      // Regular user can't have a valid API key (api_keys requires admin_user_id or seller_id)
      // So any request with a fake key returns 401
      const { status } = await apiGet('/api/v1/users', regularKeyPlaintext);
      expect(status).toBe(401);
    });
  });

  // =========================================================================
  // V1 API via SESSION auth (cookies) — same endpoints, different auth method
  // This is what the browser does. API key tests above verify API key auth.
  // =========================================================================

  describe('V1 via session auth (cookie) — platform admin', () => {
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    let platformCookie: string;

    async function getCookie(email: string, password: string): Promise<string> {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data } = await anon.auth.signInWithPassword({ email, password });
      if (!data.session) throw new Error(`Login failed for ${email}`);
      const val = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
      return `sb-127-auth-token=${val}`;
    }

    async function sessionGet(path: string, cookie: string) {
      const response = await fetch(`${API_URL}${path}`, {
        headers: { Cookie: cookie },
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    }

    beforeAll(async () => {
      await supabase.auth.admin.updateUserById(platformAdminUserId, { password: 'password123' });
      const email = (await supabase.auth.admin.getUserById(platformAdminUserId)).data.user!.email!;
      platformCookie = await getCookie(email, 'password123');
    });

    it('can list users via session', async () => {
      const { status, data } = await sessionGet('/api/v1/users?limit=5', platformCookie);
      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('can view user detail via session', async () => {
      const { status, data } = await sessionGet(`/api/v1/users/${buyerMainUserId}`, platformCookie);
      expect(status).toBe(200);
      expect(data.data.id).toBe(buyerMainUserId);
      expect(data.data.stats).toBeDefined();
    });

    it('sees all auth.users (user_access_stats — LEFT JOIN)', async () => {
      const { status, data } = await sessionGet('/api/v1/users?limit=100', platformCookie);
      expect(status).toBe(200);
      // Platform admin uses user_access_stats which includes ALL auth.users
      const userIds = data.data.map((u: { id: string }) => u.id);
      expect(userIds).toContain(buyerMainUserId);
    });
  });

  describe('V1 via session auth (cookie) — seller admin', () => {
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    let sellerCookie: string;

    async function getCookie(email: string, password: string): Promise<string> {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data } = await anon.auth.signInWithPassword({ email, password });
      if (!data.session) throw new Error(`Login failed for ${email}`);
      const val = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
      return `sb-127-auth-token=${val}`;
    }

    async function sessionGet(path: string, cookie: string) {
      const response = await fetch(`${API_URL}${path}`, {
        headers: { Cookie: cookie },
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    }

    beforeAll(async () => {
      await supabase.auth.admin.updateUserById(sellerAdminUserId, { password: 'password123' });
      const email = (await supabase.auth.admin.getUserById(sellerAdminUserId)).data.user!.email!;
      sellerCookie = await getCookie(email, 'password123');
    });

    it('can list users via session', async () => {
      const { status, data } = await sessionGet('/api/v1/users?limit=5', sellerCookie);
      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('sees ONLY customers (seller_customer_stats)', async () => {
      const { status, data } = await sessionGet('/api/v1/users?limit=100', sellerCookie);
      expect(status).toBe(200);
      const userIds = data.data.map((u: { id: string }) => u.id);
      // Seller sees only customers from their schema
      expect(userIds).toContain(buyerSellerUserId);
      expect(userIds).not.toContain(buyerMainUserId);
    });

    it('can view customer detail via session', async () => {
      const { status, data } = await sessionGet(`/api/v1/users/${buyerSellerUserId}`, sellerCookie);
      expect(status).toBe(200);
      expect(data.data.id).toBe(buyerSellerUserId);
      expect(data.data.stats.total_products).toBeGreaterThan(0);
    });
  });

  describe('V1 via session auth (cookie) — regular user', () => {
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    beforeAll(async () => {
      await supabase.auth.admin.updateUserById(regularUserId, { password: 'password123' });
    });

    it('gets 401 — not admin/seller', async () => {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const email = (await supabase.auth.admin.getUserById(regularUserId)).data.user!.email!;
      const { data } = await anon.auth.signInWithPassword({ email, password: 'password123' });
      const val = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
      const cookie = `sb-127-auth-token=${val}`;

      const response = await fetch(`${API_URL}/api/v1/users?limit=5`, {
        headers: { Cookie: cookie },
      });
      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // Legacy API: /api/users/[id]/profile — session (cookie) auth
  // =========================================================================

  describe('/api/users/[id]/profile', () => {
    // Session-based auth helper
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    async function getCookie(email: string, password: string): Promise<string> {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data } = await anon.auth.signInWithPassword({ email, password });
      if (!data.session) throw new Error(`Login failed for ${email}`);
      const val = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
      return `sb-127-auth-token=${val}`;
    }

    async function sessionGet(path: string, cookie: string) {
      const response = await fetch(`${API_URL}${path}`, {
        headers: { Cookie: cookie },
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    }

    let platformCookie: string;
    let sellerCookie: string;
    let regularCookie: string;

    beforeAll(async () => {
      // Set passwords for session login
      await supabase.auth.admin.updateUserById(platformAdminUserId, { password: 'password123' });
      await supabase.auth.admin.updateUserById(sellerAdminUserId, { password: 'password123' });
      await supabase.auth.admin.updateUserById(regularUserId, { password: 'password123' });

      const platformEmail = (await supabase.auth.admin.getUserById(platformAdminUserId)).data.user!.email!;
      const sellerEmail = (await supabase.auth.admin.getUserById(sellerAdminUserId)).data.user!.email!;
      const regularEmail = (await supabase.auth.admin.getUserById(regularUserId)).data.user!.email!;

      platformCookie = await getCookie(platformEmail, 'password123');
      sellerCookie = await getCookie(sellerEmail, 'password123');
      regularCookie = await getCookie(regularEmail, 'password123');
    });

    it('platform admin can view any user profile', async () => {
      const { status, data } = await sessionGet(`/api/users/${buyerMainUserId}/profile`, platformCookie);
      expect(status).toBe(200);
      expect(data.user.id).toBe(buyerMainUserId);
    });

    it('platform admin can view seller schema buyer profile', async () => {
      const { status, data } = await sessionGet(`/api/users/${buyerSellerUserId}/profile`, platformCookie);
      expect(status).toBe(200);
      expect(data.user.id).toBe(buyerSellerUserId);
    });

    it('seller admin can view customer profile', async () => {
      const { status, data } = await sessionGet(`/api/users/${buyerSellerUserId}/profile`, sellerCookie);
      expect(status).toBe(200);
      expect(data.user.id).toBe(buyerSellerUserId);
    });

    it('seller admin can view seller_main buyer profile too (profile is global)', async () => {
      // Profile data comes from auth.users (global) — any admin/seller can view
      const { status, data } = await sessionGet(`/api/users/${buyerMainUserId}/profile`, sellerCookie);
      expect(status).toBe(200);
      expect(data.user.id).toBe(buyerMainUserId);
    });

    it('regular user can view own profile', async () => {
      const { status, data } = await sessionGet(`/api/users/${regularUserId}/profile`, regularCookie);
      expect(status).toBe(200);
      expect(data.user.id).toBe(regularUserId);
    });

    it('regular user CANNOT view other user profile', async () => {
      const { status } = await sessionGet(`/api/users/${buyerMainUserId}/profile`, regularCookie);
      expect(status).toBe(403); // API route rejects before SQL function
    });

    it('unauthenticated CANNOT view any profile', async () => {
      const response = await fetch(`${API_URL}/api/users/${buyerMainUserId}/profile`);
      expect(response.status).toBe(401);
    });
  });

  // =========================================================================
  // Legacy API: /api/users/[id]/access — session (cookie) auth
  // =========================================================================

  describe('/api/users/[id]/access', () => {
    let platformCookie: string;
    let sellerCookie: string;

    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    async function getCookie(email: string, password: string): Promise<string> {
      const anon = createClient(SUPABASE_URL, ANON_KEY);
      const { data } = await anon.auth.signInWithPassword({ email, password });
      if (!data.session) throw new Error(`Login failed for ${email}`);
      const val = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
      return `sb-127-auth-token=${val}`;
    }

    async function sessionGet(path: string, cookie: string) {
      const response = await fetch(`${API_URL}${path}`, {
        headers: { Cookie: cookie },
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, data };
    }

    beforeAll(async () => {
      const platformEmail = (await supabase.auth.admin.getUserById(platformAdminUserId)).data.user!.email!;
      const sellerEmail = (await supabase.auth.admin.getUserById(sellerAdminUserId)).data.user!.email!;
      platformCookie = await getCookie(platformEmail, 'password123');
      sellerCookie = await getCookie(sellerEmail, 'password123');
    });

    it('platform admin can list user access (seller_main products)', async () => {
      const { status, data } = await sessionGet(`/api/users/${buyerMainUserId}/access`, platformCookie);
      expect(status).toBe(200);
      expect(data.access).toBeDefined();
      expect(Array.isArray(data.access)).toBe(true);
      expect(data.access.length).toBeGreaterThan(0);
    });

    it('seller admin can list user access (seller schema products)', async () => {
      const { status, data } = await sessionGet(`/api/users/${buyerSellerUserId}/access`, sellerCookie);
      expect(status).toBe(200);
      expect(data.access).toBeDefined();
      expect(Array.isArray(data.access)).toBe(true);
      expect(data.access.length).toBeGreaterThan(0);
    });

    it('seller admin sees 0 access for seller_main buyer (different schema)', async () => {
      const { status, data } = await sessionGet(`/api/users/${buyerMainUserId}/access`, sellerCookie);
      expect(status).toBe(200);
      // Access is schema-scoped — buyer_main has no access in seller_kowalski_digital
      expect(data.access.length).toBe(0);
    });

    it('unauthenticated CANNOT list user access', async () => {
      const response = await fetch(`${API_URL}/api/users/${buyerMainUserId}/access`);
      expect(response.status).toBe(401);
    });
  });
});
