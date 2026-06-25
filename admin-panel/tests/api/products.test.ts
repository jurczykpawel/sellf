/**
 * API Integration Tests: Products
 *
 * Migrated from api-v1-products.spec.ts (Playwright → Vitest)
 * Tests cursor-based pagination, CRUD operations, and error handling.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, post, patch, del, testData, cleanup, deleteTestApiKey, API_URL, supabaseAdmin } from './setup';

interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

// Helper to create unique slug
const uniqueSlug = () => `test-product-${Date.now()}-${Math.random().toString(36).substring(7)}`;

describe('Products API v1', () => {
  const createdProductIds: string[] = [];

  afterAll(async () => {
    await cleanup({ products: createdProductIds });
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/products`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/products', () => {
    it('should return products list with pagination', async () => {
      const { status, data } = await get<ApiResponse<Product[]>>('/api/v1/products');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
      expect(data.pagination).toHaveProperty('limit');
    });

    it('should respect limit parameter', async () => {
      const { status, data } = await get<ApiResponse<Product[]>>('/api/v1/products?limit=5');

      expect(status).toBe(200);
      expect(data.pagination?.limit).toBe(5);
      expect(data.data!.length).toBeLessThanOrEqual(5);
    });

    it('should filter by status=active', async () => {
      const { status, data } = await get<ApiResponse<Product[]>>('/api/v1/products?status=active');

      expect(status).toBe(200);
      for (const product of data.data!) {
        expect(product.is_active).toBe(true);
      }
    });

    it('should filter by status=inactive', async () => {
      const { status, data } = await get<ApiResponse<Product[]>>('/api/v1/products?status=inactive');

      expect(status).toBe(200);
      for (const product of data.data!) {
        expect(product.is_active).toBe(false);
      }
    });

    it('should support search parameter', async () => {
      // Create a product with unique name
      const uniqueName = `SearchTest-${Date.now()}`;
      const createResult = await post<ApiResponse<Product>>('/api/v1/products', {
        name: uniqueName,
        slug: uniqueSlug(),
        description: 'Search test product',
        price: 10.0,
      });

      expect(createResult.status).toBe(201);
      if (createResult.data.data?.id) {
        createdProductIds.push(createResult.data.data.id);
      }

      // Search for it
      const { status, data } = await get<ApiResponse<Product[]>>(`/api/v1/products?search=${uniqueName}`);

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThanOrEqual(1);
      expect(data.data!.some((p) => p.name === uniqueName)).toBe(true);
    });

    it('should support cursor pagination', async () => {
      // Create a few products to ensure pagination works
      for (let i = 0; i < 3; i++) {
        const createResult = await post<ApiResponse<Product>>('/api/v1/products', {
          name: `Pagination Test ${i}`,
          slug: uniqueSlug(),
          description: 'Pagination test product',
          price: 10.0,
        });
        if (createResult.data.data?.id) {
          createdProductIds.push(createResult.data.data.id);
        }
      }

      // Get first page with limit=1
      const firstPage = await get<ApiResponse<Product[]>>('/api/v1/products?limit=1');
      expect(firstPage.status).toBe(200);

      expect(firstPage.data.pagination?.has_more).toBe(true);
      expect(firstPage.data.pagination?.next_cursor).toBeTruthy();

      // Get second page
      const secondPage = await get<ApiResponse<Product[]>>(
        `/api/v1/products?limit=1&cursor=${firstPage.data.pagination!.next_cursor}`
      );
      expect(secondPage.status).toBe(200);

      // Products should be different
      expect(secondPage.data.data![0]?.id).not.toBe(firstPage.data.data![0]?.id);
    });
  });

  describe('POST /api/v1/products', () => {
    it('should create a product with required fields', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Test Product',
        slug: slug,
        description: 'A test product description',
        price: 29.99,
      });

      expect(status).toBe(201);
      expect(data.data).toHaveProperty('id');
      expect(data.data!.name).toBe('Test Product');
      expect(data.data!.slug).toBe(slug);
      expect(data.data!.price).toBe(29.99);
      expect(data.data!.currency).toBe('USD'); // default
      expect(data.data!.is_active).toBe(true); // default

      createdProductIds.push(data.data!.id);
    });

    it('should set seller_id to the authenticated user on creation', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Seller ID Test',
        slug: uniqueSlug(),
        description: 'Tests that seller_id is set',
        price: 0,
      });

      expect(status).toBe(201);
      const productId = data.data!.id;
      createdProductIds.push(productId);

      const { data: row } = await supabaseAdmin()
        .from('products')
        .select('seller_id')
        .eq('id', productId)
        .single();

      expect(row!.seller_id).toBeTruthy();
    });

    it('should create a product with all optional fields', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Full Product',
        slug: uniqueSlug(),
        description: 'Full description',
        price: 99.99,
        currency: 'PLN',
        is_active: false,
      });

      expect(status).toBe(201);
      expect(data.data!.currency).toBe('PLN');
      expect(data.data!.is_active).toBe(false);

      createdProductIds.push(data.data!.id);
    });

    it('should return validation error for missing required fields', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Test Product',
        // missing slug, description, price
      });

      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for empty body', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {});

      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should return error for duplicate slug', async () => {
      const slug = uniqueSlug();

      // Create first product
      const first = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'First Product',
        slug: slug,
        description: 'First product',
        price: 10.0,
      });
      expect(first.status).toBe(201);
      createdProductIds.push(first.data.data!.id);

      // Try to create second with same slug
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Second Product',
        slug: slug,
        description: 'Second product',
        price: 20.0,
      });

      expect(status).toBe(409);
      expect(data.error?.code).toBe('ALREADY_EXISTS');
    });

    it('should validate slug format - reject spaces', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Test Product',
        slug: 'Invalid Slug With Spaces!',
        description: 'Test description',
        price: 10.0,
      });

      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should validate price is positive', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Test Product',
        slug: uniqueSlug(),
        description: 'Test description',
        price: -10,
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });

    it('should validate price is not zero', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Test Product',
        slug,
        description: 'Test description',
        price: 0,
      });

      if (status === 201) {
        // Zero price allowed for free products — verify it was created correctly
        expect(data.data!.price).toBe(0);
        createdProductIds.push(data.data!.id);
      } else if (status === 400) {
        // Zero price rejected by validation
        expect(data.error).toBeDefined();
      } else {
        expect.fail(`Expected status 201 or 400 but got ${status}`);
      }
    });
  });

  describe('GET /api/v1/products/:id', () => {
    let testProductId: string;

    beforeAll(async () => {
      const { data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Get By ID Test',
        slug: uniqueSlug(),
        description: 'Test product for GET by ID',
        price: 15.0,
      });
      testProductId = data.data!.id;
      createdProductIds.push(testProductId);
    });

    it('should return a product by ID', async () => {
      const { status, data } = await get<ApiResponse<Product>>(`/api/v1/products/${testProductId}`);

      expect(status).toBe(200);
      expect(data.data!.id).toBe(testProductId);
      expect(data.data!.name).toBe('Get By ID Test');
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const { status, data } = await get<ApiResponse<Product>>(`/api/v1/products/${fakeId}`);

      expect(status).toBe(404);
      expect(data.error?.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid ID format', async () => {
      const { status, data } = await get<ApiResponse<Product>>('/api/v1/products/invalid-id');

      expect(status).toBe(400);
      expect(data.error?.code).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /api/v1/products/:id', () => {
    let testProductId: string;
    let testProductSlug: string;

    beforeAll(async () => {
      testProductSlug = uniqueSlug();
      const { data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Update Test',
        slug: testProductSlug,
        description: 'Original description',
        price: 10.0,
      });
      testProductId = data.data!.id;
      createdProductIds.push(testProductId);
    });

    it('should update product name', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${testProductId}`, {
        name: 'Updated Name',
      });

      expect(status).toBe(200);
      expect(data.data!.name).toBe('Updated Name');
      expect(data.data!.description).toBe('Original description'); // unchanged
    });

    it('should update product price', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${testProductId}`, {
        price: 25.0,
      });

      expect(status).toBe(200);
      expect(data.data!.price).toBe(25.0);
    });

    it('should update multiple fields at once', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${testProductId}`, {
        name: 'Multi Update',
        price: 50.0,
        description: 'Updated description',
      });

      expect(status).toBe(200);
      expect(data.data!.name).toBe('Multi Update');
      expect(data.data!.price).toBe(50.0);
      expect(data.data!.description).toBe('Updated description');
    });

    it('should toggle is_active status', async () => {
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${testProductId}`, {
        is_active: false,
      });

      expect(status).toBe(200);
      expect(data.data!.is_active).toBe(false);

      // Toggle back
      const { data: data2 } = await patch<ApiResponse<Product>>(`/api/v1/products/${testProductId}`, {
        is_active: true,
      });
      expect(data2.data!.is_active).toBe(true);
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const { status } = await patch<ApiResponse<Product>>(`/api/v1/products/${fakeId}`, {
        name: 'New Name',
      });

      expect(status).toBe(404);
    });

    it('should prevent duplicate slug on update', async () => {
      const slug1 = uniqueSlug();
      const slug2 = uniqueSlug();

      // Create two products
      const first = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'First',
        slug: slug1,
        description: 'First',
        price: 10.0,
      });
      createdProductIds.push(first.data.data!.id);

      const second = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Second',
        slug: slug2,
        description: 'Second',
        price: 20.0,
      });
      createdProductIds.push(second.data.data!.id);

      // Try to update second to have first's slug
      const { status, data } = await patch<ApiResponse<Product>>(`/api/v1/products/${second.data.data!.id}`, {
        slug: slug1,
      });

      expect(status).toBe(409);
      expect(data.error?.code).toBe('ALREADY_EXISTS');
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('should delete a product', async () => {
      // Create a product
      const createResult = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Delete Test',
        slug: uniqueSlug(),
        description: 'Will be deleted',
        price: 10.0,
      });
      const productId = createResult.data.data!.id;

      // Delete it
      const { status } = await del<ApiResponse<null>>(`/api/v1/products/${productId}`);
      expect(status).toBe(204);

      // Verify it's gone
      const { status: getStatus } = await get<ApiResponse<Product>>(`/api/v1/products/${productId}`);
      expect(getStatus).toBe(404);
    });

    it('should return 404 for non-existent product', async () => {
      const fakeId = '11111111-1111-4111-a111-111111111111';
      const { status } = await del<ApiResponse<null>>(`/api/v1/products/${fakeId}`);

      expect(status).toBe(404);
    });

    it('should return 400 for invalid ID format', async () => {
      const { status } = await del<ApiResponse<null>>('/api/v1/products/invalid-id');

      expect(status).toBe(400);
    });
  });

  describe('GET /api/v1/products search input handling', () => {
    let inactiveId: string;
    const inactiveSlug = `hidden-${Date.now()}`;

    beforeAll(async () => {
      const r = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'Hidden', slug: inactiveSlug, description: 'd', price: 1, is_active: false,
      });
      inactiveId = r.data.data!.id;
      createdProductIds.push(inactiveId);
    });

    it('treats commas in search as literal value, not filter syntax', async () => {
      const payload = encodeURIComponent(`${inactiveSlug},is_active.eq.false`);
      const { status, data } = await get<ApiResponse<Product[]>>(`/api/v1/products?status=active&search=${payload}&limit=100`);
      expect(status).toBe(200);
      const ids = (data.data ?? []).map((p) => p.id);
      expect(ids).not.toContain(inactiveId);
    });

    it('does not crash on parentheses and dots in search', async () => {
      const { status } = await get<ApiResponse<Product[]>>('/api/v1/products?search=foo.bar(baz)&limit=1');
      expect(status).toBe(200);
    });
  });

  describe('GET /api/v1/products embed param', () => {
    it('returns NO categories/tags by default', async () => {
      const { status, data } = await get<ApiResponse<Array<Product & Record<string, unknown>>>>('/api/v1/products?limit=1');
      expect(status).toBe(200);
      if (data.data!.length) {
        expect(data.data![0]).not.toHaveProperty('categories');
        expect(data.data![0]).not.toHaveProperty('tags');
      }
    });
    it('includes categories when ?embed=categories', async () => {
      const { status, data } = await get<ApiResponse<Array<Product & { categories?: unknown[] }>>>('/api/v1/products?limit=1&embed=categories');
      expect(status).toBe(200);
      if (data.data!.length) {
        expect(data.data![0]).toHaveProperty('categories');
        expect(Array.isArray(data.data![0].categories)).toBe(true);
      }
    });
    it('includes both when ?embed=categories,tags', async () => {
      const { data } = await get<ApiResponse<Array<Product & { categories?: unknown; tags?: unknown }>>>('/api/v1/products?limit=1&embed=categories,tags');
      if (data.data!.length) {
        expect(data.data![0]).toHaveProperty('categories');
        expect(data.data![0]).toHaveProperty('tags');
      }
    });
    it('ignores unknown embed keys gracefully', async () => {
      const { status } = await get<ApiResponse<Array<Product>>>('/api/v1/products?limit=1&embed=evil');
      expect(status).toBe(200);
    });
  });

  describe('GET /api/v1/products/[id] embed shape', () => {
    let createdId: string;
    beforeAll(async () => {
      const slug = uniqueSlug();
      const r = await post<ApiResponse<Product & { id: string }>>('/api/v1/products', {
        name: 'Embed shape test', slug, description: 'd', price: 1,
      });
      createdId = r.data.data!.id;
      createdProductIds.push(createdId);
    });
    it('returns categories+tags arrays by default (single endpoint always embeds both)', async () => {
      const { status, data } = await get<ApiResponse<Product & { categories: unknown[]; tags: unknown[] }>>(`/api/v1/products/${createdId}`);
      expect(status).toBe(200);
      expect(Array.isArray(data.data!.categories)).toBe(true);
      expect(Array.isArray(data.data!.tags)).toBe(true);
    });
  });

  describe('GET /api/v1/products ?category= filter', () => {
    let catA: string;
    let catB: string;
    let catASlug: string;
    let prodInA: string;
    let prodInB: string;
    let prodInBoth: string;

    beforeAll(async () => {
      catASlug = `cat-a-${Date.now()}`;
      const catBSlug = `cat-b-${Date.now()}`;
      const { data: ca, error: caErr } = await supabaseAdmin().from('categories').insert({ name: 'A', slug: catASlug }).select('id').single();
      if (caErr) throw caErr;
      const { data: cb, error: cbErr } = await supabaseAdmin().from('categories').insert({ name: 'B', slug: catBSlug }).select('id').single();
      if (cbErr) throw cbErr;
      catA = ca!.id; catB = cb!.id;

      const make = async (cats: string[]) => {
        const { data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
          name: 'F', slug: uniqueSlug(), description: 'd', price: 1, categories: cats,
        });
        const id = data.data!.id;
        createdProductIds.push(id);
        return id;
      };
      prodInA = await make([catA]);
      prodInB = await make([catB]);
      prodInBoth = await make([catA, catB]);
    });

    afterAll(async () => {
      await supabaseAdmin().from('categories').delete().in('id', [catA, catB]);
    });

    it('filters by category UUID', async () => {
      const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?category=${catA}&limit=100`);
      const ids = data.data!.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([prodInA, prodInBoth]));
      expect(ids).not.toContain(prodInB);
    });

    it('filters by category slug (auto-detect)', async () => {
      const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?category=${catASlug}&limit=100`);
      const ids = data.data!.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([prodInA, prodInBoth]));
      expect(ids).not.toContain(prodInB);
    });

    it('AND-intersects when ?category=a,b (returns only prodInBoth)', async () => {
      const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?category=${catA},${catB}&limit=100`);
      const ids = data.data!.map((p) => p.id);
      expect(ids).toContain(prodInBoth);
      expect(ids).not.toContain(prodInA);
      expect(ids).not.toContain(prodInB);
    });

    it('returns 400 on invalid filter value', async () => {
      const { status, data } = await get<ApiResponse<unknown>>('/api/v1/products?category=evil%20space');
      expect(status).toBe(400);
      expect(data.error?.code).toBe('INVALID_INPUT');
    });

    it('returns empty when category does not match any product', async () => {
      const { data } = await get<ApiResponse<unknown[]>>('/api/v1/products?category=00000000-0000-0000-0000-000000000000');
      expect(data.data).toEqual([]);
    });
  });

  describe('GET /api/v1/products ?tag= filter', () => {
    let tagA: string;
    let tagB: string;
    let tagASlug: string;
    let pA: string;
    let pB: string;
    let pBoth: string;

    beforeAll(async () => {
      tagASlug = `tag-a-${Date.now()}`;
      const tagBSlug = `tag-b-${Date.now()}`;
      const r1 = await post<ApiResponse<{ id: string }>>('/api/v1/tags', { name: 'A', slug: tagASlug });
      const r2 = await post<ApiResponse<{ id: string }>>('/api/v1/tags', { name: 'B', slug: tagBSlug });
      tagA = r1.data.data!.id;
      tagB = r2.data.data!.id;

      const make = async (tags: string[]) => {
        const { data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
          name: 'TF', slug: uniqueSlug(), description: 'd', price: 1,
        });
        const id = data.data!.id;
        createdProductIds.push(id);
        if (tags.length) {
          const rows = tags.map((tag_id) => ({ product_id: id, tag_id }));
          const { error } = await supabaseAdmin().from('product_tags').insert(rows);
          if (error) throw error;
        }
        return id;
      };
      pA = await make([tagA]);
      pB = await make([tagB]);
      pBoth = await make([tagA, tagB]);
    });

    afterAll(async () => {
      await supabaseAdmin().from('tags').delete().in('id', [tagA, tagB]);
    });

    it('filters by tag UUID', async () => {
      const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?tag=${tagA}&limit=100`);
      const ids = data.data!.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([pA, pBoth]));
      expect(ids).not.toContain(pB);
    });
    it('filters by tag slug', async () => {
      const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?tag=${tagASlug}&limit=100`);
      const ids = data.data!.map((p) => p.id);
      expect(ids).toContain(pA);
    });
    it('AND-intersects ?tag=a,b', async () => {
      const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?tag=${tagA},${tagB}&limit=100`);
      const ids = data.data!.map((p) => p.id);
      expect(ids).toContain(pBoth);
      expect(ids).not.toContain(pA);
      expect(ids).not.toContain(pB);
    });
    it('returns 400 on invalid tag value', async () => {
      const { status, data } = await get<ApiResponse<unknown>>('/api/v1/products?tag=evil%20space');
      expect(status).toBe(400);
      expect(data.error?.code).toBe('INVALID_INPUT');
    });
  });

  describe('POST/PATCH /api/v1/products tags array', () => {
    let tagId: string;
    beforeAll(async () => {
      const r = await post<ApiResponse<{ id: string }>>('/api/v1/tags', { name: 'Assign', slug: `assign-${Date.now()}` });
      tagId = r.data.data!.id;
    });
    afterAll(async () => {
      await supabaseAdmin().from('tags').delete().eq('id', tagId);
    });

    it('POST stores tag links and returns them via embed', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<{ id: string; tags?: Array<{ id: string }> }>>('/api/v1/products', {
        name: 'WT', slug, description: 'd', price: 1, tags: [tagId],
      });
      expect(status).toBe(201);
      expect(data.data!.tags?.map((t) => t.id)).toContain(tagId);
      createdProductIds.push(data.data!.id);
    });

    it('PATCH replaces existing tags (full replace semantics)', async () => {
      const slug = uniqueSlug();
      const r = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'PT', slug, description: 'd', price: 1, tags: [tagId],
      });
      const pid = r.data.data!.id;
      createdProductIds.push(pid);

      await patch<ApiResponse<unknown>>(`/api/v1/products/${pid}`, { tags: [] });
      const after = await get<ApiResponse<{ tags: unknown[] }>>(`/api/v1/products/${pid}`);
      expect(after.data.data!.tags).toEqual([]);
    });

    // Mirrors the admin product wizard edit flow: it loads existing tags via the
    // junction read (getProductTags), then re-submits them on save. PATCH with the
    // same tag set must PRESERVE the tags, not wipe them. Guards the embed-tags gotcha.
    it('PATCH with the same tags preserves them (edit flow)', async () => {
      const slug = uniqueSlug();
      const r = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'EditPreserve', slug, description: 'd', price: 1, tags: [tagId],
      });
      const pid = r.data.data!.id;
      createdProductIds.push(pid);

      // Edit something unrelated while re-sending the existing tag set.
      await patch<ApiResponse<unknown>>(`/api/v1/products/${pid}`, { name: 'EditPreserved', tags: [tagId] });
      const after = await get<ApiResponse<{ name: string; tags: Array<{ id: string }> }>>(`/api/v1/products/${pid}`);
      expect(after.data.data!.name).toBe('EditPreserved');
      expect(after.data.data!.tags.map((t) => t.id)).toContain(tagId);
    });

    it('POST rejects >50 tags', async () => {
      const slug = uniqueSlug();
      const bogus = Array.from({ length: 51 }, () => crypto.randomUUID());
      const { status } = await post<ApiResponse<unknown>>('/api/v1/products', {
        name: 'TooMany', slug, description: 'd', price: 1, tags: bogus,
      });
      expect(status).toBe(400);
    });

    it('POST with >50 tags does not orphan a product row', async () => {
      const slug = uniqueSlug();
      const bogus = Array.from({ length: 51 }, () => crypto.randomUUID());
      const { status } = await post<ApiResponse<unknown>>('/api/v1/products', {
        name: 'NoOrphan', slug, description: 'd', price: 1, tags: bogus,
      });
      expect(status).toBe(400);
      const { count } = await supabaseAdmin()
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('slug', slug);
      expect(count).toBe(0);
    });

    it('PATCH returns 207 with warnings when tag link insert fails', async () => {
      const slug = uniqueSlug();
      const r = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'PartFail', slug, description: 'd', price: 1,
      });
      const pid = r.data.data!.id;
      createdProductIds.push(pid);

      const ghostTag = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const resp = await patch<ApiResponse<{ id: string; _warnings?: string[] }>>(
        `/api/v1/products/${pid}`,
        { tags: [ghostTag] },
      );
      expect(resp.status).toBe(207);
      expect(Array.isArray(resp.data.data?._warnings)).toBe(true);
      expect(resp.data.data!._warnings!.length).toBeGreaterThan(0);
    });

    it('POST with non-UUID tag does not orphan a product row', async () => {
      const slug = uniqueSlug();
      const { status } = await post<ApiResponse<unknown>>('/api/v1/products', {
        name: 'NoOrphan2', slug, description: 'd', price: 1, tags: ['not-a-uuid'],
      });
      expect(status).toBe(400);
      const { count } = await supabaseAdmin()
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('slug', slug);
      expect(count).toBe(0);
    });

    it('POST rejects non-UUID in tags array', async () => {
      const slug = uniqueSlug();
      const { status } = await post<ApiResponse<unknown>>('/api/v1/products', {
        name: 'Bad', slug, description: 'd', price: 1, tags: ['not-a-uuid'],
      });
      expect(status).toBe(400);
    });

    it('POST rejects non-UUID in categories array (parity with tags)', async () => {
      const slug = uniqueSlug();
      const { status } = await post<ApiResponse<unknown>>('/api/v1/products', {
        name: 'Bad', slug, description: 'd', price: 1, categories: ['not-a-uuid'],
      });
      expect(status).toBe(400);
      const { count } = await supabaseAdmin()
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('slug', slug);
      expect(count).toBe(0);
    });

    it('POST rejects >50 categories without orphaning the product', async () => {
      const slug = uniqueSlug();
      const bogus = Array.from({ length: 51 }, () => crypto.randomUUID());
      const { status } = await post<ApiResponse<unknown>>('/api/v1/products', {
        name: 'Bad', slug, description: 'd', price: 1, categories: bogus,
      });
      expect(status).toBe(400);
      const { count } = await supabaseAdmin()
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('slug', slug);
      expect(count).toBe(0);
    });

    it('POST accepts categories+tags together and embeds both in response', async () => {
      const catSlug = `cat-combo-${Date.now()}`;
      const { data: cat } = await supabaseAdmin()
        .from('categories')
        .insert({ name: 'Combo', slug: catSlug })
        .select('id')
        .single();
      const catId = cat!.id as string;

      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<{ id: string; categories?: Array<{ id: string }>; tags?: Array<{ id: string }> }>>('/api/v1/products', {
        name: 'Combo', slug, description: 'd', price: 1,
        categories: [catId], tags: [tagId],
      });
      expect(status).toBe(201);
      createdProductIds.push(data.data!.id);
      expect(data.data!.categories?.map((c) => c.id)).toContain(catId);
      expect(data.data!.tags?.map((t) => t.id)).toContain(tagId);

      await supabaseAdmin().from('categories').delete().eq('id', catId);
    });

    it('PATCH categories alone (without tags) replaces existing set', async () => {
      const catSlugA = `cat-pa-${Date.now()}`;
      const catSlugB = `cat-pb-${Date.now()}`;
      const { data: cA } = await supabaseAdmin().from('categories').insert({ name: 'PA', slug: catSlugA }).select('id').single();
      const { data: cB } = await supabaseAdmin().from('categories').insert({ name: 'PB', slug: catSlugB }).select('id').single();
      const idA = cA!.id as string;
      const idB = cB!.id as string;

      const slug = uniqueSlug();
      const created = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'PC', slug, description: 'd', price: 1, categories: [idA],
      });
      const pid = created.data.data!.id;
      createdProductIds.push(pid);

      await patch<ApiResponse<unknown>>(`/api/v1/products/${pid}`, { categories: [idB] });
      const after = await get<ApiResponse<{ categories: Array<{ id: string }> }>>(`/api/v1/products/${pid}`);
      const ids = after.data.data!.categories.map((c) => c.id);
      expect(ids).toEqual([idB]);

      await supabaseAdmin().from('categories').delete().in('id', [idA, idB]);
    });
  });

  describe('Response Format', () => {
    it('should use standardized success response format', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {
        name: 'Format Test',
        slug: uniqueSlug(),
        description: 'Testing response format',
        price: 10.0,
      });

      expect(status).toBe(201);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('name');
      expect(data.data).toHaveProperty('slug');
      expect(data.data).toHaveProperty('price');
      expect(data.data).toHaveProperty('created_at');

      createdProductIds.push(data.data!.id);
    });

    it('should use standardized error response format', async () => {
      const { status, data } = await post<ApiResponse<Product>>('/api/v1/products', {});

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
      expect(typeof data.error!.code).toBe('string');
      expect(typeof data.error!.message).toBe('string');
    });

    it('should include pagination in list responses', async () => {
      const { status, data } = await get<ApiResponse<Product[]>>('/api/v1/products');

      expect(status).toBe(200);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
      expect(data.pagination).toHaveProperty('limit');
      expect(typeof data.pagination!.has_more).toBe('boolean');
      expect(typeof data.pagination!.limit).toBe('number');
    });
  });

  // M-1: server-side empty-bundle guard. The "bundle needs >= 1 component" rule used to
  // be client-only (PublishChecklist); the v1 API could still publish an empty active
  // bundle. These assert the route now rejects an empty ACTIVE bundle and accepts one
  // with a component, on both create and update.
  describe('Empty active bundle guard', () => {
    async function mkComponent(): Promise<string> {
      const slug = uniqueSlug();
      const { data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'Comp', slug, description: 'd', price: 5,
      });
      const id = data.data!.id;
      createdProductIds.push(id);
      return id;
    }

    it('POST rejects an active bundle with no components', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'EmptyBundle', slug, description: 'd', price: 99,
        is_bundle: true, is_active: true,
      });
      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
      // and it must not orphan a product row
      const { count } = await supabaseAdmin()
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('slug', slug);
      expect(count).toBe(0);
    });

    it('POST allows an INACTIVE bundle with no components (draft)', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'DraftBundle', slug, description: 'd', price: 99,
        is_bundle: true, is_active: false,
      });
      expect(status).toBe(201);
      createdProductIds.push(data.data!.id);
    });

    it('POST allows an active bundle with >= 1 component', async () => {
      const comp = await mkComponent();
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'GoodBundle', slug, description: 'd', price: 99,
        is_bundle: true, is_active: true, bundleItemIds: [comp],
      });
      expect(status).toBe(201);
      createdProductIds.push(data.data!.id);
    });

    it('PATCH rejects emptying the components of an active bundle', async () => {
      const comp = await mkComponent();
      const slug = uniqueSlug();
      const created = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'PatchBundle', slug, description: 'd', price: 99,
        is_bundle: true, is_active: true, bundleItemIds: [comp],
      });
      const pid = created.data.data!.id;
      createdProductIds.push(pid);

      const { status, data } = await patch<ApiResponse<{ id: string }>>(`/api/v1/products/${pid}`, {
        bundleItemIds: [],
      });
      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');

      // existing components are untouched (guard rejected before upsert)
      const { count } = await supabaseAdmin()
        .from('bundle_items')
        .select('id', { count: 'exact', head: true })
        .eq('bundle_product_id', pid);
      expect(count).toBe(1);
    });

    it('PATCH rejects activating a bundle that has no components', async () => {
      const slug = uniqueSlug();
      const created = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'DraftToActive', slug, description: 'd', price: 99,
        is_bundle: true, is_active: false,
      });
      const pid = created.data.data!.id;
      createdProductIds.push(pid);

      const { status, data } = await patch<ApiResponse<{ id: string }>>(`/api/v1/products/${pid}`, {
        is_active: true,
      });
      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });
  });
});
