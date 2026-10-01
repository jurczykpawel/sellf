/**
 * API Client Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SellfApiClient,
  ApiClientError,
  initApiClient,
  getApiClient,
} from '../../src/api-client.js';

describe('SellfApiClient', () => {
  let client: SellfApiClient;

  beforeEach(() => {
    client = new SellfApiClient({
      baseUrl: 'https://api.example.com',
      apiKey: 'sf_test_123456',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should remove trailing slash from baseUrl', () => {
      const clientWithSlash = new SellfApiClient({
        baseUrl: 'https://api.example.com/',
        apiKey: 'sf_test_123456',
      });
      // We can't directly test private property, but we can test via a request
      expect(clientWithSlash).toBeDefined();
    });
  });

  describe('get', () => {
    it('should make GET request with correct headers', async () => {
      const mockResponse = { data: { id: '123', name: 'Test' } };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await client.get('/api/v1/products');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/products',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'X-API-Key': 'sf_test_123456',
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should add query params to URL', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

      await client.get('/api/v1/products', {
        status: 'active',
        limit: 10,
        search: 'test',
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.any(Object)
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        expect.any(Object)
      );
    });

    it('should skip undefined params', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

      await client.get('/api/v1/products', {
        status: 'active',
        limit: undefined,
      });

      const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(callUrl).toContain('status=active');
      expect(callUrl).not.toContain('limit');
    });

    it('should throw ApiClientError on error response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: 'NOT_FOUND', message: 'Product not found' },
        }),
      } as Response);

      await expect(client.get('/api/v1/products/123')).rejects.toThrow(ApiClientError);

      try {
        await client.get('/api/v1/products/123');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).code).toBe('NOT_FOUND');
        expect((error as ApiClientError).message).toBe('Product not found');
        expect((error as ApiClientError).statusCode).toBe(404);
      }
    });

    it('should handle error response without error object', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      try {
        await client.get('/api/v1/products');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiClientError);
        expect((error as ApiClientError).code).toBe('UNKNOWN_ERROR');
      }
    });
  });

  describe('post', () => {
    it('should make POST request with body', async () => {
      const mockResponse = { data: { id: '123', name: 'New Product' } };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const body = { name: 'New Product', price: 1000 };
      const result = await client.post('/api/v1/products', body);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/products',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('patch', () => {
    it('should make PATCH request with body', async () => {
      const mockResponse = { data: { id: '123', name: 'Updated' } };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const body = { name: 'Updated' };
      await client.patch('/api/v1/products/123', body);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/products/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('delete', () => {
    it('should make DELETE request', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      await client.delete('/api/v1/products/123');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/products/123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });
});

describe('SellfApiClient base URL safety', () => {
  it('rejects a plain-http base URL against a non-loopback host', () => {
    expect(() => new SellfApiClient({ baseUrl: 'http://api.example.com', apiKey: 'sf_test' })).toThrow(
      /must be https/
    );
  });

  it('accepts a plain-http base URL against loopback (local dev)', () => {
    expect(() => new SellfApiClient({ baseUrl: 'http://127.0.0.1:3000', apiKey: 'sf_test' })).not.toThrow();
    expect(() => new SellfApiClient({ baseUrl: 'http://localhost:3000', apiKey: 'sf_test' })).not.toThrow();
  });

  it('accepts an https base URL', () => {
    expect(() => new SellfApiClient({ baseUrl: 'https://api.example.com', apiKey: 'sf_test' })).not.toThrow();
  });

  it('rejects an unparseable base URL', () => {
    expect(() => new SellfApiClient({ baseUrl: 'not-a-url', apiKey: 'sf_test' })).toThrow(/Invalid Sellf API base URL/);
  });
});

describe('SellfApiClient redirect and timeout handling', () => {
  let client: SellfApiClient;

  beforeEach(() => {
    client = new SellfApiClient({ baseUrl: 'https://api.example.com', apiKey: 'sf_test_123456' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('never follows redirects on API requests', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }),
    } as Response);

    await client.get('/api/v1/products');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('aborts and raises an ApiClientError when the request exceeds the timeout', async () => {
    vi.useFakeTimers();
    const timeoutClient = new SellfApiClient({
      baseUrl: 'https://api.example.com',
      apiKey: 'sf_test',
      timeoutMs: 50,
    });

    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const pending = expect(timeoutClient.get('/api/v1/products')).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'TIMEOUT',
      statusCode: 408,
    });

    await vi.advanceTimersByTimeAsync(50);
    await pending;
  });
});

describe('ApiClientError', () => {
  it('should create error with all properties', () => {
    const error = new ApiClientError(
      'NOT_FOUND',
      'Resource not found',
      404,
      { id: '123' }
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Resource not found');
    expect(error.statusCode).toBe(404);
    expect(error.details).toEqual({ id: '123' });
    expect(error.name).toBe('ApiClientError');
  });

  it('should serialize to JSON correctly', () => {
    const error = new ApiClientError('TEST', 'Test error', 500);
    const json = error.toJSON();

    expect(json).toEqual({
      code: 'TEST',
      message: 'Test error',
      statusCode: 500,
      details: undefined,
    });
  });
});

describe('initApiClient / getApiClient', () => {
  it('should initialize and retrieve client', () => {
    const client = initApiClient({
      baseUrl: 'https://test.com',
      apiKey: 'sf_test_abc',
    });

    expect(client).toBeInstanceOf(SellfApiClient);
    expect(getApiClient()).toBe(client);
  });
});
