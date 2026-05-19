import { describe, it, expect } from 'vitest';
import { validateCrossOriginRequest } from '@/lib/cors';

describe('validateCrossOriginRequest', () => {
  function createMockRequest(options: {
    origin?: string | null;
    xRequestedWith?: string | null;
    method?: string;
  } = {}): Request {
    const headers = new Headers();
    if (options.origin) headers.set('origin', options.origin);
    if (options.xRequestedWith) headers.set('X-Requested-With', options.xRequestedWith);
    return { headers, method: options.method || 'POST' } as Request;
  }

  it('rejects requests without X-Requested-With header', () => {
    const request = createMockRequest({ origin: 'https://example.com', xRequestedWith: null });
    const result = validateCrossOriginRequest(request);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('rejects requests with wrong X-Requested-With value', () => {
    const request = createMockRequest({ origin: 'https://example.com', xRequestedWith: 'fetch' });
    const result = validateCrossOriginRequest(request);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });

  it('accepts requests with valid X-Requested-With header', () => {
    const request = createMockRequest({ origin: 'https://example.com', xRequestedWith: 'XMLHttpRequest' });
    const result = validateCrossOriginRequest(request);
    expect(result).toBeNull();
  });

  it('blocks simple form POST without the custom header', () => {
    const request = createMockRequest({ origin: 'https://other.example', xRequestedWith: null });
    const result = validateCrossOriginRequest(request);
    expect(result?.status).toBe(403);
  });

  it('blocks requests with no Origin and no custom header', () => {
    const request = createMockRequest({ origin: null, xRequestedWith: null });
    const result = validateCrossOriginRequest(request);
    expect(result?.status).toBe(403);
  });

  it('allows AJAX requests carrying the custom header', () => {
    const request = createMockRequest({ origin: 'https://app.example.com', xRequestedWith: 'XMLHttpRequest' });
    const result = validateCrossOriginRequest(request);
    expect(result).toBeNull();
  });
});
