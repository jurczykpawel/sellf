/**
 * Products Toolset
 *
 * MCP tools for managing Sellf products.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient } from '../api-client.js';
import { productCreateShape, productUpdateShape } from './product-schema.js';

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  is_active: boolean;
  is_featured: boolean;
  icon: string;
  content_delivery_type: string;
  content_config: Record<string, unknown> | null;
  available_from: string | null;
  available_until: string | null;
  auto_grant_duration_days: number | null;
  created_at: string;
  updated_at: string;
  categories?: Array<{ id: string; name: string; slug: string }>;
}

export function registerProductsTools(server: McpServer): void {
  // List products
  server.tool(
    'list_products',
    'List all products with optional filters and pagination. Returns price, sale_price, recurring_price, custom_price_min, and custom_price_presets in major units: 49.99 means 49.99 in the product currency.',
    {
      status: z.enum(['active', 'inactive', 'all']).optional().describe('Filter by status'),
      search: z.string().optional().describe('Search in name and description'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().min(1).max(100).optional().describe('Items per page (max 100)'),
      sort_by: z.enum(['created_at', 'name', 'price', 'updated_at']).optional().describe('Sort field'),
      sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
    },
    async ({ status, search, cursor, limit, sort_by, sort_order }) => {
      const api = getApiClient();
      const result = await api.get<{ data: Product[]; pagination: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number; total?: number } }>('/api/v1/products', {
        status,
        search,
        cursor,
        limit,
        sort_by,
        sort_order,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get single product
  server.tool(
    'get_product',
    'Get a single product by ID with full details including categories. Returns price, sale_price, recurring_price, custom_price_min, and custom_price_presets in major units: 49.99 means 49.99 in the product currency.',
    {
      id: z.string().uuid().describe('Product ID'),
    },
    async ({ id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: Product }>(`/api/v1/products/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Create product
  server.tool(
    'create_product',
    'Create a new product. Defaults to a draft until explicitly published using update_product with is_active: true. Returns price, sale_price, recurring_price, custom_price_min, and custom_price_presets in major units: 49.99 means 49.99 in the product currency.',
    {
      ...productCreateShape,
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.post<{ data: Product }>('/api/v1/products', { ...params, is_active: params.is_active ?? false });

      return {
        content: [{ type: 'text', text: `Product created successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Update product
  server.tool(
    'update_product',
    'Update an existing product. Only provided fields will be updated. Returns price, sale_price, recurring_price, custom_price_min, and custom_price_presets in major units: 49.99 means 49.99 in the product currency.',
    {
      id: z.string().uuid().describe('Product ID to update'),
      ...productUpdateShape,
    },
    async ({ id, ...updates }) => {
      const api = getApiClient();
      const result = await api.patch<{ data: Product }>(`/api/v1/products/${id}`, updates);

      return {
        content: [{ type: 'text', text: `Product updated successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Delete product
  server.tool(
    'delete_product',
    'Delete a product. Products with existing user access or payments cannot be deleted.',
    {
      id: z.string().uuid().describe('Product ID to delete'),
    },
    async ({ id }) => {
      const api = getApiClient();
      await api.delete(`/api/v1/products/${id}`);

      return {
        content: [{ type: 'text', text: `Product ${id} deleted successfully` }],
      };
    }
  );

  // Toggle product status
  server.tool(
    'toggle_product_status',
    'Activate or deactivate a product',
    {
      id: z.string().uuid().describe('Product ID'),
      is_active: z.boolean().describe('Whether product should be active'),
    },
    async ({ id, is_active }) => {
      const api = getApiClient();
      const result = await api.patch<{ data: Product }>(`/api/v1/products/${id}`, { is_active });

      const status = result.data.is_active ? 'activated' : 'deactivated';
      return {
        content: [{ type: 'text', text: `Product ${result.data.name} ${status} successfully` }],
      };
    }
  );

  // Duplicate product
  server.tool(
    'duplicate_product',
    'Create a copy of an existing product with a new name and slug. Returns price, sale_price, recurring_price, custom_price_min, and custom_price_presets in major units: 49.99 means 49.99 in the product currency.',
    {
      source_id: z.string().uuid().describe('ID of product to duplicate'),
      new_name: z.string().min(1).max(100).describe('Name for the new product'),
      new_slug: z.string().min(1).max(100).describe('Slug for the new product'),
    },
    async ({ source_id, new_name, new_slug }) => {
      const api = getApiClient();

      // Fetch source product
      const sourceResult = await api.get<{ data: Product }>(`/api/v1/products/${source_id}`);
      const source = sourceResult.data;

      // Create new product with source data
      const newProductData = {
        name: new_name,
        slug: new_slug,
        description: source.description,
        price: source.price,
        currency: source.currency,
        is_active: false, // New products start inactive
        is_featured: false,
        icon: source.icon,
        content_delivery_type: source.content_delivery_type,
        content_config: source.content_config,
        available_from: source.available_from,
        available_until: source.available_until,
        auto_grant_duration_days: source.auto_grant_duration_days,
        categories: source.categories?.map((c) => c.id),
      };

      const result = await api.post<{ data: Product }>('/api/v1/products', newProductData);

      return {
        content: [{ type: 'text', text: `Product duplicated successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Get product stats (uses analytics endpoint)
  server.tool(
    'get_product_stats',
    'Get sales statistics from a sample of at most the first 100 payments for a product. Returns product.price in major units (49.99 means 49.99 in the product currency), sales.total_revenue and sales.by_currency in minor units (4999 means 49.99 for PLN/USD). The aggregate can mix currencies; use by_currency.',
    {
      product_id: z.string().uuid().describe('Product ID'),
    },
    async ({ product_id }) => {
      const api = getApiClient();

      // Fetch product details
      const productResult = await api.get<{ data: Product }>(`/api/v1/products/${product_id}`);

      // Fetch payments for this product
      const paymentsResult = await api.get<{ data: { status: string; amount: number; currency?: string }[]; pagination?: { has_more: boolean; next_cursor: string | null } }>(
        '/api/v1/payments',
        { product_id, limit: 100 }
      );

      const payments = paymentsResult.data;
      const successfulPayments = payments.filter((p) => p.status === 'completed');
      const totalRevenue = successfulPayments.reduce((sum, p) => sum + p.amount, 0);

      const byCurrency: Record<string, number> = {};
      for (const payment of successfulPayments) {
        const currency = (payment.currency || productResult.data.currency).toUpperCase();
        byCurrency[currency] = (byCurrency[currency] || 0) + payment.amount;
      }
      const stats = {
        sample: {
          limit: 100,
          returned: payments.length,
          has_more: paymentsResult.pagination?.has_more ?? false,
          next_cursor: paymentsResult.pagination?.next_cursor ?? null,
        },
        product: {
          id: productResult.data.id,
          name: productResult.data.name,
          price: productResult.data.price,
          currency: productResult.data.currency,
          is_active: productResult.data.is_active,
        },
        sales: {
          total_transactions: successfulPayments.length,
          total_revenue: totalRevenue,
          by_currency: byCurrency,
          amount_unit: 'minor',
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }
  );
}
