/**
 * Payments Toolset
 *
 * MCP tools for managing Sellf payments and transactions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getApiClient } from '../api-client.js';

interface Payment {
  id: string;
  customer_email: string;
  amount: number;
  currency: string;
  status: string;
  stripe_payment_intent_id: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
  };
  user_id: string | null;
  session_id: string | null;
  refund: {
    id: string;
    amount: number;
    refunded_at: string;
    reason: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

interface PaymentStats {
  total_transactions: number;
  total_revenue: number;
  pending_count: number;
  refunded_amount: number;
  today_revenue: number;
  this_month_revenue: number;
}

export function registerPaymentsTools(server: McpServer): void {
  // List payments
  server.tool(
    'list_payments',
    'List payment transactions with optional filters',
    {
      status: z.enum(['all', 'completed', 'refunded', 'failed', 'pending']).optional().describe('Filter by status'),
      product_id: z.string().uuid().optional().describe('Filter by product ID'),
      email: z.string().optional().describe('Filter by customer email'),
      date_from: z.string().optional().describe('Filter from date (ISO 8601)'),
      date_to: z.string().optional().describe('Filter to date (ISO 8601)'),
      cursor: z.string().optional().describe('Pagination cursor'),
      limit: z.number().min(1).max(100).optional().describe('Items per page (max 100)'),
      sort: z.string().optional().describe('Sort field with optional - prefix for desc (e.g., -created_at)'),
    },
    async (params) => {
      const api = getApiClient();
      const result = await api.get<{ data: Payment[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        '/api/v1/payments',
        params
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get single payment
  server.tool(
    'get_payment',
    'Get detailed information about a specific payment',
    {
      id: z.string().uuid().describe('Payment ID'),
    },
    async ({ id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: Payment }>(`/api/v1/payments/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );

  // Search payments
  server.tool(
    'search_payments',
    'Search for payments by customer email or product',
    {
      email: z.string().optional().describe('Customer email to search'),
      product_id: z.string().uuid().optional().describe('Product ID to filter by'),
    },
    async ({ email, product_id }) => {
      const api = getApiClient();
      const result = await api.get<{ data: Payment[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        '/api/v1/payments',
        { email, product_id, limit: 50 }
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Process refund
  server.tool(
    'process_refund',
    'Process a full or partial refund for a payment. Requires full API access scope.',
    {
      id: z.string().uuid().describe('Payment ID to refund'),
      amount: z.number().int().positive().optional().describe('Refund amount in cents. If not provided, full refund.'),
      reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional().describe('Reason for refund'),
    },
    async ({ id, amount, reason }) => {
      const api = getApiClient();
      const result = await api.post<{
        data: {
          payment_id: string;
          refund: {
            id: string;
            amount: number;
            currency: string;
            status: string;
            reason: string | null;
          };
          payment_status: string;
          total_refunded: number;
          created_at: string;
        };
      }>(`/api/v1/payments/${id}/refund`, { amount, reason });

      return {
        content: [{ type: 'text', text: `Refund processed successfully:\n${JSON.stringify(result.data, null, 2)}` }],
      };
    }
  );

  // Export payments
  server.tool(
    'export_payments',
    'Export payment transactions as CSV data',
    {
      status: z.enum(['all', 'completed', 'refunded', 'failed', 'pending']).optional().describe('Filter by status'),
      date_from: z.string().optional().describe('Filter from date (ISO 8601)'),
      date_to: z.string().optional().describe('Filter to date (ISO 8601)'),
      product_id: z.string().uuid().optional().describe('Filter by product ID'),
    },
    async (params) => {
      const api = getApiClient();

      // The export endpoint returns CSV, so we need to handle it differently
      // For MCP, we'll return the info about the export rather than the raw CSV
      // since Claude can't process binary files

      // First get a summary of what would be exported
      const paymentsResult = await api.get<{
        data: Payment[];
        pagination: { next_cursor: string | null; has_more: boolean };
      }>('/api/v1/payments', {
        status: params.status,
        date_from: params.date_from,
        date_to: params.date_to,
        product_id: params.product_id,
        limit: 100,
      });

      const summary = {
        total_records: paymentsResult.data.length,
        has_more: paymentsResult.pagination.has_more,
        filters_applied: {
          status: params.status || 'all',
          date_from: params.date_from || 'none',
          date_to: params.date_to || 'none',
          product_id: params.product_id || 'none',
        },
        sample_records: paymentsResult.data.slice(0, 5),
        export_note: 'Use the Sellf admin panel to download the actual CSV file',
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // List failed payments
  server.tool(
    'list_failed_payments',
    'List all failed payment transactions',
    {
      date_from: z.string().optional().describe('Filter from date (ISO 8601)'),
      date_to: z.string().optional().describe('Filter to date (ISO 8601)'),
      limit: z.number().min(1).max(100).optional().describe('Items per page'),
    },
    async ({ date_from, date_to, limit }) => {
      const api = getApiClient();
      const result = await api.get<{ data: Payment[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        '/api/v1/payments',
        { status: 'failed', date_from, date_to, limit }
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Get payment stats
  server.tool(
    'get_payment_stats',
    'Get payment statistics including total revenue, transaction counts, and trends',
    {},
    async () => {
      const api = getApiClient();
      const result = await api.get<{ data: PaymentStats }>('/api/v1/payments/stats');

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      };
    }
  );
}
