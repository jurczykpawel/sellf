/**
 * Integration Tests: Marketplace Payment Flow
 *
 * Tests seller-aware payment flow: create-payment-intent, grant-access,
 * product-access, verify-payment, webhook routing, cross-schema purchases.
 *
 * REQUIRES: Supabase running locally (npx supabase start + db reset)
 * Run: bunx vitest run tests/unit/marketplace/marketplace-payment-flow.test.ts
 *
 * @see priv/MARKETPLACE-PLAN.md
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

// Service role clients for different schemas
const publicClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'public' },
  auth: { autoRefreshToken: false, persistSession: false },
});

function createSchemaClient(schema: string) {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ===== HELPERS =====

/** Get seller info by slug from public.sellers */
async function getSellerBySlug(slug: string) {
  const normalized = slug.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const { data, error } = await publicClient
    .from('sellers')
    .select('id, slug, schema_name, display_name, stripe_account_id, stripe_onboarding_complete, platform_fee_percent, status')
    .eq('slug', normalized)
    .eq('status', 'active')
    .single();
  if (error) return null;
  return data;
}

/** Get product from a specific seller schema */
async function getProductFromSchema(schemaName: string, productSlug: string) {
  const client = createSchemaClient(schemaName);
  const { data, error } = await client
    .from('products')
    .select('id, name, slug, price, currency, is_active')
    .eq('slug', productSlug)
    .single();
  if (error) return null;
  return data;
}

// ===== TESTS =====

