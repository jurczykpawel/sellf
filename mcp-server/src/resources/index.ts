/**
 * Resources Module
 *
 * MCP resources provide auto-refreshing context data for Claude.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getApiClient } from '../api-client.js';

export function registerResources(server: McpServer): void {
  // Dashboard resource
  server.resource(
    'dashboard',
    'sellf://dashboard',
    { description: 'Dashboard overview with key business metrics', mimeType: 'application/json' },
    async () => {
      const api = getApiClient();
      const result = await api.get('/api/v1/analytics/dashboard');

      return {
        contents: [
          {
            uri: 'sellf://dashboard',
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Active products resource
  server.resource(
    'products-active',
    'sellf://products/active',
    { description: 'List of all active products available for purchase', mimeType: 'application/json' },
    async () => {
      const api = getApiClient();
      const result = await api.get('/api/v1/products', {
        status: 'active',
        limit: 100,
      });

      return {
        contents: [
          {
            uri: 'sellf://products/active',
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Alerts resource (pending refunds, failed webhooks)
  server.resource(
    'alerts',
    'sellf://alerts',
    { description: 'System alerts including pending refunds and failed webhooks', mimeType: 'application/json' },
    async () => {
      const api = getApiClient();

      // Fetch dashboard for refund info
      const dashboardResult = await api.get('/api/v1/analytics/dashboard');

      // Fetch failed payments
      const failedPaymentsResult = await api.get('/api/v1/payments', {
        status: 'failed',
        limit: 10,
      });

      // Fetch recent webhook logs with errors
      let webhookErrors: unknown[] = [];
      try {
        const webhookLogsResult = await api.get('/api/v1/webhooks/logs', {
          limit: 20,
        });
        webhookErrors = (webhookLogsResult as { data: { error_message: string | null }[] }).data?.filter(
          (log: { error_message: string | null }) => log.error_message
        ) || [];
      } catch {
        // Webhooks logs might not be accessible
      }

      const alerts = {
        pending_refunds: (dashboardResult as { data: { refunds: { pending_count: number } } }).data?.refunds?.pending_count || 0,
        failed_payments: (failedPaymentsResult as { data: unknown[] }).data?.length || 0,
        webhook_errors: webhookErrors.length,
        generated_at: new Date().toISOString(),
        details: {
          recent_failed_payments: (failedPaymentsResult as { data: unknown[] }).data?.slice(0, 5) || [],
          recent_webhook_errors: webhookErrors.slice(0, 5),
        },
      };

      return {
        contents: [
          {
            uri: 'sellf://alerts',
            mimeType: 'application/json',
            text: JSON.stringify(alerts, null, 2),
          },
        ],
      };
    }
  );

  // Recent sales resource
  server.resource(
    'recent-sales',
    'sellf://recent-sales',
    { description: 'Most recent successful payment transactions', mimeType: 'application/json' },
    async () => {
      const api = getApiClient();
      const result = await api.get('/api/v1/payments', {
        status: 'completed',
        limit: 10,
        sort: '-created_at',
      });

      return {
        contents: [
          {
            uri: 'sellf://recent-sales',
            mimeType: 'application/json',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
