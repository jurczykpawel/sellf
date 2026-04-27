/**
 * API Integration Tests: Public product access — expiry semantics
 *
 * Covers the two endpoints that drive `/p/[slug]` and `/my-products`:
 *   GET /api/public/products/[slug]/access   — drives ProductView render switch
 *   GET /api/public/products/[slug]/content  — serves the actual protected payload
 *
 * Both endpoints are session-cookie authenticated and live behind Supabase RLS.
 * Tests cover: anonymous, no-access, active, expired, future, NULL, inactive,
 * temporal availability, and boundary timestamps.
 *
 * Run: bun run test:api  (requires `npx supabase start` + `bun run dev`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const API_URL = process.env.TEST_API_URL || 'http://localhost:3777';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY in test env');
}

const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loginCookie(email: string, password: string): Promise<string> {
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed for ${email}: ${error?.message}`);
  const val = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
  return `sb-127-auth-token=${val}`;
}

async function publicGet(path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${API_URL}${path}`, { headers });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const TEST_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface CreatedProduct {
  id: string;
  slug: string;
}

async function createProduct(opts: {
  suffix: string;
  isActive?: boolean;
  availableFrom?: Date | null;
  availableUntil?: Date | null;
}): Promise<CreatedProduct> {
  const slug = `pub-expiry-${opts.suffix}-${TEST_ID}`;
  const { data, error } = await supabaseAdmin
    .schema('seller_main' as never)
    .from('products')
    .insert({
      name: `Public Expiry ${opts.suffix}`,
      slug,
      price: 19.99,
      currency: 'USD',
      is_active: opts.isActive ?? true,
      available_from: opts.availableFrom?.toISOString() ?? null,
      available_until: opts.availableUntil?.toISOString() ?? null,
      content_config: {
        content_items: [
          { id: 'i1', type: 'download_link', is_active: true, url: 'https://files.example/secret.pdf' },
        ],
      },
      content_delivery_type: 'content',
    })
    .select('id')
    .single();
  if (error) throw new Error(`createProduct(${opts.suffix}) failed: ${error.message}`);
  return { id: data.id, slug };
}

async function grantAccess(userId: string, productId: string, expiresAt: Date | null) {
  // DB constraint: access_expires_at must be NULL or > access_granted_at.
  // For expired access we backdate access_granted_at to before access_expires_at.
  const grantedAt = expiresAt && expiresAt < new Date()
    ? new Date(expiresAt.getTime() - 60 * 60 * 1000) // 1h before expiry
    : new Date();
  const { error } = await supabaseAdmin
    .schema('seller_main' as never)
    .from('user_product_access')
    .insert({
      user_id: userId,
      product_id: productId,
      access_granted_at: grantedAt.toISOString(),
      access_expires_at: expiresAt?.toISOString() ?? null,
    });
  if (error) throw new Error(`grantAccess failed: ${error.message}`);
}

describe('Public product endpoints — expiry semantics', () => {
  const userEmail = `pub-expiry-user-${TEST_ID}@example.com`;
  const userPassword = 'TestPassword123!';
  let userId: string;
  let userCookie: string;

  // Products under test
  let pActive: CreatedProduct;       // active product, user has unlimited access
  let pExpired: CreatedProduct;      // active product, user's access expired yesterday
  let pFuture: CreatedProduct;       // active product, user's access expires tomorrow
  let pBoundary: CreatedProduct;     // active product, user's access expires +60s from now
  let pInactive: CreatedProduct;     // inactive product, user has access
  let pTemporal: CreatedProduct;     // active product, available_until in the past, user has no access
  let pNoAccess: CreatedProduct;     // active product, user has no access

  beforeAll(async () => {
    // Create the test user
    const { data: created, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: userEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (userErr) throw userErr;
    userId = created.user!.id;
    userCookie = await loginCookie(userEmail, userPassword);

    // Build products
    pActive = await createProduct({ suffix: 'active' });
    pExpired = await createProduct({ suffix: 'expired' });
    pFuture = await createProduct({ suffix: 'future' });
    pBoundary = await createProduct({ suffix: 'boundary' });
    pInactive = await createProduct({ suffix: 'inactive', isActive: false });
    pTemporal = await createProduct({
      suffix: 'temporal',
      availableUntil: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
    });
    pNoAccess = await createProduct({ suffix: 'no-access' });

    // Grant access where appropriate
    await grantAccess(userId, pActive.id, null); // unlimited
    await grantAccess(userId, pExpired.id, new Date(Date.now() - 24 * 60 * 60 * 1000)); // yesterday
    await grantAccess(userId, pFuture.id, new Date(Date.now() + 24 * 60 * 60 * 1000)); // tomorrow
    await grantAccess(userId, pBoundary.id, new Date(Date.now() + 60_000)); // +60s
    await grantAccess(userId, pInactive.id, null); // unlimited but product is inactive
  });

  afterAll(async () => {
    const productIds = [pActive, pExpired, pFuture, pBoundary, pInactive, pTemporal, pNoAccess]
      .filter(Boolean)
      .map((p) => p.id);
    await supabaseAdmin
      .schema('seller_main' as never)
      .from('user_product_access')
      .delete()
      .eq('user_id', userId);
    for (const id of productIds) {
      await supabaseAdmin.schema('seller_main' as never).from('products').delete().eq('id', id);
    }
    if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
  });

  // ===========================================================================
  // GET /api/public/products/[slug]/access
  // Drives the render switch in ProductView.tsx (case 'expired' → ProductExpiredState).
  // ===========================================================================

  describe('GET /access — reason calculation', () => {
    it('401 for anonymous caller', async () => {
      const { status } = await publicGet(`/api/public/products/${pActive.slug}/access`);
      expect(status).toBe(401);
    });

    it('hasAccess=true for unlimited active access', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pActive.slug}/access`, userCookie);
      expect(status).toBe(200);
      expect(data.hasAccess).toBe(true);
      expect(data.userAccess).toBeDefined();
      expect(data.userAccess.access_expires_at).toBeNull();
    });

    it('reason=expired when access_expires_at is in the past', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pExpired.slug}/access`, userCookie);
      expect(status).toBe(200);
      expect(data.hasAccess).toBe(false);
      expect(data.reason).toBe('expired');
    });

    it('hasAccess=true when access_expires_at is in the future', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pFuture.slug}/access`, userCookie);
      expect(status).toBe(200);
      expect(data.hasAccess).toBe(true);
    });

    it('inactive product is hidden from regular user (RLS) — endpoint returns 404', async () => {
      // The reason='inactive' branch in the route only fires when the product
      // is visible (admin preview). For regular users RLS hides inactive
      // products, so the slug lookup short-circuits to 404.
      const { status } = await publicGet(`/api/public/products/${pInactive.slug}/access`, userCookie);
      expect(status).toBe(404);
    });

    it('reason=temporal when product is no longer purchasable and user has no access', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pTemporal.slug}/access`, userCookie);
      expect(status).toBe(200);
      expect(data.hasAccess).toBe(false);
      expect(data.reason).toBe('temporal');
    });

    it('reason=no_access for active product the user never bought', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pNoAccess.slug}/access`, userCookie);
      expect(status).toBe(200);
      expect(data.hasAccess).toBe(false);
      expect(data.reason).toBe('no_access');
    });

    it('boundary: hasAccess=true when access_expires_at is just in the future (+60s)', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pBoundary.slug}/access`, userCookie);
      expect(status).toBe(200);
      expect(data.hasAccess).toBe(true);
    });

    it('404 for slug that does not exist', async () => {
      const { status } = await publicGet(`/api/public/products/does-not-exist-${TEST_ID}/access`, userCookie);
      expect(status).toBe(404);
    });
  });

  // ===========================================================================
  // GET /api/public/products/[slug]/content
  // The endpoint that actually serves the protected payload (download URLs, etc.).
  // This is the security boundary — even if a client manipulates the access
  // endpoint or render switch, this endpoint independently enforces expiry.
  // ===========================================================================

  describe('GET /content — independent expiry gate', () => {
    it('401 for anonymous caller', async () => {
      const { status } = await publicGet(`/api/public/products/${pActive.slug}/content`);
      expect(status).toBe(401);
    });

    it('200 with content_config for unlimited active access', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pActive.slug}/content`, userCookie);
      expect(status).toBe(200);
      expect(data.product?.content_config?.content_items?.[0]?.url).toBe('https://files.example/secret.pdf');
      // is_expired is `null` for unlimited access (computed from `expiresAt && expiresAt < now`).
      expect(data.userAccess.is_expired).toBeFalsy();
    });

    it('403 "Access expired" when access_expires_at is in the past', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pExpired.slug}/content`, userCookie);
      expect(status).toBe(403);
      expect(data.error).toMatch(/expired/i);
    });

    it('200 when access_expires_at is in the future', async () => {
      const { status } = await publicGet(`/api/public/products/${pFuture.slug}/content`, userCookie);
      expect(status).toBe(200);
    });

    it('403 when product is inactive (RLS-hidden), even if user holds access record', async () => {
      // Same as the /access counterpart: RLS hides the product from the user's
      // session client, so the route's first lookup fails → 403 "Access denied".
      // The route's later "Product not available" branch is unreachable here.
      const { status, data } = await publicGet(`/api/public/products/${pInactive.slug}/content`, userCookie);
      expect(status).toBe(403);
      expect(data.error).toMatch(/access denied|not available/i);
    });

    it('403 for active product the user never bought (no access record)', async () => {
      const { status } = await publicGet(`/api/public/products/${pNoAccess.slug}/content`, userCookie);
      expect(status).toBe(403);
    });

    it('boundary: 200 when access_expires_at is just in the future (+60s)', async () => {
      const { status, data } = await publicGet(`/api/public/products/${pBoundary.slug}/content`, userCookie);
      expect(status).toBe(200);
      expect(data.userAccess.is_expired).toBe(false);
      expect(data.userAccess.is_expiring_soon).toBe(true);
    });

    it('does not leak product existence: 403 for both no-access and not-found responses', async () => {
      // The route returns 403 (not 404) for unknown slugs to avoid disclosing
      // whether a product exists. Verify both shapes look identical.
      const { status: s1 } = await publicGet(`/api/public/products/does-not-exist-${TEST_ID}/content`, userCookie);
      const { status: s2 } = await publicGet(`/api/public/products/${pNoAccess.slug}/content`, userCookie);
      expect(s1).toBe(403);
      expect(s2).toBe(403);
    });
  });

  // ===========================================================================
  // Defense-in-depth assertion: /content cannot be tricked into serving
  // expired payload even when the caller bypasses the /access pre-check.
  // ===========================================================================

  describe('defense-in-depth: /content checks expiry independently of /access', () => {
    it('expired user hitting /content directly still gets 403', async () => {
      // No prior /access call. Directly fetch /content.
      const { status, data } = await publicGet(`/api/public/products/${pExpired.slug}/content`, userCookie);
      expect(status).toBe(403);
      expect(data.error).toMatch(/expired/i);
    });
  });
});
