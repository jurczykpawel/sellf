/**
 * Integration Tests - Full MCP to API Flow
 *
 * These tests verify the complete flow from MCP client through
 * MCP server to the API client with a mock HTTP server.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { initApiClient } from '../../src/api-client.js';
import { registerProductsTools } from '../../src/tools/products.js';
import { registerUsersTools } from '../../src/tools/users.js';
import { registerPaymentsTools } from '../../src/tools/payments.js';
import { registerCouponsTools } from '../../src/tools/coupons.js';
import { registerAnalyticsTools } from '../../src/tools/analytics.js';
import { registerWebhooksTools } from '../../src/tools/webhooks.js';
import { registerSystemTools } from '../../src/tools/system.js';
import { registerResources } from '../../src/resources/index.js';
import { registerPrompts } from '../../src/prompts/index.js';

// Mock HTTP server responses
const mockResponses: Record<string, unknown> = {};

function setMockResponse(path: string, method: string, response: unknown): void {
  mockResponses[`${method}:${path}`] = response;
}

function getMockResponse(path: string, method: string): unknown {
  // Remove query string from path
  const cleanPath = path.split('?')[0];

  // Try exact match first
  const exactKey = `${method}:${cleanPath}`;
  if (mockResponses[exactKey]) {
    return mockResponses[exactKey];
  }

  // Try pattern matching (for paths with IDs)
  for (const key of Object.keys(mockResponses)) {
    const colonIndex = key.indexOf(':');
    const keyMethod = key.substring(0, colonIndex);
    const keyPath = key.substring(colonIndex + 1);
    if (keyMethod !== method) continue;

    // Convert path pattern to regex (e.g., /api/v1/products/:id -> /api/v1/products/[^/]+)
    const pattern = keyPath.replace(/:[^/]+/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    if (regex.test(cleanPath)) {
      return mockResponses[key];
    }
  }

  return { error: { code: 'NOT_FOUND', message: 'Not found' } };
}

describe('Integration: Full MCP to API Flow', () => {
  let mockServer: Server;
  let mockServerPort: number;
  let mcpServer: McpServer;
  let mcpClient: Client;

  beforeAll(async () => {
    // Create mock HTTP server
    mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      const method = req.method || 'GET';
      const url = new URL(req.url || '/', `http://localhost`);
      const path = url.pathname;

      // Handle request body for POST/PATCH
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        const response = getMockResponse(path, method);
        const statusCode = (response as { error?: unknown })?.error ? 404 : 200;

        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        const address = mockServer.address();
        mockServerPort = typeof address === 'object' && address ? address.port : 3099;
        resolve();
      });
    });

    // Initialize API client with mock server URL
    initApiClient({
      baseUrl: `http://localhost:${mockServerPort}`,
      apiKey: 'gf_test_integration_key',
    });
  });

  afterAll(async () => {
    await mcpClient?.close();
    await mcpServer?.close();
    mockServer?.close();
  });

  beforeEach(async () => {
    // Clear mock responses
    Object.keys(mockResponses).forEach((key) => delete mockResponses[key]);

    // Create fresh MCP server and client for each test
    mcpServer = new McpServer({
      name: 'sellf-integration-test',
      version: '1.0.0',
    });

    // Register all tools, resources, and prompts
    registerProductsTools(mcpServer);
    registerUsersTools(mcpServer);
    registerPaymentsTools(mcpServer);
    registerCouponsTools(mcpServer);
    registerAnalyticsTools(mcpServer);
    registerWebhooksTools(mcpServer);
    registerSystemTools(mcpServer);
    registerResources(mcpServer);
    registerPrompts(mcpServer);

    mcpClient = new Client({
      name: 'integration-test-client',
      version: '1.0.0',
    });

    // Connect via in-memory transport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpClient.connect(clientTransport),
      mcpServer.connect(serverTransport),
    ]);
  });

  describe('Products Flow', () => {
    it('should list products through full MCP-API flow', async () => {
      setMockResponse('/api/v1/products', 'GET', {
        data: {
          items: [
            { id: 'prod-1', name: 'Product 1', price: 1000, currency: 'USD', is_active: true },
            { id: 'prod-2', name: 'Product 2', price: 2000, currency: 'USD', is_active: true },
          ],
          pagination: { has_more: false, next_cursor: null, limit: 20 },
        },
      });

      const result = await mcpClient.callTool({
        name: 'list_products',
        arguments: { status: 'active' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Product 1');
      expect(text).toContain('Product 2');
    });

    it('should get single product through full flow', async () => {
      setMockResponse('/api/v1/products/:id', 'GET', {
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test Product',
          slug: 'test-product',
          price: 2999,
          currency: 'USD',
          description: 'A test product',
          is_active: true,
        },
      });

      const result = await mcpClient.callTool({
        name: 'get_product',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Test Product');
      expect(text).toContain('2999');
    });

    it('should create product through full flow', async () => {
      setMockResponse('/api/v1/products', 'POST', {
        data: {
          id: 'new-prod-id',
          name: 'New Product',
          slug: 'new-product',
          price: 1500,
          currency: 'USD',
        },
      });

      const result = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'New Product',
          slug: 'new-product',
          description: 'A new test product',
          price: 1500,
          currency: 'USD',
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('created successfully');
    });

    it('should update product through full flow', async () => {
      setMockResponse('/api/v1/products/:id', 'PATCH', {
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Updated Product',
          price: 3000,
        },
      });

      const result = await mcpClient.callTool({
        name: 'update_product',
        arguments: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Updated Product',
          price: 3000,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('updated successfully');
    });

    it('should delete product through full flow', async () => {
      setMockResponse('/api/v1/products/:id', 'DELETE', {});

      const result = await mcpClient.callTool({
        name: 'delete_product',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('deleted successfully');
    });
  });

  describe('Users Flow', () => {
    it('should list users through full flow', async () => {
      setMockResponse('/api/v1/users', 'GET', {
        data: {
          items: [
            { id: 'user-1', email: 'user1@example.com', created_at: '2024-01-01' },
            { id: 'user-2', email: 'user2@example.com', created_at: '2024-01-02' },
          ],
          pagination: { has_more: false },
        },
      });

      const result = await mcpClient.callTool({
        name: 'list_users',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('user1@example.com');
      expect(text).toContain('user2@example.com');
    });

    it('should get user details through full flow', async () => {
      setMockResponse('/api/v1/users/:id', 'GET', {
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          email: 'test@example.com',
          created_at: '2024-01-01',
          product_access: [
            { product_id: 'prod-1', product_name: 'Product 1', granted_at: '2024-01-01' },
          ],
        },
      });

      const result = await mcpClient.callTool({
        name: 'get_user',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('test@example.com');
    });

    it('should grant access through full flow', async () => {
      setMockResponse('/api/v1/users/:id/access', 'POST', {
        data: {
          id: 'access-1',
          user_id: 'user-1',
          product_id: 'prod-1',
          granted_at: '2024-01-01',
        },
      });

      const result = await mcpClient.callTool({
        name: 'grant_access',
        arguments: {
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          product_id: '123e4567-e89b-12d3-a456-426614174001',
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('granted');
    });
  });

  describe('Payments Flow', () => {
    it('should list payments through full flow', async () => {
      setMockResponse('/api/v1/payments', 'GET', {
        data: {
          items: [
            { id: 'pay-1', amount_total: 1000, status: 'succeeded', created_at: '2024-01-01' },
            { id: 'pay-2', amount_total: 2000, status: 'succeeded', created_at: '2024-01-02' },
          ],
          pagination: { has_more: false },
        },
      });

      const result = await mcpClient.callTool({
        name: 'list_payments',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('pay-1');
      expect(text).toContain('1000');
    });

    it('should get payment details through full flow', async () => {
      setMockResponse('/api/v1/payments/:id', 'GET', {
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          amount_total: 2999,
          currency: 'USD',
          status: 'succeeded',
          customer_email: 'customer@example.com',
        },
      });

      const result = await mcpClient.callTool({
        name: 'get_payment',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('2999');
      expect(text).toContain('customer@example.com');
    });
  });

  describe('Analytics Flow', () => {
    it('should get dashboard through full flow', async () => {
      setMockResponse('/api/v1/analytics/dashboard', 'GET', {
        data: {
          revenue: { today: 5000, this_week: 25000, this_month: 100000, total: 500000 },
          transactions: { today: 10, this_week: 50, this_month: 200, total: 1000 },
          products: { active: 15, total: 20 },
          users: { total: 500, with_access: 300 },
        },
      });

      const result = await mcpClient.callTool({
        name: 'get_dashboard',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('5000');
      expect(text).toContain('revenue');
    });

    it('should get top products through full flow', async () => {
      setMockResponse('/api/v1/analytics/top-products', 'GET', {
        data: [
          { product_id: 'prod-1', product_name: 'Best Seller', revenue: 50000, sales_count: 100 },
          { product_id: 'prod-2', product_name: 'Second Best', revenue: 30000, sales_count: 60 },
        ],
      });

      const result = await mcpClient.callTool({
        name: 'get_top_products',
        arguments: { limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Best Seller');
      expect(text).toContain('50000');
    });
  });

  describe('System Flow', () => {
    it('should get system health through full flow', async () => {
      setMockResponse('/api/v1/system/status', 'GET', {
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: { api: 'v1', service: 'sellf', build: 'abc123' },
          environment: 'test',
          database: { connected: true, error: null },
          counts: {
            products: { total: 20, active: 15 },
            users: { total: 500 },
            transactions: { total: 1000, completed: 950 },
            refund_requests: { pending: 5 },
            webhooks: { active: 10 },
            coupons: { active: 8 },
            api_keys: { active: 3 },
          },
          features: {
            stripe_enabled: true,
            webhooks_enabled: true,
            api_keys_enabled: true,
          },
        },
      });

      const result = await mcpClient.callTool({
        name: 'get_system_health',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      expect(result.content.length).toBe(2); // Summary + JSON
      const summary = (result.content[0] as { type: 'text'; text: string }).text;
      expect(summary).toContain('HEALTHY');
    });
  });

  describe('Coupons Flow', () => {
    it('should list coupons through full flow', async () => {
      setMockResponse('/api/v1/coupons', 'GET', {
        data: {
          items: [
            { id: 'coupon-1', code: 'SAVE10', discount_type: 'percentage', discount_value: 10 },
            { id: 'coupon-2', code: 'SAVE20', discount_type: 'percentage', discount_value: 20 },
          ],
          pagination: { has_more: false },
        },
      });

      const result = await mcpClient.callTool({
        name: 'list_coupons',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('SAVE10');
      expect(text).toContain('SAVE20');
    });

    it('should create coupon through full flow', async () => {
      setMockResponse('/api/v1/coupons', 'POST', {
        data: {
          id: 'new-coupon',
          code: 'NEWCODE',
          discount_type: 'percentage',
          discount_value: 15,
        },
      });

      const result = await mcpClient.callTool({
        name: 'create_coupon',
        arguments: {
          code: 'NEWCODE',
          discount_type: 'percentage',
          discount_value: 15,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('created successfully');
    });
  });

  describe('Webhooks Flow', () => {
    it('should list webhooks through full flow', async () => {
      setMockResponse('/api/v1/webhooks', 'GET', {
        data: {
          items: [
            { id: 'wh-1', url: 'https://example.com/webhook1', events: ['payment.completed'] },
            { id: 'wh-2', url: 'https://example.com/webhook2', events: ['user.created'] },
          ],
          pagination: { has_more: false },
        },
      });

      const result = await mcpClient.callTool({
        name: 'list_webhooks',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('webhook1');
      expect(text).toContain('webhook2');
    });

    it('should create webhook through full flow', async () => {
      setMockResponse('/api/v1/webhooks', 'POST', {
        data: {
          id: 'new-webhook',
          url: 'https://example.com/new-webhook',
          events: ['payment.completed'],
          is_active: true,
        },
      });

      const result = await mcpClient.callTool({
        name: 'create_webhook',
        arguments: {
          url: 'https://example.com/new-webhook',
          events: ['payment.completed'],
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('created successfully');
    });
  });

  describe('Resources Flow', () => {
    it('should read dashboard resource through full flow', async () => {
      setMockResponse('/api/v1/analytics/dashboard', 'GET', {
        data: {
          revenue: { today: 1000, total: 50000 },
          transactions: { today: 5, total: 200 },
        },
      });

      const result = await mcpClient.readResource({
        uri: 'sellf://dashboard',
      });

      expect(result.contents).toBeDefined();
      expect(result.contents.length).toBeGreaterThan(0);
      expect(result.contents[0].uri).toBe('sellf://dashboard');
      expect(result.contents[0].mimeType).toBe('application/json');
    });

    it('should read active products resource through full flow', async () => {
      setMockResponse('/api/v1/products', 'GET', {
        data: {
          items: [{ id: '1', name: 'Active Product', is_active: true }],
          pagination: { has_more: false },
        },
      });

      const result = await mcpClient.readResource({
        uri: 'sellf://products/active',
      });

      expect(result.contents).toBeDefined();
      expect(result.contents[0].uri).toBe('sellf://products/active');
    });
  });

  describe('Prompts Flow', () => {
    it('should get weekly-report prompt', async () => {
      const result = await mcpClient.getPrompt({
        name: 'weekly-report',
        arguments: {},
      });

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('user');
    });

    it('should get product-analysis prompt with argument', async () => {
      const result = await mcpClient.getPrompt({
        name: 'product-analysis',
        arguments: { product_id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.messages).toBeDefined();
      const content = result.messages[0].content as { type: 'text'; text: string };
      expect(content.text).toContain('123e4567-e89b-12d3-a456-426614174000');
    });
  });
});
