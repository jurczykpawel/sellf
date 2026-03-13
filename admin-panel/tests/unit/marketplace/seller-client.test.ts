/**
 * Integration Tests: Marketplace Seller Client
 *
 * Tests getSellerBySlug, getSellerById, seller cache, and tenant-scoped clients.
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 * Run: bunx vitest run tests/unit/marketplace/seller-client.test.ts
 *
 * @see src/lib/marketplace/seller-client.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSellerBySlug,
  getSellerById,
  clearSellerCache,
  createSellerAdminClient,
  createSellerPublicClient,
} from '@/lib/marketplace/seller-client';

describe('Marketplace: Seller Client', () => {
  beforeEach(() => {
    clearSellerCache();
  });

  // =====================================================
  // getSellerBySlug()
  // =====================================================

  describe('getSellerBySlug()', () => {
    it('should find the owner seller (slug=main)', async () => {
      const seller = await getSellerBySlug('main');
      expect(seller).toBeTruthy();
      expect(seller!.slug).toBe('main');
      expect(seller!.schema_name).toBe('seller_main');
      expect(seller!.display_name).toBe('Platform Owner');
      expect(seller!.platform_fee_percent).toBe(0);
      expect(seller!.status).toBe('active');
    });

    it('should return null for non-existent seller', async () => {
      const seller = await getSellerBySlug('non-existent-slug-xyz');
      expect(seller).toBeNull();
    });

    it('should return null for empty slug', async () => {
      const seller = await getSellerBySlug('');
      expect(seller).toBeNull();
    });

    it('should cache results (second call returns same data)', async () => {
      const seller1 = await getSellerBySlug('main');
      const seller2 = await getSellerBySlug('main');
      expect(seller1).toEqual(seller2);
    });

    it('should cache null results (negative caching)', async () => {
      const seller1 = await getSellerBySlug('does-not-exist');
      expect(seller1).toBeNull();
      // Second call should also return null from cache (no DB query)
      const seller2 = await getSellerBySlug('does-not-exist');
      expect(seller2).toBeNull();
    });

    it('should return fresh data after cache clear', async () => {
      const seller1 = await getSellerBySlug('main');
      clearSellerCache();
      const seller2 = await getSellerBySlug('main');
      expect(seller1).toEqual(seller2);
    });
  });

  // =====================================================
  // getSellerById()
  // =====================================================

  describe('getSellerById()', () => {
    it('should find seller by ID', async () => {
      // First get the owner seller to know its ID
      const bySlug = await getSellerBySlug('main');
      expect(bySlug).toBeTruthy();

      const byId = await getSellerById(bySlug!.id);
      expect(byId).toBeTruthy();
      expect(byId!.slug).toBe('main');
      expect(byId!.id).toBe(bySlug!.id);
    });

    it('should return null for non-existent ID', async () => {
      const seller = await getSellerById('00000000-0000-4000-a000-000000000000');
      expect(seller).toBeNull();
    });

    it('should return null for empty ID', async () => {
      const seller = await getSellerById('');
      expect(seller).toBeNull();
    });
  });

  // =====================================================
  // createSellerAdminClient()
  // =====================================================

  describe('createSellerAdminClient()', () => {
    it('should reject seller_main (platform schema, not a seller)', () => {
      expect(() => createSellerAdminClient('seller_main')).toThrow('Invalid seller schema name');
    });

    it('should create a client for a valid seller schema name', () => {
      const client = createSellerAdminClient('seller_test_shop');
      expect(client).toBeTruthy();
      // Verify it's a valid Supabase client by checking it has expected methods
      expect(typeof client.from).toBe('function');
      expect(typeof client.rpc).toBe('function');
    });
  });

  // =====================================================
  // createSellerPublicClient()
  // =====================================================

  describe('createSellerPublicClient()', () => {
    it('should reject seller_main (platform schema, not a seller)', () => {
      expect(() => createSellerPublicClient('seller_main')).toThrow('Invalid seller schema name');
    });

    it('should create a public client for a valid seller schema', () => {
      const client = createSellerPublicClient('seller_test_shop');
      expect(client).toBeTruthy();
      expect(typeof client.from).toBe('function');
    });
  });
});
