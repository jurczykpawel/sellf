/**
 * Users Toolset
 *
 * MCP tools for managing Sellf users and their product access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient, PaginatedResponse } from '../api-client.js';

interface ProductAccess {
  id: string;
  product_id: string;
  product_slug: string;
  product_name: string;
  product_price: number;
  product_currency: string;
  product_icon: string;
  product_is_active: boolean;
  granted_at: string;
  expires_at: string | null;
  duration_days: number | null;
}

interface User {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  product_access: ProductAccess[];
  stats: {
    total_products: number;
    total_value: number;
    last_access_granted_at: string | null;
    first_access_granted_at: string | null;
  };
}

export function registerUsersTools(server: McpServer): void {
  // List users
  server.tool(
    'list_users',
    'List all users with their product access and statistics',
    {
      search: z.string().optional().describe('Search by email'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().min(1).max(100).optional().describe('Items per page (max 100)'),
      sort_by: z.enum(['created_at', 'email', 'last_sign_in_at', 'total_products', 'total_value']).optional().describe('Sort field'),
      sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
    },
    async ({ search, cursor, limit, sort_by, sort_order }) => {
      const api = getApiClient();
      const result = await api.get<{ data: PaginatedResponse<User> }>('/api/v1/users', {
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

  // Get single user
  server.tool(
    'get_user',
    'Get detailed information about a single user including all product access',
    {
      id: z.string().uuid().describe('User ID'),
    },
    async ({ id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: User }>(`/api/v1/users/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Search users by email
  server.tool(
    'search_users',
    'Search for users by email address',
    {
      email: z.string().min(1).describe('Email address or partial match to search for'),
    },
    async ({ email }) => {
      const api = getApiClient();
      const result = await api.get<{ data: PaginatedResponse<User> }>('/api/v1/users', {
        search: email,
        limit: 20,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Grant access
  server.tool(
    'grant_access',
    'Grant a user access to a product',
    {
      user_id: z.string().uuid().describe('User ID'),
      product_id: z.string().uuid().describe('Product ID to grant access to'),
      access_duration_days: z.number().min(1).max(3650).optional().describe('Duration in days (1-3650)'),
      access_expires_at: z.string().optional().describe('Specific expiration date (ISO 8601)'),
    },
    async ({ user_id, product_id, access_duration_days, access_expires_at }) => {
      const api = getApiClient();
      const result = await api.post<{ data: ProductAccess }>(`/api/v1/users/${user_id}/access`, {
        product_id,
        access_duration_days,
        access_expires_at,
      });

      return {
        content: [{ type: 'text', text: `Access granted successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Revoke access
  server.tool(
    'revoke_access',
    'Revoke a user\'s access to a product',
    {
      user_id: z.string().uuid().describe('User ID'),
      access_id: z.string().uuid().describe('Access entry ID to revoke'),
    },
    async ({ user_id, access_id }) => {
      const api = getApiClient();
      await api.delete(`/api/v1/users/${user_id}/access/${access_id}`);

      return {
        content: [{ type: 'text', text: `Access ${access_id} revoked successfully` }],
      };
    }
  );

  // Extend access
  server.tool(
    'extend_access',
    'Extend or modify a user\'s product access expiration',
    {
      user_id: z.string().uuid().describe('User ID'),
      access_id: z.string().uuid().describe('Access entry ID'),
      extend_days: z.number().min(1).max(3650).optional().describe('Days to add to current expiration'),
      access_expires_at: z.string().optional().describe('Set specific expiration date (ISO 8601)'),
      access_duration_days: z.number().min(1).max(3650).optional().describe('Set duration from now'),
    },
    async ({ user_id, access_id, extend_days, access_expires_at, access_duration_days }) => {
      const api = getApiClient();
      const result = await api.patch<{ data: ProductAccess }>(`/api/v1/users/${user_id}/access/${access_id}`, {
        extend_days,
        access_expires_at,
        access_duration_days,
      });

      return {
        content: [{ type: 'text', text: `Access extended successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Bulk grant access
  server.tool(
    'bulk_grant_access',
    'Grant multiple users access to a product',
    {
      user_ids: z.array(z.string().uuid()).min(1).max(100).describe('Array of user IDs'),
      product_id: z.string().uuid().describe('Product ID to grant access to'),
      access_duration_days: z.number().min(1).max(3650).optional().describe('Duration in days'),
    },
    async ({ user_ids, product_id, access_duration_days }) => {
      const api = getApiClient();
      const results: { user_id: string; success: boolean; error?: string }[] = [];

      for (const user_id of user_ids) {
        try {
          await api.post(`/api/v1/users/${user_id}/access`, {
            product_id,
            access_duration_days,
          });
          results.push({ user_id, success: true });
        } catch (error) {
          results.push({
            user_id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return {
        content: [
          {
            type: 'text',
            text: `Bulk grant complete: ${successful} succeeded, ${failed} failed\n\nDetails:\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      };
    }
  );

  // Get user purchases (via payments endpoint)
  server.tool(
    'get_user_purchases',
    'Get all purchases/payments made by a user',
    {
      email: z.string().email().describe('User email address'),
    },
    async ({ email }) => {
      const api = getApiClient();
      const result = await api.get<{
        data: PaginatedResponse<{
          id: string;
          product_id: string;
          product_name: string;
          amount_total: number;
          currency: string;
          status: string;
          created_at: string;
        }>;
      }>('/api/v1/payments', {
        email,
        limit: 100,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );
}
