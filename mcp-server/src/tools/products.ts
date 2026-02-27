/**
 * Products Toolset
 *
 * MCP tools for managing Sellf products.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient, PaginatedResponse } from '../api-client.js';

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
    'List all products with optional filters and pagination',
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
      const result = await api.get<{ data: PaginatedResponse<Product> }>('/api/v1/products', {
        status,
        search,
        cursor,
        limit,
        sort_by,
        sort_order,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Get single product
  server.tool(
    'get_product',
    'Get a single product by ID with full details including categories',
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
    'Create a new product',
    {
      name: z.string().min(1).max(100).describe('Product name'),
      slug: z.string().min(1).max(100).describe('URL-friendly slug'),
      description: z.string().min(1).describe('Product description'),
      price: z.number().min(0).describe('Price in smallest currency unit (e.g., cents)'),
      currency: z.string().length(3).optional().describe('ISO 4217 currency code (default: USD)'),
      is_active: z.boolean().optional().describe('Whether product is available for purchase'),
      is_featured: z.boolean().optional().describe('Whether product is featured'),
      icon: z.string().optional().describe('Emoji icon for the product'),
      content_delivery_type: z.enum(['content', 'redirect', 'download']).optional().describe('How content is delivered'),
      content_config: z.record(z.unknown()).optional().describe('Content delivery configuration'),
      available_from: z.string().optional().describe('ISO 8601 date when product becomes available'),
      available_until: z.string().optional().describe('ISO 8601 date when product is no longer available'),
      auto_grant_duration_days: z.number().optional().describe('Days of access granted on purchase'),
      categories: z.array(z.string()).optional().describe('Array of category IDs'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.post<{ data: Product }>('/api/v1/products', params);

      return {
        content: [{ type: 'text', text: `Product created successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Update product
  server.tool(
    'update_product',
    'Update an existing product. Only provided fields will be updated.',
    {
      id: z.string().uuid().describe('Product ID to update'),
      name: z.string().min(1).max(100).optional().describe('Product name'),
      slug: z.string().min(1).max(100).optional().describe('URL-friendly slug'),
      description: z.string().min(1).optional().describe('Product description'),
      price: z.number().min(0).optional().describe('Price in smallest currency unit'),
      currency: z.string().length(3).optional().describe('ISO 4217 currency code'),
      is_active: z.boolean().optional().describe('Whether product is available for purchase'),
      is_featured: z.boolean().optional().describe('Whether product is featured'),
      icon: z.string().optional().describe('Emoji icon'),
      content_delivery_type: z.enum(['content', 'redirect', 'download']).optional().describe('How content is delivered'),
      content_config: z.record(z.unknown()).optional().describe('Content delivery configuration'),
      available_from: z.string().optional().describe('ISO 8601 date when product becomes available'),
      available_until: z.string().optional().describe('ISO 8601 date when product is no longer available'),
      auto_grant_duration_days: z.number().optional().describe('Days of access granted on purchase'),
      categories: z.array(z.string()).optional().describe('Array of category IDs (replaces existing)'),
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
    'Create a copy of an existing product with a new name and slug',
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
    'Get sales statistics for a specific product',
    {
      product_id: z.string().uuid().describe('Product ID'),
    },
    async ({ product_id }) => {
      const api = getApiClient();

      // Fetch product details
      const productResult = await api.get<{ data: Product }>(`/api/v1/products/${product_id}`);

      // Fetch payments for this product
      const paymentsResult = await api.get<{ data: PaginatedResponse<{ status: string; amount_total: number }> }>(
        '/api/v1/payments',
        { product_id, limit: 100 }
      );

      const payments = paymentsResult.data.items;
      const successfulPayments = payments.filter((p) => p.status === 'succeeded');
      const totalRevenue = successfulPayments.reduce((sum, p) => sum + p.amount_total, 0);

      const stats = {
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
          currency: productResult.data.currency,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }
  );
}
