import { describe, expect, it } from 'vitest';

import {
  buildEmbedCorsHeaders,
  isAllowedEmbedOrigin,
  parseEmbedCheckoutBody,
  sanitizeAllowedEmbedOrigins,
} from '@/lib/embed/checkout-embed';

describe('checkout embed security helpers', () => {
  it('allows only exact HTTPS origins from the configured list', () => {
    const allowed = sanitizeAllowedEmbedOrigins([
      'https://landing.example.com',
      'https://sellf.techskills.academy/',
      'http://localhost:3000',
    ]);

    expect(isAllowedEmbedOrigin('https://landing.example.com', allowed)).toBe(true);
    expect(isAllowedEmbedOrigin('https://sellf.techskills.academy', allowed)).toBe(true);
    expect(isAllowedEmbedOrigin('http://localhost:3000', allowed)).toBe(true);
    expect(isAllowedEmbedOrigin('https://evil.example.com', allowed)).toBe(false);
    expect(isAllowedEmbedOrigin('https://landing.example.com.evil.test', allowed)).toBe(false);
    expect(isAllowedEmbedOrigin(null, allowed)).toBe(false);
  });

  it('builds CORS headers without credentials and without wildcard fallback', () => {
    const headers = buildEmbedCorsHeaders('https://landing.example.com', [
      'https://landing.example.com',
    ]);

    expect(headers['Access-Control-Allow-Origin']).toBe('https://landing.example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Sellf-Embed-Version');
    expect(headers.Vary).toBe('Origin');

    const deniedHeaders = buildEmbedCorsHeaders(null, ['https://landing.example.com']);
    expect(deniedHeaders['Access-Control-Allow-Origin']).toBeUndefined();
    expect(deniedHeaders['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('accepts only the embed request fields owned by Sellf', () => {
    expect(parseEmbedCheckoutBody({ productSlug: 'kurs-ai', email: 'buyer@example.com' })).toEqual({
      ok: true,
      value: { productSlug: 'kurs-ai', email: 'buyer@example.com' },
    });

    expect(parseEmbedCheckoutBody({ productSlug: 'kurs-ai', successUrl: 'https://evil.example' })).toEqual({
      ok: false,
      error: 'Invalid request',
    });

    expect(parseEmbedCheckoutBody({ productId: 'product-id' })).toEqual({
      ok: false,
      error: 'Invalid request',
    });
  });
});
