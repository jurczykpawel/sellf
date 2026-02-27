/**
 * Products Tools Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProductsTools } from '../../../src/tools/products.js';
import * as apiClientModule from '../../../src/api-client.js';

// Mock the api-client module
vi.mock('../../../src/api-client.js', () => ({
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

describe('Products Tools', () => {
  let server: McpServer;
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let registeredTools: Map<string, { handler: Function; description: string }>;

  beforeEach(() => {
    // Create mock API client
    mockApiClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    vi.mocked(apiClientModule.getApiClient).mockReturnValue(mockApiClient as any);

    // Create server and capture registered tools
    server = new McpServer({ name: 'test', version: '1.0.0' });
    registeredTools = new Map();

    // Spy on server.tool to capture registrations
    const originalTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((name: string, ...args: any[]) => {
      const description = typeof args[0] === 'string' ? args[0] : '';
      const handler = args[args.length - 1];
      registeredTools.set(name, { handler, description });
      return originalTool(name, ...args);
    });

    // Register tools
    registerProductsTools(server);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list_products', () => {
    it('should be registered', () => {
      expect(registeredTools.has('list_products')).toBe(true);
    });

    it('should call API with correct params', async () => {
      const mockResponse = {
        data: {
          items: [{ id: '1', name: 'Product 1' }],
          pagination: { has_more: false, next_cursor: null },
        },
      };
      mockApiClient.get.mockResolvedValueOnce(mockResponse);

      const tool = registeredTools.get('list_products')!;
      const result = await tool.handler({ status: 'active', limit: 10 }, {});

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/products', {
        status: 'active',
        limit: 10,
        search: undefined,
        cursor: undefined,
        sort_by: undefined,
        sort_order: undefined,
      });
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Product 1');
    });
  });

  describe('get_product', () => {
    it('should be registered', () => {
      expect(registeredTools.has('get_product')).toBe(true);
    });

    it('should call API with product ID', async () => {
      const mockProduct = {
        id: '123',
        name: 'Test Product',
        price: 1000,
      };
      mockApiClient.get.mockResolvedValueOnce({ data: mockProduct });

      const tool = registeredTools.get('get_product')!;
      const result = await tool.handler({ id: '123' }, {});

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/products/123');
      expect(result.content[0].text).toContain('Test Product');
    });
  });

  describe('create_product', () => {
    it('should be registered', () => {
      expect(registeredTools.has('create_product')).toBe(true);
    });

    it('should call API with product data', async () => {
      const newProduct = {
        name: 'New Product',
        slug: 'new-product',
        description: 'A new product',
        price: 2000,
        currency: 'USD',
      };
      mockApiClient.post.mockResolvedValueOnce({ data: { id: '456', ...newProduct } });

      const tool = registeredTools.get('create_product')!;
      const result = await tool.handler(newProduct, {});

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/products', newProduct);
      expect(result.content[0].text).toContain('created successfully');
    });
  });

  describe('update_product', () => {
    it('should be registered', () => {
      expect(registeredTools.has('update_product')).toBe(true);
    });

    it('should call API with update data', async () => {
      mockApiClient.patch.mockResolvedValueOnce({
        data: { id: '123', name: 'Updated Product' },
      });

      const tool = registeredTools.get('update_product')!;
      const result = await tool.handler({ id: '123', name: 'Updated Product' }, {});

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/v1/products/123', {
        name: 'Updated Product',
      });
      expect(result.content[0].text).toContain('updated successfully');
    });
  });

  describe('delete_product', () => {
    it('should be registered', () => {
      expect(registeredTools.has('delete_product')).toBe(true);
    });

    it('should call API to delete product', async () => {
      mockApiClient.delete.mockResolvedValueOnce({});

      const tool = registeredTools.get('delete_product')!;
      const result = await tool.handler({ id: '123' }, {});

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/v1/products/123');
      expect(result.content[0].text).toContain('deleted successfully');
    });
  });

  describe('toggle_product_status', () => {
    it('should be registered', () => {
      expect(registeredTools.has('toggle_product_status')).toBe(true);
    });

    it('should activate product', async () => {
      mockApiClient.patch.mockResolvedValueOnce({
        data: { id: '123', name: 'Product', is_active: true },
      });

      const tool = registeredTools.get('toggle_product_status')!;
      const result = await tool.handler({ id: '123', is_active: true }, {});

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/v1/products/123', {
        is_active: true,
      });
      expect(result.content[0].text).toContain('activated');
    });

    it('should deactivate product', async () => {
      mockApiClient.patch.mockResolvedValueOnce({
        data: { id: '123', name: 'Product', is_active: false },
      });

      const tool = registeredTools.get('toggle_product_status')!;
      const result = await tool.handler({ id: '123', is_active: false }, {});

      expect(result.content[0].text).toContain('deactivated');
    });
  });

  describe('duplicate_product', () => {
    it('should be registered', () => {
      expect(registeredTools.has('duplicate_product')).toBe(true);
    });

    it('should fetch source and create new product', async () => {
      const sourceProduct = {
        id: '123',
        name: 'Original',
        slug: 'original',
        description: 'Original description',
        price: 1000,
        currency: 'USD',
        is_active: true,
        is_featured: true,
        icon: '📦',
        content_delivery_type: 'content',
        content_config: null,
        available_from: null,
        available_until: null,
        auto_grant_duration_days: null,
        categories: [{ id: 'cat1', name: 'Category 1', slug: 'cat1' }],
      };

      mockApiClient.get.mockResolvedValueOnce({ data: sourceProduct });
      mockApiClient.post.mockResolvedValueOnce({
        data: { id: '456', name: 'Copy of Original' },
      });

      const tool = registeredTools.get('duplicate_product')!;
      const result = await tool.handler({
        source_id: '123',
        new_name: 'Copy of Original',
        new_slug: 'copy-of-original',
      }, {});

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/products/123');
      expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/products', expect.objectContaining({
        name: 'Copy of Original',
        slug: 'copy-of-original',
        description: 'Original description',
        price: 1000,
        is_active: false, // New products start inactive
        categories: ['cat1'],
      }));
      expect(result.content[0].text).toContain('duplicated successfully');
    });
  });

  describe('get_product_stats', () => {
    it('should be registered', () => {
      expect(registeredTools.has('get_product_stats')).toBe(true);
    });

    it('should fetch product and payments to compute stats', async () => {
      mockApiClient.get
        .mockResolvedValueOnce({
          data: { id: '123', name: 'Product', price: 1000, currency: 'USD', is_active: true },
        })
        .mockResolvedValueOnce({
          data: {
            items: [
              { status: 'succeeded', amount_total: 1000 },
              { status: 'succeeded', amount_total: 1000 },
              { status: 'failed', amount_total: 1000 },
            ],
          },
        });

      const tool = registeredTools.get('get_product_stats')!;
      const result = await tool.handler({ product_id: '123' }, {});

      const stats = JSON.parse(result.content[0].text);
      expect(stats.product.name).toBe('Product');
      expect(stats.sales.total_transactions).toBe(2);
      expect(stats.sales.total_revenue).toBe(2000);
    });
  });
});
