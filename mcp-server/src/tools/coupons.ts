/**
 * Coupons Toolset
 *
 * MCP tools for managing Sellf discount coupons.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient } from '../api-client.js';

interface Coupon {
  id: string;
  code: string;
  name: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  currency: string | null;
  is_active: boolean;
  is_public: boolean;
  starts_at: string;
  expires_at: string | null;
  usage_limit_global: number | null;
  usage_limit_per_user: number;
  current_usage_count: number;
  allowed_emails: string[];
  allowed_product_ids: string[];
  exclude_order_bumps: boolean;
  is_oto_coupon: boolean;
  created_at: string;
  updated_at: string;
}

export function registerCouponsTools(server: McpServer): void {
  // List coupons
  server.tool(
    'list_coupons',
    'List all discount coupons with optional filters',
    {
      status: z.enum(['all', 'active', 'inactive', 'expired']).optional().describe('Filter by status'),
      search: z.string().optional().describe('Search in code and name'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().min(1).max(100).optional().describe('Items per page (max 100)'),
      sort: z.string().optional().describe('Sort field with optional - prefix for desc'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.get<{ data: Coupon[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        '/api/v1/coupons',
        params
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get single coupon
  server.tool(
    'get_coupon',
    'Get detailed information about a specific coupon',
    {
      id: z.string().uuid().describe('Coupon ID'),
    },
    async ({ id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: Coupon }>(`/api/v1/coupons/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Create coupon
  server.tool(
    'create_coupon',
    'Create a new discount coupon',
    {
      code: z.string().min(1).max(50).describe('Unique coupon code (alphanumeric, hyphens, underscores)'),
      name: z.string().optional().describe('Display name'),
      discount_type: z.enum(['percentage', 'fixed']).describe('Type of discount'),
      discount_value: z.number().positive().describe('Percentage (0-100) or fixed amount in cents'),
      currency: z.string().length(3).optional().describe('Currency for fixed discounts (required for fixed type)'),
      is_active: z.boolean().optional().describe('Whether coupon is active'),
      is_public: z.boolean().optional().describe('Whether coupon shows in auto-apply'),
      starts_at: z.string().optional().describe('Start date (ISO 8601)'),
      expires_at: z.string().optional().describe('Expiration date (ISO 8601)'),
      usage_limit_global: z.number().int().positive().optional().describe('Maximum total uses'),
      usage_limit_per_user: z.number().int().positive().optional().describe('Maximum uses per email'),
      allowed_emails: z.array(z.string().email()).optional().describe('Restrict to specific emails'),
      allowed_product_ids: z.array(z.string().uuid()).optional().describe('Restrict to specific products'),
      exclude_order_bumps: z.boolean().optional().describe('Exclude from order bump products'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.post<{ data: Coupon }>('/api/v1/coupons', params);

      return {
        content: [{ type: 'text', text: `Coupon created successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Update coupon
  server.tool(
    'update_coupon',
    'Update an existing coupon. Only provided fields will be updated.',
    {
      id: z.string().uuid().describe('Coupon ID to update'),
      name: z.string().optional().describe('Display name'),
      discount_type: z.enum(['percentage', 'fixed']).optional().describe('Type of discount'),
      discount_value: z.number().positive().optional().describe('Discount value'),
      currency: z.string().length(3).optional().describe('Currency for fixed discounts'),
      is_active: z.boolean().optional().describe('Whether coupon is active'),
      is_public: z.boolean().optional().describe('Whether coupon shows in auto-apply'),
      expires_at: z.string().optional().describe('Expiration date (ISO 8601)'),
      usage_limit_global: z.number().int().positive().optional().describe('Maximum total uses'),
      usage_limit_per_user: z.number().int().positive().optional().describe('Maximum uses per email'),
      allowed_emails: z.array(z.string().email()).optional().describe('Restrict to specific emails'),
      allowed_product_ids: z.array(z.string().uuid()).optional().describe('Restrict to specific products'),
      exclude_order_bumps: z.boolean().optional().describe('Exclude from order bump products'),
    },
    async ({ id, ...updates }) => {
      const api = getApiClient();
      const result = await api.patch<{ data: Coupon }>(`/api/v1/coupons/${id}`, updates);

      return {
        content: [{ type: 'text', text: `Coupon updated successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Delete coupon
  server.tool(
    'delete_coupon',
    'Delete a coupon permanently',
    {
      id: z.string().uuid().describe('Coupon ID to delete'),
    },
    async ({ id }) => {
      const api = getApiClient();
      await api.delete(`/api/v1/coupons/${id}`);

      return {
        content: [{ type: 'text', text: `Coupon ${id} deleted successfully` }],
      };
    }
  );

  // Get coupon stats
  server.tool(
    'get_coupon_stats',
    'Get usage statistics for a specific coupon',
    {
      id: z.string().uuid().describe('Coupon ID'),
    },
    async ({ id }) => {
      const api = getApiClient();
      const result = await api.get<{
        data: {
          id: string;
          code: string;
          total_uses: number;
          total_discount_given: number;
          usage_by_product: Array<{ product_id: string; product_name: string; uses: number }>;
        };
      }>(`/api/v1/coupons/${id}/stats`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Deactivate coupon
  server.tool(
    'deactivate_coupon',
    'Quickly deactivate a coupon (set is_active to false)',
    {
      id: z.string().uuid().describe('Coupon ID to deactivate'),
    },
    async ({ id }) => {
      const api = getApiClient();
      const result = await api.patch<{ data: Coupon }>(`/api/v1/coupons/${id}`, { is_active: false });

      return {
        content: [{ type: 'text', text: `Coupon ${result.data.code} deactivated successfully` }],
      };
    }
  );
}