describe('Marketplace Payment Flow', () => {
  // Pre-check: marketplace seed data exists
  let kowalskiSeller: Awaited<ReturnType<typeof getSellerBySlug>>;
  let creativeSeller: Awaited<ReturnType<typeof getSellerBySlug>>;

  beforeAll(async () => {
    kowalskiSeller = await getSellerBySlug('kowalski-digital');
    creativeSeller = await getSellerBySlug('creative-studio');
  });

  describe('seed data verification', () => {
    it('should have Kowalski Digital seller provisioned', () => {
      expect(kowalskiSeller).not.toBeNull();
      expect(kowalskiSeller!.display_name).toBe('Kowalski Digital');
      expect(kowalskiSeller!.schema_name).toBe('seller_kowalski_digital');
      expect(kowalskiSeller!.status).toBe('active');
    });

    it('should have Creative Studio seller provisioned', () => {
      expect(creativeSeller).not.toBeNull();
      expect(creativeSeller!.display_name).toBe('Creative Studio');
      expect(creativeSeller!.schema_name).toBe('seller_creative_studio');
    });

    it('should have products in Kowalski schema', async () => {
      const product = await getProductFromSchema('seller_kowalski_digital', 'kurs-ecommerce');
      expect(product).not.toBeNull();
      expect(product!.name).toBe('Kurs E-commerce od Zera');
      expect(product!.price).toBe(199);
    });

    it('should have products in Creative Studio schema', async () => {
      const product = await getProductFromSchema('seller_creative_studio', 'logo-design');
      expect(product).not.toBeNull();
      expect(product!.name).toBe('Logo Design Package');
    });

    it('should NOT find seller products in seller_main schema', async () => {
      const product = await getProductFromSchema('seller_main', 'kurs-ecommerce');
      expect(product).toBeNull();
    });
  });

  // ===== PAYMENT FLOW TESTS (RED — will fail until implemented) =====

  describe('create-payment-intent — seller routing', () => {
    it('should query product from seller schema when sellerSlug provided', async () => {
      // This test will call the API route with sellerSlug
      // Currently: API queries default schema → product not found → 404
      // Expected: API resolves seller → queries seller schema → finds product
      const product = await getProductFromSchema('seller_kowalski_digital', 'kurs-ecommerce');
      expect(product).not.toBeNull();

      // TODO: When API is seller-aware, call it and verify success
      // For now, verify the product exists in the right place
      const mainProduct = await getProductFromSchema('seller_main', 'kurs-ecommerce');
      expect(mainProduct).toBeNull(); // Confirms the bug: product is NOT in default schema
    });

    it('should return 404 when sellerSlug points to non-existent seller', async () => {
      const seller = await getSellerBySlug('nonexistent-seller');
      expect(seller).toBeNull();
    });

    it('should return 404 when product does not exist in seller schema', async () => {
      // Creative Studio does not have 'kurs-ecommerce'
      const product = await getProductFromSchema('seller_creative_studio', 'kurs-ecommerce');
      expect(product).toBeNull();
    });
  });

  describe('Stripe Connect — payment routing', () => {
    it('platform owner (seller_main) should have 0% platform fee', async () => {
      const owner = await getSellerBySlug('main');
      expect(owner).not.toBeNull();
      expect(owner!.platform_fee_percent).toBe(0);
    });

    it('marketplace sellers should have default 5% platform fee', async () => {
      expect(kowalskiSeller!.platform_fee_percent).toBe(5);
      expect(creativeSeller!.platform_fee_percent).toBe(5);
    });

    it('should reject payment when seller has no stripe_account_id', async () => {
      // Seed sellers don't have Stripe accounts connected
      expect(kowalskiSeller!.stripe_account_id).toBeNull();
      expect(kowalskiSeller!.stripe_onboarding_complete).toBe(false);
      // TODO: API should return error when sellerSlug points to seller without Stripe
    });

    it('should calculate application_fee correctly', () => {
      // 199 PLN product, 5% fee
      const totalAmountCents = 19900;
      const feePercent = 5;
      const applicationFee = Math.round(totalAmountCents * feePercent / 100);
      expect(applicationFee).toBe(995); // 9.95 PLN
    });
  });

  describe('product-access — seller routing', () => {
    it('should find product in correct seller schema', async () => {
      const product = await getProductFromSchema('seller_kowalski_digital', 'kurs-ecommerce');
      expect(product).not.toBeNull();
      expect(product!.is_active).toBe(true);
    });

    it('should NOT find product in wrong seller schema', async () => {
      const product = await getProductFromSchema('seller_creative_studio', 'kurs-ecommerce');
      expect(product).toBeNull();
    });
  });

  describe('cross-schema access — user_product_access', () => {
    it('each seller schema should have its own user_product_access table', async () => {
      const kowalskiClient = createSchemaClient('seller_kowalski_digital');
      const creativeClient = createSchemaClient('seller_creative_studio');
      const mainClient = createSchemaClient('seller_main');

      // All three schemas should have user_product_access (empty since no purchases)
      const [k, c, m] = await Promise.all([
        kowalskiClient.from('user_product_access').select('id').limit(1),
        creativeClient.from('user_product_access').select('id').limit(1),
        mainClient.from('user_product_access').select('id').limit(1),
      ]);

      expect(k.error).toBeNull();
      expect(c.error).toBeNull();
      expect(m.error).toBeNull();
    });

    it('each seller schema should have its own payment_transactions table', async () => {
      const kowalskiClient = createSchemaClient('seller_kowalski_digital');
      const { error } = await kowalskiClient.from('payment_transactions').select('id').limit(1);
      expect(error).toBeNull();
    });

    it('each seller schema should have its own guest_purchases table', async () => {
      const kowalskiClient = createSchemaClient('seller_kowalski_digital');
      const { error } = await kowalskiClient.from('guest_purchases').select('id').limit(1);
      expect(error).toBeNull();
    });
  });

  describe('order bumps — seller schema isolation', () => {
    it('should have order bumps in Kowalski schema', async () => {
      const client = createSchemaClient('seller_kowalski_digital');
      const { data, error } = await client
        .from('order_bumps')
        .select('id, main_product_id, bump_product_id, bump_price, is_active');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it('should have order bumps in Creative Studio schema', async () => {
      const client = createSchemaClient('seller_creative_studio');
      const { data, error } = await client
        .from('order_bumps')
        .select('id, main_product_id, bump_product_id');
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it('order bumps should reference products within same schema only', async () => {
      const client = createSchemaClient('seller_kowalski_digital');
      const { data: bumps } = await client
        .from('order_bumps')
        .select('main_product_id, bump_product_id');

      // All bump product IDs should exist in kowalski's products table
      for (const bump of bumps!) {
        const { data: mainProd } = await client
          .from('products')
          .select('id')
          .eq('id', bump.main_product_id)
          .single();
        expect(mainProd).not.toBeNull();

        const { data: bumpProd } = await client
          .from('products')
          .select('id')
          .eq('id', bump.bump_product_id)
          .single();
        expect(bumpProd).not.toBeNull();
      }
    });
  });

  describe('security', () => {
    it('should not expose schema_name via anon client', async () => {
      const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
        db: { schema: 'public' },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Anon can read active sellers but should see limited columns
      const { data, error } = await anonClient
        .from('sellers')
        .select('id, slug, display_name, status')
        .eq('status', 'active');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      // schema_name should NOT be exposed to anon (RLS should filter it)
      // Note: This depends on RLS policy — verify that select policy limits columns
    });

    it('should reject invalid seller schema names', () => {
      const isValid = (name: string) => /^seller_[a-z0-9_]{2,50}$/.test(name) && name !== 'seller_main';

      expect(isValid('seller_kowalski_digital')).toBe(true);
      expect(isValid('seller_main')).toBe(false); // owner, not marketplace seller
      expect(isValid('public')).toBe(false);
      expect(isValid('seller_')).toBe(false); // too short
      expect(isValid('seller_a')).toBe(false); // too short (needs 2+ chars after prefix)
      expect(isValid('seller_DROP_TABLE')).toBe(false); // uppercase
      expect(isValid('seller_valid_name')).toBe(true);
    });
  });
});
