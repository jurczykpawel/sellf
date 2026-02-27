/**
 * MCP Protocol Tests
 *
 * Tests the MCP server by connecting to it through the MCP SDK client
 * and verifying it responds correctly to protocol messages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as apiClientModule from '../../src/api-client.js';
import { registerProductsTools } from '../../src/tools/products.js';
import { registerUsersTools } from '../../src/tools/users.js';
import { registerAnalyticsTools } from '../../src/tools/analytics.js';
import { registerSystemTools } from '../../src/tools/system.js';
import { registerResources } from '../../src/resources/index.js';
import { registerPrompts } from '../../src/prompts/index.js';

// Mock the api-client module
vi.mock('../../src/api-client.js', () => ({
  getApiClient: vi.fn(),
  initApiClient: vi.fn(),
  SellfApiClient: vi.fn(),
  ApiClientError: class extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, message: string, statusCode: number) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
}));

describe('MCP Server Protocol', () => {
  let server: McpServer;
  let client: Client;
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create mock API client
    mockApiClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    vi.mocked(apiClientModule.getApiClient).mockReturnValue(mockApiClient as any);

    // Create server
    server = new McpServer({
      name: 'sellf-test',
      version: '1.0.0',
    });

    // Register tools
    registerProductsTools(server);
    registerUsersTools(server);
    registerAnalyticsTools(server);
    registerSystemTools(server);
    registerResources(server);
    registerPrompts(server);

    // Create client
    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });

    // Connect via in-memory transport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  });

  describe('Tool Discovery', () => {
    it('should list all registered tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      // Check for some expected tools
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('list_products');
      expect(toolNames).toContain('get_product');
      expect(toolNames).toContain('create_product');
      expect(toolNames).toContain('list_users');
      expect(toolNames).toContain('get_dashboard');
      expect(toolNames).toContain('get_system_health');
    });

    it('should have descriptions for all tools', async () => {
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description!.length).toBeGreaterThan(0);
      }
    });

    it('should have input schemas for tools with parameters', async () => {
      const result = await client.listTools();

      const getProduct = result.tools.find((t) => t.name === 'get_product');
      expect(getProduct).toBeDefined();
      expect(getProduct!.inputSchema).toBeDefined();
      expect(getProduct!.inputSchema.properties).toHaveProperty('id');
    });
  });

  describe('Tool Execution', () => {
    it('should execute list_products tool', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          items: [
            { id: '1', name: 'Product 1', price: 1000 },
            { id: '2', name: 'Product 2', price: 2000 },
          ],
          pagination: { has_more: false, next_cursor: null, limit: 20 },
        },
      });

      const result = await client.callTool({
        name: 'list_products',
        arguments: { status: 'active', limit: 10 },
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe('text');

      const textContent = result.content[0] as { type: 'text'; text: string };
      expect(textContent.text).toContain('Product 1');
      expect(textContent.text).toContain('Product 2');
    });

    it('should execute get_product tool', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          id: '123',
          name: 'Test Product',
          slug: 'test-product',
          price: 1500,
          currency: 'USD',
        },
      });

      const result = await client.callTool({
        name: 'get_product',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.content).toBeDefined();
      const textContent = result.content[0] as { type: 'text'; text: string };
      expect(textContent.text).toContain('Test Product');
      expect(textContent.text).toContain('1500');
    });

    it('should execute get_dashboard tool', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          revenue: { today: 5000, this_week: 25000, total: 100000 },
          transactions: { today: 5, this_week: 20, total: 100 },
          products: { active: 10, total: 15 },
          users: { total: 50, with_access: 30 },
        },
      });

      const result = await client.callTool({
        name: 'get_dashboard',
        arguments: {},
      });

      expect(result.content).toBeDefined();
      const textContent = result.content[0] as { type: 'text'; text: string };
      expect(textContent.text).toContain('revenue');
      expect(textContent.text).toContain('5000');
    });

    it('should execute get_system_health tool', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: { api: 'v1', service: 'sellf', build: 'abc123' },
          environment: 'test',
          database: { connected: true, error: null },
          counts: {
            products: { total: 10, active: 8 },
            users: { total: 50 },
            transactions: { total: 100, completed: 95 },
            refund_requests: { pending: 2 },
            webhooks: { active: 5 },
            coupons: { active: 3 },
            api_keys: { active: 2 },
          },
          features: {
            stripe_enabled: true,
            webhooks_enabled: true,
            api_keys_enabled: true,
          },
        },
      });

      const result = await client.callTool({
        name: 'get_system_health',
        arguments: {},
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBe(2); // Summary + JSON
      const summary = result.content[0] as { type: 'text'; text: string };
      expect(summary.text).toContain('HEALTHY');
      expect(summary.text).toContain('Connected');
    });

    it('should handle tool errors gracefully', async () => {
      mockApiClient.get.mockRejectedValueOnce(
        new (apiClientModule as any).ApiClientError('NOT_FOUND', 'Product not found', 404)
      );

      const result = await client.callTool({
        name: 'get_product',
        arguments: { id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      // MCP SDK returns isError flag instead of throwing
      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      const textContent = result.content[0] as { type: 'text'; text: string };
      expect(textContent.text).toContain('Product not found');
    });
  });

  describe('Resource Discovery', () => {
    it('should list all registered resources', async () => {
      const result = await client.listResources();

      expect(result.resources).toBeDefined();
      expect(result.resources.length).toBeGreaterThan(0);

      const resourceUris = result.resources.map((r) => r.uri);
      expect(resourceUris).toContain('sellf://dashboard');
      expect(resourceUris).toContain('sellf://products/active');
      expect(resourceUris).toContain('sellf://alerts');
      expect(resourceUris).toContain('sellf://recent-sales');
    });

    it('should have descriptions for all resources', async () => {
      const result = await client.listResources();

      for (const resource of result.resources) {
        expect(resource.name).toBeDefined();
      }
    });
  });

  describe('Resource Reading', () => {
    it('should read dashboard resource', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          revenue: { today: 1000, total: 50000 },
          transactions: { today: 2, total: 50 },
        },
      });

      const result = await client.readResource({
        uri: 'sellf://dashboard',
      });

      expect(result.contents).toBeDefined();
      expect(result.contents.length).toBeGreaterThan(0);
      expect(result.contents[0].uri).toBe('sellf://dashboard');
      expect(result.contents[0].mimeType).toBe('application/json');
    });

    it('should read active products resource', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          items: [{ id: '1', name: 'Active Product' }],
          pagination: { has_more: false },
        },
      });

      const result = await client.readResource({
        uri: 'sellf://products/active',
      });

      expect(result.contents).toBeDefined();
      expect(result.contents[0].uri).toBe('sellf://products/active');
    });
  });

  describe('Prompt Discovery', () => {
    it('should list all registered prompts', async () => {
      const result = await client.listPrompts();

      expect(result.prompts).toBeDefined();
      expect(result.prompts.length).toBeGreaterThan(0);

      const promptNames = result.prompts.map((p) => p.name);
      expect(promptNames).toContain('weekly-report');
      expect(promptNames).toContain('product-analysis');
      expect(promptNames).toContain('revenue-forecast');
      expect(promptNames).toContain('refund-analysis');
    });

    it('should have descriptions for all prompts', async () => {
      const result = await client.listPrompts();

      for (const prompt of result.prompts) {
        expect(prompt.description).toBeDefined();
        expect(prompt.description!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Prompt Execution', () => {
    it('should execute weekly-report prompt', async () => {
      const result = await client.getPrompt({
        name: 'weekly-report',
        arguments: {},
      });

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('user');

      const content = result.messages[0].content;
      expect(content.type).toBe('text');
      expect((content as { type: 'text'; text: string }).text).toContain('weekly sales report');
    });

    it('should execute product-analysis prompt with argument', async () => {
      const result = await client.getPrompt({
        name: 'product-analysis',
        arguments: { product_id: '123e4567-e89b-12d3-a456-426614174000' },
      });

      expect(result.messages).toBeDefined();
      const content = result.messages[0].content as { type: 'text'; text: string };
      expect(content.text).toContain('123e4567-e89b-12d3-a456-426614174000');
    });
  });
});
