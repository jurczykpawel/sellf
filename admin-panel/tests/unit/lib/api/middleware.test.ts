/**
 * API Middleware Unit Tests
 *
 * Tests for CORS handling, response helpers, and error handling.
 * Authentication functions require more complex mocking and are tested in E2E.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  getApiCorsHeaders,
  handleCorsPreFlight,
  jsonResponse,
  noContentResponse,
  apiError,
  ApiAuthError,
  ApiValidationError,
  handleApiError,
} from '@/lib/api/middleware';

// Mock NextRequest
function createMockRequest(options: {
  origin?: string | null;
  method?: string;
  headers?: Record<string, string>;
} = {}): NextRequest {
  const headers = new Headers();
  if (options.origin) {
    headers.set('origin', options.origin);
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  return {
    headers,
    method: options.method || 'GET',
  } as NextRequest;
}

describe('API Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getApiCorsHeaders', () => {
    it('should allow site URL origin', () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://mysite.com';

      const headers = getApiCorsHeaders('https://mysite.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://mysite.com');
    });

    it('should allow localhost origins', () => {
      const headers = getApiCorsHeaders('http://localhost:3000');
      expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });

    it('should allow 127.0.0.1 origins', () => {
      const headers = getApiCorsHeaders('http://127.0.0.1:8080');
      expect(headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:8080');
    });

    it('should fallback to site URL for unknown origins', () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://mysite.com';

      const headers = getApiCorsHeaders('https://unknown-site.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://mysite.com');
    });

    it('should fallback to SITE_URL if NEXT_PUBLIC_SITE_URL not set', () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      process.env.SITE_URL = 'https://backend.com';

      const headers = getApiCorsHeaders('https://unknown.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://backend.com');
    });

    it('should omit Access-Control-Allow-Origin if no site URL configured and origin not allowed', () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.SITE_URL;

      const headers = getApiCorsHeaders('https://unknown.com');
      // Security: omitting the header entirely blocks CORS per spec
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('should include Vary: Origin header for proper caching', () => {
      const headers = getApiCorsHeaders('http://localhost:3000');
      expect(headers['Vary']).toBe('Origin');
    });

    it('should include all required CORS headers', () => {
      const headers = getApiCorsHeaders(null);

      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PATCH, DELETE, OPTIONS');
      expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization, X-API-Key');
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(headers['Access-Control-Max-Age']).toBe('86400');
    });

    it('should handle null origin', () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://mysite.com';

      const headers = getApiCorsHeaders(null);
      expect(headers['Access-Control-Allow-Origin']).toBe('https://mysite.com');
    });
  });

  describe('handleCorsPreFlight', () => {
    it('should return 200 status', () => {
      const request = createMockRequest({ origin: 'http://localhost:3000' });
      const response = handleCorsPreFlight(request);

      expect(response.status).toBe(200);
    });

    it('should include CORS headers', () => {
      const request = createMockRequest({ origin: 'http://localhost:3000' });
      const response = handleCorsPreFlight(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
    });

    it('should have null body', () => {
      const request = createMockRequest();
      const response = handleCorsPreFlight(request);

      expect(response.body).toBe(null);
    });
  });

  describe('jsonResponse', () => {
    it('should return JSON response with data', async () => {
      const request = createMockRequest();
      const data = { id: '123', name: 'Test' };

      const response = jsonResponse(data, request);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(data);
    });

    it('should use custom status code', async () => {
      const request = createMockRequest();
      const response = jsonResponse({ created: true }, request, 201);

      expect(response.status).toBe(201);
    });

    it('should include CORS headers', () => {
      const request = createMockRequest({ origin: 'http://localhost:3000' });
      const response = jsonResponse({}, request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    it('should handle array data', async () => {
      const request = createMockRequest();
      const data = [{ id: 1 }, { id: 2 }];

      const response = jsonResponse(data, request);
      expect(await response.json()).toEqual(data);
    });

    it('should handle null data', async () => {
      const request = createMockRequest();
      const response = jsonResponse(null, request);

      expect(await response.json()).toBe(null);
    });
  });

  describe('noContentResponse', () => {
    it('should return 204 status', () => {
      const request = createMockRequest();
      const response = noContentResponse(request);

      expect(response.status).toBe(204);
    });

    it('should have null body', () => {
      const request = createMockRequest();
      const response = noContentResponse(request);

      expect(response.body).toBe(null);
    });

    it('should include CORS headers', () => {
      const request = createMockRequest({ origin: 'http://localhost:3000' });
      const response = noContentResponse(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });
  });

  describe('apiError', () => {
    it('should return NOT_FOUND with 404 status', async () => {
      const request = createMockRequest();
      const response = apiError(request, 'NOT_FOUND', 'Product not found');

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Product not found');
    });

    it('should return UNAUTHORIZED with 401 status', async () => {
      const request = createMockRequest();
      const response = apiError(request, 'UNAUTHORIZED', 'Auth required');

      expect(response.status).toBe(401);
    });

    it('should return VALIDATION_ERROR with 400 status', async () => {
      const request = createMockRequest();
      const response = apiError(request, 'VALIDATION_ERROR', 'Invalid input', {
        name: ['Name is required'],
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.details).toEqual({ name: ['Name is required'] });
    });

    it('should return RATE_LIMITED with 429 status', async () => {
      const request = createMockRequest();
      const response = apiError(request, 'RATE_LIMITED', 'Too many requests');

      expect(response.status).toBe(429);
    });

    it('should return INTERNAL_ERROR with 500 status', async () => {
      const request = createMockRequest();
      const response = apiError(request, 'INTERNAL_ERROR', 'Server error');

      expect(response.status).toBe(500);
    });
  });

  describe('ApiAuthError', () => {
    it('should create error with code and message', () => {
      const error = new ApiAuthError('UNAUTHORIZED', 'Not logged in');

      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.message).toBe('Not logged in');
      expect(error.name).toBe('ApiAuthError');
    });

    it('should be instanceof Error', () => {
      const error = new ApiAuthError('FORBIDDEN', 'Access denied');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiAuthError);
    });

    it('should support all auth error codes', () => {
      expect(new ApiAuthError('UNAUTHORIZED', 'test').code).toBe('UNAUTHORIZED');
      expect(new ApiAuthError('FORBIDDEN', 'test').code).toBe('FORBIDDEN');
      expect(new ApiAuthError('INVALID_TOKEN', 'test').code).toBe('INVALID_TOKEN');
      expect(new ApiAuthError('RATE_LIMITED', 'test').code).toBe('RATE_LIMITED');
    });
  });

  describe('ApiValidationError', () => {
    it('should create error with message only', () => {
      const error = new ApiValidationError('Invalid data');

      expect(error.message).toBe('Invalid data');
      expect(error.details).toBeUndefined();
      expect(error.name).toBe('ApiValidationError');
    });

    it('should create error with details', () => {
      const details = { email: ['Invalid format'] };
      const error = new ApiValidationError('Validation failed', details);

      expect(error.message).toBe('Validation failed');
      expect(error.details).toEqual(details);
    });

    it('should be instanceof Error', () => {
      const error = new ApiValidationError('test');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiValidationError);
    });
  });

  describe('handleApiError', () => {
    it('should handle ApiAuthError', async () => {
      const request = createMockRequest();
      const error = new ApiAuthError('FORBIDDEN', 'Access denied');

      const response = handleApiError(error, request);

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('Access denied');
    });

    it('should handle ApiValidationError', async () => {
      const request = createMockRequest();
      const error = new ApiValidationError('Invalid input', { name: ['Required'] });

      const response = handleApiError(error, request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual({ name: ['Required'] });
    });

    it('should handle legacy Unauthorized error', async () => {
      const request = createMockRequest();
      const error = new Error('Unauthorized');

      const response = handleApiError(error, request);

      expect(response.status).toBe(401);
    });

    it('should handle legacy Forbidden error', async () => {
      const request = createMockRequest();
      const error = new Error('Forbidden');

      const response = handleApiError(error, request);

      expect(response.status).toBe(403);
    });

    it('should handle unknown errors as INTERNAL_ERROR and log them', async () => {
      const request = createMockRequest();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = handleApiError(new Error('Unknown'), request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred');
      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalledWith('[handleApiError]', 'Error', 'Unknown');

      consoleSpy.mockRestore();
    });

    it('should handle non-Error objects and log them', async () => {
      const request = createMockRequest();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = handleApiError('string error', request);

      expect(response.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalledWith('[handleApiError]', 'string', 'Unknown error');

      consoleSpy.mockRestore();
    });
  });
});
