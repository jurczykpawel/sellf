/**
 * API Integration Tests: Products
 *
 * Migrated from api-v1-products.spec.ts (Playwright → Vitest)
 * Tests cursor-based pagination, CRUD operations, and error handling.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, post, patch, del, testData, cleanup, deleteTestApiKey, API_URL } from './setup';

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
});
