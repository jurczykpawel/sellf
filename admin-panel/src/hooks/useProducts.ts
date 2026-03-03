/**
 * Products Hook for v1 API
 *
 * Provides a consistent interface for products operations,
 * translating between the v1 API cursor pagination and the
 * frontend's offset-based pagination UI.
 */

import { useState, useCallback, useRef } from 'react';
import { Product } from '@/types';
import { api, ApiError } from '@/lib/api/client';

interface UseProductsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'all' | 'active' | 'inactive';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface UseProductsResult {
  products: Product[];
  loading: boolean;
  error: string | null;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasMore: boolean;
  };
  fetchProducts: () => Promise<void>;
  createProduct: (data: ProductCreateData) => Promise<Product>;
  updateProduct: (id: string, data: ProductUpdateData) => Promise<Product>;
  deleteProduct: (id: string) => Promise<void>;
  toggleStatus: (id: string, currentStatus: boolean) => Promise<void>;
  toggleFeatured: (id: string, currentFeatured: boolean) => Promise<void>;
  toggleListed: (id: string, currentListed: boolean) => Promise<void>;
}

interface ProductCreateData {
  name: string;
  slug?: string;
  description?: string;
  price: number;
  currency?: string;
  is_active?: boolean;
  is_featured?: boolean;
  is_listed?: boolean;
  icon?: string | null;
  content_delivery_type?: string;
  content_config?: Record<string, unknown>;
  email_config?: Record<string, unknown>;
  access_duration_type?: string;
  access_duration_days?: number | null;
  // OTO fields
  oto_enabled?: boolean;
  oto_product_id?: string | null;
  oto_discount_type?: string | null;
  oto_discount_value?: number | null;
  oto_duration_minutes?: number | null;
}

interface ProductUpdateData extends Partial<ProductCreateData> {}

/**
 * Hook for products CRUD operations using v1 API
 */
export function useProducts(params: UseProductsParams = {}): UseProductsResult {
  const {
    page = 1,
    limit = 10,
    search = '',
    status = 'all',
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    hasMore: false,
  });

  // Maps page number → cursor to use when fetching that page.
  // Page 1 always uses no cursor (null). Populated as pages are visited.
  const cursorMapRef = useRef<Map<number, string | null>>(new Map([[1, null]]));
  // Detects filter changes so the cursor map can be reset.
  const prevFilterKeyRef = useRef<string>('');

  /**
   * Fetch products from v1 API with cursor-based pagination.
   *
   * Translates the offset-based page param into the correct cursor by
   * tracking next_cursor values as pages are visited sequentially.
   */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Reset cursor map when filters change so stale cursors aren't reused.
      const filterKey = `${search}|${status}|${sortBy}|${sortOrder}|${limit}`;
      if (filterKey !== prevFilterKeyRef.current) {
        cursorMapRef.current = new Map([[1, null]]);
        prevFilterKeyRef.current = filterKey;
      }

      const cursor = cursorMapRef.current.get(page) ?? null;

      const response = await api.list<Product>('products', {
        limit: limit + 1,
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        sort_by: sortBy,
        sort_order: sortOrder,
        cursor: cursor || undefined,
      });

      const allProducts = response.data;
      const hasMore = allProducts.length > limit;
      const pageProducts = allProducts.slice(0, limit);

      // Store cursor for the next page so forward navigation works.
      const nextCursor = response.pagination?.next_cursor;
      if (nextCursor) {
        cursorMapRef.current.set(page + 1, nextCursor);
      }

      const total = response.pagination?.total;
      const totalPages = total
        ? Math.ceil(total / limit)
        : hasMore ? page + 1 : page;

      setProducts(pageProducts);
      setPagination({
        currentPage: page,
        totalPages,
        totalItems: total ?? 0,
        hasMore,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load products. Please try again later.');
      }
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, status, sortBy, sortOrder]);

  /**
   * Create a new product
   */
  const createProduct = useCallback(async (data: ProductCreateData): Promise<Product> => {
    // Extract OTO fields - they're handled separately
    const { oto_enabled, oto_product_id, oto_discount_type, oto_discount_value, oto_duration_minutes, ...productData } = data;

    // Create the product
    const product = await api.create<Product>('products', productData);

    // If OTO is enabled, save OTO configuration using v1 API
    if (oto_enabled && oto_product_id && product.id) {
      try {
        await api.putCustom(`products/${product.id}/oto`, {
          oto_product_id,
          discount_type: oto_discount_type || 'percentage',
          discount_value: oto_discount_value || 20,
          duration_minutes: oto_duration_minutes || 15,
        });
      } catch (otoErr) {
        console.error('Failed to save OTO configuration:', otoErr);
        // Don't throw - product was created successfully
      }
    }

    return product;
  }, []);

  /**
   * Update an existing product
   */
  const updateProduct = useCallback(async (id: string, data: ProductUpdateData): Promise<Product> => {
    // Extract OTO fields - they're handled separately
    const { oto_enabled, oto_product_id, oto_discount_type, oto_discount_value, oto_duration_minutes, ...productData } = data;

    // Update the product
    const product = await api.update<Product>('products', id, productData);

    // Save OTO configuration using v1 API (create/update/delete)
    try {
      if (oto_enabled && oto_product_id) {
        // Create or update OTO
        await api.putCustom(`products/${id}/oto`, {
          oto_product_id,
          discount_type: oto_discount_type || 'percentage',
          discount_value: oto_discount_value || 20,
          duration_minutes: oto_duration_minutes || 15,
        });
      } else {
        // Delete OTO configuration
        await api.deleteCustom(`products/${id}/oto`);
      }
    } catch (otoErr) {
      console.error('Failed to save OTO configuration:', otoErr);
      // Don't throw - product was updated successfully
    }

    return product;
  }, []);

  /**
   * Delete a product
   */
  const deleteProduct = useCallback(async (id: string): Promise<void> => {
    await api.delete('products', id);
  }, []);

  /**
   * Toggle product active status
   */
  const toggleStatus = useCallback(async (id: string, currentStatus: boolean): Promise<void> => {
    await api.update<Product>('products', id, { is_active: !currentStatus });
  }, []);

  /**
   * Toggle product featured status
   */
  const toggleFeatured = useCallback(async (id: string, currentFeatured: boolean): Promise<void> => {
    await api.update<Product>('products', id, { is_featured: !currentFeatured });
  }, []);

  /**
   * Toggle product listed status (visible on store page)
   */
  const toggleListed = useCallback(async (id: string, currentListed: boolean): Promise<void> => {
    await api.update<Product>('products', id, { is_listed: !currentListed });
  }, []);

  return {
    products,
    loading,
    error,
    pagination,
    fetchProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    toggleStatus,
    toggleFeatured,
    toggleListed,
  };
}

/**
 * Hook for fetching products dropdown (simple list for selects)
 */
export function useProductsDropdown(status: 'all' | 'active' = 'active') {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.list<Product>('products', {
        limit: 1000, // Get all products for dropdown
        status: status === 'all' ? undefined : status,
        sort_by: 'name',
        sort_order: 'asc',
      });

      setProducts(response.data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load products');
      }
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  return { products, loading, error, fetchProducts };
}
