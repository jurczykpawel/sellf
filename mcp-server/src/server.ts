/**
 * Sellf MCP Server
 *
 * Main server setup - initializes McpServer with all tools, resources, and prompts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initApiClient } from './api-client.js';
import { registerProductsTools } from './tools/products.js';
import { registerUsersTools } from './tools/users.js';
import { registerPaymentsTools } from './tools/payments.js';
import { registerCouponsTools } from './tools/coupons.js';
import { registerAnalyticsTools } from './tools/analytics.js';
import { registerWebhooksTools } from './tools/webhooks.js';
import { registerSystemTools } from './tools/system.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

export interface ServerConfig {
  apiKey: string;
  apiUrl: string;
}

export function createServer(config: ServerConfig): McpServer {
  // Validate configuration
  if (!config.apiKey) {
    throw new Error('SELLF_API_KEY environment variable is required');
  }
  if (!config.apiUrl) {
    throw new Error('SELLF_API_URL environment variable is required');
  }

  // Initialize API client
  initApiClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  // Create MCP server instance
  const server = new McpServer({
    name: 'sellf',
    version: '1.0.0',
  });

  // Register all tools
  registerProductsTools(server);
  registerUsersTools(server);
  registerPaymentsTools(server);
  registerCouponsTools(server);
  registerAnalyticsTools(server);
  registerWebhooksTools(server);
  registerSystemTools(server);

  // Register resources
  registerResources(server);

  // Register prompts
  registerPrompts(server);

  return server;
}
