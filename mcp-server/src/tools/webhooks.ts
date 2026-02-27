/**
 * Webhooks Toolset
 *
 * MCP tools for managing Sellf webhook endpoints.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient } from '../api-client.js';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface WebhookLog {
  id: string;
  webhook_id: string;
  event_type: string;
  request_body: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  created_at: string;
}

// Valid webhook event types
const WEBHOOK_EVENTS = [
  'payment.completed',
  'payment.failed',
  'payment.refunded',
  'access.granted',
  'access.revoked',
  'access.expired',
  'user.created',
  'coupon.used',
] as const;

export function registerWebhooksTools(server: McpServer): void {
  // List webhooks
  server.tool(
    'list_webhooks',
    'List all webhook endpoints with their configuration',
    {
      status: z.enum(['all', 'active', 'inactive']).optional().describe('Filter by status'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().min(1).max(100).optional().describe('Items per page'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.get<{ data: Webhook[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        '/api/v1/webhooks',
        params
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Create webhook
  server.tool(
    'create_webhook',
    'Create a new webhook endpoint to receive event notifications',
    {
      url: z.string().url().describe('Webhook URL (must be HTTPS)'),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).describe('List of event types to subscribe to'),
      description: z.string().optional().describe('Description of the webhook'),
      is_active: z.boolean().optional().describe('Whether the webhook is active'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.post<{ data: Webhook }>('/api/v1/webhooks', params);

      return {
        content: [{ type: 'text', text: `Webhook created successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Update webhook
  server.tool(
    'update_webhook',
    'Update an existing webhook endpoint configuration',
    {
      id: z.string().uuid().describe('Webhook ID to update'),
      url: z.string().url().optional().describe('New webhook URL'),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional().describe('Updated event types'),
      description: z.string().optional().describe('Updated description'),
      is_active: z.boolean().optional().describe('Whether the webhook is active'),
    },
    async ({ id, ...updates }) => {
      const api = getApiClient();
      const result = await api.patch<{ data: Webhook }>(`/api/v1/webhooks/${id}`, updates);

      return {
        content: [{ type: 'text', text: `Webhook updated successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Delete webhook
  server.tool(
    'delete_webhook',
    'Delete a webhook endpoint permanently',
    {
      id: z.string().uuid().describe('Webhook ID to delete'),
    },
    async ({ id }) => {
      const api = getApiClient();
      await api.delete(`/api/v1/webhooks/${id}`);

      return {
        content: [{ type: 'text', text: `Webhook ${id} deleted successfully` }],
      };
    }
  );

  // Get webhook logs
  server.tool(
    'get_webhook_logs',
    'Get delivery logs for webhook endpoints to troubleshoot issues',
    {
      webhook_id: z.string().uuid().optional().describe('Filter by specific webhook ID'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().min(1).max(100).optional().describe('Items per page'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.get<{ data: WebhookLog[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        '/api/v1/webhooks/logs',
        params
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
