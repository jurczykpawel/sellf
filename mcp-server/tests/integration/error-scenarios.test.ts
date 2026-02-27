/**
 * Integration Tests - Error Scenarios
 *
 * Tests network errors, timeouts, and various API error responses
 * through the full MCP to API flow.
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
import { registerSystemTools } from '../../src/tools/system.js';

// Response configuration for mock server
let mockResponseConfig: {
  statusCode: number;
  body: unknown;
  delay?: number;
  shouldHangup?: boolean;
} = { statusCode: 200, body: {} };

function setMockConfig(config: typeof mockResponseConfig): void {
  mockResponseConfig = config;
}

describe('Integration: Error Scenarios', () => {
  let mockServer: Server;
  let mockServerPort: number;
  let mcpServer: McpServer;
  let mcpClient: Client;

  beforeAll(async () => {
    // Create mock HTTP server that can simulate various error conditions
    mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Check if we should hang up immediately (simulate connection reset)
      if (mockResponseConfig.shouldHangup) {
        req.socket.destroy();
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        const respond = () => {
          res.writeHead(mockResponseConfig.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mockResponseConfig.body));
        };

        // Add delay if configured
        if (mockResponseConfig.delay) {
          setTimeout(respond, mockResponseConfig.delay);
        } else {
          respond();
        }
      });
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        const address = mockServer.address();
        mockServerPort = typeof address === 'object' && address ? address.port : 3098;
        resolve();
      });
    });

    // Initialize API client
    initApiClient({
      baseUrl: `http://localhost:${mockServerPort}`,
      apiKey: 'gf_test_error_scenarios',
    });
  });

  afterAll(async () => {
    await mcpClient?.close();
    await mcpServer?.close();
    mockServer?.close();
  });

  beforeEach(async () => {
    // Reset mock config
    mockResponseConfig = { statusCode: 200, body: {} };

    // Create fresh MCP server and client
    mcpServer = new McpServer({
      name: 'sellf-error-test',
      version: '1.0.0',
    });

    registerProductsTools(mcpServer);
    registerUsersTools(mcpServer);
    registerPaymentsTools(mcpServer);
    registerCouponsTools(mcpServer);
    registerAnalyticsTools(mcpServer);
    registerSystemTools(mcpServer);

    mcpClient = new Client({
      name: 'error-test-client',
      version: '1.0.0',
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      mcpClient.connect(clientTransport),
      mcpServer.connect(serverTransport),
    ]);
  });

  describe('HTTP Status Errors', () => {
    it('should handle 400 Bad Request', async () => {
      setMockConfig({
        statusCode: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid product data' } },
      });

      const result = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Test',
          slug: 'test',
          description: 'A test product',
          price: 100,
          currency: 'USD',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Invalid product data');
    });

    it('should handle 401 Unauthorized', async () => {
      setMockConfig({
        statusCode: 401,
        body: { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } },
      });

      const result = await mcpClient.callTool({
        name: 'list_products',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Invalid API key');
    });

    it('should handle 403 Forbidden', async () => {
      setMockConfig({
        statusCode: 403,
        body: { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      });

      const result = await mcpClient.callTool({
        name: 'delete_product',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Insufficient permissions');
    });

    it('should handle 404 Not Found', async () => {
      setMockConfig({
        statusCode: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Product not found' } },
      });

      const result = await mcpClient.callTool({
        name: 'get_product',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Product not found');
    });

    it('should handle 409 Conflict', async () => {
      setMockConfig({
        statusCode: 409,
        body: { error: { code: 'CONFLICT', message: 'Product with this slug already exists' } },
      });

      const result = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Duplicate',
          slug: 'existing-slug',
          description: 'A duplicate product',
          price: 1000,
          currency: 'USD',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('already exists');
    });

    it('should handle 422 Unprocessable Entity', async () => {
      setMockConfig({
        statusCode: 422,
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: { price: 'must be a positive number' },
          },
        },
      });

      const result = await mcpClient.callTool({
        name: 'update_product',
        arguments: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          price: 0,
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Validation failed');
    });

    it('should handle 429 Too Many Requests', async () => {
      setMockConfig({
        statusCode: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
      });

      const result = await mcpClient.callTool({
        name: 'list_products',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Too many requests');
    });

    it('should handle 500 Internal Server Error', async () => {
      setMockConfig({
        statusCode: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } },
      });

      const result = await mcpClient.callTool({
        name: 'get_dashboard',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('unexpected error');
    });

    it('should handle 502 Bad Gateway', async () => {
      setMockConfig({
        statusCode: 502,
        body: { error: { code: 'BAD_GATEWAY', message: 'Upstream server error' } },
      });

      const result = await mcpClient.callTool({
        name: 'list_payments',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Upstream server error');
    });

    it('should handle 503 Service Unavailable', async () => {
      setMockConfig({
        statusCode: 503,
        body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' } },
      });

      const result = await mcpClient.callTool({
        name: 'get_system_health',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('temporarily unavailable');
    });
  });

  describe('Malformed Responses', () => {
    it('should handle empty error response', async () => {
      setMockConfig({
        statusCode: 500,
        body: {},
      });

      const result = await mcpClient.callTool({
        name: 'list_products',
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });

    it('should handle error response without message', async () => {
      setMockConfig({
        statusCode: 400,
        body: { error: { code: 'BAD_REQUEST' } },
      });

      const result = await mcpClient.callTool({
        name: 'create_product',
        arguments: {
          name: 'Test',
          slug: 'test',
          price: 1000,
          currency: 'USD',
        },
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Tool-Specific Error Handling', () => {
    it('should handle grant_access with invalid user', async () => {
      setMockConfig({
        statusCode: 404,
        body: { error: { code: 'USER_NOT_FOUND', message: 'User does not exist' } },
      });

      const result = await mcpClient.callTool({
        name: 'grant_access',
        arguments: {
          user_id: '123e4567-e89b-12d3-a456-426614174000',
          product_id: '123e4567-e89b-12d3-a456-426614174001',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('User does not exist');
    });

    it('should handle process_refund with already refunded payment', async () => {
      setMockConfig({
        statusCode: 400,
        body: { error: { code: 'ALREADY_REFUNDED', message: 'Payment has already been refunded' } },
      });

      const result = await mcpClient.callTool({
        name: 'process_refund',
        arguments: {
          id: '123e4567-e89b-12d3-a456-426614174000',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('already been refunded');
    });

    it('should handle duplicate coupon code', async () => {
      setMockConfig({
        statusCode: 409,
        body: { error: { code: 'DUPLICATE_CODE', message: 'Coupon code already exists' } },
      });

      const result = await mcpClient.callTool({
        name: 'create_coupon',
        arguments: {
          code: 'EXISTING',
          discount_type: 'percentage',
          discount_value: 10,
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('already exists');
    });
  });

  describe('Multiple Tools Recover from Errors', () => {
    it('should continue working after an error', async () => {
      // First call - error
      setMockConfig({
        statusCode: 500,
        body: { error: { code: 'INTERNAL_ERROR', message: 'Temporary error' } },
      });

      const errorResult = await mcpClient.callTool({
        name: 'list_products',
        arguments: {},
      });
      expect(errorResult.isError).toBe(true);

      // Second call - success
      setMockConfig({
        statusCode: 200,
        body: {
          data: {
            items: [{ id: '1', name: 'Product' }],
            pagination: { has_more: false },
          },
        },
      });

      const successResult = await mcpClient.callTool({
        name: 'list_products',
        arguments: {},
      });
      expect(successResult.isError).toBeFalsy();
      const text = (successResult.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Product');
    });
  });
});
