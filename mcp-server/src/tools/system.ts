/**
 * System Toolset
 *
 * MCP tools for Sellf system status and health checks.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getApiClient } from '../api-client.js';

interface SystemStatus {
  status: 'healthy' | 'degraded';
  timestamp: string;
  version: {
    api: string;
    service: string;
    build: string;
  };
  environment: string;
  database: {
    connected: boolean;
    error: string | null;
  };
  counts: {
    products: { total: number; active: number };
    users: { total: number };
    transactions: { total: number; completed: number };
    refund_requests: { pending: number };
    webhooks: { active: number };
    coupons: { active: number };
    api_keys: { active: number };
  };
  features: {
    stripe_enabled: boolean;
    webhooks_enabled: boolean;
    api_keys_enabled: boolean;
  };
}

export function registerSystemTools(server: McpServer): void {
  // Get system health
  server.tool(
    'get_system_health',
    'Get detailed system health status including database connectivity and resource counts',
    {},
    async () => {
      const api = getApiClient();
      const result = await api.get<{ data: SystemStatus }>('/api/v1/system/status');

      const status = result.data;

      // Format a human-readable summary
      const summary = `
System Status: ${status.status.toUpperCase()}
Timestamp: ${status.timestamp}
Version: ${status.version.api} (${status.version.build})
Environment: ${status.environment}

Database: ${status.database.connected ? 'Connected' : 'Disconnected'}${status.database.error ? ` (Error: ${status.database.error})` : ''}

Resource Counts:
- Products: ${status.counts.products.active}/${status.counts.products.total} active
- Users: ${status.counts.users.total}
- Transactions: ${status.counts.transactions.completed}/${status.counts.transactions.total} completed
- Pending Refunds: ${status.counts.refund_requests.pending}
- Active Webhooks: ${status.counts.webhooks.active}
- Active Coupons: ${status.counts.coupons.active}
- Active API Keys: ${status.counts.api_keys.active}

Features:
- Stripe: ${status.features.stripe_enabled ? 'Enabled' : 'Disabled'}
- Webhooks: ${status.features.webhooks_enabled ? 'Enabled' : 'Disabled'}
- API Keys: ${status.features.api_keys_enabled ? 'Enabled' : 'Disabled'}
`.trim();

      return {
        content: [
          { type: 'text', text: summary },
          { type: 'text', text: '\n\nFull JSON:\n' + JSON.stringify(result.data, null, 2) },
        ],
      };
    }
  );

  // Get API usage (from system status - API key stats)
  server.tool(
    'get_api_usage',
    'Get API usage statistics including active API keys count',
    {},
    async () => {
      const api = getApiClient();
      const result = await api.get<{ data: SystemStatus }>('/api/v1/system/status');

      const usage = {
        api_keys: {
          active_count: result.data.counts.api_keys.active,
        },
        system: {
          status: result.data.status,
          environment: result.data.environment,
          api_version: result.data.version.api,
        },
        features_enabled: result.data.features,
        timestamp: result.data.timestamp,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(usage, null, 2) }],
      };
    }
  );
}
