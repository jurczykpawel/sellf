/**
 * API Integration Tests: Products OTO (One-Time Offer)
 *
 * Migrated from api-v1-products-oto.spec.ts (Playwright → Vitest)
 * Tests OTO configuration endpoints.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, put, del, deleteTestApiKey, API_URL, supabase } from './setup';

interface OtoConfig {
  has_oto: boolean;
  oto_product_id?: string;
  discount_type?: 'percentage' | 'fixed';
  discount_value?: number;
  duration_minutes?: number;
  oto_product?: {
    id: string;
    name: string;
    price: number;
  };
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
}

describe('Products OTO API v1', () => {
  let sourceProductId: string;
  let otoProductId: string;

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create source product
    const { data: source, error: sourceErr } = await supabase
      .from('products')
      .insert({
        name: `OTO Source Product ${randomStr}`,
        slug: `oto-source-${randomStr}`,
        price: 10000,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (sourceErr) throw sourceErr;
    sourceProductId = source.id;

    // Create OTO product
    const { data: oto, error: otoErr } = await supabase
      .from('products')
      .insert({
        name: `OTO Offer Product ${randomStr}`,
        slug: `oto-offer-${randomStr}`,
        price: 5000,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (otoErr) throw otoErr;
    otoProductId = oto.id;
  });

  afterAll(async () => {
    // Cleanup OTO offers
    if (sourceProductId) {
      await supabase.from('oto_offers').delete().eq('source_product_id', sourceProductId);
    }

    // Cleanup products
    if (otoProductId) {
      await supabase.from('products').delete().eq('id', otoProductId);
    }
    if (sourceProductId) {
      await supabase.from('products').delete().eq('id', sourceProductId);
    }

    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated GET requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/products/${sourceProductId}/oto`);
      expect(response.status).toBe(401);
    });

    it('should return 401 for unauthenticated PUT requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/products/${sourceProductId}/oto`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oto_product_id: otoProductId }),
      });
      expect(response.status).toBe(401);
    });

    it('should return 401 for unauthenticated DELETE requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/products/${sourceProductId}/oto`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/products/[id]/oto', () => {
    it('should return has_oto: false when no OTO configured', async () => {
      const { status, data } = await get<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`
      );

      expect(status).toBe(200);
      expect(data.data!.has_oto).toBe(false);
    });

    it('should return 400 for invalid product ID format', async () => {
      const { status, data } = await get<ApiResponse<OtoConfig>>(
        '/api/v1/products/invalid-uuid/oto'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 404 for non-existent product', async () => {
      const { status, data } = await get<ApiResponse<OtoConfig>>(
        '/api/v1/products/00000000-0000-0000-0000-000000000000/oto'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /api/v1/products/[id]/oto', () => {
    it('should create OTO configuration with defaults', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        { oto_product_id: otoProductId }
      );

      expect(status).toBe(200);
      expect(data.data!.has_oto).toBe(true);
      expect(data.data!.oto_product_id).toBe(otoProductId);
      expect(data.data!.discount_type).toBe('percentage');
      expect(data.data!.discount_value).toBe(20);
      expect(data.data!.duration_minutes).toBe(15);
    });

    it('should create OTO configuration with custom values', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: customOto } = await supabase
        .from('products')
        .insert({
          name: `Custom OTO ${randomStr}`,
          slug: `custom-oto-${randomStr}`,
          price: 3000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status, data } = await put<ApiResponse<OtoConfig>>(
          `/api/v1/products/${sourceProductId}/oto`,
          {
            oto_product_id: customOto!.id,
            discount_type: 'fixed',
            discount_value: 10,
            duration_minutes: 30,
          }
        );

        expect(status).toBe(200);
        expect(data.data!.has_oto).toBe(true);
        expect(data.data!.discount_type).toBe('fixed');
        expect(data.data!.discount_value).toBe(10);
        expect(data.data!.duration_minutes).toBe(30);
      } finally {
        await supabase.from('oto_offers').delete().eq('oto_product_id', customOto!.id);
        await supabase.from('products').delete().eq('id', customOto!.id);
      }
    });

    it('should return 400 for missing oto_product_id', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        {}
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid oto_product_id format', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        { oto_product_id: 'invalid-uuid' }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for non-existent OTO product', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        { oto_product_id: '00000000-0000-0000-0000-000000000000' }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
      expect(data.error!.message).toContain('not found');
    });

    it('should return 400 for invalid discount_type', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        {
          oto_product_id: otoProductId,
          discount_type: 'invalid',
        }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for negative discount_value', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        {
          oto_product_id: otoProductId,
          discount_value: -10,
        }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid duration_minutes', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        `/api/v1/products/${sourceProductId}/oto`,
        {
          oto_product_id: otoProductId,
          duration_minutes: 0,
        }
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent source product', async () => {
      const { status, data } = await put<ApiResponse<OtoConfig>>(
        '/api/v1/products/00000000-0000-0000-0000-000000000000/oto',
        { oto_product_id: otoProductId }
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/products/[id]/oto', () => {
    it('should delete OTO configuration', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a fresh product pair for this test
      const { data: delTestSource } = await supabase
        .from('products')
        .insert({
          name: `Delete Test Source ${randomStr}`,
          slug: `del-test-source-${randomStr}`,
          price: 6000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: delTestOto } = await supabase
        .from('products')
        .insert({
          name: `Delete Test OTO ${randomStr}`,
          slug: `del-test-oto-${randomStr}`,
          price: 2000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        // First create an OTO
        const createResponse = await put<ApiResponse<OtoConfig>>(
          `/api/v1/products/${delTestSource!.id}/oto`,
          { oto_product_id: delTestOto!.id }
        );
        expect(createResponse.status).toBe(200);

        // Then delete it
        const deleteResponse = await del<ApiResponse<unknown>>(
          `/api/v1/products/${delTestSource!.id}/oto`
        );
        expect(deleteResponse.status).toBe(204);

        // Verify it's gone
        const getResponse = await get<ApiResponse<OtoConfig>>(
          `/api/v1/products/${delTestSource!.id}/oto`
        );
        expect(getResponse.status).toBe(200);
        expect(getResponse.data.data!.has_oto).toBe(false);
      } finally {
        // Cleanup
        await supabase.from('oto_offers').delete().eq('source_product_id', delTestSource!.id);
        await supabase.from('products').delete().eq('id', delTestOto!.id);
        await supabase.from('products').delete().eq('id', delTestSource!.id);
      }
    });

    it('should return 400 for invalid product ID format', async () => {
      const { status, data } = await del<ApiResponse<unknown>>(
        '/api/v1/products/invalid-uuid/oto'
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should succeed even if no OTO exists (idempotent)', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create a product with no OTO
      const { data: noOtoProduct } = await supabase
        .from('products')
        .insert({
          name: `No OTO Product ${randomStr}`,
          slug: `no-oto-${randomStr}`,
          price: 2500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const { status } = await del<ApiResponse<unknown>>(
          `/api/v1/products/${noOtoProduct!.id}/oto`
        );
        expect(status).toBe(204);
      } finally {
        await supabase.from('products').delete().eq('id', noOtoProduct!.id);
      }
    });
  });

  describe('OTO Lifecycle', () => {
    it('should replace existing OTO when PUT is called with different product', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      // Create fresh products for this test
      const { data: lifecycleSource } = await supabase
        .from('products')
        .insert({
          name: `Lifecycle Source ${randomStr}`,
          slug: `lifecycle-source-${randomStr}`,
          price: 8000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: initialOto } = await supabase
        .from('products')
        .insert({
          name: `Initial OTO ${randomStr}`,
          slug: `initial-oto-${randomStr}`,
          price: 2500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: replacementOto } = await supabase
        .from('products')
        .insert({
          name: `Replacement OTO ${randomStr}`,
          slug: `replacement-oto-${randomStr}`,
          price: 3500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        // Create initial OTO
        const response1 = await put<ApiResponse<OtoConfig>>(
          `/api/v1/products/${lifecycleSource!.id}/oto`,
          {
            oto_product_id: initialOto!.id,
            discount_type: 'percentage',
            discount_value: 10,
          }
        );
        expect(response1.status).toBe(200);

        // Replace OTO with different product
        const response2 = await put<ApiResponse<OtoConfig>>(
          `/api/v1/products/${lifecycleSource!.id}/oto`,
          {
            oto_product_id: replacementOto!.id,
            discount_type: 'fixed',
            discount_value: 25,
          }
        );
        expect(response2.status).toBe(200);
        expect(response2.data.data!.discount_type).toBe('fixed');
        expect(response2.data.data!.discount_value).toBe(25);
        expect(response2.data.data!.oto_product_id).toBe(replacementOto!.id);

        // Verify only one active OTO exists
        const getResponse = await get<ApiResponse<OtoConfig>>(
          `/api/v1/products/${lifecycleSource!.id}/oto`
        );
        expect(getResponse.status).toBe(200);
        expect(getResponse.data.data!.discount_type).toBe('fixed');
        expect(getResponse.data.data!.discount_value).toBe(25);
      } finally {
        // Cleanup
        await supabase.from('oto_offers').delete().eq('source_product_id', lifecycleSource!.id);
        await supabase.from('products').delete().eq('id', replacementOto!.id);
        await supabase.from('products').delete().eq('id', initialOto!.id);
        await supabase.from('products').delete().eq('id', lifecycleSource!.id);
      }
    });

    it('should update the offer when PUT is called again for the same product pair', async () => {
      const randomStr = Math.random().toString(36).substring(7);

      const { data: pairSource } = await supabase
        .from('products')
        .insert({
          name: `Pair Source ${randomStr}`,
          slug: `pair-source-${randomStr}`,
          price: 8000,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      const { data: pairOto } = await supabase
        .from('products')
        .insert({
          name: `Pair OTO ${randomStr}`,
          slug: `pair-oto-${randomStr}`,
          price: 2500,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();

      try {
        const response1 = await put<ApiResponse<OtoConfig>>(
          `/api/v1/products/${pairSource!.id}/oto`,
          {
            oto_product_id: pairOto!.id,
            discount_type: 'percentage',
            discount_value: 20,
          }
        );
        expect(response1.status).toBe(200);

        // Same pair, new values
        const response2 = await put<ApiResponse<OtoConfig>>(
          `/api/v1/products/${pairSource!.id}/oto`,
          {
            oto_product_id: pairOto!.id,
            discount_type: 'percentage',
            discount_value: 30,
            duration_minutes: 30,
          }
        );
        expect(response2.status).toBe(200);
        expect(response2.data.data!.discount_value).toBe(30);
        expect(response2.data.data!.duration_minutes).toBe(30);

        const getResponse = await get<ApiResponse<OtoConfig>>(
          `/api/v1/products/${pairSource!.id}/oto`
        );
        expect(getResponse.status).toBe(200);
        expect(getResponse.data.data!.has_oto).toBe(true);
        expect(getResponse.data.data!.discount_value).toBe(30);
      } finally {
        await supabase.from('oto_offers').delete().eq('source_product_id', pairSource!.id);
        await supabase.from('products').delete().eq('id', pairOto!.id);
        await supabase.from('products').delete().eq('id', pairSource!.id);
      }
    });
  });
});
